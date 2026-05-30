# Meme Chat AI

React Native + Expo app, derived from `react-native-app-template`.

**Identity (already bound, do not change unless you mean it):**

| Field | Value |
|---|---|
| App name | Meme Chat AI |
| Slug | meme-chat-ai |
| iOS bundle ID | com.jorgejimenez.memeai |
| Android package | com.jorgejimenez.memeai |
| Deep-link scheme | memechatai |
| App Store Connect SKU | `memeai-001` _(enter when creating the app record in App Store Connect; not stored in code)_ |

App features go on top of the shell below — start by editing
`app/(tabs)/index.tsx` (Home) and adding new screens under `app/`.

---

## What ships out of the box

The shell has zero feature functionality. It gives you:

- Email + Apple Sign-In (with verify-email gate for password users)
- One-step onboarding gate (placeholder Welcome screen)
- Two tabs: **Home** (placeholder) and **Settings** (delete data, theme,
  language)
- English + Spanish localization
- Light + dark themes via NativeWind, controlled by a single palette file
- Cloud Functions for App Store-compliant account deletion + new-user
  profile bootstrap
- Marketing website skeleton (`/`, `/privacy`, `/support`, `/404`)
- RevenueCat scaffolding (no-op until you wire keys)

Leave the auth, onboarding, routing, and settings chrome alone unless
you explicitly want to change behavior.

---

## 1. What you're editing first

In order, the three files that turn this template into _your_ app:

1. **`app.json`** — app name, slug, bundle ID, scheme, EAS project ID.
2. **`nativewind-theme.ts`** — brand colors. Touching this one file
   reskins the whole app.
3. **`.env.example` → `.env`** — Firebase + RevenueCat keys.

Everything else can wait.

---

## 2. External accounts you must create

