# Meme Chat AI

An AI chat app powered by Claude. Send a message, get back a reply — sometimes with a meme attached. Features a Brainrot Bot persona with a configurable Rot Level dial, multimodal input (photos + GIFs), conversation history, and a 4-tier subscription model.

**App identity (do not change unless you mean it):**

| Field | Value |
|---|---|
| App name | Meme Chat AI |
| Slug | meme-chat-ai |
| iOS bundle ID | com.jorgejimenez.memeai |
| Android package | com.jorgejimenez.memeai |
| Deep-link scheme | memechatai |

---

## What's built

**Screens**

- Landing → Age gate (16+) → Sign up / Sign in → Email verification → Onboarding
- **Chat** — text + photo + GIF input, AI replies with optional meme/GIF attachments, usage bar, AdMob banner for Free users
- **History** — conversation list with search
- **Settings** — theme, language (9 supported), account management
- **Plan** — subscription tiers, RevenueCat paywall

**Cloud Functions** (16 total)

| Group | Functions |
|---|---|
| Account | `onUserCreated`, `deleteMyAccount`, `updateProfile` |
| Chat | `streamAgentAnswer`, `streamReplayTurn`, `rateMessage`, `setMessageEmoji` |
| Conversations | `deleteConversations`, `summarizeConversation`, `generateConversationTitle` |
| Media | `getTrendingMemes`, `searchMemes`, `getTrendingGifs`, `searchGifs`, `watermarkAttachment` |
| Billing | `devSetPlan`, `syncRevenueCatPlan`, `revenueCatWebhook`, `aggregateDailyUsage` |

**Subscription tiers** — same Claude model on all plans; tiers differ by monthly credit budget (1 credit ≈ $0.001 of API cost):

| Plan | Monthly credits | Approx. messages/month |
|---|---|---|
| Free | 260 | ~97 |
| Basic | 1,953 | ~726 |
| Plus | 5,103 | ~1,897 |
| Power | 11,052 | ~4,109 |

---

## External services

| Service | Purpose | Keys |
|---|---|---|
| **Firebase** | Auth, Firestore, Storage, Functions, Hosting | `EXPO_PUBLIC_FIREBASE_*` (6) |
| **Claude API** | AI replies (via OpenAI-compatible SDK) | `OPENAI_API_KEY` — Firebase secret |
| **Klipy** | Meme + GIF search for agent tool use | `KLIPY_APP_KEY` — Firebase secret (optional; graceful no-op if absent) |
| **RevenueCat** | Subscription management + webhooks | `EXPO_PUBLIC_REVENUECAT_*` (7, all optional) |
| **AdMob** | Banner ads on Free tier | `EXPO_PUBLIC_ADMOB_*` (optional) |

---

## Environment variables

### Production (real project)

Copy `.env.example` → `.env` and fill in the values.

```bash
# Firebase Web SDK — Project Settings → General → Your apps → Web app
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=

# RevenueCat — optional; leave blank to disable the paywall (app still works)
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=
EXPO_PUBLIC_REVENUECAT_OFFERING_ID=default
# Test store: set USE_TEST_STORE=true + TEST_API_KEY to hit RC sandbox
EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE=
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=
EXPO_PUBLIC_REVENUECAT_ENABLE_CUSTOMER_CENTER=

# AdMob — optional; blank falls back to Google test ads in dev builds
EXPO_PUBLIC_ADS_ENABLED=true
EXPO_PUBLIC_ADMOB_IOS_BANNER_ID=
EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID=
```

Functions secrets live in Google Secret Manager, not `.env`:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set KLIPY_APP_KEY           # optional
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH # optional
```

### Local / emulator mode

Three gitignored files layer on top of `.env`. Create them to switch into emulator mode:

**Root `.env.local`** — routes the app at the local emulator instead of the real project:
```bash
EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true
# Optional: force a host (needed for physical devices — auto-detected from Metro otherwise)
# EXPO_PUBLIC_EMULATOR_HOST=192.168.1.20
```

**`functions/.secret.local`** — function secrets for the emulator (see `.secret.local.example`):
```bash
OPENAI_API_KEY=           # needed for real AI replies locally
KLIPY_APP_KEY=            # optional
REVENUECAT_WEBHOOK_AUTH=  # optional
```

**`functions/.env.local`** — dev-only function flags (loaded by emulator only, never deployed):
```bash
ALLOW_DEV_SETPLAN=true    # enables the devSetPlan callable locally
ALLOW_RC_SANDBOX=true     # allows RevenueCat sandbox webhook events
```

**To go back to prod:** delete `.env.local`. The base `.env` is never touched.

---

## Local development

### Prerequisites

- Firebase CLI: `npm i -g firebase-tools`
- Java 11+ (Firestore/Auth/Storage emulators require a JRE; Functions alone does not):
  - Windows: `winget install EclipseAdoptium.Temurin.21.JDK` then open a new terminal
  - macOS: `brew install temurin`

### Commands

```bash
npm run emulators:fresh   # first run — starts with empty state
npm run emulators         # subsequent runs — imports/exports ./.emulator-data
npm run dev:functions     # second terminal — recompiles functions on save
npm run seed              # seeds a test account + sample conversations (while emulators are running)
npm start                 # app in emulator mode (requires .env.local above)

