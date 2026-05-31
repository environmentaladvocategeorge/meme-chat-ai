#!/usr/bin/env node
// Inventory every touchable interaction and classify how it's built, so we can
// see the delta between reliable and flaky buttons.
//
// Run: node scripts/map-touchables.mjs .            (this app)
//      node scripts/map-touchables.mjs ../hobby-dex (baseline)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? ".";
const SKIP = new Set(["node_modules", ".git", ".expo", "android", "ios", "dist", "build", "scripts"]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.tsx$/.test(name)) files.push(p);
  }
})(root);

const rows = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");

  // Which touchable primitives appear
  const prims = [];
  if (/\bBottomSheetTouchableOpacity\b|TouchableOpacity as BottomSheet/.test(src)) prims.push("gorhom-touchable");
  if (/from ["']react-native-gesture-handler["']/.test(src) && /\b(Pressable|TouchableOpacity|RectButton|BorderlessButton)\b/.test(src)) prims.push("gh-touchable");
  // raw RN Pressable / TouchableOpacity (exclude the gorhom-aliased one)
  const rnTouchable = /from ["']react-native["'][^;]*\b(Pressable|TouchableOpacity)\b/s.test(src) || /\bPressable\b/.test(src);
  if (/\bcreateAnimatedComponent\(\s*(Pressable|Touchable)/.test(src)) prims.push("AnimatedPressable");
  if (/<Button\b/.test(src) || /\bButton\b.*from ["']@?\/?.*Button["']/.test(src)) prims.push("<Button>");
  if (rnTouchable && !prims.includes("gorhom-touchable")) prims.push("rn-pressable");

  if (prims.length === 0) continue;

  const flags = [];
  if (/transform:\s*\[[^\]]*pressed\b/.test(src)) flags.push("xform-on-press");
  if (/\bcreateAnimatedComponent\(\s*(Pressable|Touchable)/.test(src)) flags.push("animated-target");
  if (/\b(entering|exiting)=\{/.test(src) && /\b(Pressable|Touchable\w*)\b/.test(src)) flags.push("entering-in-file");
  // crude "inside a sheet" signal
  if (/BottomSheet(View|ScrollView|Modal)|@gorhom\/bottom-sheet/.test(src)) flags.push("sheet-context");

  rows.push({ file: relative(root, f), prims, flags });
}

rows.sort((a, b) => a.file.localeCompare(b.file));

console.log(`\n# Touchable inventory for "${root}"  (${rows.length} files)\n`);
for (const r of rows) {
  console.log(
    `${r.prims.join(",").padEnd(34)} ${("[" + r.flags.join(",") + "]").padEnd(46)} ${r.file}`,
  );
}

const tally = (key) => {
  const m = {};
  for (const r of rows) for (const v of r[key]) m[v] = (m[v] ?? 0) + 1;
  return m;
};
console.log("\n## primitive usage (files):", tally("prims"));
console.log("## risk flags (files):", tally("flags"));
console.log("");
