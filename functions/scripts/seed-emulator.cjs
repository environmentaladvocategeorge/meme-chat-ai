// Seeds the LOCAL Firebase Emulator Suite with a ready-to-use test account and
// a couple of sample conversations, so the emulators don't start empty.
//
//   npm run seed         (from repo root — builds functions, then runs this)
//
// SAFETY: this forces the Admin SDK at the local emulator via the *_EMULATOR_HOST
// env vars below. With those set the SDK never authenticates against or touches
// the real project, so this can only ever write to the emulator. It refuses to
// run if either host looks non-local.
//
// Re-running is idempotent for the user (created once, then left alone) and
// additive for conversations (you'll accumulate sample threads). Wipe state with
// `rm -rf .emulator-data` (or delete the folder) to start clean.

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

function assertLocal(label, hostPort) {
  const host = hostPort.split(":")[0];
  const ok = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host);
  if (!ok) {
    console.error(
      `Refusing to seed: ${label} (${hostPort}) is not a local emulator host.`,
    );
    process.exit(1);
  }
}
assertLocal("FIREBASE_AUTH_EMULATOR_HOST", AUTH_HOST);
assertLocal("FIRESTORE_EMULATOR_HOST", FS_HOST);

// Set before requiring firebase-admin so the SDK picks up emulator routing.
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;

const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  getFirestore,
  FieldValue,
  Timestamp,
} = require("firebase-admin/firestore");

// Reuse the real plan/billing helper so a seeded profile matches exactly what
// the app writes. Requires `npm --prefix functions run build` first (the `seed`
// npm script does this for you).
let planActivationFields;
try {
  ({ planActivationFields } = require("../lib/entitlement/schema"));
} catch {
  console.error(
    "Could not load functions/lib — build first: npm --prefix functions run build",
  );
  process.exit(1);
}

// projectId must match .firebaserc / firebase.json so the emulator namespaces
// the data under the same project the app uses in emulator mode.
const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "memechatai-8d8af";

const TEST_USER = {
  uid: "seed-power-user",
  email: "test@local.dev",
  password: "test1234",
  alias: "Test Pro",
  plan: "power",
};

async function ensureAuthUser(auth) {
  try {
    await auth.createUser({
      uid: TEST_USER.uid,
      email: TEST_USER.email,
      emailVerified: true,
      password: TEST_USER.password,
      displayName: TEST_USER.alias,
    });
    console.log(`  ✓ auth user ${TEST_USER.email} (pw: ${TEST_USER.password})`);
  } catch (err) {
    if (err.code === "auth/uid-already-exists" || err.code === "auth/email-already-exists") {
      console.log(`  • auth user ${TEST_USER.email} already exists — left as-is`);
      return;
    }
    throw err;
  }
}

async function seedProfile(db) {
  const now = new Date();
  const billing = {
    plan: TEST_USER.plan,
    planSource: "stub",
    rcAppUserId: null,
    rcActiveProductId: null,
    rcEntitlementExpiresAt: null,
    ...planActivationFields(TEST_USER.plan, now),
  };

  // Mirrors onUserCreated's profile shape, but onboarded and on a paid plan.
  await db.doc(`profiles/${TEST_USER.uid}`).set(
    {
      uid: TEST_USER.uid,
      email: TEST_USER.email,
      emailVerified: true,
      providers: ["password"],
      createdAt: FieldValue.serverTimestamp(),
      alias: TEST_USER.alias,
      onboardingCompleted: true,
      ...billing,
    },
    { merge: true },
  );
  console.log(`  ✓ profile profiles/${TEST_USER.uid} (plan: ${TEST_USER.plan})`);
}

// Writes a conversation + its messages with monotonically increasing timestamps
// so history orders correctly (loadRecentMessages sorts by createdAt).
async function seedConversation(db, { title, messages }) {
  const convoRef = db.collection("conversations").doc();
  const base = Date.now() - messages.length * 1000;
  const ts = (i) => Timestamp.fromMillis(base + i * 1000);
  const last = messages[messages.length - 1];

  await convoRef.set({
    uid: TEST_USER.uid,
    title,
    firstUserMessage: messages[0].text.slice(0, 500),
    titleGenerated: true,
    plan: TEST_USER.plan,
    createdAt: ts(0),
    updatedAt: ts(messages.length - 1),
    lastMessagePreview: last.text.slice(0, 160),
  });

  let i = 0;
  for (const m of messages) {
    await convoRef.collection("messages").doc().set({
      role: m.role,
      text: m.text,
      status: "complete",
      createdAt: ts(i),
      updatedAt: ts(i),
      ...(m.role === "user" ? { clientMessageId: `seed-${convoRef.id}-${i}` } : {}),
    });
    i += 1;
  }
  console.log(`  ✓ conversation "${title}" (${messages.length} messages)`);
}

async function main() {
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  console.log(`Seeding emulator (project ${PROJECT_ID}, firestore ${FS_HOST})…`);
  await ensureAuthUser(auth);
  await seedProfile(db);

  await seedConversation(db, {
    title: "First brainrot session",
    messages: [
      { role: "user", text: "yo what's the most unhinged take you've got today" },
      { role: "agent", text: "buckle up bestie, we're going FERAL today 💀" },
      { role: "user", text: "do your worst" },
      { role: "agent", text: "ok so hear me out: cereal is just breakfast soup and I will die on this hill 🥣⚰️" },
    ],
  });

  await seedConversation(db, {
    title: "Quick check-in",
    messages: [
      { role: "user", text: "say something motivational but make it cursed" },
      { role: "agent", text: "you miss 100% of the shots you don't take — Wayne Gretzky — Michael Scott — me, just now ✨" },
    ],
  });

  console.log("\nDone. Sign in to the app with:");
  console.log(`  email:    ${TEST_USER.email}`);
  console.log(`  password: ${TEST_USER.password}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
