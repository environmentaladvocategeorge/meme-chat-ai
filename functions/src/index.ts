import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onUserCreated } from "./onUserCreated";
export { deleteMyAccount } from "./deleteMyAccount";
export { streamAgentAnswer } from "./streamAgentAnswer";
