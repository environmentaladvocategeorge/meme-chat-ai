const mockGetDoc = jest.fn();
let mockAvailable = true;

jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => "profile-doc-ref"),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

jest.mock("../app", () => ({
  getFirebaseServices: () =>
    mockAvailable
      ? { available: true, services: { firestore: {} } }
      : { available: false, reason: "missing-config" },
}));

import { fetchOnboardingCompleted } from "../profile";

beforeEach(() => {
  mockGetDoc.mockReset();
  mockAvailable = true;
});

describe("fetchOnboardingCompleted", () => {
  it("returns true when the profile carries onboardingCompleted: true", async () => {
    mockGetDoc.mockResolvedValue({ data: () => ({ onboardingCompleted: true }) });

    await expect(fetchOnboardingCompleted("u1")).resolves.toBe(true);
  });

  it("returns false when the field is absent or not strictly true", async () => {
    mockGetDoc.mockResolvedValue({ data: () => ({ plan: "free" }) });
    await expect(fetchOnboardingCompleted("u1")).resolves.toBe(false);

    mockGetDoc.mockResolvedValue({ data: () => undefined });
    await expect(fetchOnboardingCompleted("u1")).resolves.toBe(false);
  });

  it("fails closed (false) when the read rejects", async () => {
    mockGetDoc.mockRejectedValue(new Error("permission-denied"));

    await expect(fetchOnboardingCompleted("u1")).resolves.toBe(false);
  });

  it("fails closed when Firebase is unavailable", async () => {
    mockAvailable = false;

    await expect(fetchOnboardingCompleted("u1")).resolves.toBe(false);
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("times out a hung read instead of stalling sign-in", async () => {
    jest.useFakeTimers();
    try {
      mockGetDoc.mockReturnValue(new Promise(() => {}));

      const promise = fetchOnboardingCompleted("u1");
      jest.advanceTimersByTime(5000);

      await expect(promise).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
