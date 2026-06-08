import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ModelUsage } from "../../billing/ledger";
import { resolveModelId } from "../../billing/models";
import { MEMORY_EXTRACTION_PROMPT } from "./extractionPrompt";
import { isMemoryCategory, type MemoryFact, type MemoryOp } from "./types";

export type ExtractResult = { ops: MemoryOp[]; usage: ModelUsage | null };

// gpt-5-nano is a reasoning model: max_completion_tokens is the TOTAL budget
// (reasoning + output). Give real headroom so the small JSON actually gets
// emitted after the reasoning pass (mirrors the title generator's tuning).
const MAX_COMPLETION_TOKENS = 1200;

function clampSalience(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : 2;
  return Math.min(Math.max(n, 1), 5);
}

function buildUserContent(existing: MemoryFact[], transcript: string): string {
  const existingBlock =
    existing.length > 0
      ? existing
          .map((f) => `[${f.id}] (${f.category}, s${f.salience}) ${f.text}`)
          .join("\n")
      : "(none yet)";
  return `EXISTING MEMORY:\n${existingBlock}\n\nRECENT CONVERSATION:\n${transcript}`;
}

// Tolerant JSON parse: the model is told to emit raw JSON, but strip a stray code
// fence just in case. Returns [] on any malformed output (fail-safe: a bad
// extraction must never corrupt stored memory).
function parseOps(raw: string, existingIds: Set<string>): MemoryOp[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const rawOps = (parsed as { ops?: unknown })?.ops;
  if (!Array.isArray(rawOps)) return [];

  const ops: MemoryOp[] = [];
  for (const item of rawOps) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const op = o.operation;

    if (op === "ADD") {
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text || !isMemoryCategory(o.category)) continue;
      ops.push({
        operation: "ADD",
        text,
        category: o.category,
        salience: clampSalience(o.salience),
      });
    } else if (op === "UPDATE") {
      const targetId = typeof o.targetId === "string" ? o.targetId : "";
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!targetId || !existingIds.has(targetId) || !text) continue;
      ops.push({
        operation: "UPDATE",
        targetId,
        text,
        ...(isMemoryCategory(o.category) ? { category: o.category } : {}),
        ...(typeof o.salience === "number"
          ? { salience: clampSalience(o.salience) }
          : {}),
      });
    } else if (op === "REMOVE") {
      const targetId = typeof o.targetId === "string" ? o.targetId : "";
      if (!targetId || !existingIds.has(targetId)) continue;
      ops.push({ operation: "REMOVE", targetId });
    }
    // Unknown operations (incl. "SKIP") are simply not materialized.
  }
  return ops;
}

// Calls the cheap nano model to derive memory ops from a conversation. Never
// throws — on any failure it returns no ops (and null usage) so the background
// refresh degrades to "leave memory unchanged".
export async function extractMemoryOps(args: {
  apiKey: string;
  existing: MemoryFact[];
  transcript: string;
}): Promise<ExtractResult> {
  const { apiKey, existing, transcript } = args;
  if (!transcript.trim()) return { ops: [], usage: null };

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: resolveModelId("nano"),
      reasoning_effort: "low",
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        { role: "user", content: buildUserContent(existing, transcript) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const ops = parseOps(raw, new Set(existing.map((f) => f.id)));

    const u = completion.usage;
    const usage: ModelUsage | null = u
      ? {
          model: "nano",
          inputTokens: u.prompt_tokens ?? 0,
          cachedInputTokens:
            (u.prompt_tokens_details as { cached_tokens?: number } | undefined)
              ?.cached_tokens ?? 0,
          outputTokens: u.completion_tokens ?? 0,
          reasoningTokens:
            (
              u.completion_tokens_details as
                | { reasoning_tokens?: number }
                | undefined
            )?.reasoning_tokens ?? 0,
        }
      : null;

    return { ops, usage };
  } catch (err) {
    logger.warn("[memory] extraction call failed; leaving memory unchanged", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return { ops: [], usage: null };
  }
}
