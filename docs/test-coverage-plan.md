# Meme Chat AI — Test Coverage Audit & Plan

_Owner: QA / engineering. Status: **implemented** — Phases 1–4 landed (see §5). Scope: pure JavaScript/TypeScript unit tests only — no e2e, no simulator, no rendered native trees._

> **Landed (this pass): +155 tests across 19 new suites.** App **408 → 493** (32 → 43 files); functions **712 → 782** (59 → 67 files). `npm run typecheck` + `npm --prefix functions run lint` clean (the lone `dashboard/src/lib/prefs.tsx` typecheck error is pre-existing and unrelated). Two additive exports shipped to make private mappers testable: `services/firebase/entitlement.ts` (`mapEntitlement`) and `services/firebase/conversations.ts` (`mapMessage`/`mapConversation`) — no behavior change.

## TL;DR

The suite is already strong and built the right way: bug-prone logic lives in framework-free modules under `domain/`, `store/`, `services/firebase/`, and `functions/src/`, exercised with `ts-jest` + node. Baseline is **~1,120 tests across 91 first-party suites** (app **408 / 32**, functions **712 / 59**). The gaps aren't in *how* we test — they're a handful of high-value modules left uncovered: the per-IP rate limiter, the Tavily web-search client, the "look-&-pick" media selector, the hate-speech gate, token estimation, the auth-service error mapping, and two Firestore→model mappers (entitlement + chat messages) that are written to be testable but were never exported.

This plan maps every functional area, ranks the gaps, and closes the ones that matter — no coverage-threshold gate anywhere.

## Current state

| Suite | Config | Files (before → after) | Tests (before → after) |
|---|---|---|---|
| App (`npm test`) | `jest.config.js` | 32 → **43** | 408 → **493** |
| Functions (`npm --prefix functions test`) | `functions/jest.config.js` | 59 → **67** | 712 → **782** (781 + 1 skipped) |
| **Total** | — | **91 → 110** | **~1,120 → ~1,275, all green** |

`npm run typecheck` is clean. Both suites run in node with `clearMocks: true`, the `@/…` alias mirrored, no `jest-expo`, no React renderer, no coverage config — correct for the stated goal.

---

## 1. What I found

> **Implementation status — §1c gaps closed:** #1 rateLimit ✅ · #2 tavilyClient ✅ · #3 checkHateSpeech ✅ · #4 pickBestMedia ✅ · #5 tokens + plans ✅ · #6 conversations mappers ✅ (exported) · #7 entitlement mapper ✅ (exported) · #8 emailAuth + appleAuth ✅ · #9 callables ✅ · #10 klipy/client ✅ · #11 messageGif ✅ · #12 domain billing/memes/gifs/appleNonce/appStoreReview/authRoute ✅. Remaining: #13 (repository resilience cores) + Phase 5 items, tracked below.

### 1a. Why the setup works (and why we keep it)

The codebase splits "decide" from "do." Native/network-bound modules stay thin; the rule they enforce is lifted into a pure function next to them, tested in node:

