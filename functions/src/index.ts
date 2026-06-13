import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onUserCreated } from "./onUserCreated";
export { deleteMyAccount } from "./deleteMyAccount";
export { updateProfile } from "./profile/updateProfile";
export { deleteConversations } from "./conversations/deleteConversations";
export { rateMessage, setMessageEmoji } from "./conversations/rateMessage";
export { streamAgentAnswer } from "./streamAgentAnswer";
export { streamReplayTurn } from "./streamReplayTurn";
export { devSetPlan } from "./entitlement/devSetPlan";
export { revenueCatWebhook } from "./revenueCat/webhook";
export { syncRevenueCatPlan } from "./revenueCat/syncPlan";
export { summarizeConversation } from "./context/summarize";
export { generateConversationTitle } from "./context/title";
export { generateUserMemory } from "./agent/memory/generateUserMemory";
export { clearMemory } from "./agent/memory/clearMemory";
export { setMemoryEnabled } from "./agent/memory/setMemoryEnabled";
export { aggregateDailyUsage } from "./aggregations/dailyUsage";
export { savePersona, deletePersona } from "./personas/savePersona";
export { getTrendingMemes, searchMemes } from "./memes/getTrendingMemes";
export { getTrendingGifs, searchGifs } from "./gifs/getGifs";
export { watermarkAttachment } from "./watermark/watermarkAttachment";
