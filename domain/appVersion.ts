// Force-update gate logic. Pure + side-effect-free so it can be unit tested
// without a device or network. The store layer (store/appUpdate.ts) feeds it the
// installed binary version and the remote-config floor; this just decides.

// Compare two dotted numeric versions ("1.0.4" vs "1.2"). Missing or
// non-numeric segments count as 0, so "1.0" === "1.0.0" and a garbage segment
// never throws. Returns 1 if a > b, -1 if a < b, 0 if equal.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = parseInt(pa[i] ?? "0", 10);
    const y = parseInt(pb[i] ?? "0", 10);
    const xn = Number.isFinite(x) ? x : 0;
    const yn = Number.isFinite(y) ? y : 0;
    if (xn > yn) return 1;
    if (xn < yn) return -1;
  }
  return 0;
}

// Whether the installed build is below the required floor. FAILS OPEN: if either
// value is missing or unparseable we never gate, so a config read failure or a
// missing version can't lock a user out of the app.
export function isUpdateRequired({
  installedVersion,
  minRequiredVersion,
}: {
  installedVersion: string | null | undefined;
  minRequiredVersion: string | null | undefined;
}): boolean {
  if (!installedVersion || !minRequiredVersion) return false;
  return compareVersions(installedVersion, minRequiredVersion) < 0;
}