- `components/chat/buildVisibleMessages.ts` (the chat thread's de-dup/streaming/settle/error logic) is pure and tested; `app/(app)/chat.tsx` only wires it.
- `store/subscriptionDerive.ts` (`deriveFromCustomerInfo`) is tested; `store/subscription.ts` wires it to the RevenueCat SDK.
- `functions/src/billing/credits.ts`, `ledger.ts`, `entitlement/dailyWindow.ts` are pure and tested; the Firestore transactions wrapping them are thin (and mostly covered via in-memory fakes).
- `services/firebase/streamAgent.ts` (the SSE parser + auth/refresh/replay loop) is tested with a mocked `XMLHttpRequest`.

This matches Expo/React Native guidance: if a function is pure, test it in node and don't give it a rendered tree.

### 1b. Strengths to preserve

- **Edge-first.** Existing tests hit boundaries, corrupt input, and the fallback branch — not just the happy path (e.g. `streamAgent.test.ts`, `resolveImageInputs.test.ts`, `repository.test.ts`).
- **Fail-open is a tested concern** server-side (`credits.ts`, the moderation/persona path). We extend that to the remaining fail-open gates.
- **Determinism.** Functions that need "now"/randomness take an injectable arg or are driven through fake timers (`store/chat.test.ts` fakes the await-grace timer; `replaySampling.test.ts` pins RNG).

### 1c. Gaps that matter — ranked

Legend: ★ = money/abuse/safety path or core UX correctness.

| # | Area | Module(s) | Why it matters | Approach |
|---|---|---|---|---|
| 1 ★ | Abuse path | `functions/src/billing/rateLimit.ts` | Per-IP 60/hr gate guards the paid endpoint; fail-open branches untested | `extractClientIp` is pure; `checkIpRateLimit` via in-memory txn fake |
| 2 ★ | Web search | `functions/src/web/tavilyClient.ts` | New 1.1.x feature; never-throw contract feeds the reply model | `formatTavilyContext` pure; `tavilySearch` via `fetch` mock |
| 3 ★ | Safety gate | `functions/src/moderation/checkHateSpeech.ts` | Blocks slurs pre-persist; must fail **open** on API error | mock OpenAI moderation; flagged/clean/throw |
| 4 | Media selection | `functions/src/agent/pickBestMedia.ts` | nano "look-&-pick"; parse/clamp/never-throw → top hit | mock OpenAI; index parse + bounds + catch |
| 5 ★ | Billing inputs | `functions/src/context/tokens.ts`, `functions/src/billing/plans.ts` | Token estimate + plan credit table drive every charge | pure math + invariant tests |
| 6 ★ | Chat data integrity | `services/firebase/conversations.ts` (`mapMessage`/`mapImages`/`mapGifs`/`mapConversation`) | Defensive Firestore→model parse; drives the whole thread; private + untested | export the mappers, test directly |
| 7 ★ | Entitlement mapping | `services/firebase/entitlement.ts` (`mapEntitlement`) | Plan/credit fallback + daily-window reset-for-display; drives usage/paywall; private + untested | export `mapEntitlement` (+ helpers), test directly |
| 8 | Auth mapping | `services/firebase/emailAuth.ts`, `appleAuth.ts` | error-code→result incl. password-reset **enumeration guard** | mock `firebase/auth`, assert mapping |
| 9 | Callable plumbing | `services/firebase/callables.ts` | `firebase-unavailable` guard + `.data` unwrap + target name across ~12 callables | mock `firebase/functions` + services |
| 10 | External client | `functions/src/klipy/client.ts` | Klipy HTTP (shaping / non-200 / error) behind get_meme/get_gif | `fetch` mock |
| 11 | Validation symmetry | `functions/src/messages/messageGif.ts` | `messageImage` schema is tested; the GIF twin isn't | zod parse: valid/invalid/caps |
| 12 | Pure mappers | `domain/billing.ts`, `domain/memes.ts`, `domain/gifs.ts`, `domain/appleNonce.ts`, `domain/appStoreReview.ts`, `domain/routing/authRoute.ts` | small pure cores written to be testable, never tested | direct |
| 13 | Resilience cores | `functions/src/conversations/repository.ts` `finalizeAgentMessage({saved})` + `watchMessageDeleted` | new v1.1.1 pause/finish-&-save logic — only emulator-covered today | extend `repository.test.ts` with a NOT_FOUND fake |

---

## 2. How we test here — rules of the road

### 2a. Pure JS/unit only
Tests run under `ts-jest` in node. **No** e2e (Maestro/Detox), **no** simulator, **no** render trees. Native/SDK modules — `react-native-google-mobile-ads`, `expo-glass-effect`, `expo-image-*`, `react-native-purchases`, `@react-native-firebase/*`/`firebase/*` — are **never imported for real**; we test the pure logic that feeds them and `jest.mock()` the boundary only when a thin wrapper must be exercised.

> Glass / ads / images: the testable brains (`buildVisibleMessages`, `messageFormat`, `mediaLayout`, `pickerVisibility`, `customization`) are unit-tested; `GlassSurface` falls back to a plain surface off iOS 26 and holds no logic worth a test.

### 2b. No coverage gates — a living map instead
No `collectCoverage`, no `coverageThreshold`. Coverage is tracked by hand in §3 and kept current as modules are added.

### 2c. The quality bar (no false positives, no busywork)
1. **It can fail.** Invert the function's core branch and an assertion goes red. No tautologies.
2. **Behavior, not shape.** Assert outputs and state transitions, not merely that a mock was called.
3. **The failure path is the point.** Anything touching network/Firestore/OpenAI/native gets its error + fallback branch tested (fail-open vs fail-closed asserted explicitly).
4. **Boundaries and degenerate input.** Off-by-one edges, empty/`null`/`NaN`, corrupt JSON, out-of-enum values, oversized arrays.
5. **No snapshot-only tests.**
6. **Deterministic.** Inject/mantle `now`, fake timers for debounce/grace, mock randomness.
7. **Independent.** `clearMocks` + per-test state reset (zustand stores reset via `setState`).

### 2d. Mocking approach
Inline per test file, following the proven existing patterns: factory `jest.mock` for the OpenAI SDK / `firebase/*` / `fetch` boundary, and an in-memory transactional fake for Firestore in the functions suite (see `rateMessage.test.ts`, `repository.test.ts`). A tiny refactor to export two private mappers (#6, #7) is the only production change — additive, no behavior change, matching the codebase's existing "export the pure core" convention.

---

## 3. Coverage map (every functional area)

Legend: ✅ tested · ⬜ untested, in scope · ➖ out of scope (thin native/config/prompt glue or SDK orchestration whose pure core is already tested).

### domain/
| Module | Status |
|---|---|
| `age`, `agentText`, `appVersion`, `attachments`, `customization`, `mediaLayout`, `personaDrafts`, `personaForm`, `personaTemplates`, `personas`, `publishPersona`, `savePersonaEdit`, `tagInput`, `usage` | ✅ |
| `billing`, `memes`, `gifs`, `appleNonce`, `appStoreReview`, `routing/authRoute` | ⬜ (#12) |
| `ads/*` | ➖ native gating |

### store/
| Module | Status |
|---|---|
| `ageGate`, `chat`, `entitlement`, `onboarding`, `personaDraft`, `personas`, `reviewPrompt`, `storage`, `subscriptionDerive` | ✅ |
| `auth`, `subscription` | ➖ SDK orchestration; pure cores tested (`subscriptionDerive`) |
| `settings`, `appUpdate`, `notifications` | ⬜ low — test only if a non-trivial reducer appears |
| `accountSheet`, `chatCustomizationSheet`, `languageSheet`, `memorySheet`, `menu`, `nameSheet`, `personaSheet`, `planSheet`, `rotLevelSheet` | ➖ trivial open/close sheets |

### services/firebase/
| Module | Status |
|---|---|
| `profile`, `streamAgent`, `uploadMessageImage`, `uploadPersonaAvatar` | ✅ |
| `conversations` (mappers), `entitlement` (`mapEntitlement`) | ⬜ ★ (#6, #7) — export + test |
| `emailAuth`, `appleAuth`, `callables` | ⬜ (#8, #9) |
| `personas`, `memory` | ⬜ low — snapshot/callable mappers if non-trivial |
| `app`, `appConfig`, `emulator`, `sessionErrors` | ➖ bootstrap/config/class |

### hooks/
| Module | Status |
|---|---|
| all (`useKlipy*`, `useChatAppearance`, `useDailyPaywall`, `useMemory`, `useOnSendEffects`, `useOpenPlan`, `useTheme`, `useDebouncedValue`, `useRelativeTime`, `useResetCountdown`) | ➖ wiring — but extract the **pure cores** worth testing: a Klipy pagination reducer (`useKlipyContent`), relative-time formatting, countdown math, debounce timer. Tracked as optional. |

### functions/src/
| Module | Status |
|---|---|
| `__tests__/*` (deleteMyAccount, streamAgentRequest, streamAuth, streamReplayRequest, streamReplayTurn.billing) | ✅ |
| `agent/` decideMedia, decideWebSearch, replaySampling, streamAgent, memory/* | ✅ |
| `agent/pickBestMedia` | ⬜ (#4) |
| `agent/webSearch`, `agent/ConversationHistory`, `agent/Agent` | ⬜ low — shaping/windowing (cores like decideWebSearch already ✅); full Agent = ➖ orchestration |
| `billing/` credits, dailyCap, ledger, models, revenuecat, router | ✅ |
| `billing/rateLimit`, `billing/plans` | ⬜ ★ (#1, #5) |
| `context/` assemble, assembleContext, buildCurrentUserContent, compaction | ✅ |
| `context/tokens` | ⬜ ★ (#5) |
| `context/title`, `context/summarize` | ⬜ low — fallback/orchestration |
| `conversations/` cancelAgentReply, deleteConversations, rateMessage, repository | ✅ (extend repository for #13) |
| `entitlement/` dailyWindow, devSetPlan, planActivation, reset, schema | ✅ |
| `entitlement/loadEntitlement` | ⬜ low |
| `gifs/` extractFrames, getGifTool, klipy · `memes/` getMemeTool, getTrendingMemes, klipy · `klipy/pickByRandomness` | ✅ |
| `klipy/client` | ⬜ (#10) |
| `messages/` attachmentMeta, messageImage, resolveImageInputs, sanitizeAgentText | ✅ |
| `messages/messageGif` | ⬜ (#11) |
| `moderation/personaModeration` | ✅ |
| `moderation/checkHateSpeech` | ⬜ ★ (#3) |
| `moderation/logFlaggedContent` | ➖ best-effort logging |
| `personas/*` (12 suites: spec render, prompts, rotLevel, savePersona, userPersonas, moderation, avatar/description, invariants …) | ✅ |
| `personas/perTurnNote`, `platformGuardrailsPrompt` | ➖ prompt strings |
| `profile/updateProfile`, `revenueCat/*` (handle, syncPlan, webhook), `watermark/watermarkAttachment` | ✅ |
| `watermark/watermark`, `watermark/logo` | ➖ sharp compositing |
| `onUserCreated`, `aggregations/dailyUsage`, `agent/memory/{clearMemory,setMemoryEnabled,generateUserMemory}` | ⬜ low — default-shape / scheduled / callable glue |
| `streamAgentAnswer`, `streamReplayTurn`, the `onCall`/`onRequest` handlers | ➖ orchestration; pieces tested. Cancellation/finish-&-save paths need the emulator or `firebase-functions-test` (see §5 optional) |

---

## 4. Spotlights

**`functions/src/agent/pickBestMedia.ts`** — mock the OpenAI client to return scripted `chat.completions.create` results. Cases: `titles.length <= 1` short-circuits to `{index:0, ZERO_USAGE}` with no API call; a valid `{"index":2}` is honored; out-of-range / negative / `NaN` / non-integer index clamps to 0; malformed JSON content → 0; a thrown SDK error → `{index:0, ZERO_USAGE}` (never throws); usage fields map from `prompt_tokens`/`completion_tokens_details`.

**`functions/src/web/tavilyClient.ts`** — `formatTavilyContext` is pure: answer-only, results-only, both, neither (→`null`), `MAX_SOURCES` cap, per-snippet + whole-block truncation, malformed result entries skipped. `tavilySearch` mocks `fetch`: 2xx→formatted block, non-2xx→`null`, throw→`null`, empty body→`null`, and asserts the request shape (URL, bearer header, `search_depth:"basic"`).

**`services/firebase/conversations.ts` mappers** — feed scripted Firestore docs: a complete agent reply maps through; an empty `streaming` placeholder is dropped; an attachment-only complete message is kept; corrupt `images`/`gifs` entries are filtered; bad `role`/`status` → `null`; persona/reaction/levelOfRot shaping. (Requires exporting the mappers — see §5 Phase 2.)

---

## 5. Phased plan

### Phase 1 — pure cores (no production changes) — ✅ DONE
- [x] `functions/src/agent/pickBestMedia.ts`, `functions/src/web/tavilyClient.ts` (`formatTavilyContext`), `functions/src/context/tokens.ts`, `functions/src/billing/plans.ts` (invariants), `functions/src/messages/messageGif.ts`.
- [x] `domain/billing.ts`, `domain/memes.ts`, `domain/gifs.ts`, `domain/appleNonce.ts`, `domain/appStoreReview.ts`, `domain/routing/authRoute.ts`.

### Phase 2 — chat/entitlement data integrity ★ (tiny additive export) — ✅ DONE
- [x] Exported + tested `services/firebase/conversations.ts` (`mapMessage`/`mapConversation`) and `services/firebase/entitlement.ts` (`mapEntitlement`).
- [x] `services/firebase/callables.ts` `firebase-unavailable` guard + `.data` unwrap + target name.

### Phase 3 — money/abuse/safety, server-side ★ — ✅ DONE
- [x] `functions/src/billing/rateLimit.ts` (`extractClientIp` + `checkIpRateLimit` via txn fake), `functions/src/moderation/checkHateSpeech.ts` (fail-open), `functions/src/web/tavilyClient.ts` (`tavilySearch` fetch), `functions/src/klipy/client.ts`.

### Phase 4 — auth mapping + resilience cores — ◐ PARTIAL
- [x] `services/firebase/emailAuth.ts`, `services/firebase/appleAuth.ts`.
- [ ] Extend `functions/src/conversations/__tests__/repository.test.ts` for `finalizeAgentMessage` `{saved:false}` on NOT_FOUND + `watchMessageDeleted` fire-on-delete (#13).

### Phase 5 — remaining mappers + integrity (not started)
- `services/firebase/personas.ts` / `memory.ts` mappers (if non-trivial), `functions/src/entitlement/loadEntitlement.ts`, `functions/src/context/title.ts`, `functions/src/agent/webSearch.ts` shaping.

### Optional / later
- Extract pure cores from hooks (`useKlipyContent` pagination reducer, relative-time/countdown formatters, `useDebouncedValue`) and test those, not the hooks.
- `onCall`/`onRequest` handlers — including the v1.1.1 streaming cancel / finish-&-save paths — via `firebase-functions-test` or the emulator (out of the pure-unit scope; tracked separately).
- Shared `test/` fixtures to de-dupe the AsyncStorage / Firestore fakes.

---

## 6. Pass criteria

- **Per test:** inverting the central branch goes red; asserts a value/transition, not a bare call; includes a failure/edge case; deterministic across re-runs and random order.
- **Per suite:** both green and fast; zero real network/native/SDK loads; **no** coverage threshold added.
- **Definition of done:** Phases 1–4 complete, the §1c gap table cleared to low/optional items, this map reflecting reality, and `npm run typecheck` + `npm --prefix functions run lint` clean.

---

## 7. Notes from current (2026) best practice

- **Pyramid, our slice.** ~70% unit / 20% component / 10% e2e is the standard split; we deliberately took the thorough 70% — pure unit in node — which is what this architecture is shaped for.
- **Native/SDK modules stay mocked, never loaded.** Keep logic out of components and `jest.mock()` the boundary only when a thin wrapper must be exercised.

Sources: [Expo — Unit testing](https://docs.expo.dev/develop/unit-testing/) · [Expo — Mocking native calls](https://docs.expo.dev/modules/mocking/) · [React Native — Testing Overview](https://reactnative.dev/docs/testing-overview) · [Jest — Testing React Native](https://jestjs.io/docs/tutorial-react-native)

---

_Appendix — re-run with `npm test` and `npm --prefix functions test`; typecheck with `npm run typecheck`._