npm run dashboard         # local admin dashboard (builds functions first)
npm run dashboard:install # install dashboard dependencies
```

The seed script creates a Power-plan test account you can sign in with immediately:

```
email:    test@local.dev
password: test1234
```

Emulator UI at http://localhost:4000. State persists in `./.emulator-data/` (gitignored). Delete it to reset to a clean slate.

Full walkthrough: [docs/local-dev.md](docs/local-dev.md).

---

## Monitoring dashboard (local, internal)

`dashboard/` is a **local-only, read-only** monitoring tool. It reads **production**
Firestore + Firebase Auth and surfaces users, conversations, messages, plans, AI
spend, per-turn OpenAI request/response/token reconstruction, user feedback
(👍/👎), and a content-moderation feed. It is **never deployed**, is gitignored,
and is blocked from Metro/EAS bundling — nothing from it can end up in an app
build or the App Store.

### Run it

```bash
firebase login            # one-time, if not already (no service-account key needed)

npm run dashboard:install # one-time — installs the dashboard's own deps
npm run dashboard         # builds functions/lib, then starts API + web
```

Then open **http://127.0.0.1:5173**. Stop with `Ctrl+C`.

- API server runs on `127.0.0.1:8787` (localhost-only, read-only against Firestore).
- Web UI (Vite) runs on `127.0.0.1:5173` and proxies `/api` to the server.
- Auth reuses your Firebase CLI login (the same credentials `firebase deploy`
  uses) — no service-account JSON.

### What's in it

| Tab | Shows |
|---|---|
| **Overview** | user/plan counts, AI spend (24h/7d/30d, in $), daily message & cost charts, signups, top users by cost |
| **Users** | searchable/sortable table → click a user → profile, billing, activity, conversations |
| **Conversation** | full message thread + an **inspector** that rebuilds the exact OpenAI request, response, and token cost for any turn |
| **Feedback** | every message a user rated 👍/👎, with input/output, filterable; click → conversation |
| **Flagged** | messages with sexual/illegal/suicidal/hateful language; unflag to dismiss, toggle Flagged ↔ Dismissed |

There's an **Anonymous** toggle (top-left, off by default) that excludes
RevenueCat `$RCAnonymousID` stub profiles from user counts. Spend is shown in
**dollars** (the cost to you); credits appear only as a secondary internal metric.

Full details and architecture: [dashboard/README.md](dashboard/README.md).

> **Note:** `dashboard/` is excluded from git, so a fresh clone won't include it.
> It lives only on the machine where it was created.

---

## Deploying

```bash
npm install
cd functions && npm install && cd ..

# Backend (rules + functions):
firebase deploy --only firestore:rules,storage:rules,functions

# Marketing site:
firebase deploy --only hosting
```

App builds via EAS:

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

---

## App Store notes

- [x] **Account deletion** (5.1.1(v)) — `deleteMyAccount` callable
- [x] **Sign in with Apple** (4.8) — required since email/password is offered
- [x] **Privacy policy + support URL** — `website/`
- [x] **Non-exempt encryption** — `ITSAppUsesNonExemptEncryption: false` in `app.json`
- [ ] **App Privacy** — declare in App Store Connect: Email Address, linked to user, App Functionality
- [ ] **Demo account** — App Review needs login credentials; use the seeded account or create a throwaway after first build
- [ ] **Marketing screenshots** — generate per device size before submitting

---

## Website placeholders

The marketing site under `website/public/` still has template values to replace:

| Placeholder | Files |
|---|---|
| `%APP_DESCRIPTION%` | `index.html` |
| `%APP_DOMAIN%` | `index.html`, `privacy.html`, `support.html`, `404.html`, `robots.txt`, `sitemap.xml` |
| `%APP_STORE_URL%` | `index.html` (fill in after first ship) |
| `%SUPPORT_EMAIL%` | `privacy.html`, `support.html` |
| `%COMPANY_NAME%` | `index.html`, `privacy.html`, `404.html` |
| `%COMPANY_ADDRESS%` | `privacy.html` |
| `%PRIVACY_LAST_UPDATED%` | `privacy.html` |

---

## Project layout

```
app/
  index.tsx               Landing
  age-gate.tsx            16+ gate
  auth/                   Sign-in, sign-up, verify-email
  onboarding/             Welcome step
  (app)/                  Main tabs — chat, history, settings, plan
components/               UI components (chat, account, ads, onboarding)
domain/                   Pure business logic (billing, memes, GIFs, usage)
services/firebase/        Firebase init, auth, callables, streaming agent client
store/                    Zustand stores (auth, chat, entitlement, settings…)
functions/src/            Cloud Functions (TypeScript)
  scripts/                Admin/seed scripts (seed-emulator.cjs)
docs/                     local-dev.md — emulator workflow
website/                  Marketing site (Firebase Hosting)
nativewind-theme.ts       Color tokens — edit to rebrand
firestore.rules           Uid-gated reads; server-side writes only
storage.rules             User message images only (JPEG/PNG ≤ 8 MB)
firebase.json             Emulator ports + deploy config
.env.example              All EXPO_PUBLIC_* keys documented
```
