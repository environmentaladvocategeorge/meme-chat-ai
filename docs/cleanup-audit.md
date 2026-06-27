# Codebase Cleanup Audit

_Generated 2026-06-14. Scope: functional code only (app, components, store, domain, hooks, services, lib, functions/src, scripts). The `website/` and `dashboard/` folders were intentionally excluded._

## TL;DR

The codebase is **cleaner than expected**. There is essentially **no commented-out dead code**, and the dense inline comments are genuine explanatory docs (the "why"), not cruft — they should mostly stay. The real cleanup falls into five buckets:

1. **Stray files** sitting in the repo root.
2. **Accumulated snapshot backups** (gitignored, local-only, but piling up).
3. **One-off operational scripts** that have served their purpose.
4. **One built-but-unwired feature** (persona templates).
5. **A handful of stale "for now" comments** that now contradict the code.

Nothing here is urgent or risky. Items are ordered roughly by confidence/safety.

---

## 1. Stray files — safe to delete

| File | Status | Notes |
|------|--------|-------|
| [firestore-debug.log](../firestore-debug.log) | Untracked (gitignored) | Local emulator debug log, 11 KB, last written Jun 4. Safe to delete; `.gitignore` already excludes it. |
| [KLIPY Light text.png](../KLIPY%20Light%20text.png) | **Tracked in git** | 5 KB image in repo root, not referenced anywhere in code or config. Looks like a leftover brand asset that was dropped in the root by accident. Recommend `git rm` (move to `assets/` if it's actually needed for store listings). |

---

## 2. Snapshot backup directories — gitignored, accumulating locally

Both are correctly gitignored, so they don't pollute the repo — but they grow unbounded on your machine and are worth periodically pruning.

- [prompt-snapshots/](../prompt-snapshots/) — **25 files**. Timestamped dumps from `pull-prompts.cjs`/`push-prompts.cjs`. The only one worth keeping long-term is `BASELINE-pre-prompt-optimization.json` (your documented rollback point). The 24 timestamped `prompts-*.json` are intermediate working snapshots from Jun 8–13 and can be cleared.
- [profile-snapshots/](../profile-snapshots/) — **7 files**. `BEFORE-SET-TRIAL` / `BEFORE-SET-FREE` / migration backups from the entitlement scripts. These are per-user restore points; keep until you're confident the affected users are settled, then clear.

**Suggestion:** keep the `BASELINE-*` file, delete the timestamped ones. Or add a `npm run snapshots:prune` helper if this becomes routine.

---

## 3. Scripts — classify keep vs. retire

Per project memory, several of these are documented ongoing tools — **keep** those. The genuinely one-off ones can be archived (or deleted, since git history preserves them).

### Keep (documented, reusable)
- `functions/scripts/admin-app.cjs` — shared ADC bootstrap; every other script imports it.
- `functions/scripts/push-prompts.cjs`, `pull-prompts.cjs`, `push-media-decider.cjs` — the live prompt-editing workflow.
- `functions/scripts/migrate-plan-credits.cjs` — the all-tier credit migration tool.
- `functions/scripts/grant-plan.cjs` — the per-user manual entitlement fix.
- `functions/scripts/analyze-usage.cjs`, `simulate-free-convo.cjs` — usage/burn-rate analysis.
- `functions/scripts/seed-emulator.cjs` — wired into `npm run seed`.
- `functions/scripts/inspect-personas.cjs`, `check-firestore-rules.cjs` — read-only diagnostics (newly added, untracked; commit or keep as needed).

### Candidates to retire (one-off, purpose served)
| Script | Why it's likely done |
|--------|----------------------|
| `functions/scripts/raise-free-credits.cjs` | Free-tier-only; its own header says it's **superseded** by `migrate-plan-credits.cjs` (which generalizes it to all tiers). Redundant. |
| `functions/scripts/set-app-config.cjs` | "One-off: set the force-update config doc." Run once per mandatory release; arguably keep, but it's not a recurring tool. |
| `functions/scripts/set-free.cjs` / `set-trial.cjs` | One-off per-user state setters from the pre-paid-launch trial period. `trial-user-ids.json` is dated "Set 2026-06-04" for pre-launch trial users — likely historical now. |
| `scripts/map-touchables.mjs` / `scripts/scan-touch-targets.mjs` | Diagnostic scanners built for the Fabric/release-build touch-target investigation (they compare against a `../hobby-dex` baseline that may not exist on every machine). One-time investigation tooling. |
| `scripts/round-splash-icon.py` | One-off asset generator (produces `splash-icon.png` from `app-icon.png`). Keep only if you expect to regenerate the splash. |

**Recommendation:** move retired scripts to a `scripts/archive/` (or just `git rm` — history keeps them). Low priority; they're inert and don't ship to the app or functions runtime.

---

## 4. Built-but-unwired feature: persona templates

This is the most substantive finding. The persona **template** system is fully built and tested but **not connected to any UI**:

- [domain/personaTemplates.ts](../domain/personaTemplates.ts) defines 6 full `PERSONA_TEMPLATES` (Chaos Goblin, Deadpan Bestie, etc.) plus `findTemplate()`.
- [domain/personaDrafts.ts](../domain/personaDrafts.ts) `createDraft(templateId)` can seed a draft from a template.
- **But** the only production call site — [components/PersonaSheet.tsx:191](../components/PersonaSheet.tsx#L191) — calls `newDraft(null)`, always seeding a blank draft. `PersonaSheet`'s own comment confirms: _"there's no template picker."_
- Every non-test `createDraft`/`newDraft` call passes `null`. The template id path is exercised **only in tests** (`personaTemplates.test.ts`, `personaDrafts.test.ts`, `personaForm.test.ts`, `storage.test.ts`).

**This isn't dead code to delete** — it's scaffolding for a template-picker that hasn't shipped. But flag it: either (a) wire up the template picker soon, or (b) if templates were abandoned in favor of the blank-wizard flow, remove `personaTemplates.ts` + its test and simplify `createDraft` to drop the `templateId` parameter. Right now it reads as "finished feature" but is invisible to users.

---

## 5. Stale "for now" comments that now contradict the code

These were accurate when written but the code moved on. Worth a quick correction so they stop misleading.

- [components/PersonaSheet.tsx:11-14](../components/PersonaSheet.tsx#L11-L14) — header comment says _"Creating/editing personas is a later step — the + button and create row are inert except for the free-tier upgrade route."_ **This is now false:** `handleCreate` (line 182) seeds a draft and routes to `/persona-creator`. The create flow ships. Update the header.
- [components/PersonaSheet.tsx:781](../components/PersonaSheet.tsx#L781) — _"The 'create a new bot' affordance ... Inert for now"_ — same staleness; verify against current behavior.

### Accurate "for now" markers (leave, but track as real TODOs)
These correctly describe a genuine in-progress gap, not cruft:

- [app/(app)/chat.tsx:200-201](../app/(app)/chat.tsx#L200-L201) and [chat.tsx:201](../app/(app)/chat.tsx#L201) — _"Selection is cosmetic for now — the chat send path does not yet forward personaId."_ This is the **one real functional TODO** in the persona work: the picker selects a persona but the send path ignores it. Track it.
- [functions/src/streamAgentAnswer.ts:87](../functions/src/streamAgentAnswer.ts#L87) — `TODO: enable enforceAppCheck` once the mobile client integrates App Check. Legitimate deferred work.
- [functions/src/conversations/repository.ts:22](../functions/src/conversations/repository.ts#L22), [functions/src/context/tokens.ts:27](../functions/src/context/tokens.ts#L27) — "for now" notes describing deliberate current simplifications; low priority.

---

## What I checked and found **clean** (no action)

So you know the audit was thorough and not just cherry-picking:

- **No commented-out code blocks.** A heuristic scan for `// const`, `// return`, `// if`, etc. across all functional dirs returned only prose comments that happen to wrap onto a word like "constant" — zero actual disabled code.
- **No `.only`/`.skip`/`xit`/`xdescribe`** left in any test file.
- **`console.warn` usages are all intentional** structured error logging (`[chat]`, `[auth]`, `[subscription]`, etc.) — no stray `console.log` debug statements in shipping code.
- **`devSetPlan`** (the dev-only entitlement callable) is exported in `functions/src/index.ts` but is **properly gated** — it throws `failed-precondition: dev-only` in production ([devSetPlan.ts:20](../functions/src/entitlement/devSetPlan.ts#L20)). Safe as-is.
- **`streamReplayTurn`** looked like it might be a debug endpoint but is a **real shipping feature** — the regenerate/replay button on the last agent message ([chat.tsx:186](../app/(app)/chat.tsx#L186), `MessageActions.tsx` ReplayButton).
- **`.native.ts`/`.native.tsx` splits** (ads) are legit platform splits, not placeholder stubs.
- **`NameSheet` / `nameSheet` store** are NOT orphaned — `ChangeNameForm.tsx` was deleted and replaced by the new `NameSheet.tsx`, still referenced from settings and the root layout.
- **`expo-file-system/legacy` imports** are an intentional API choice (the legacy FS API), not leftover debt.

---

## Suggested action order

1. **2 min:** delete `firestore-debug.log`; `git rm "KLIPY Light text.png"` (or relocate to `assets/`).
2. **2 min:** prune `prompt-snapshots/` down to the `BASELINE-*` file; clear settled `profile-snapshots/`.
3. **5 min:** fix the two stale `PersonaSheet` comments (§5); leave the accurate `personaId` TODO.
4. **Decide:** wire the persona template picker **or** remove `personaTemplates.ts` (§4).
5. **Optional:** `scripts/archive/` for the retired one-offs (§3) — purely housekeeping.
