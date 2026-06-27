/*
 * Live smoke + latency benchmark for the web-search feature.
 * Exercises the REAL compiled modules (lib/) against the live OpenAI + Tavily
 * APIs. Requires OPENAI_API_KEY and TAVILY_API_KEY in the environment.
 *
 *   node scripts/smoke-web-search.cjs
 *
 * Prints, for a set of messages: the router verdict (+ rewritten query), whether
 * Tavily returned context, and per-stage latency. Then runs a small latency
 * benchmark (router-only, tavily-only, full gatherWebContext) reporting p50/avg.
 */
const { routeWebSearch } = require("../lib/agent/decideWebSearch");
const { tavilySearch } = require("../lib/web/tavilyClient");
const { gatherWebContext } = require("../lib/agent/webSearch");

const OPENAI = process.env.OPENAI_API_KEY;
const TAVILY = process.env.TAVILY_API_KEY;
if (!OPENAI || !TAVILY) {
  console.error("Missing OPENAI_API_KEY or TAVILY_API_KEY in env.");
  process.exit(1);
}

const ms = (start) => `${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)}ms`;
const now = () => process.hrtime.bigint();

// Expected: true = should search, false = should NOT search.
const CASES = [
  { msg: "who won the nba finals", history: "", expect: true },
  { msg: "yo who won the thing last night fr", history: "User: been glued to the nba playoffs all week\nBot: who you riding with", expect: true },
  { msg: "is bitcoin up or down today", history: "", expect: true },
  { msg: "what's the latest iphone called", history: "", expect: true },
  { msg: "whats the weather in tokyo rn", history: "", expect: true },
  { msg: "lmaooo you're so real for that fr", history: "", expect: false },
  { msg: "whats 17 times 23", history: "", expect: false },
  { msg: "write me a haiku about cats", history: "", expect: false },
  { msg: "i had the worst day at work man", history: "", expect: false },
];

async function runCases() {
  console.log("=== Router + Tavily smoke (live) ===\n");
  let correct = 0;
  for (const c of CASES) {
    const t0 = now();
    const { decision, usage } = await routeWebSearch({
      apiKey: OPENAI,
      message: c.msg,
      history: c.history || undefined,
    });
    const routerMs = ms(t0);

    let tavilyMs = "-";
    let gotContext = "-";
    if (decision.search) {
      const t1 = now();
      const res = await tavilySearch({ apiKey: TAVILY, query: decision.query });
      tavilyMs = ms(t1);
      gotContext = res ? `yes (${res.contextText.length} chars)` : "no";
    }

    const verdict = decision.search ? `SEARCH q="${decision.query}"` : "no-search";
    const ok = decision.search === c.expect ? "✓" : "✗ UNEXPECTED";
    if (decision.search === c.expect) correct++;
    console.log(`${ok}  "${c.msg}"`);
    console.log(
      `    → ${verdict}  | router ${routerMs} (in ${usage.inputTokens}/out ${usage.outputTokens} tok) | tavily ${tavilyMs} | context ${gotContext}`,
    );
    if (decision.search) {
      const r = await tavilySearch({ apiKey: TAVILY, query: decision.query });
      if (r) console.log(`    ctx: ${r.contextText.replace(/\n/g, " | ").slice(0, 200)}…`);
    }
    console.log("");
  }
  console.log(`Router accuracy on labeled cases: ${correct}/${CASES.length}\n`);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { avg: avg.toFixed(0), p50: p(0.5).toFixed(0), p90: p(0.9).toFixed(0), min: sorted[0].toFixed(0), max: sorted[sorted.length - 1].toFixed(0) };
}

async function bench(label, fn, n) {
  // one warmup
  await fn();
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = now();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  const s = stats(samples);
  console.log(`${label.padEnd(34)} n=${n}  avg=${s.avg}ms  p50=${s.p50}ms  p90=${s.p90}ms  (min ${s.min} / max ${s.max})`);
}

async function runBench() {
  console.log("=== Latency benchmark ===\n");
  const N = 6;
  // Router on a no-search message (typical fast path).
  await bench("router (no-search msg)", () =>
    routeWebSearch({ apiKey: OPENAI, message: "lol you're so real fr" }), N);
  // Router on a search message (rewrite path).
  await bench("router (search+rewrite msg)", () =>
    routeWebSearch({ apiKey: OPENAI, message: "who won the nba finals last night" }), N);
  // Tavily alone on a fixed query.
  await bench("tavily search (basic)", () =>
    tavilySearch({ apiKey: TAVILY, query: "NBA Finals winner 2026" }), N);
  // Full combiner on a search turn (router + tavily, end to end).
  await bench("gatherWebContext (search turn)", () =>
    gatherWebContext({ openaiApiKey: OPENAI, tavilyApiKey: TAVILY, message: "who won the nba finals last night" }), N);
  // Full combiner on a no-search turn (router only, then bails).
  await bench("gatherWebContext (no-search turn)", () =>
    gatherWebContext({ openaiApiKey: OPENAI, tavilyApiKey: TAVILY, message: "lmaooo you're so real fr" }), N);
}

(async () => {
  await runCases();
  await runBench();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
