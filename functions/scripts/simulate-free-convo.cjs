// Simulates a free user having a real back-and-forth conversation against the
// LIVE streamAgentAnswer endpoint, then reports the credit burn per turn from
// usageEvents. Auth: mints a custom token for the uid via the Admin SDK and
// exchanges it for an ID token through the Identity Toolkit REST API (the same
// flow the app's client SDK uses).
//
// This spends real OpenAI tokens and real credits on the target account — use
// on a test/own account only, ideally after set-free.cjs (snapshot + restore).
//
// Usage (from repo root):
//   node functions/scripts/simulate-free-convo.cjs <uid> [turns=20]
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");
const { getDb, initAdminApp, PROJECT_ID } = require("./admin-app.cjs");

const STREAM_URL = "https://streamagentanswer-wmiutuwpka-uc.a.run.app";

const uid = process.argv[2];
const turnCount = Number(process.argv[3] ?? 20);
if (!uid) throw new Error("usage: node simulate-free-convo.cjs <uid> [turns]");

// A realistic casual free-user session: greetings, reactions, factual asks,
// roast requests, follow-ups. Mix of short and long turns.
const TURNS = [
  "yo, send me a gif",
  "lol not much, just got home from work",
  "my boss made us redo the whole deck for the third time bro, send a gif of how done i am",
  "roast him for me",
  "LMAOOO ok that's good, send me a victory gif",
  "real talk how do mortgages actually work, me and my gf were arguing about it",
  "wait so the bank owns the house??",
  "ok that makes sense. what's a good down payment percent",
  "we're cooked then lol we got like 4k saved",
  "fair fair. anyway you watch the knicks game",
  "bro they blew a 20 point lead AGAIN",
  "send me some brainrot to heal",
  "another one",
  "ok i'm dead 💀 what does sybau even mean btw",
  "my gf says it constantly now",
  "should i be worried she's chronically online",
  "lol true. ok real question, is it bad to charge my phone overnight",
  "huh interesting. what about leaving the laptop plugged in 24/7",
  "you actually know stuff for a meme bot",
  "aight i'm out, later",
];

function parseEnvApiKey() {
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8");
  const m = env.match(/^EXPO_PUBLIC_FIREBASE_API_KEY=(.+)$/m);
  if (!m) throw new Error("EXPO_PUBLIC_FIREBASE_API_KEY not found in .env");
  return m[1].trim();
}

