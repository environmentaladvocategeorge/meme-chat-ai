// Local-only admin bootstrap: authenticates firebase-admin using the Firebase
// CLI's stored refresh token (the same login `firebase deploy` uses), so our
// prompt pull/write scripts reach Firestore without a service-account key or
// gcloud. We materialize a temporary Application Default Credentials file in the
// `authorized_user` format (identical to what `gcloud auth application-default
// login` writes), which the underlying @google-cloud/firestore client accepts.
// The client_id/secret are the Firebase CLI's PUBLIC OAuth client (from the
// open-source firebase-tools) — not a secret. The temp file holds the refresh
// token, so we chmod 600 it and delete it on exit.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const FIREBASE_CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJECT_ID = "memechatai-8d8af";

function configPath() {
  const candidates = [
    path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"),
    process.env.APPDATA &&
      path.join(process.env.APPDATA, "configstore", "firebase-tools.json"),
    path.join(os.homedir(), "AppData", "Roaming", "configstore", "firebase-tools.json"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("firebase-tools config not found; run `firebase login` first");
}

let adcFile = null;

function ensureAdc() {
  const cfg = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  const rt = cfg.tokens && cfg.tokens.refresh_token;
  if (!rt) throw new Error("no refresh_token in firebase-tools config; re-run `firebase login`");
  const adc = {
    type: "authorized_user",
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: rt,
  };
  adcFile = path.join(os.tmpdir(), `mca-adc-${process.pid}.json`);
  fs.writeFileSync(adcFile, JSON.stringify(adc), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
}

function cleanup() {
  if (adcFile) {
    try {
      fs.unlinkSync(adcFile);
    } catch {}
    adcFile = null;
  }
}
process.on("exit", cleanup);

// `extra` lets a caller add init options BEFORE the app is created — e.g.
// `serviceAccountId` so createCustomToken can sign via IAM signBlob (the CLI
// user OAuth credential has no private key of its own). Must be called before
// the first getDb() to take effect.
function initAdminApp(extra = {}) {
  if (!getApps().length) {
    ensureAdc();
    initializeApp({ projectId: PROJECT_ID, ...extra });
  }
}

function getDb() {
  initAdminApp();
  return getFirestore();
}

module.exports = { getDb, initAdminApp, PROJECT_ID, cleanup };
