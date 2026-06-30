import {
  asNumber,
  asString,
  KLIPY_BASE_URL,
  KlipyError,
  requestKlipyList,
} from "../client";

describe("asString / asNumber", () => {
  it("asString returns strings, else empty", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString(5)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(undefined)).toBe("");
  });

  it("asNumber returns finite numbers, else 0", () => {
    expect(asNumber(5)).toBe(5);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(NaN)).toBe(0);
    expect(asNumber(Infinity)).toBe(0);
    expect(asNumber("5")).toBe(0);
  });
});

describe("requestKlipyList", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const params = { apiKey: "app-key", page: 2, perPage: 24, customerId: "uid-1" };

  const okBody = {
    result: true,
    data: {
      data: [{ keep: 1 }, { drop: 1 }, { keep: 2 }],
      current_page: 2,
      per_page: 24,
      has_next: true,
    },
  };

  // Keeps entries with a `keep` field, dropping the rest (null filter path).
  const normalize = (raw: unknown) => {
    const k = (raw as { keep?: number }).keep;
    return k ? { v: k } : null;
  };

  function mockFetch(resp: unknown) {
    const fn = jest.fn(async (..._args: unknown[]) => resp);
    global.fetch = fn as never;
    return fn;
  }

  it("builds the URL (app_key in path + query params), maps items, drops nulls", async () => {
    const fn = mockFetch({ ok: true, json: async () => okBody });

    const r = await requestKlipyList(
      "gifs",
      "search",
      { ...params, query: "cat", formatFilter: "gif,webp" },
      normalize,
    );

    const url = fn.mock.calls[0][0] as string;
    expect(url).toContain(`${KLIPY_BASE_URL}/app-key/gifs/search`);
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=24");
    expect(url).toContain("customer_id=uid-1");
    expect(url).toContain("q=cat");
    expect(url).toContain("format_filter=gif%2Cwebp");

    expect(r.items).toEqual([{ v: 1 }, { v: 2 }]);
    expect(r).toMatchObject({ page: 2, perPage: 24, hasNext: true });
  });

  it("omits the q param on the trending endpoint", async () => {
    const fn = mockFetch({ ok: true, json: async () => okBody });
    await requestKlipyList("static-memes", "trending", { ...params, query: "ignored" }, normalize);
    expect(fn.mock.calls[0][0] as string).not.toContain("q=");
  });

  it("throws KlipyError carrying the status on a non-2xx response", async () => {
    mockFetch({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      requestKlipyList("gifs", "trending", params, normalize),
    ).rejects.toMatchObject({ name: "KlipyError", status: 503 });
  });

  it("throws KlipyError when fetch itself fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("dns");
    }) as never;
    await expect(
      requestKlipyList("gifs", "trending", params, normalize),
    ).rejects.toBeInstanceOf(KlipyError);
  });

  it("throws KlipyError on a non-JSON body", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(
      requestKlipyList("gifs", "trending", params, normalize),
    ).rejects.toThrow(/non-JSON/);
  });

  it("throws KlipyError when the envelope result is not true", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ result: false, data: { data: [] } }) });
    await expect(
      requestKlipyList("gifs", "trending", params, normalize),
    ).rejects.toThrow(/unsuccessful/);
  });

  it("falls back to the requested page/perPage when the envelope omits them", async () => {
    mockFetch({ ok: true, json: async () => ({ result: true, data: { data: [] } }) });
    const r = await requestKlipyList("gifs", "trending", params, normalize);
    expect(r).toMatchObject({ items: [], page: 2, perPage: 24, hasNext: false });
  });
});