| # | Account | What you create | What you copy back |
|---|---------|-----------------|--------------------|
| 1 | **Firebase project** ([console.firebase.google.com](https://console.firebase.google.com)) | New project. Enable Authentication (Email/Password + Apple providers), Cloud Firestore, Cloud Functions (requires upgrading to the **Blaze plan** — Functions are not available on Spark). Register a Web app under Project Settings → General. | The 6 `EXPO_PUBLIC_FIREBASE_*` values into `.env`. |
| 2 | **Apple Developer** ([developer.apple.com](https://developer.apple.com)) | App ID matching `com.jorgejimenez.memeai` with **Sign in with Apple** capability enabled. Services ID + Apple-private auth key for the Firebase Apple provider. | Services ID + Key ID + Team ID + the `.p8` private key — paste them into Firebase Console → Authentication → Apple provider. |
| 3 | **Expo + EAS** ([expo.dev](https://expo.dev)) | Run `eas init` in the project root. | `%EAS_PROJECT_ID%` (auto-written into `app.json` by `eas init`). |
| 4 | **RevenueCat** ([app.revenuecat.com](https://app.revenuecat.com)) — _optional_ | New project + iOS/Android apps, hooked up to App Store Connect and Google Play. Create at least one Offering. | The `EXPO_PUBLIC_REVENUECAT_*` values into `.env` (platform keys, plus optional test-store key / entitlement / offering). Leave the platform keys blank to disable; the subscription store no-ops. |
| 5 | **Domain + Firebase Hosting** ([firebase.google.com/docs/hosting](https://firebase.google.com/docs/hosting)) | Buy a domain for the marketing site. Apple **requires** a working privacy URL and support URL when you submit to the App Store. From the `website/` folder run `firebase init hosting` (use the existing project from #1, set public dir to `public`). | Domain into `%APP_DOMAIN%` placeholder. |

You only need #1, #2, #3, #5 to ship. RevenueCat is optional until you
add a paywall.

---

## 3. Remaining placeholders

App identity is already bound (see the top of this README). What's still
templated, scoped to the marketing site + legal copy:

| Placeholder | Where it appears | What you fill in |
|---|---|---|
| `%EAS_PROJECT_ID%` | `app.json` | Output of `eas init` — auto-written for you |
| `%APP_DESCRIPTION%` | `website/public/index.html` | One-sentence pitch for Meme Chat AI |
| `%APP_DOMAIN%` | `website/public/*.html`, `website/public/robots.txt`, `website/public/sitemap.xml` | Bare host, e.g. `memechatai.app` |
| `%APP_STORE_URL%` | `website/public/index.html` | App Store listing URL (fill in after first ship) |
| `%SUPPORT_EMAIL%` | `website/public/support.html`, `website/public/privacy.html` | An inbox you actually check |
| `%COMPANY_NAME%` | `website/public/index.html`, `website/public/privacy.html`, `website/public/404.html` | Legal entity name |
| `%COMPANY_ADDRESS%` | `website/public/privacy.html` | Mailing address (some GDPR contexts require it) |
| `%PRIVACY_LAST_UPDATED%` | `website/public/privacy.html` | ISO date, e.g. `2026-05-28` |

**Brand colors live in one file.** Edit `nativewind-theme.ts` —
specifically `--color-primary` (and the `primary-*` family) — and the
whole app reskins. The placeholder palette is intentionally indigo so it
looks "this needs replacing" rather than "this is shipping."

---

## 4. Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
# Firebase web SDK config — Firebase Console → Project Settings → General →
# Your apps → Web app → SDK setup and configuration. The 6 fields below
# come straight from the firebaseConfig snippet.
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=

# RevenueCat config — RevenueCat Dashboard → Project Settings → API Keys.
# Leave the platform keys blank to disable the subscription store; it will
# no-op rather than crash, and the rest of the app keeps working.
# Flip USE_TEST_STORE=true with a TEST_API_KEY to run local builds against
# RevenueCat's test store instead of the real App Store / Play Store.
EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE=
EXPO_PUBLIC_REVENUECAT_ENABLE_CUSTOMER_CENTER=
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=
EXPO_PUBLIC_REVENUECAT_OFFERING_ID=default
```

`services/firebase/app.ts` treats any value starting with
`REPLACE_WITH_`, containing `YOUR_`, or containing `PLACEHOLDER` as
empty, so leftover hints don't accidentally try to initialise Firebase.

The OpenAI API key is a Firebase Functions secret, not an Expo env var:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

---

## 5. First-run checklist

```bash
# From the template root:
cp .env.example .env                    # then fill in Firebase keys

npm install
cd functions && npm install && cd ..

# Drop fonts into assets/fonts/ (see assets/fonts/README.md).

# Deploy backend bits to your Firebase project:
firebase deploy --only firestore:rules,storage:rules,functions

# Launch the app:
npm run ios       # or: npm run android
```

Then in the simulator:

1. Cold start → lands on the landing screen.
2. Tap **Sign up** → enter email + password → routes to **Verify your email**.
3. Click the link in the verification email → tap **I've verified** →
   routes to the onboarding welcome screen.
4. Tap **Get started** → lands on the Home tab.
5. **Settings → Appearance** toggles theme instantly.
6. **Settings → Language** toggles strings instantly.
7. **Settings → Delete everything** → confirm → account is wiped from
   Firebase Auth and the profile doc is deleted; app returns to landing.

---

## 6. App Store pre-flight

Apple submission gotchas this template already handles, plus what you
still need to do:

- [x] **Account deletion in-app** (5.1.1(v)) — wired via
      `deleteMyAccount` callable.
- [x] **Sign in with Apple** if you offer any other social login (4.8) —
      enabled in `app.json` and `services/firebase/appleAuth.ts`.
- [x] **Privacy policy + Support URL** — Hosting site under `website/`.
- [x] **Encryption export compliance** — `ITSAppUsesNonExemptEncryption:
      false` set in `app.json`.
- [ ] **App Privacy data types** — declare in App Store Connect: Email
      Address linked to user, used for App Functionality only.
- [ ] **Demo account** — App Review wants login credentials. Create a
      throwaway account once you ship a build.
- [ ] **Marketing screenshots** — generate per device size before
      submitting.

---

## 7. What's deliberately out of scope

This template is **not** a CMS, ecommerce kit, or social app starter.
The following intentionally aren't included; add them per-product when
you actually need them:

- Forgot-password screen (the `sendPasswordResetEmail` action exists on
  the auth store — wire a screen when you want it).
- Streaming chat v1 intentionally excludes App Check enforcement, per-uid
  rate limiting, automatic title summarization, multi-provider model
  abstraction, web streaming verification, tool/function calling, message
  editing/regeneration, and conversation deletion.
- Profile photo upload (Storage rules deny by default; open them when you
  add the feature).
- Push notifications (no `expo-notifications` dependency).
- Analytics, ads, in-app review prompts, update prompts.
- Multi-step onboarding (single placeholder step — replace
  `app/onboarding/index.tsx` or add sibling routes).
- Age gate.
- Localization beyond English + Spanish — add languages by dropping new
  files into `locales/` and registering them in `i18n.ts`,
  `SUPPORTED_LANGUAGES`, and `app.json > ios.infoPlist.CFBundleLocalizations`.

---

## 8. Project layout

```
app/                  Expo Router screens
  _layout.tsx         Sole routing dispatcher — do not navigate from screens
  index.tsx           Landing
  auth/               Sign-in, sign-up, verify-email
  onboarding/         Placeholder welcome step
  (tabs)/             Home + Settings (the actual app)
components/           Typography, Button, Input, etc.
domain/
  routing/authRoute.ts  Pure reducer for auth/onboarding routing
  appleNonce.ts         Crypto helpers for Sign in with Apple
hooks/                useTheme
services/firebase/    Firebase init, email auth, Apple auth, callables
store/                Zustand stores (auth, onboarding, settings, subscription, storage)
locales/              en.ts, es.ts
functions/            Cloud Functions (deleteMyAccount, onUserCreated)
website/              Marketing site (Firebase Hosting)
nativewind-theme.ts   Color tokens — edit to rebrand
i18n.ts               i18next setup
app.json              Expo config (placeholders here)
firebase.json         Firestore + Storage + Functions config
firestore.rules       uid-gated reads on profiles/{uid}
storage.rules         Deny-all by default
```
