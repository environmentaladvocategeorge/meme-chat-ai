# Cleanup Checklist

_Companion to [cleanup-audit.md](./cleanup-audit.md). Actionable, ordered by safety. Commands are bash (Git Bash); paths are repo-root-relative. Nothing here touches shipping app/functions runtime code except §4 (a decision) and §5 (comment edits)._

---

## 1. Stray files — delete

- [ ] Delete the local emulator debug log (gitignored, regenerated on demand):
  ```bash
  rm -f firestore-debug.log
  ```
- [ ] Remove the orphaned root image (tracked in git, referenced nowhere):
  ```bash
  git rm "KLIPY Light text.png"
  ```
  _If it's actually needed for a store listing, instead: `git mv "KLIPY Light text.png" assets/`_

---

## 2. Snapshot backups — prune (all gitignored, local-only)

- [ ] Clear the intermediate prompt snapshots but **keep the baseline rollback point**:
  ```bash
  find prompt-snapshots -name 'prompts-*.json' -delete
  # keep: prompt-snapshots/BASELINE-pre-prompt-optimization.json
  ```
- [ ] Clear settled profile/entitlement snapshots once the affected users are confirmed stable:
  ```bash
  rm -f profile-snapshots/*.json
  ```
  _(7 files: BEFORE-SET-TRIAL / BEFORE-SET-FREE / migration backups. Only delete if you no longer need them as restore points.)_

---

## 3. One-off scripts — retire

Move to an archive folder (history is preserved either way; archiving keeps them discoverable):

- [ ] Create the archive dir:
  ```bash
  mkdir -p functions/scripts/archive scripts/archive
  ```
- [ ] `functions/scripts/raise-free-credits.cjs` — **superseded** by `migrate-plan-credits.cjs` (its own header says so).
  ```bash
  git mv functions/scripts/raise-free-credits.cjs functions/scripts/archive/
  ```
- [ ] `functions/scripts/set-free.cjs` — one-off per-user free-plan reset (pre-paid-launch).
  ```bash
  git mv functions/scripts/set-free.cjs functions/scripts/archive/
  ```
- [ ] `functions/scripts/set-trial.cjs` — one-off trial setter (pre-paid-launch).
  ```bash
  git mv functions/scripts/set-trial.cjs functions/scripts/archive/
  ```
- [ ] `functions/scripts/trial-user-ids.json` — historical trial-user list, dated "Set 2026-06-04". Archive alongside the setters (verify nothing still reads it first).
  ```bash
  grep -rn "trial-user-ids" functions/ --include=*.cjs --include=*.ts   # expect: no runtime refs
  git mv functions/scripts/trial-user-ids.json functions/scripts/archive/
  ```
- [ ] `scripts/map-touchables.mjs` — Fabric touch-target diagnostic (compares against a `../hobby-dex` baseline that may not exist locally).
  ```bash
  git mv scripts/map-touchables.mjs scripts/archive/
  ```
- [ ] `scripts/scan-touch-targets.mjs` — same touch-target investigation tooling.
  ```bash
  git mv scripts/scan-touch-targets.mjs scripts/archive/
  ```
- [ ] `scripts/round-splash-icon.py` — one-off splash asset generator. **Keep only if** you expect to regenerate `splash-icon.png`; otherwise archive.
  ```bash
  git mv scripts/round-splash-icon.py scripts/archive/
  ```

**Keep (do NOT touch — documented ongoing tools):** `admin-app.cjs`, `push-prompts.cjs`, `pull-prompts.cjs`, `push-media-decider.cjs`, `migrate-plan-credits.cjs`, `grant-plan.cjs`, `analyze-usage.cjs`, `simulate-free-convo.cjs`, `seed-emulator.cjs`, `inspect-personas.cjs`, `check-firestore-rules.cjs`, `set-app-config.cjs` (keep — needed per mandatory release).

---

## 4. Persona templates — DECIDE (built but unwired)

The 6-template system is fully built + tested but no UI uses it (`PersonaSheet` always calls `newDraft(null)`; there is no template picker). Pick one path:

- [ ] **Path A — wire it up:** add a template picker to the persona-creator entry and pass the chosen id through `newDraft(templateId)`. _(Feature work, not cleanup — out of scope for this checklist; just track it.)_
- [ ] **Path B — remove the dead scaffolding** (if templates were abandoned for the blank-wizard flow):
  - [ ] Delete `domain/personaTemplates.ts`
  - [ ] Delete `domain/__tests__/personaTemplates.test.ts`
  - [ ] Simplify `domain/personaDrafts.ts` `createDraft()` to drop the `templateId` parameter (always blank)
  - [ ] Update `store/personaDraft.ts` `newDraft()` signature to drop `templateId`
  - [ ] Update callers/tests: `store/__tests__/personaDraft.test.ts`, `store/__tests__/storage.test.ts`, `domain/__tests__/personaDrafts.test.ts`, `domain/__tests__/personaForm.test.ts` (these seed from templates today — re-point them at an inline fixture)
  - [ ] Run `npm test` to confirm green

> ⚠️ Don't do Path B casually — confirm with yourself that the template-picker idea is truly dropped. If it's just "not yet," leave it and check Path A.

---

## 5. Stale comments — correct (no behavior change)

- [ ] [components/PersonaSheet.tsx:11-14](../components/PersonaSheet.tsx#L11-L14) — header says the create button is _"inert except for the free-tier upgrade route."_ **Now false** — `handleCreate` routes to `/persona-creator`. Rewrite the header to describe the shipped create flow.
- [ ] [components/PersonaSheet.tsx:781](../components/PersonaSheet.tsx#L781) — _"Inert for now"_ on the create-a-new-bot affordance; update to match current behavior.

**Leave these (accurate, real TODOs — track, don't delete):**
- `app/(app)/chat.tsx:200-201` — _"Selection is cosmetic for now — the chat send path does not yet forward personaId."_ This is the one genuine functional gap in the persona work.
- `functions/src/streamAgentAnswer.ts:87` — `TODO: enable enforceAppCheck` once the client integrates App Check.

---

## 6. Verify nothing broke

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm --prefix functions run build` (if you touched anything under `functions/`)
- [ ] `git status` — review staged deletions/moves before committing
- [ ] Commit in logical chunks (e.g. "chore: remove stray root files", "chore: archive one-off ops scripts", "docs: fix stale PersonaSheet comments")

---

## Explicitly checked and left clean (no action needed)

- No commented-out code blocks anywhere in functional dirs.
- No `.only`/`.skip`/`xit`/`xdescribe` in tests.
- `console.warn` calls are all intentional structured error logging — no stray `console.log`.
- `devSetPlan` is exported but properly gated (`throw dev-only` in prod) — safe.
- `streamReplayTurn` is a shipping feature (replay button), not a debug endpoint.
- `.native.ts(x)` ad splits are legit platform splits, not stubs.
- `NameSheet`/`nameSheet` store are live (replaced the deleted `ChangeNameForm`) — not orphaned.
- `expo-file-system/legacy` imports are an intentional API choice.
