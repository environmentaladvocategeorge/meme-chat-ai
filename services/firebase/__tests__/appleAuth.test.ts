let mockAvailable = true;
let mockCurrentUser: unknown = { uid: "u1" };

const mockSignInAsync = jest.fn();
const mockSignInWithCredential = jest.fn();
const mockReauth = jest.fn();

jest.mock("@/domain/appleNonce", () => ({
  randomNonce: jest.fn(async () => "raw-nonce"),
  sha256: jest.fn(async () => "hashed-nonce"),
}));

jest.mock("expo-apple-authentication", () => ({
  signInAsync: (...a: unknown[]) => mockSignInAsync(...a),
  AppleAuthenticationScope: { FULL_NAME: "full", EMAIL: "email" },
}));

jest.mock("firebase/app", () => ({ FirebaseError: class extends Error {} }));

jest.mock("firebase/auth", () => ({
  OAuthProvider: class {
    credential = (c: unknown) => ({ __cred: c });
  },
  signInWithCredential: (...a: unknown[]) => mockSignInWithCredential(...a),
  reauthenticateWithCredential: (...a: unknown[]) => mockReauth(...a),
}));

jest.mock("../app", () => ({
  getFirebaseServices: () =>
    mockAvailable
      ? { available: true, services: { auth: { currentUser: mockCurrentUser } } }
      : { available: false },
}));

import { reauthenticateWithApple, signInWithApple } from "../appleAuth";

beforeEach(() => {
  mockAvailable = true;
  mockCurrentUser = { uid: "u1" };
  mockSignInAsync.mockReset();
  mockSignInWithCredential.mockReset();
  mockReauth.mockReset();
});

describe("signInWithApple", () => {
  it("maps a successful sign-in including provider data", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: "tok" });
    mockSignInWithCredential.mockResolvedValue({
      user: {
        uid: "u1",
        email: "a@b.com",
        emailVerified: true,
        providerData: [{ providerId: "apple.com", email: "a@b.com" }],
      },
    });

    await expect(signInWithApple()).resolves.toEqual({
      success: true,
      uid: "u1",
      email: "a@b.com",
      emailVerified: true,
      providers: [{ providerId: "apple.com", email: "a@b.com" }],
    });
  });

  it("returns missing-identity-token when Apple yields no token", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });
    await expect(signInWithApple()).resolves.toEqual({
      success: false,
      error: "missing-identity-token",
    });
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it("maps a user cancel to 'cancelled'", async () => {
    mockSignInAsync.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });
    await expect(signInWithApple()).resolves.toEqual({ success: false, error: "cancelled" });
  });

  it.each([
    ["auth/account-exists-with-different-credential", "account-exists-with-different-credential"],
    ["auth/operation-not-allowed", "operation-not-allowed"],
    ["auth/network-request-failed", "network-request-failed"],
    ["auth/whatever-else", "generic"],
  ])("maps the firebase code %s -> %s", async (code, expected) => {
    mockSignInAsync.mockResolvedValue({ identityToken: "tok" });
    mockSignInWithCredential.mockRejectedValue({ code });
    await expect(signInWithApple()).resolves.toEqual({ success: false, error: expected });
  });

  it("returns unavailable when Firebase is down", async () => {
    mockAvailable = false;
    await expect(signInWithApple()).resolves.toEqual({ success: false, error: "unavailable" });
  });
});

describe("reauthenticateWithApple", () => {
  it("returns unavailable when Firebase is down", async () => {
    mockAvailable = false;
    await expect(reauthenticateWithApple()).resolves.toEqual({
      success: false,
      error: "unavailable",
    });
  });

  it("returns no-user when nobody is signed in", async () => {
    mockCurrentUser = null;
    await expect(reauthenticateWithApple()).resolves.toEqual({
      success: false,
      error: "no-user",
    });
  });

  it("succeeds on a valid reauth", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: "tok" });
    mockReauth.mockResolvedValue(undefined);
    await expect(reauthenticateWithApple()).resolves.toEqual({ success: true });
  });

  it("maps user-mismatch", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: "tok" });
    mockReauth.mockRejectedValue({ code: "auth/user-mismatch" });
    await expect(reauthenticateWithApple()).resolves.toEqual({
      success: false,
      error: "user-mismatch",
    });
  });

  it("maps a user cancel", async () => {
    mockSignInAsync.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });
    await expect(reauthenticateWithApple()).resolves.toEqual({
      success: false,
      error: "cancelled",
    });
  });

  it("returns missing-identity-token when Apple yields none", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: undefined });
    await expect(reauthenticateWithApple()).resolves.toEqual({
      success: false,
      error: "missing-identity-token",
    });
  });
});
