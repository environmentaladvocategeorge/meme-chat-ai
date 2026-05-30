# MeMe Chat AI — App Store & Google Play Privacy Disclosure Sheet

Working draft to fill out Apple's **App Privacy** ("Privacy Nutrition Label") and Google Play's
**Data safety** form. Designed to line up 1:1 with `website/public/privacy.html`. Items needing a
developer decision are marked **[Confirm]**.

Source of truth: code audit of the current branch (functions/, app/, store/, services/).

---

## Key scoping decisions (read first — these drive both forms)

These are the calls that are easy to get wrong. The policy and both store forms must agree on them.

1. **Date of birth / age gate = NOT "collected" for store purposes.**
   DOB and the age-gate decision are stored only in on-device AsyncStorage
   (`store/storage.ts`, `store/ageGate.ts`); they are never transmitted to our servers or any third
   party. Apple and Google "data collection" both mean data that **leaves the device**. On-device-only
   data is not declared. → Do **not** list DOB/age/“Sensitive info” as collected. (The age gate itself
   is still disclosed in the *policy* text, §4 — that's a feature disclosure, not a data-collection label.)

2. **Saving memes/GIFs to the gallery = NOT "Photos and videos" collection.**
   The media-library permission is **add/save only** (`MediaLibrary.requestPermissionsAsync(true)` in
   `components/AttachmentViewer.tsx`). We write a file to the user's library; we never read, scan, or
   upload the user's existing photos. Writing to the device is not "collecting" the user's photos. →
   Do **not** declare "Photos and videos" as a collected data type. (Disclose the *permission* in the
   store listing's permissions section + policy §12.)

3. **Images sent to OpenAI are third-party meme/GIF media, not the user's photos.**
   The only images sent to OpenAI are Klipy meme URLs and GIF frames the backend samples
   (`functions/src/context/assemble.ts`, `functions/src/gifs/extractFrames.ts`). They are part of
   **User content / Messages**, not "Photos and videos." The user uploads no photos/files/audio.

4. **Locale/country ≠ Location.**
   We pass a locale/country code (device locale) to Klipy; we do not read device GPS/geolocation.
   → Do **not** declare Precise or Coarse **Location**. (Apple's Location and Google's "approximate
   location" categories are about geolocation, not locale strings.)

5. **IP address is used only for security / rate-limiting.**
   Raw IP is used transiently for per-IP rate limiting and may appear in diagnostic logs; Firestore
   stores only a SHA-256, truncated hash (`functions/src/billing/rateLimit.ts`). It is not used for
   location or ads. Google offers a **security/fraud-prevention exemption** that can apply; Apple folds
   this into Diagnostics. See per-store notes. **[Confirm]** raw-IP log redaction (Recommended fix C1).

6. **"No push token collected."**
   We request notification permission in onboarding (`store/notifications.ts`) but collect/send no push
   token (no `getExpoPushTokenAsync` anywhere). → Notifications need no data-type declaration today.
   **[Confirm]** future push-token plans — if tokens will be collected, add Device IDs / declare it.

7. **Third parties: processors vs. "sharing."**
   OpenAI, Klipy, RevenueCat, Apple, Google act as service providers/processors. This matters mainly
   for **Google Play's "Shared" column** (Google excludes transfers to service providers from
   "sharing"). See the Google section. **[Confirm]** that each has a DPA / processor terms in place; if
   you cannot confirm processor status for Klipy, declare the relevant types as **Shared**.

---

## 1) Apple App Store — "App Privacy"

Apple model: for each data type, declare whether it's **Collected**, whether it's **Linked to the
user**, and whether it's **Used for Tracking**. (Apple has no "shared" toggle.) "Tracking" = linking
with third-party data for ads, or sharing with data brokers — **we do none**, so *Data Used to Track
You* = **None**.

### Data Used to Track You
**None.** No ad SDK, no IDFA/GAID, no ATT prompt, no cross-app tracking (confirmed: no analytics/ads/
attribution SDKs in the dependency tree).

### Data Linked to You (Collected, Linked, Not used for tracking)

| Apple category → type | What it is | Purposes to check |
|---|---|---|
| **Contact Info → Email Address** | Account email (Firebase Auth / Apple relay) | App Functionality; (Account Management*) |
| **Identifiers → User ID** | Firebase UID, RevenueCat app user ID, Apple Sign In identifier | App Functionality |
| **User Content → Other User Content** | Chat messages, AI replies, titles/summaries, meme/GIF attachment refs + image inputs, message ratings (thumbs), alias/nickname, persona/rot context | App Functionality |
| **User Content → Customer Support** | Emails you send support | App Functionality / Customer Support |
| **Search History** | Klipy meme/GIF search queries — typed **and** AI-generated from the conversation | App Functionality |
| **Purchases → Purchase History** | Subscription status, product IDs, entitlement, transaction metadata (RevenueCat/Apple/Google) | App Functionality |
| **Usage Data → Product Interaction** | Usage events, credits/token metering, ratings, in-app actions | App Functionality |
| **Diagnostics → Crash Data / Performance Data / Other Diagnostic Data** | Cloud Functions logs, error strings, IP/network + rate-limit data, attachment metadata | App Functionality |

\* Apple's purpose list is: App Functionality, Analytics, Product Personalization, Developer's
Advertising/Marketing, Third-Party Advertising, Other. We only use **App Functionality** (and arguably
**Product Personalization** for alias/rot-level). Do **not** check Analytics or any Advertising purpose.

### Data Not Collected (do NOT declare)
- **Health, Financial Info (beyond purchase history), Precise/Coarse Location, Sensitive Info,
  Contacts, Browsing History, Photos or Videos, Audio Data, Device ID.**
- **Date of birth / age** — on-device only (Scoping #1).
- **Photos or Videos** — save-only permission, not collection (Scoping #2).

### Apple notes
- Each provider with its own SDK in the app must be reflected: **RevenueCat** (purchases) is in-app;
  **OpenAI/Klipy** are backend-only (no client SDK) but the *data* they receive is still declared by
  category above. Apple requires disclosing data collected by **third-party partners** via your app.
- **Account deletion:** App offers in-app account deletion (`deleteMyAccount`) — required by App Store
  Guideline 5.1.1(v). Keep the in-app path visible.
- **Age rating:** set the App Store age rating consistent with a 16+ minimum **[Confirm minimum age]**.

---

## 2) Google Play — "Data safety"

Google model: for each type, **Collected?**, **Shared?**, **Processed ephemerally?**, **Required or
optional?**, plus **Purposes**. Then a **Security practices** section.

### Reminder on "Shared" (Scoping #7)
Google **excludes transfers to service providers** from "Shared." If OpenAI, Klipy, and RevenueCat are
processors under DPA/terms, you may mark them **Collected, not Shared**. If you cannot confirm Klipy's
processor status, mark the Klipy-bound types (**User IDs**, **In-app search history**) as **Shared**.
The table below shows the **conservative** answer (Shared = Yes where a third party receives it);
downgrade to "not shared" per type only once processor status is confirmed. **[Confirm]**

### Collected data types

| Play category → type | Collected | Shared (conservative) | Ephemeral | Req/Opt | Purposes |
|---|---|---|---|---|---|
| **Personal info → Email address** | Yes | No | No | Required | App functionality; Account management |
| **Personal info → User IDs** | Yes | **Yes** (Klipy `customer_id`=UID; RevenueCat) | No | Required | App functionality; Account management; Fraud prevention/security |
| **Financial info → Purchase history** | Yes | **Yes** (RevenueCat/Apple/Google) | No | Optional* | App functionality |
| **Messages → Other in-app messages** | Yes | **Yes** (OpenAI) | No | Required | App functionality |
| **App activity → In-app search history** | Yes | **Yes** (Klipy) | No | Optional | App functionality |
| **App activity → App interactions** | Yes | No | No | Required | App functionality |
| **App activity → Other user-generated content** | Yes | **Yes** (meme/GIF image inputs, titles/summaries to OpenAI) | No | Required | App functionality |
| **App info & performance → Crash logs** | Yes | No | No | Required | App functionality |
| **App info & performance → Diagnostics** | Yes | No | No | Required | App functionality |

\* "Required/Optional" = whether the user can use the app without providing it. Purchases are optional
(free tier exists); chat messages/UGC are required to use the core feature; search is optional.

### IP address / rate-limiting
Declare-or-exempt decision: raw IP is used only for **security & abuse prevention** and is stored only
as a hash. Google permits **omitting** data collected/used **solely** for fraud prevention/security/
compliance from the Data safety form. → You may omit IP, **provided** it is truly only used for
security (no analytics/location use). If raw IP persists in general diagnostic logs for debugging, it
is safer to declare it under **App info & performance → Diagnostics**. **[Confirm]** (ties to fix C1).

### Not collected (do NOT declare)
- **Location (approximate/precise), Photos and videos, Audio files, Files and docs, Calendar,
  Contacts, Web browsing, Health & fitness, Device or other IDs.**
- **DOB/age** (on-device only) and **gallery saves** (write-only) — see Scoping #1 & #2.

### Security practices section
- **Is data encrypted in transit?** **Yes.** All backend, OpenAI, and Klipy traffic is HTTPS/TLS;
  Firebase SDK uses TLS.
- **Can users request that data be deleted?** **Yes.** In-app account deletion (`deleteMyAccount`,
  requires recent re-auth) plus deletion-by-email via support.
- **Account-deletion URL:** Google requires a way to request deletion **including a web URL** for
  apps that allow account creation. **[Confirm]** publish a deletion-request/instructions page (e.g.
  `https://%APP_DOMAIN%/delete-account` or document the in-app path on the support page).
- **Committed to follow the Play Families Policy / is this a kids app?** **No** (16+, not directed to
  children). **[Confirm minimum age]**.
- **Independent security review (MASA):** **[Confirm]** — likely "No" unless you've done one.

---

## 3) Cross-check matrix (policy ↔ Apple ↔ Google)

| Concept | Policy § | Apple type | Google type |
|---|---|---|---|
| Email | §3 | Contact Info → Email | Personal info → Email address |
| Firebase UID / RC ID / Apple ID | §3, §10 | Identifiers → User ID | Personal info → User IDs |
| Chat text + AI replies | §5, §7 | User Content → Other | Messages → Other in-app messages |
| Meme/GIF image inputs + attachments | §6 | User Content → Other | App activity → Other UGC |
| Message ratings (thumbs) | §7 | User Content → Other / Usage → Product Interaction | App activity → App interactions |
| Alias / personalization | §7 | User Content → Other | App activity → Other UGC |
| Klipy search (typed + AI-generated) | §8 | Search History | App activity → In-app search history |
| Purchases | §10 | Purchases → Purchase History | Financial info → Purchase history |
| Usage/credits metering | §13 | Usage Data → Product Interaction | App activity → App interactions |
| Logs / errors / IP | §13 | Diagnostics | App info & performance (or security exemption) |
| DOB / age gate | §4 | — (on-device) | — (on-device) |
| Gallery save permission | §12 | — (permission, not data) | — (permission, not data) |
| Notifications | §12 | — (no token) | — (no token) |

---

## 4) Open confirmations specific to store labels

- [ ] **Processor status** for OpenAI / Klipy / RevenueCat → sets every Google "Shared" toggle.
- [ ] **Klipy `customer_id`** stays Firebase UID, or switch to pseudonymous ID (changes User IDs sharing rationale).
- [ ] **Raw IP logging** kept or redacted → Diagnostics declaration vs. security exemption.
- [ ] **Account-deletion web URL** published for Google's deletion requirement.
- [ ] **Minimum age 16** confirmed → both age ratings + "not a kids app."
- [ ] **Future push tokens** → if yes, add Device IDs (Google) / Identifiers (Apple) + Notifications data.
- [ ] **Purchases purpose** — confirm "App functionality" only (no analytics/advertising).
- [ ] Final review that **no field claims Analytics or Advertising purposes** (we use none).
