// Pure window math for the background memory extractor — its own module so
// tests can import it without pulling in the Firestore-backed trigger
// (generateUserMemory instantiates MemoryService at module load).
//
// The extractor reads only the messages that are NEW since the last extraction
// (the conversation's memoryMsgCount watermark) plus a few context turns, hard
// capped. Re-feeding the same 40-message tail every 6 messages was the root of
// the one-off-inflation bug: a single "send kawaii memes" got re-presented to
// the extractor up to ~6 times across successive runs, which both multiplied
// the chances of a bad ADD and made one mention look like a recurring taste.
// With the new-tail window each message is seen at most twice (once as new,
// once as context), so "recurring" again means the USER repeated it.

export const TRANSCRIPT_TURN_LIMIT = 40;
export const TRANSCRIPT_CONTEXT_TURNS = 4;

// How many tail messages to fetch given the total message count and the
// watermark from the previous extraction.
export function transcriptTailLimit(
  totalMessages: number,
  lastProcessedCount: number,
): number {
  const newCount = Math.max(totalMessages - lastProcessedCount, 0);
  return Math.min(newCount + TRANSCRIPT_CONTEXT_TURNS, TRANSCRIPT_TURN_LIMIT);
}
