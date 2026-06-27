import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { generatePersonaAvatarCallable } from "./callables";
import type { PickedAvatar } from "./uploadPersonaAvatar";

// AI persona-avatar generation (client half). The backend
// (functions/src/personas/generatePersonaAvatar.ts) returns a base64 PNG; here
// we decode it to a LOCAL compressed JPEG that matches exactly what the photo
// picker produces (512px, q0.7) — so a generated avatar is indistinguishable
// from an uploaded one downstream and rides the same publish → upload →
// moderate → store path. Nothing is stored remotely until the user picks one
// and publishes the persona.

// Mirror uploadPersonaAvatar's compression so generated and picked avatars land
// at the same size/format (and satisfy the personaAvatars JPEG storage rule).
const AVATAR_MAX_DIM = 512;
const AVATAR_JPEG_QUALITY = 0.7;
// The maximum description the backend accepts (mirrors AVATAR_DESCRIPTION_MAX).
export const AVATAR_DESCRIPTION_MAX = 100;
// Client-side soft rate limit between regenerations — purely a UI nudge to slow
// repeated taps; the real spend gate is the daily/monthly credit allowance.
export const AVATAR_REGEN_COOLDOWN_MS = 60_000;

export type AvatarGenerationErrorCode =
  | "quota-daily"
  | "quota-monthly"
  | "prompt-rejected"
  | "generation-failed"
  | "firebase-unavailable";

// Best-effort cleanup of generated-candidate JPEGs left in the cache directory.
// Each generation writes a compressed candidate; only the published one is ever
// uploaded, so the rest are orphans. Callers pass the URIs they're about to drop
// (e.g. the previous batch on regenerate). Idempotent and error-swallowing —
// cache files are disposable, so a failed delete is never worth surfacing.
export async function deleteLocalAvatars(uris: string[]): Promise<void> {
  await Promise.all(
    uris.map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}),
    ),
  );
}

export class AvatarGenerationError extends Error {
  constructor(public readonly code: AvatarGenerationErrorCode) {
    super(code);
    this.name = "AvatarGenerationError";
  }
}

// Maps a thrown callable error to a typed generation error. The callable's
// HttpsError message arrives as the FirebaseError message; firebase-unavailable
// is our own pre-call guard.
function toGenerationError(err: unknown): AvatarGenerationError {
  if (err instanceof AvatarGenerationError) return err;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (message === "firebase-unavailable") {
    return new AvatarGenerationError("firebase-unavailable");
  }
  if (message.includes("quota_daily")) return new AvatarGenerationError("quota-daily");
  if (message.includes("quota_monthly")) return new AvatarGenerationError("quota-monthly");
  if (message.includes("prompt_rejected")) {
    return new AvatarGenerationError("prompt-rejected");
  }
  return new AvatarGenerationError("generation-failed");
}

// Generates ONE avatar from the description and returns a local compressed copy
// ready to hand to the creator session (setLocalAvatar). `variant` selects an
// art direction server-side so two parallel calls diverge. Throws an
// AvatarGenerationError on any failure so the UI can map it to copy.
export async function generatePersonaAvatar(
  description: string,
  variant?: number,
): Promise<PickedAvatar> {
  let rawPath: string | null = null;
  try {
    const { imageBase64 } = await generatePersonaAvatarCallable({
      description: description.trim(),
      variant,
    });

    // ImageManipulator needs a file URI, so stage the base64 PNG to cache first,
    // then compress it down to the avatar size/format.
    rawPath = `${FileSystem.cacheDirectory}persona-avatar-gen-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.png`;
    await FileSystem.writeAsStringAsync(rawPath, imageBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const compressed = await ImageManipulator.manipulateAsync(
      rawPath,
      [{ resize: { width: AVATAR_MAX_DIM } }],
      { compress: AVATAR_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return {
      localUri: compressed.uri,
      width: compressed.width,
      height: compressed.height,
    };
  } catch (err) {
    throw toGenerationError(err);
  } finally {
    if (rawPath) {
      await FileSystem.deleteAsync(rawPath, { idempotent: true }).catch(() => {});
    }
  }
}
