import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "./app";

// Persona avatar capture + upload. Two-stage by design:
//   1. pickPersonaAvatar — pick + compress to a LOCAL file, returned for the
//      draft. Nothing leaves the device, so abandoned drafts cost nothing.
//   2. uploadPendingAvatar — at PUBLISH, upload the local copy to the user's
//      personaAvatars/{uid} namespace and return { url, path }. savePersona
//      then moderates the url and stores both (see functions savePersona).
//
// Avatars render small (72px hero down to a 26px header chip), so the stored
// copy is capped well below the chat-photo size.

const AVATAR_MAX_DIM = 512;
const AVATAR_JPEG_QUALITY = 0.7;

export type PickSource = "camera" | "library";

export type PersonaAvatarErrorCode =
  | "permission-denied"
  | "firebase-unavailable"
  | "signed-out"
  | "upload-failed";

export class PersonaAvatarError extends Error {
  constructor(public readonly code: PersonaAvatarErrorCode) {
    super(code);
    this.name = "PersonaAvatarError";
  }
}

export type PickedAvatar = {
  // Local file URI of the compressed copy (lives in the draft until publish).
  localUri: string;
  width: number;
  height: number;
};

export type UploadedAvatar = {
  url: string;
  path: string;
};

// Pure helpers (unit-tested) — kept out of the IO path so they can't drift.
export function makeAvatarId(): string {
  return [
    "avatar",
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

// Must match the storage.rules personaAvatars/{uid}/{fileName} matcher and the
// savePersona ownership check (path startsWith `personaAvatars/${uid}/`).
export function personaAvatarPath(uid: string, avatarId: string): string {
  return `personaAvatars/${uid}/${avatarId}.jpg`;
}

async function ensurePermission(source: PickSource): Promise<void> {
  const result =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!result.granted) throw new PersonaAvatarError("permission-denied");
}

// Launches the camera/library, square-ish compresses the chosen photo, and
// returns the LOCAL copy for the draft. Returns null when the user cancels.
export async function pickPersonaAvatar(
  source: PickSource,
): Promise<PickedAvatar | null> {
  await ensurePermission(source);

  const picked =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        });

  if (picked.canceled || picked.assets.length === 0) return null;

  const compressed = await ImageManipulator.manipulateAsync(
    picked.assets[0].uri,
    [{ resize: { width: AVATAR_MAX_DIM } }],
    { compress: AVATAR_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

  return { localUri: compressed.uri, width: compressed.width, height: compressed.height };
}

// Uploads the draft's local avatar to Cloud Storage at publish time and returns
// the download URL + path. The backend re-validates ownership by path and
// moderates the URL; this is convenience + UX, not a trust boundary.
export async function uploadPendingAvatar(localUri: string): Promise<UploadedAvatar> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new PersonaAvatarError("firebase-unavailable");
  const uid = firebase.services.auth.currentUser?.uid;
  if (!uid) throw new PersonaAvatarError("signed-out");

  try {
    const response = await fetch(localUri);
    const blob = await response.blob();
    const path = personaAvatarPath(uid, makeAvatarId());
    const objectRef = ref(firebase.services.storage, path);
    await uploadBytes(objectRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(objectRef);
    return { url, path };
  } catch (err) {
    if (err instanceof PersonaAvatarError) throw err;
    throw new PersonaAvatarError("upload-failed");
  } finally {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
  }
}
