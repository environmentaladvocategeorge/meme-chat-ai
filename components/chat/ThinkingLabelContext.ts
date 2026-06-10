import { createContext, useContext } from "react";

// The playful "Memeing…" label for the in-flight reply. It's screen state
// (picked per turn, keyed to activeReplyClientId), but only the ONE streaming
// bubble ever renders it — so it travels via context instead of a renderItem
// prop. Passing it as a prop would hand every finalized bubble a value that
// changes each turn and break MessageBubble's memo.
export const ThinkingLabelContext = createContext<string>("");
export const useThinkingLabel = () => useContext(ThinkingLabelContext);
