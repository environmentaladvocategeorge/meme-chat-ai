// Post-test analysis: pull the usageEvents for the most-recently-active
// conversation (the burn-through test) + that conversation's messages, and
// print true per-user statistics (messages, tokens, nano/mini split, credits).
//
// Usage: node scripts/analyze-usage.cjs [conversationId]
//   - no arg: auto-detect the conversation with the most recent usageEvent.
const { getDb } = require("./admin-app.cjs");

// Inlined from billing/plans.ts to avoid depending on the compiled lib/ output.
const FREE_MONTHLY_CREDITS = 500; // PLANS.free.monthlyCredits
const DAILY_BURST_FACTOR = 3;
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * DAILY_BURST_FACTOR);
}

function n(x) {
  return typeof x === "number" ? x : 0;
}

(async () => {
  const db = getDb();
  const argCid = process.argv[2];

  // Recent usageEvents (single orderBy → auto-indexed, no composite needed).
  const recent = await db
    .collection("usageEvents")
    .orderBy("createdAt", "desc")
    .limit(300)
    .get();
  if (recent.empty) {
    console.log("no usageEvents found");
    process.exit(0);
  }

  const cid =
    argCid ||
    recent.docs.find((d) => d.data().conversationId)?.data().conversationId;
  console.log("conversation:", cid);

  const events = recent.docs
    .map((d) => d.data())
    .filter((e) => e.conversationId === cid);

  // Sort oldest → newest for a readable timeline.
  events.sort(
    (a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0),
  );

  const byKind = {};
  const tot = {
    events: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    nanoInputTokens: 0,
    nanoCachedInputTokens: 0,
    nanoOutputTokens: 0,
    miniInputTokens: 0,
    miniCachedInputTokens: 0,
    miniOutputTokens: 0,
    costUsd: 0,
    credits: 0,
  };
  let plan = "?";
  for (const e of events) {
    plan = e.plan ?? plan;
    const k = e.kind ?? "turn";
    byKind[k] = byKind[k] ?? { events: 0, credits: 0, inputTokens: 0, outputTokens: 0 };
    byKind[k].events += 1;
    byKind[k].credits += n(e.credits);
    byKind[k].inputTokens += n(e.inputTokens);
    byKind[k].outputTokens += n(e.outputTokens);
    for (const key of Object.keys(tot)) {
      if (key === "events") continue;
      tot[key] += n(e[key]);
    }
    tot.events += 1;
  }

  // Conversation messages.
  const msgs = await db
    .collection(`conversations/${cid}/messages`)
    .orderBy("createdAt", "asc")
    .get();
  let userMsgs = 0;
  let agentMsgs = 0;
  let agentWithGif = 0;
  let agentWithMeme = 0;
  for (const m of msgs.docs) {
    const d = m.data();
    if (d.role === "user") userMsgs += 1;
    else if (d.role === "agent") {
      agentMsgs += 1;
      if (Array.isArray(d.gifs) && d.gifs.length) agentWithGif += 1;
      if (Array.isArray(d.images) && d.images.length) agentWithMeme += 1;
    }
  }

  const now = new Date();
  const dailyCap = computeDailyCap(FREE_MONTHLY_CREDITS, now);
  const cachedPct = tot.inputTokens
    ? ((tot.cachedInputTokens / tot.inputTokens) * 100).toFixed(1)
    : "0";

  console.log("\n========== BURN-THROUGH STATS ==========");
  console.log(`plan on events:        ${plan}`);
  console.log(`usageEvents:           ${tot.events}`);
  console.log(`  turns:               ${byKind.turn?.events ?? 0}`);
  console.log(`  summaries:           ${byKind.summary?.events ?? 0}`);
  console.log(`  titles:              ${byKind.title?.events ?? 0}`);
  console.log(`messages in convo:     ${msgs.size}  (user ${userMsgs} / agent ${agentMsgs})`);
  console.log(`agent replies w/ GIF:  ${agentWithGif}`);
  console.log(`agent replies w/ meme: ${agentWithMeme}`);
  console.log("\n--- tokens ---");
  console.log(`input (total):         ${tot.inputTokens}  (cached ${tot.cachedInputTokens} = ${cachedPct}%)`);
  console.log(`output (total):        ${tot.outputTokens}  (reasoning ${tot.reasoningTokens})`);
  console.log(`  nano in/cached/out:  ${tot.nanoInputTokens} / ${tot.nanoCachedInputTokens} / ${tot.nanoOutputTokens}`);
  console.log(`  mini in/cached/out:  ${tot.miniInputTokens} / ${tot.miniCachedInputTokens} / ${tot.miniOutputTokens}`);
  console.log("\n--- cost ---");
  console.log(`total costUsd:         $${tot.costUsd.toFixed(5)}`);
  console.log(`total credits:         ${tot.credits.toFixed(2)}`);
  console.log(`avg credits / turn:    ${byKind.turn?.events ? (byKind.turn.credits / byKind.turn.events).toFixed(2) : "n/a"}`);
  console.log("\n--- vs FREE budget ---");
  console.log(`free daily cap:        ${dailyCap} credits  (${daysInMonth(now)}-day month)`);
  console.log(`free monthly:          ${FREE_MONTHLY_CREDITS} credits`);
  console.log(`this convo used:       ${tot.credits.toFixed(2)} credits = ${((tot.credits / dailyCap) * 100).toFixed(0)}% of a day, ${((tot.credits / FREE_MONTHLY_CREDITS) * 100).toFixed(1)}% of the month`);
  console.log(`turns to drain a day:  ~${byKind.turn?.events && byKind.turn.credits ? Math.round(dailyCap / (byKind.turn.credits / byKind.turn.events)) : "n/a"}`);
  console.log("========================================");

  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
