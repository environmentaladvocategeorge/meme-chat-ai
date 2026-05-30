// Pure, framework-free formatting helpers for chat message bubbles. Kept out of
// the component so the (fiddly) markdown-detection and timestamp rules can be
// unit-tested without pulling in React Native.

// Whether a message body contains markdown worth handing to the markdown
// renderer. Plain prose skips it (cheaper, and avoids the renderer mangling
// stray punctuation). Matches fenced/inline code, bold, italics, headings,
// bullet/ordered lists, and blockquotes.
export function shouldRenderMarkdown(text: string): boolean {
  return /```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s|^\s*>/m.test(
    text,
  );
}

// Human-friendly timestamp for a message bubble, revealed on long-press.
//   • same day            → time only ("3:05 PM")
//   • earlier this year   → "Jun 1, 3:05 PM"
//   • a prior year        → "Jun 1, 2024, 3:05 PM"
// Returns null for a missing or invalid date so callers can skip the row.
export function formatMessageTimestamp(value?: Date | null): string | null {
  if (!value) return null;
  const timestampMs = value.getTime();
  if (Number.isNaN(timestampMs)) return null;

  const now = new Date();
  const sameYear = value.getFullYear() === now.getFullYear();
  const sameDay = value.toDateString() === now.toDateString();
  const time = value.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return time;

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
