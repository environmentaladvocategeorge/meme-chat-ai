// Read-only: fetches the LIVE deployed Firestore ruleset and checks whether the
// user_personas read rule is present (a client read of saved bots is denied if
// it isn't, even though savePersona's Admin-SDK write lands the doc anyway).
const { initAdminApp, PROJECT_ID } = require("./admin-app.cjs");
const { GoogleAuth } = require("google-auth-library");

(async () => {
  initAdminApp(); // sets GOOGLE_APPLICATION_CREDENTIALS for ADC
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const base = "https://firebaserules.googleapis.com/v1";

  const rel = await client.request({
    url: `${base}/projects/${PROJECT_ID}/releases`,
  });
  const releases = (rel.data.releases || []).filter((r) =>
    r.name.endsWith("cloud.firestore"),
  );
  if (releases.length === 0) {
    console.log("No cloud.firestore release found.");
    process.exit(0);
  }
  const fsRel = releases[0];
  console.log("firestore release:", fsRel.name);
  console.log("ruleset:          ", fsRel.rulesetName);
  console.log("created:          ", fsRel.createTime);

  const rs = await client.request({ url: `${base}/${fsRel.rulesetName}` });
  const files = (rs.data.source && rs.data.source.files) || [];
  for (const f of files) {
    const hasUP = f.content.includes("user_personas");
    console.log(`\n=== ${f.name} === (contains user_personas: ${hasUP})`);
    if (hasUP) {
      const i = f.content.indexOf("match /user_personas");
      console.log(f.content.slice(Math.max(0, i - 60), i + 360));
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", (e.response && JSON.stringify(e.response.data)) || e.message);
  process.exit(1);
});
