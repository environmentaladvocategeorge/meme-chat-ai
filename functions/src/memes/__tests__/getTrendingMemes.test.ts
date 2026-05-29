import { HttpsError } from "firebase-functions/v2/https";
import { getTrendingMemesImpl, searchMemesImpl } from "../getTrendingMemes";
import * as klipy from "../klipy";

jest.mock("../klipy", () => {
  const actual = jest.requireActual("../klipy");
  return { ...actual, fetchTrendingMemes: jest.fn(), searchMemes: jest.fn() };
});

const fetchTrendingMemes = klipy.fetchTrendingMemes as jest.Mock;
const searchMemes = klipy.searchMemes as jest.Mock;

const RESULT = { memes: [], page: 1, perPage: 24, hasNext: false };

describe("getTrendingMemesImpl", () => {
  beforeEach(() => {
    fetchTrendingMemes.mockReset();
    fetchTrendingMemes.mockResolvedValue(RESULT);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(getTrendingMemesImpl(undefined, "key", {})).rejects.toThrow(
      HttpsError,
    );
    expect(fetchTrendingMemes).not.toHaveBeenCalled();
  });

  it("rejects when the app key is not configured", async () => {
    await expect(getTrendingMemesImpl("uid", "", {})).rejects.toThrow(HttpsError);
  });

  it("passes the uid through as customer_id and applies defaults", async () => {
    await getTrendingMemesImpl("uid-7", "key", {});
    expect(fetchTrendingMemes).toHaveBeenCalledWith({
      apiKey: "key",
      page: 1,
      perPage: 24,
      customerId: "uid-7",
      locale: undefined,
      contentFilter: "medium",
    });
  });

  it("tolerates the callable protocol encoding optional fields as null", async () => {
    // Firebase encodes client-side `undefined` as `null` on the wire — this is
    // the exact payload the app sends with no locale/filter selected.
    await getTrendingMemesImpl("uid-9", "key", {
      page: 1,
      perPage: 24,
      locale: null,
      contentFilter: null,
    });
    expect(fetchTrendingMemes).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        perPage: 24,
        locale: undefined,
        contentFilter: "medium",
      }),
    );
  });

  it("forwards validated pagination + filter args", async () => {
    await getTrendingMemesImpl("uid", "key", {
      page: 3,
      perPage: 50,
      locale: "US",
      contentFilter: "high",
    });
    expect(fetchTrendingMemes).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 3,
        perPage: 50,
        locale: "us",
        contentFilter: "high",
      }),
    );
  });

  it("rejects perPage above the Klipy max", async () => {
    await expect(
      getTrendingMemesImpl("uid", "key", { perPage: 51 }),
    ).rejects.toThrow(HttpsError);
  });

  it("rejects a malformed locale", async () => {
    await expect(
      getTrendingMemesImpl("uid", "key", { locale: "usa" }),
    ).rejects.toThrow(HttpsError);
  });

  it("maps a KlipyError to an unavailable HttpsError", async () => {
    fetchTrendingMemes.mockRejectedValue(new klipy.KlipyError("boom", 500));
    await expect(getTrendingMemesImpl("uid", "key", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("returns the normalized result on success", async () => {
    const result = await getTrendingMemesImpl("uid", "key", {});
    expect(result).toBe(RESULT);
  });
});

describe("searchMemesImpl", () => {
  beforeEach(() => {
    searchMemes.mockReset();
    searchMemes.mockResolvedValue(RESULT);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      searchMemesImpl(undefined, "key", { query: "cat" }),
    ).rejects.toThrow(HttpsError);
    expect(searchMemes).not.toHaveBeenCalled();
  });

  it("rejects when the app key is not configured", async () => {
    await expect(
      searchMemesImpl("uid", "", { query: "cat" }),
    ).rejects.toThrow(HttpsError);
  });

  it("requires a non-empty query", async () => {
    await expect(searchMemesImpl("uid", "key", {})).rejects.toThrow(HttpsError);
    await expect(
      searchMemesImpl("uid", "key", { query: "   " }),
    ).rejects.toThrow(HttpsError);
    expect(searchMemes).not.toHaveBeenCalled();
  });

  it("forwards the trimmed query, uid, and defaults", async () => {
    await searchMemesImpl("uid-3", "key", { query: "  dancing cat  " });
    expect(searchMemes).toHaveBeenCalledWith({
      apiKey: "key",
      query: "dancing cat",
      page: 1,
      perPage: 24,
      customerId: "uid-3",
      locale: undefined,
      contentFilter: "medium",
    });
  });

  it("enforces the search per_page minimum of 8", async () => {
    await expect(
      searchMemesImpl("uid", "key", { query: "cat", perPage: 4 }),
    ).rejects.toThrow(HttpsError);
  });

  it("tolerates the callable protocol encoding optional fields as null", async () => {
    await searchMemesImpl("uid", "key", {
      query: "cat",
      page: 1,
      perPage: 24,
      locale: null,
      contentFilter: null,
    });
    expect(searchMemes).toHaveBeenCalledWith(
      expect.objectContaining({ locale: undefined, contentFilter: "medium" }),
    );
  });

  it("maps a KlipyError to an unavailable HttpsError", async () => {
    searchMemes.mockRejectedValue(new klipy.KlipyError("boom", 500));
    await expect(
      searchMemesImpl("uid", "key", { query: "cat" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
