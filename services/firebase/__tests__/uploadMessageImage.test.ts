const mockDeleteAsync = jest.fn();
const mockManipulateAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockUploadBytes = jest.fn();
const mockGetDownloadURL = jest.fn();

jest.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: mockManipulateAsync,
  SaveFormat: { JPEG: "jpeg" },
}));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: mockLaunchImageLibraryAsync,
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: mockRequestMediaLibraryPermissionsAsync,
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock("firebase/storage", () => ({
  ref: jest.fn((_storage, path: string) => ({ path })),
  uploadBytes: mockUploadBytes,
  getDownloadURL: mockGetDownloadURL,
}));

jest.mock("../app", () => ({
  getFirebaseServices: () => ({
    available: true,
    services: {
      auth: { currentUser: { uid: "uid-1" } },
      storage: {},
    },
  }),
}));

import { captureAndUploadImage } from "../uploadMessageImage";

describe("captureAndUploadImage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://picked.jpg" }],
    });
    mockManipulateAsync.mockResolvedValue({
      uri: "file://compressed.jpg",
      width: 800,
      height: 600,
    });
    mockUploadBytes.mockResolvedValue(undefined);
    mockGetDownloadURL.mockResolvedValue("https://storage.example/image.jpg");
    mockDeleteAsync.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      blob: jest.fn().mockResolvedValue({ size: 1234 }),
    }) as never;
  });

  it("deletes the compressed temp file after a successful upload", async () => {
    await expect(captureAndUploadImage("library", "c1")).resolves.toMatchObject({
      source: "upload",
      path: expect.stringContaining("messageImages/uid-1/c1/"),
      url: "https://storage.example/image.jpg",
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file://compressed.jpg", {
      idempotent: true,
    });
  });

  it("deletes the compressed temp file when upload fails", async () => {
    mockUploadBytes.mockRejectedValueOnce(new Error("upload failed"));

    await expect(captureAndUploadImage("library", "c1")).rejects.toMatchObject({
      code: "upload-failed",
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file://compressed.jpg", {
      idempotent: true,
    });
  });
});
