const mockGetRandomBytesAsync = jest.fn();
const mockDigestStringAsync = jest.fn();

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: (...args: unknown[]) => mockGetRandomBytesAsync(...args),
  digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

import { randomNonce, sha256 } from "../appleNonce";

describe("randomNonce", () => {
  it("hex-encodes the random bytes (two lowercase hex chars per byte)", async () => {
    mockGetRandomBytesAsync.mockResolvedValue(new Uint8Array([0, 15, 255, 171]));
    const nonce = await randomNonce(4);
    expect(nonce).toBe("000fffab");
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  it("defaults to 32 bytes => 64 hex chars", async () => {
    mockGetRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(1));
    const nonce = await randomNonce();
    expect(nonce).toHaveLength(64);
    expect(mockGetRandomBytesAsync).toHaveBeenCalledWith(32);
  });
});

describe("sha256", () => {
  it("delegates to expo-crypto SHA-256 and returns the digest", async () => {
    mockDigestStringAsync.mockResolvedValue("deadbeef");
    await expect(sha256("hello")).resolves.toBe("deadbeef");
    expect(mockDigestStringAsync).toHaveBeenCalledWith("SHA-256", "hello");
  });
});
