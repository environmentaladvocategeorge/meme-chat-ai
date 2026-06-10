// One-off: set the public force-update config doc (config/app) in production.
// The mobile client reads this before sign-in to decide whether the installed
// build is below the supported floor; if so it shows a blocking update screen.
//
// minIosVersion = the lowest iOS build allowed in. Installs below it are forced
// to update. Bump this only when a release must be mandatory.
//
// Usage (from functions/):  node scripts/set-app-config.cjs [minIosVersion]
//   default minIosVersion = 1.0.4
const { getDb } = require("./admin-app.cjs");

const MIN_IOS_VERSION = process.argv[2] || "1.0.4";
const IOS_APP_STORE_URL =
  "https://apps.apple.com/app/meme-chat-ai-brainrot-bot/id6774211629";

async function main() {
  const db = getDb();
  const ref = db.collection("config").doc("app");
  const payload = {
    minIosVersion: MIN_IOS_VERSION,
    iosAppStoreUrl: IOS_APP_STORE_URL,
  };
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  console.log("config/app written:", JSON.stringify(snap.data()));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to write config/app:", err);
    process.exit(1);
  });
