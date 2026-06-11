import { readFileSync } from "fs";
import { join } from "path";

// The streamReplayTurn handler is wired the same way the trusted streamAgentAnswer
// money path is, and like that one it has no full-handler test (the pieces —
// schema, ledger, credits, assemble, streamAgent, repository — are unit-tested in
// isolation). What's unique and worth pinning here is the billing contract the
// feature must never break: deleting the old reply is free, and the replay
// charges itself exactly once via the same chargeForUsage pattern.
//
// We assert it at the source level so a future edit that "helpfully" refunds the
// deleted turn, or pre-charges, trips this guard.
const source = readFileSync(
  join(__dirname, "..", "streamReplayTurn.ts"),
  "utf8",
);

describe("streamReplayTurn billing contract (source guard)", () => {
  it("deletes the old reply and charges the new turn", () => {
    expect(source).toMatch(/deleteMessage\(conversationId, agentMessageId\)/);
    expect(source).toContain("chargeForUsage");
    expect(source).toContain("chargeCredits(");
  });

  it("never refunds or restores credits on deletion", () => {
    // No refund/credit-restore CALL should ever appear in this path. (None
    // exists in the ledger today — this keeps it that way for replay
    // specifically.) Matches function-call shapes, not prose, so the comments
    // explaining the no-refund contract don't trip the guard.
    expect(source).not.toMatch(/\brefund\w*\s*\(/i);
    expect(source).not.toMatch(/\b(grant|add|restore)Credits\s*\(/i);
    expect(source).not.toMatch(/creditsRemaining\s*\+/);
  });

  it("charges only after usage is known, never reserves up front", () => {
    // chargeForUsage builds the per-model usage list (media decider + reply)
    // and bails when nothing ran, so an aborted/empty replay is free — mirroring
    // the read-only quota gate (no pre-charge).
    expect(source).toMatch(/if \(usages\.length === 0\) return;/);
    // The gate before streaming is read-only (no charge): evaluateQuota only.
    expect(source).toContain("evaluateQuota(");
  });

  it("deletes the reply only after preflight succeeds (no destroy-then-fail)", () => {
    // The delete must live after flushHeaders, i.e. once we've committed to
    // streaming — so a preflight failure leaves the conversation intact.
    const flushIdx = source.indexOf("res.flushHeaders();");
    const deleteIdx = source.indexOf("deleteMessage(conversationId, agentMessageId)");
    expect(flushIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(flushIdx);
  });
});
