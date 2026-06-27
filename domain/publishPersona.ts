import type { PersonaDraft } from "./personaDrafts";
import { toPersonaSavePayload, type PersonaSavePayload } from "./personaForm";

// Publish flow for a draft, with its IO injected so the branch logic is
// unit-testable. Uploads the avatar (if any) at publish, then calls savePersona
// and classifies the outcome. Moderation/limit failures are NOT errors to throw
// — they're expected results the UI shows differently (keep the draft, let the
// user fix it).

export type PublishResult =
  | { ok: true; personaId: string }
  // The persona's content (or avatar) was rejected by moderation.
  | { ok: false; reason: "rejected" }
  // Moderation/infra was unavailable — retryable, not a verdict.
  | { ok: false; reason: "unavailable" }
  // Already at the plan cap (shouldn't reach here if entry gated, but safe).
  | { ok: false; reason: "limit" }
  // Anything else (network, etc.).
  | { ok: false; reason: "error" };

export type PublishDeps = {
  uploadAvatar: (localUri: string) => Promise<{ url: string; path: string }>;
  savePersona: (args: {
    persona: PersonaSavePayload;
    avatar?: { url: string; path: string };
  }) => Promise<{ personaId: string }>;
};

// Maps a savePersona HttpsError message to the UI-facing reason. Shared with the
// edit flow (domain/savePersonaEdit.ts) so create + edit classify identically.
export function classifyPersonaSaveError(
  err: unknown,
): "rejected" | "unavailable" | "limit" | "error" {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("moderation_unavailable")) return "unavailable";
  if (message.includes("persona_rejected")) return "rejected";
  if (message.includes("persona_limit_reached")) return "limit";
  return "error";
}

function classify(err: unknown): PublishResult {
  return { ok: false, reason: classifyPersonaSaveError(err) };
}

export async function publishPersonaDraft(
  draft: PersonaDraft,
  deps: PublishDeps,
): Promise<PublishResult> {
  try {
    let avatar: { url: string; path: string } | undefined;
    if (draft.avatar?.localUri) {
      avatar = await deps.uploadAvatar(draft.avatar.localUri);
    }
    const res = await deps.savePersona({
      // Pass the draft's picked reactions so their preview URLs persist (the
      // editor re-renders real thumbnails on a later edit, not text chips).
      persona: toPersonaSavePayload(draft.values, draft.mediaPicks),
      ...(avatar ? { avatar } : {}),
    });
    return { ok: true, personaId: res.personaId };
  } catch (err) {
    return classify(err);
  }
}
