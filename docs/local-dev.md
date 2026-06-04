# Local development with the Firebase Emulator Suite

A fully local dev environment: Functions, Firestore, Auth, and Storage all run
on your machine. No second cloud project, no billing, nothing to tear down.
Data persists between runs and your production project is never touched.

## One-time setup

1. **Install the Firebase CLI and Java** (the emulators need a JRE):
   - `npm i -g firebase-tools` (or use `npx firebase`)
   - Java 11+ — `java -version` to check; install Temurin/OpenJDK if missing.
2. **Functions secrets** — copy the example and fill in at least an OpenAI key
   if you want real agent replies locally:
   ```
   cp functions/.secret.local.example functions/.secret.local
   ```
   `KLIPY_APP_KEY` and `REVENUECAT_WEBHOOK_AUTH` are optional locally.
3. **App toggle** — a gitignored `.env.local` already exists with
   `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true`. Its presence is what points the app
   at the emulators. **Delete or rename it to go back to the real project.**

## Daily workflow

Two terminals:

```
# Terminal 1 — emulators (first ever run: use emulators:fresh, no import)
npm run emulators:fresh      # first run only — starts empty
npm run emulators            # every run after — imports your saved data

# Terminal 2 — function hot-reload (recompiles TS -> lib on save)
npm run dev:functions

# Terminal 3 — the app, in emulator mode thanks to .env.local
npm start
```

- Emulator UI: http://localhost:4000 — inspect Firestore, Auth users, logs.
- State is written to `./.emulator-data/` on exit (`Ctrl-C`) and re-imported next
  time. That folder is gitignored. Delete it to reset to a clean slate.

## How the wiring works

- [services/firebase/emulator.ts](../services/firebase/emulator.ts) holds the
  toggle (`EXPO_PUBLIC_USE_FIREBASE_EMULATOR`) and derives the emulator host from
  Metro, so it works on the iOS simulator, Android emulator, and physical
  devices on the same network. Override with `EXPO_PUBLIC_EMULATOR_HOST`.
- [services/firebase/app.ts](../services/firebase/app.ts) calls
  `connect*Emulator` for Auth/Firestore/Functions/Storage right after init.
- The **streaming** endpoints (`streamAgentAnswer`, `streamReplayTurn`) are
  `onRequest` and build their own URL, so
  [services/firebase/streamAgent.ts](../services/firebase/streamAgent.ts)
  redirects them to the functions emulator separately.
- [functions/.env.local](../functions/.env.local) flips the dev-only guards
  (`ALLOW_DEV_SETPLAN`, `ALLOW_RC_SANDBOX`). It is loaded **only** by the
  emulator, never by `firebase deploy`.

## Seeding data

Two ways to get data into a fresh emulator:

**A. Just use the app.** Sign up a user — the `onUserCreated` trigger fires
locally and creates the profile/entitlement docs exactly as in production.
`--export-on-exit` then persists everything for next time.

**B. Run the seed script** for an instant ready-to-use account:

```
# In a separate terminal, while the emulators are running:
npm run seed
```

This creates a **Power-plan** test user and a couple of sample conversations:

```
email:    test@local.dev
password: test1234
```

Sign in with those in the app. The script
([functions/scripts/seed-emulator.cjs](../functions/scripts/seed-emulator.cjs))
talks only to the emulator — it sets `*_EMULATOR_HOST` and refuses to run
against a non-local host, so it can never touch the real project. The seeded
profile is built with the same `planActivationFields` helper the app uses, so
its billing/credits match a real Power subscriber. Re-running leaves the user
alone and just adds more sample threads; delete `./.emulator-data/` to reset.

## Pre-deploy smoke test (optional)

The emulator runs the same compiled functions you deploy, so it catches almost
everything. The one class it can't reproduce is deploy-specific issues (e.g. a
callable losing its invoker binding after a redeploy). If you ever need that,
the next step up is a second Firebase project added as a `.firebaserc` alias and
`firebase deploy -P <alias>` — but that needs Blaze billing and duplicated
secrets, so reach for it only when an emulator-clean change misbehaves in prod.
