import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";

// Aggregates the previous day's usageEvents into a single usageDaily/{date}
// doc so cost-watching dashboards can read one row per day instead of
// scanning the whole usageEvents collection. Runs once per day at 01:10 UTC
// so all of yesterday's events have been settled.
export const aggregateDailyUsage = onSchedule(
  {
    schedule: "10 1 * * *",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
    const db = getFirestore();

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayUtc = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);
    const isoDate = yesterdayUtc.toISOString().slice(0, 10);

    const start = Timestamp.fromMillis(yesterdayUtc.getTime());
    const end = Timestamp.fromMillis(todayUtc.getTime());

    const snap = await db
      .collection("usageEvents")
      .where("createdAt", ">=", start)
      .where("createdAt", "<", end)
      .get();

    type Totals = {
      events: number;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      cachedInputTokens: number;
      costUsd: number;
      credits: number;
      // Flat web-search (Tavily) spend folded into costUsd, broken out so the
      // dashboard can chart web-search cost on its own. searchedTurns counts the
      // events that actually ran a paid search (searchCostUsd > 0).
      searchCostUsd: number;
      searchedTurns: number;
    };
    const empty: Totals = {
      events: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
      credits: 0,
      searchCostUsd: 0,
      searchedTurns: 0,
    };

    const overall: Totals = { ...empty };
    const byModel: Record<string, Totals> = {};
    const byPlan: Record<string, Totals> = {};

    for (const doc of snap.docs) {
      const d = doc.data() as Partial<{
        model: string;
        plan: string;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cachedInputTokens: number;
        costUsd: number;
        credits: number;
        searchCostUsd: number;
      }>;
      const searchCostUsd = d.searchCostUsd ?? 0;
      const accumulate = (t: Totals) => {
        t.events += 1;
        t.inputTokens += d.inputTokens ?? 0;
        t.outputTokens += d.outputTokens ?? 0;
        t.reasoningTokens += d.reasoningTokens ?? 0;
        t.cachedInputTokens += d.cachedInputTokens ?? 0;
        t.costUsd += d.costUsd ?? 0;
        t.credits += d.credits ?? 0;
        t.searchCostUsd += searchCostUsd;
        if (searchCostUsd > 0) t.searchedTurns += 1;
      };
      accumulate(overall);
      if (typeof d.model === "string") {
        byModel[d.model] = byModel[d.model] ?? { ...empty };
        accumulate(byModel[d.model]);
      }
      if (typeof d.plan === "string") {
        byPlan[d.plan] = byPlan[d.plan] ?? { ...empty };
        accumulate(byPlan[d.plan]);
      }
    }

    // Surface Tavily web search as its own "model" line: the flat per-search
    // cost rode on the turn event (whose `model` is the heaviest model, mini),
    // so move that spend out of the bucket it landed in and into a synthetic
    // "tavily" model. Per-model costs still sum to the overall total.
    const tavilyModel: Totals = { ...empty };
    for (const doc of snap.docs) {
      const d = doc.data() as { model?: string; searchCostUsd?: number };
      const sc = d.searchCostUsd ?? 0;
      if (sc <= 0) continue;
      const model = typeof d.model === "string" ? d.model : null;
      if (model && byModel[model]) {
        byModel[model].costUsd -= sc;
        byModel[model].searchCostUsd -= sc;
        byModel[model].searchedTurns -= 1;
      }
      tavilyModel.events += 1;
      tavilyModel.costUsd += sc;
      tavilyModel.searchCostUsd += sc;
      tavilyModel.searchedTurns += 1;
    }
    if (tavilyModel.events > 0) byModel.tavily = tavilyModel;

    await db.doc(`usageDaily/${isoDate}`).set({
      date: isoDate,
      totals: overall,
      byModel,
      byPlan,
      generatedAt: Timestamp.now(),
    });

    logger.info("[aggregateDailyUsage] done", {
      date: isoDate,
      events: overall.events,
      costUsd: overall.costUsd,
      credits: overall.credits,
      searchCostUsd: overall.searchCostUsd,
      searchedTurns: overall.searchedTurns,
    });
  },
);
