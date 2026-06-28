import { HttpsError } from "firebase-functions/v2/https";
import { getTrendingStickersImpl, searchStickersImpl } from "../getStickers";
import * as klipy from "../klipy";

jest.mock("../klipy", () => {
  const actual = jest.requireActual("../klipy");
  return { ...actual, fetchTrendingStickers: jest.fn(), searchStickers: jest.fn() };
});

const fetchTrendingStickers = klipy.fetchTrendingStickers as jest.Mock;
const searchStickers = klipy.searchStickers as jest.Mock;

const RESULT = { stickers: [], page: 1, perPage: 24, hasNext: false };

describe("getTrendingStickersImpl", () => {
  beforeEach(() => {
    fetchTrendingStickers.mockReset();
    fetchTrendingStickers.mockResolvedValue(RESULT);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(getTrendingStickersImpl(undefined, "key", {})).rejects.toThrow(
      HttpsError,
    );
    expect(fetchTrendingStickers).not.toHaveBeenCalled();
  });

  it("rejects when the app key is not configured", async () => {
    await expect(getTrendingStickersImpl("uid", "", {})).rejects.toThrow(HttpsError);
  });

  it("passes the uid through as customer_id and applies defaults", async () => {
    await getTrendingStickersImpl("uid-7", "key", {});
    expect(fetchTrendingStickers).toHaveBeenCalledWith({
      apiKey: "key",
      page: 1,
      perPage: 24,
      customerId: "uid-7",
      locale: undefined,
      contentFilter: "medium",
    });
  });

  it("tolerates the callable protocol encoding optional fields as null", async () => {
    await getTrendingStickersImpl("uid-9", "key", {
      page: 1,
      perPage: 24,
      locale: null,
      contentFilter: null,
    });
    expect(fetchTrendingStickers).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        perPage: 24,
        locale: undefined,
        contentFilter: "medium",
      }),
    );
  });

  it("rejects perPage above the Klipy max", async () => {
    await expect(
      getTrendingStickersImpl("uid", "key", { perPage: 51 }),
    ).rejects.toThrow(HttpsError);
  });

  it("rejects a malformed locale", async () => {
    await expect(
      getTrendingStickersImpl("uid", "key", { locale: "usa" }),
    ).rejects.toThrow(HttpsError);
  });

  it("maps a KlipyError to an unavailable HttpsError", async () => {
    fetchTrendingStickers.mockRejectedValue(new klipy.KlipyError("boom", 500));
    await expect(getTrendingStickersImpl("uid", "key", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("returns the normalized result on success", async () => {
    const result = await getTrendingStickersImpl("uid", "key", {});
    expect(result).toBe(RESULT);
  });
});

describe("searchStickersImpl", () => {
  beforeEach(() => {
    searchStickers.mockReset();
    searchStickers.mockResolvedValue(RESULT);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      searchStickersImpl(undefined, "key", { query: "rawr" }),
    ).rejects.toThrow(HttpsError);
    expect(searchStickers).not.toHaveBeenCalled();
  });

  it("requires a non-empty query", async () => {
    await expect(searchStickersImpl("uid", "key", {})).rejects.toThrow(HttpsError);
    await expect(
      searchStickersImpl("uid", "key", { query: "   " }),
    ).rejects.toThrow(HttpsError);
    expect(searchStickers).not.toHaveBeenCalled();
  });

  it("forwards the trimmed query, uid, and defaults", async () => {
    await searchStickersImpl("uid-3", "key", { query: "  rawr dino  " });
    expect(searchStickers).toHaveBeenCalledWith({
      apiKey: "key",
      query: "rawr dino",
      page: 1,
      perPage: 24,
      customerId: "uid-3",
      locale: undefined,
      contentFilter: "medium",
    });
  });

  it("enforces the search per_page minimum of 8", async () => {
    await expect(
      searchStickersImpl("uid", "key", { query: "rawr", perPage: 4 }),
    ).rejects.toThrow(HttpsError);
  });

  it("maps a KlipyError to an unavailable HttpsError", async () => {
    searchStickers.mockRejectedValue(new klipy.KlipyError("boom", 500));
    await expect(
      searchStickersImpl("uid", "key", { query: "rawr" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
