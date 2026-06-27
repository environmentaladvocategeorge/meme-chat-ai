import {
  toPersonaSavePayload,
  type MediaPickInput,
  type PersonaFormValues,
  type PersonaSavePayload,
} from "./personaForm";
import { classifyPersonaSaveError } from "./publishPersona";

// Edit-save flow for an existing persona, with IO injected so the branch logic
// is unit-testable. Mirrors publishPersonaDraft, but always targets an existing
// `personaId` (overwrite) and there is NO draft involved — edit mode is "edit or
// quit", never autosaved. The avatar is a small state machine: keep the stored
// one, replace it with a freshly-picked local image (uploaded here), or remove
// it (the backend clears it + deletes the Storage object). Moderation/limit
// failures are expected results the UI shows, not thrown errors.

// What the user did to the avatar during the edit session.
export type EditAvatarState =
  | { kind: "keep" } // leave the stored avatar untouched
  | { kind: "replace"; localUri: string } // a new local image to upload
  | { kind: "remove" }; // clear the stored avatar

export type SavePersonaEditResult =
  | { ok: true; personaId: string }
  | { ok: false; reason: "rejected" | "unavailable" | "limit" | "error" };

export type SavePersonaEditDeps = {
  uploadAvatar: (localUri: string) => Promise<{ url: string; path: string }>;
  savePersona: (args: {
    persona: PersonaSavePayload;
    personaId: string;
    avatar?: { url: string; path: string };
    removeAvatar?: boolean;
  }) => Promise<{ personaId: string }>;
};

export async function savePersonaEdit(
  personaId: string,
  values: PersonaFormValues,
  avatar: EditAvatarState,
  deps: SavePersonaEditDeps,
  // The edit session's picked reactions (name + preview URL), so their
  // thumbnails persist across edits. Optional: a caller with no picks (or an
  // older one) omits it and the names alone are saved, as before.
  mediaPicks?: MediaPickInput[],
): Promise<SavePersonaEditResult> {
  try {
    const uploaded =
      avatar.kind === "replace"
        ? await deps.uploadAvatar(avatar.localUri)
        : undefined;
    const res = await deps.savePersona({
      persona: toPersonaSavePayload(values, mediaPicks),
      personaId,
      ...(uploaded ? { avatar: uploaded } : {}),
      ...(avatar.kind === "remove" ? { removeAvatar: true } : {}),
    });
    return { ok: true, personaId: res.personaId };
  } catch (err) {
    return { ok: false, reason: classifyPersonaSaveError(err) };
  }
}
