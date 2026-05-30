import type { UploadedMessageImage } from "@/domain/memes";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "./app";

// Capturing/picking a photo, compressing it ~50% for storage, and uploading it
// to Cloud Storage under the caller's namespace. The backend re-validates and
// ingests the object BY PATH (see functions/src/messages/resolveImageInputs.ts),
// so everything here is convenience + UX, not a trust boundary.

// Largest edge of the stored display copy. A ~1280px JPEG at q0.6 is roughly a
// 50% reduction off a typical phone capture while staying crisp in a bubble.
const DISPLAY_MAX_DIM = 1280;
const DISPLAY_JPEG_QUALITY = 0.6;

// Where a not-yet-sent upload is filed when there's no conversation id yet (a
// brand-new chat whose id is minted server-side on send). Deletion is path-based
// (from the message doc) + prefix-based (account), so the folder name is cosmetic.
const DRAFT_FOLDER = "drafts";

export type PickSource = "camera" | "library";

export type UploadImageError =
  | "permission-denied"
  | "firebase-unavailable"
  | "signed-out"
  | "upload-failed";

export class CaptureImageError extends Error {
  constructor(public readonly code: UploadImageError) {
    super(code);
    this.name = "CaptureImageError";
  }
}

function makeImageId(): string {
  return [
    "img",
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

async function ensurePermission(source: PickSource): Promise<void> {
  const result =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!result.granted) {
    throw new CaptureImageError("permission-denied");
  }
}

// Launches the camera or library, compresses the chosen photo, uploads it, and
// returns the staged attachment metadata. Returns null when the user cancels.
export async function captureAndUploadImage(
  source: PickSource,
  conversationId: string | null,
): Promise<UploadedMessageImage | null> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new CaptureImageError("firebase-unavailable");
  const uid = firebase.services.auth.currentUser?.uid;
  if (!uid) throw new CaptureImageError("signed-out");

  await ensurePermission(source);

  const picked =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
        });

  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];

  // Compress for the stored display copy (~50%). The backend makes its own,
  // smaller copy for the model.
  const compressed = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: DISPLAY_MAX_DIM } }],
    {
      compress: DISPLAY_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  try {
    const response = await fetch(compressed.uri);
    const blob = await response.blob();

    const imageId = makeImageId();
    const path = `messageImages/${uid}/${conversationId ?? DRAFT_FOLDER}/${imageId}.jpg`;
    const objectRef = ref(firebase.services.storage, path);
    await uploadBytes(objectRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(objectRef);

    return {
      id: imageId,
      source: "upload",
      path,
      url,
      width: compressed.width,
      height: compressed.height,
      mimeType: "image/jpeg",
      bytes: blob.size,
    };
  } catch {
    throw new CaptureImageError("upload-failed");
  }
}
