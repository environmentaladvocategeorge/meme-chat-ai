// Strips meme artifacts the agent sometimes writes into its text reply:
// markdown image embeds, attachment:// links, and bare attachment placeholders.
// The agent's meme is rendered as its own image (MessageImageAttachments), so
// this junk should never show up in the message bubble.
//
// The backend scrubs the same artifacts before persisting (see
// functions/src/messages/sanitizeAgentText.ts); applying it on the client too
// keeps the live stream clean and tidies any messages that were stored before
// the backend fix shipped. Keep the two implementations in sync.
export function stripMemeArtifacts(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\(\s*attachment:\/\/[^)]*\)/gi, "")
    .replace(/attachment:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
