jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
  Timestamp: { fromMillis: (ms: number) => ({ __ts: ms }) },
}));

import { getFirestore } from "firebase-admin/firestore";
import { checkIpRateLimit, extractClientIp } from "../rateLimit";

describe("extractClientIp", () => {
  it("takes the RIGHTMOST x-forwarded-for entry (the one Google appended)", () => {
    // The left side of XFF is client-supplied and spoofable; Google's front
    // end appends the real connecting IP at the end. Trusting the leftmost
    // entry let anyone bypass the per-IP cap with a random header per request.
    expect(
      extractClientIp({
        forwarded: "6.6.6.6, 1.1.1.1",
        realIp: "9.9.9.9",
        fallback: "8.8.8.8",
      }),
    ).toBe("1.1.1.1");
  });

  it("spoofed leading entries never win", () => {
    expect(
      extractClientIp({ forwarded: "spoofed, 10.0.0.1, 2.2.2.2" }),
    ).toBe("2.2.2.2");
  });

  it("trims whitespace on the forwarded entry", () => {
    expect(extractClientIp({ forwarded: "4.4.4.4,  3.3.3.3 " })).toBe("3.3.3.3");
  });

  it("skips empty trailing segments", () => {
    expect(extractClientIp({ forwarded: "5.5.5.5, " })).toBe("5.5.5.5");
  });

  it("falls back realIp -> fallback -> null", () => {
    expect(extractClientIp({ realIp: "9.9.9.9", fallback: "8.8.8.8" })).toBe("9.9.9.9");
    expect(extractClientIp({ fallback: "8.8.8.8" })).toBe("8.8.8.8");
    expect(extractClientIp({})).toBeNull();
  });

  it("ignores an empty forwarded header", () => {
    expect(extractClientIp({ forwarded: "", realIp: "9.9.9.9" })).toBe("9.9.9.9");
  });
});

describe("checkIpRateLimit", () => {
  const savedEnv = process.env.FUNCTIONS_EMULATOR;

  beforeEach(() => {
    (getFirestore as jest.Mock).mockReset();
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = savedEnv;
  });

  function dbWithCount(count: number) {
    const tx = {
      get: jest.fn().mockResolvedValue({ data: () => ({ count }) }),
      set: jest.fn(),
    };
    const db = {
      doc: jest.fn(() => ({})),
      runTransaction: (fn: (t: typeof tx) => Promise<boolean>) => fn(tx),
    };
    (getFirestore as jest.Mock).mockReturnValue(db);
    return tx;
  }

  it("fails open in the emulator without touching Firestore", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    (getFirestore as jest.Mock).mockImplementation(() => {
      throw new Error("getFirestore must not be called in the emulator");
    });
    expect(await checkIpRateLimit("1.2.3.4")).toBe(true);
  });

  it("fails open when there is no IP", async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    expect(await checkIpRateLimit(null)).toBe(true);
    expect(getFirestore as jest.Mock).not.toHaveBeenCalled();
  });

  it("allows and increments under the cap", async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    const tx = dbWithCount(5);
    expect(await checkIpRateLimit("1.2.3.4")).toBe(true);
    expect(tx.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ count: { __increment: 1 } }),
      { merge: true },
    );
  });

  it("denies at the cap (60/hr) without writing", async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    const tx = dbWithCount(60);
    expect(await checkIpRateLimit("1.2.3.4")).toBe(false);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it("denies above the cap", async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    dbWithCount(999);
    expect(await checkIpRateLimit("1.2.3.4")).toBe(false);
  });
});
