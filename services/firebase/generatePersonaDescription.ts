import { generatePersonaDescriptionCallable } from "./callables";

// AI-written persona description (client half). Gathers whatever the creator has
// entered so far (name, tagline, vibe, humor) and asks the backend to write the
// "who they are" paragraph. The backend bills the user and runs the result
// through moderation before returning it. Text-only and deliberately light: the
// avatar is NOT sent — it's a cheap nano write, not a vision task.

export type DescriptionErrorCode =
  | "quota-daily"
  | "quota-monthly"
  | "rejected"
  | "generation-failed"
  | "firebase-unavailable";

export class PersonaDescriptionError extends Error {
  constructor(public readonly code: DescriptionErrorCode) {
    super(code);
    this.name = "PersonaDescriptionError";
  }
}

function toError(err: unknown): PersonaDescriptionError {
  if (err instanceof PersonaDescriptionError) return err;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (message === "firebase-unavailable") {
    return new PersonaDescriptionError("firebase-unavailable");
  }
  if (message.includes("quota_daily")) return new PersonaDescriptionError("quota-daily");
  if (message.includes("quota_monthly")) return new PersonaDescriptionError("quota-monthly");
  if (message.includes("description_rejected")) {
    return new PersonaDescriptionError("rejected");
  }
  return new PersonaDescriptionError("generation-failed");
}

export type DescriptionContext = {
  displayName?: string;
  shortDescription?: string;
  toneTags?: string[];
  humorTypes?: string[];
};

export async function generatePersonaDescription(
  ctx: DescriptionContext,
): Promise<string> {
  try {
    const res = await generatePersonaDescriptionCallable({
      displayName: ctx.displayName?.trim() || undefined,
      shortDescription: ctx.shortDescription?.trim() || undefined,
      toneTags: ctx.toneTags?.length ? ctx.toneTags : undefined,
      humorTypes: ctx.humorTypes?.length ? ctx.humorTypes : undefined,
    });
    return res.description;
  } catch (err) {
    throw toError(err);
  }
}
