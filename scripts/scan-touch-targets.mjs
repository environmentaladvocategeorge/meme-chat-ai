#!/usr/bin/env node
// Static scan for touch-target patterns that are known to drop / delay taps on
// the New Architecture (Fabric) in *release* builds but behave fine in
// Expo Go / dev. Heuristic, not a proof — it flags the shapes to inspect.
//
// Run:  node scripts/scan-touch-targets.mjs            (scans this repo)
//       node scripts/scan-touch-targets.mjs ../hobby-dex   (compare a baseline)
//
// What it flags per file:
//  [ANIM-PRESSABLE]  Animated.createAnimatedComponent(Pressable/Touchable)
//                    -> the touch target itself is animated; Fabric can hit-test
//                       a stale/transformed frame.
//  [TRANSFORM-ON-PRESS] transform:[{scale: pressed ? ...}] inside a Pressable
//                    style fn -> shrinks/animates the hittable frame on press.
//  [ENTERING-WRAP]   entering=/exiting= layout animation in a file that also
//                    renders a Pressable/Touchable -> entering animations can
//                    leave a child's hit frame unsynced until a re-layout.
//  [FULLSCREEN-CATCHER] absoluteFill(+Object) Pressable/backdrop -> a
//                    full-screen layer that can keep capturing for ~1 tap while
//                    it animates out / before pointerEvents commits.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? ".";
const SKIP = new Set(["node_modules", ".git", ".expo", "android", "ios", "dist", "build"]);

/** @type {string[]} */
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(name)) files.push(p);
  }
})(root);

const RULES = [
  {
    tag: "ANIM-PRESSABLE",
    test: (src) =>
      /createAnimatedComponent\(\s*(Pressable|TouchableOpacity|TouchableWithoutFeedback|TouchableHighlight)\s*\)/.test(
        src,
      ),
  },
  {
    tag: "TRANSFORM-ON-PRESS",
    // transform with a `pressed` ternary anywhere (Pressable style fn)
    test: (src) => /transform:\s*\[[^\]]*pressed\b/.test(src),
  },
  {
    tag: "ENTERING-WRAP",
    test: (src) =>
      /\b(entering|exiting)=\{/.test(src) &&
      /\b(Pressable|Touchable\w*)\b/.test(src),
  },
  {
    tag: "FULLSCREEN-CATCHER",
    test: (src) =>
      /(StyleSheet\.absoluteFill(Object)?)/.test(src) &&
      /\b(Pressable|Touchable\w*|Backdrop)\b/.test(src),
  },
];

const hits = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const tags = RULES.filter((r) => r.test(src)).map((r) => r.tag);
  if (tags.length) hits.push({ file: relative(root, f), tags });
}

hits.sort((a, b) => b.tags.length - a.tags.length || a.file.localeCompare(b.file));

console.log(`\nScanned ${files.length} files under "${root}"`);
console.log(`Flagged ${hits.length} files:\n`);
for (const h of hits) {
  console.log(`  ${h.tags.join(" + ").padEnd(48)} ${h.file}`);
}

const counts = {};
for (const h of hits) for (const t of h.tags) counts[t] = (counts[t] ?? 0) + 1;
console.log("\nTotals:");
for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(3)}  ${t}`);
}
console.log("");
