// The module imports native/expo packages jest doesn't transform; mock them so
// it loads. These tests only exercise the pure path/id helpers.
jest.mock("expo-file-system/legacy", () => ({ deleteAsync: jest.fn() }));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("firebase/storage", () => ({
  ref: jest.fn(),
  uploadBytes: jest.fn(),
  getDownloadURL: jest.fn(),
}));
jest.mock("../app", () => ({ getFirebaseServices: jest.fn() }));

import { makeAvatarId, personaAvatarPath } from "../uploadPersonaAvatar";

describe("personaAvatarPath", () => {
  it("builds a path under the caller's namespace that savePersona will accept", () => {
    const path = personaAvatarPath("uid-1", "avatar-abc");
    expect(path).toBe("personaAvatars/uid-1/avatar-abc.jpg");
    // Must satisfy the backend ownership check.
    expect(path.startsWith("personaAvatars/uid-1/")).toBe(true);
  });
});

describe("makeAvatarId", () => {
  it("is avatar-prefixed and unique across calls", () => {
    const a = makeAvatarId();
    const b = makeAvatarId();
    expect(a.startsWith("avatar-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
