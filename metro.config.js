const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Hard-exclude the local-only monitoring dashboard from the bundler. The app
// never imports it, but this guarantees Metro can't resolve or pull anything
// from dashboard/ into a dev, EAS, or app-store bundle. Anchored to the repo's
// own dashboard dir so node_modules packages named "dashboard" aren't affected.
const dashboardDir = path
  .join(__dirname, "dashboard")
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dashboardBlock = new RegExp(`${dashboardDir}([\\\\/]|$)`);
const existingBlock = config.resolver.blockList;
config.resolver.blockList = existingBlock
  ? [].concat(existingBlock, dashboardBlock)
  : dashboardBlock;

module.exports = withNativewind(config);
