let mockAvailable = true;
let mockCurrentUser: { uid?: string; email?: string | null } | null = {
  uid: "u1",
  email: "a@b.com",
};

const m = {
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  sendEmailVerification: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  updatePassword: jest.fn(),
  verifyBeforeUpdateEmail: jest.fn(),
};

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...a: unknown[]) => m.createUserWithEmailAndPassword(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => m.signInWithEmailAndPassword(...a),
  sendEmailVerification: (...a: unknown[]) => m.sendEmailVerification(...a),
  sendPasswordResetEmail: (...a: unknown[]) => m.sendPasswordResetEmail(...a),
  reauthenticateWithCredential: (...a: unknown[]) => m.reauthenticateWithCredential(...a),
  updatePassword: (...a: unknown[]) => m.updatePassword(...a),
  verifyBeforeUpdateEmail: (...a: unknown[]) => m.verifyBeforeUpdateEmail(...a),
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
}));

jest.mock("../app", () => ({
  getFirebaseServices: () =>
    mockAvailable
      ? { available: true, services: { auth: { currentUser: mockCurrentUser } } }
      : { available: false },
}));

import {
  changeUserPassword,
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
} from "../emailAuth";

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  mockAvailable = true;
  mockCurrentUser = { uid: "u1", email: "a@b.com" };
  Object.values(m).forEach((fn) => fn.mockReset());
});

describe("registerWithEmail", () => {
  it("maps a successful registration", async () => {
    m.createUserWithEmailAndPassword.mockResolvedValue({
      user: { uid: "u9", email: "x@y.com", emailVerified: false },
    });
    m.sendEmailVerification.mockResolvedValue(undefined);
    await expect(registerWithEmail("x@y.com", "pw")).resolves.toEqual({
      success: true,
      uid: "u9",
      email: "x@y.com",
      emailVerified: false,
    });
  });

  it("still succeeds when the best-effort verification email throws", async () => {
    m.createUserWithEmailAndPassword.mockResolvedValue({
      user: { uid: "u9", email: "x@y.com", emailVerified: false },
    });
    m.sendEmailVerification.mockRejectedValue(new Error("smtp down"));
    await expect(registerWithEmail("x@y.com", "pw")).resolves.toMatchObject({ success: true });
  });

  it.each([
    ["auth/email-already-in-use", "email-already-in-use"],
    ["auth/weak-password", "weak-password"],
    ["auth/invalid-email", "invalid-email"],
    ["auth/something-else", "generic"],
  ])("maps %s -> %s", async (code, expected) => {
    m.createUserWithEmailAndPassword.mockRejectedValue(authError(code));
    await expect(registerWithEmail("x@y.com", "pw")).resolves.toEqual({
      success: false,
      error: expected,
    });
  });

  it("returns generic when Firebase is unavailable", async () => {
    mockAvailable = false;
    await expect(registerWithEmail("x", "y")).resolves.toEqual({ success: false, error: "generic" });
  });
});

describe("signInWithEmail", () => {
  it("maps a successful sign-in", async () => {
    m.signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: "u1", email: "a@b.com", emailVerified: true },
    });
    await expect(signInWithEmail("a@b.com", "pw")).resolves.toEqual({
      success: true,
      uid: "u1",
      email: "a@b.com",
      emailVerified: true,
    });
  });

  it.each([
    ["auth/invalid-credential", "invalid-credential"],
    ["auth/user-not-found", "invalid-credential"],
    ["auth/wrong-password", "invalid-credential"],
    ["auth/invalid-email", "invalid-email"],
    ["auth/too-many-requests", "too-many-requests"],
    ["auth/internal-error", "generic"],
  ])("maps %s -> %s", async (code, expected) => {
    m.signInWithEmailAndPassword.mockRejectedValue(authError(code));
    await expect(signInWithEmail("a@b.com", "pw")).resolves.toEqual({
      success: false,
      error: expected,
    });
  });
});

describe("sendPasswordReset", () => {
  it("succeeds normally", async () => {
    m.sendPasswordResetEmail.mockResolvedValue(undefined);
    await expect(sendPasswordReset("a@b.com")).resolves.toEqual({ success: true });
  });

  it("returns success on user-not-found (account-enumeration guard)", async () => {
    m.sendPasswordResetEmail.mockRejectedValue(authError("auth/user-not-found"));
    await expect(sendPasswordReset("ghost@b.com")).resolves.toEqual({ success: true });
  });

  it("maps invalid-email and too-many-requests", async () => {
    m.sendPasswordResetEmail.mockRejectedValue(authError("auth/invalid-email"));
    await expect(sendPasswordReset("bad")).resolves.toEqual({
      success: false,
      error: "invalid-email",
    });
    m.sendPasswordResetEmail.mockRejectedValue(authError("auth/too-many-requests"));
    await expect(sendPasswordReset("a@b.com")).resolves.toEqual({
      success: false,
      error: "too-many-requests",
    });
  });
});

describe("changeUserPassword", () => {
  it("reauthenticates then updates the password", async () => {
    m.reauthenticateWithCredential.mockResolvedValue(undefined);
    m.updatePassword.mockResolvedValue(undefined);
    await expect(changeUserPassword("old", "new")).resolves.toEqual({ success: true });
    expect(m.reauthenticateWithCredential).toHaveBeenCalled();
    expect(m.updatePassword).toHaveBeenCalled();
  });

  it("maps a bad current password and never updates", async () => {
    m.reauthenticateWithCredential.mockRejectedValue(authError("auth/wrong-password"));
    await expect(changeUserPassword("old", "new")).resolves.toEqual({
      success: false,
      error: "invalid-credential",
    });
    expect(m.updatePassword).not.toHaveBeenCalled();
  });

  it("maps a weak new password", async () => {
    m.reauthenticateWithCredential.mockResolvedValue(undefined);
    m.updatePassword.mockRejectedValue(authError("auth/weak-password"));
    await expect(changeUserPassword("old", "weak")).resolves.toEqual({
      success: false,
      error: "weak-password",
    });
  });

  it("returns generic with no signed-in user", async () => {
    mockCurrentUser = null;
    await expect(changeUserPassword("old", "new")).resolves.toEqual({
      success: false,
      error: "generic",
    });
  });
});