// Custom tokens need signBlob, which the CLI-user credential lacks. Instead:
// set a one-off random password on the account (plain Admin REST, no signing),
// sign in with it via Identity Toolkit, and report whether the password
// provider existed before so the caller can unlink it afterwards. Side effect:
// existing refresh tokens are revoked, so live app sessions on this account
// must re-sign-in.
async function mintIdToken(targetUid, apiKey) {
  const auth = getAuth();
  const user = await auth.getUser(targetUid);
  if (!user.email) throw new Error("target user has no email; cannot password-sign-in");
  const hadPasswordProvider = user.providerData.some(
    (p) => p.providerId === "password",
  );
  const tempPassword = require("crypto").randomBytes(24).toString("base64url");
  await auth.updateUser(targetUid, { password: tempPassword });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: tempPassword,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`password sign-in failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.localId !== targetUid) {
    throw new Error(`signed in as ${json.localId}, expected ${targetUid}`);
  }
  return { idToken: json.idToken, hadPasswordProvider };
}

// Removes the temporary password provider unless the account already had one.
async function cleanupPasswordProvider(targetUid, hadPasswordProvider) {
  if (hadPasswordProvider) {
    console.log(
      "NOTE: account already had a password provider; its password was replaced by a random one this run.",
    );
    return;
  }
  try {
    await getAuth().updateUser(targetUid, { providersToUnlink: ["password"] });
    console.log("temporary password provider unlinked");
  } catch (e) {
    console.log("WARN: failed to unlink temp password provider:", e.message);
  }
}

// Streams one turn; resolves with the SSE outcome.
async function runTurn(idToken, conversationId, message, index) {
  const body = {
    message,
    clientMessageId: `sim-${Date.now()}-${index}`,
    levelOfRot: 2,
    respondWithEmojis: true,
    respondWithMedia: true,
    language: "en",
  };
  if (conversationId) body.conversationId = conversationId;

  const res = await fetch(STREAM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }

  const out = { conversationId, text: "", gif: false, meme: false, quota: null, error: null };
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      let parsed = {};
      try { parsed = data ? JSON.parse(data) : {}; } catch {}
      if (event === "conversation") out.conversationId = parsed.id;
      else if (event === "delta") out.text += parsed.text ?? "";
      else if (event === "gif") out.gif = true;
      else if (event === "meme") out.meme = true;
      else if (event === "quota_exceeded") out.quota = parsed;
      else if (event === "error") out.error = parsed.code ?? "unknown";
    }
  }
  return out;
}

async function readBilling(db) {
  const d = (await db.doc(`profiles/${uid}`).get()).data();
  return {
    creditsRemaining: d.creditsRemaining,
    dailyCreditsUsed: d.dailyCreditsUsed,
  };
}

(async () => {
  // CLI-user OAuth can't sign custom tokens itself; route signing through the
  // App Engine default SA via IAM signBlob (needs iam.serviceAccounts.signBlob
  // on that SA — project owner has it).
  initAdminApp({ serviceAccountId: `${PROJECT_ID}@appspot.gserviceaccount.com` });
  const db = getDb();
  const apiKey = parseEnvApiKey();
  const { idToken, hadPasswordProvider } = await mintIdToken(uid, apiKey);
  console.log("ID token minted for", uid);

  const startBilling = await readBilling(db);
  const startedAt = new Date();
  console.log("start billing:", JSON.stringify(startBilling));
  console.log(`running up to ${turnCount} turns...\n`);

  let conversationId = undefined;
  const turnLog = [];
  for (let i = 0; i < Math.min(turnCount, TURNS.length); i++) {
    const message = TURNS[i];
    const t0 = Date.now();
    const result = await runTurn(idToken, conversationId, message, i);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    conversationId = result.conversationId ?? conversationId;

    if (result.quota) {
      console.log(`turn ${i + 1}: BLOCKED quota_exceeded (${result.quota.reason}) after ${secs}s`);
      turnLog.push({ turn: i + 1, blocked: true });
      break;
    }
    if (result.error) {
      console.log(`turn ${i + 1}: ERROR ${result.error} after ${secs}s`);
      turnLog.push({ turn: i + 1, error: result.error });
      break;
    }
    const billing = await readBilling(db);
    const media = result.gif ? " +GIF" : result.meme ? " +MEME" : "";
    console.log(
      `turn ${i + 1} (${secs}s)${media} dailyUsed=${billing.dailyCreditsUsed.toFixed(2)} | "${message}" -> "${result.text.slice(0, 70).replace(/\n/g, " / ")}..."`,
    );
    turnLog.push({ turn: i + 1, dailyUsed: billing.dailyCreditsUsed });
    // Small gap like a human reading the reply.
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Give background charges (title/summary/memory) a moment to settle.
  console.log("\nwaiting 30s for background charges (title/summary) to settle...");
  await new Promise((r) => setTimeout(r, 30_000));

  const endBilling = await readBilling(db);

  // Pull all usage events for this run. Equality-only query (auto single-field
  // index — uid+createdAt has no composite index); filter + sort client-side.
  const snap = await db.collection("usageEvents").where("uid", "==", uid).get();
  const events = {
    docs: snap.docs
      .filter((d) => {
        const e = d.data();
        return e.createdAt && e.createdAt.toDate() >= startedAt;
      })
      .sort((a, b) => a.data().createdAt.toMillis() - b.data().createdAt.toMillis()),
    get size() {
      return this.docs.length;
    },
  };

  console.log("\n=== usageEvents for this run ===");
  console.log(
    "kind     credits   costUsd    in     cachedIn  out   reason  | mini-in mini-cached",
  );
  const totals = { credits: 0, costUsd: 0, in: 0, cached: 0, out: 0, reasoning: 0 };
  const byKind = {};
  for (const doc of events.docs) {
    const e = doc.data();
    totals.credits += e.credits;
    totals.costUsd += e.costUsd;
    totals.in += e.inputTokens;
    totals.cached += e.cachedInputTokens;
    totals.out += e.outputTokens;
    totals.reasoning += e.reasoningTokens ?? 0;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + e.credits;
    console.log(
      `${e.kind.padEnd(8)} ${e.credits.toFixed(3).padStart(7)} ${e.costUsd.toFixed(6).padStart(9)} ${String(e.inputTokens).padStart(6)} ${String(e.cachedInputTokens).padStart(8)} ${String(e.outputTokens).padStart(5)} ${String(e.reasoningTokens ?? 0).padStart(6)} | ${String(e.miniInputTokens ?? 0).padStart(7)} ${String(e.miniCachedInputTokens ?? 0).padStart(10)}`,
    );
  }

  const turns = events.docs.filter((d) => d.data().kind === "turn").length;
  console.log("\n=== summary ===");
  console.log("events:", events.size, " of which turns:", turns);
  console.log("credits by kind:", JSON.stringify(byKind));
  console.log(
    `totals: credits=${totals.credits.toFixed(3)} costUsd=$${totals.costUsd.toFixed(5)} in=${totals.in} cached=${totals.cached} (${((totals.cached / Math.max(1, totals.in)) * 100).toFixed(1)}% of input) out=${totals.out} reasoning=${totals.reasoning}`,
  );
  if (turns > 0) {
    const perTurn = totals.credits / turns;
    console.log(`avg credits/turn (incl. background): ${perTurn.toFixed(3)}`);
    console.log(`turns until 26-credit daily cap: ~${Math.floor(26 / perTurn)}`);
  }
  console.log(
    `profile delta: dailyUsed ${startBilling.dailyCreditsUsed.toFixed(2)} -> ${endBilling.dailyCreditsUsed.toFixed(2)}, remaining ${startBilling.creditsRemaining.toFixed(2)} -> ${endBilling.creditsRemaining.toFixed(2)}`,
  );
  console.log("conversationId:", conversationId);
  await cleanupPasswordProvider(uid, hadPasswordProvider);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
