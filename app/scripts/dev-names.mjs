#!/usr/bin/env node
// Both apps (production shopify.app.toml and dev shopify.app.dev.toml) share the same
// extension folders, and Shopify has no per-config extension names. So the dev app's
// names get "(Dev)" only while a dev command runs:
//
//   node scripts/dev-names.mjs run -- shopify app dev --config dev
//       adds "(Dev)", runs the command, then restores the production names (also on Ctrl-C)
//   node scripts/dev-names.mjs check
//       fails if any "(Dev)" name is left in the files (runs before production deploys)
//   node scripts/dev-names.mjs restore
//       puts the production names back (after a crash)
//
// Theme block names are limited to 25 characters, hence "Coupon drawer (Dev)".
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [file, production text, dev text] — exact text, so nothing else in the file changes. */
const NAMES = [
  ["extensions/coupon-picker/shopify.extension.toml", 'name = "Coupon picker"', 'name = "Coupon picker (Dev)"'],
  ["extensions/coupon-picker/blocks/coupon_picker.liquid", '"name": "Coupon picker",', '"name": "Coupon picker (Dev)",'],
  ["extensions/coupon-picker/blocks/coupon_picker_drawer.liquid", '"name": "Coupon picker (drawer)",', '"name": "Coupon drawer (Dev)",'],
  ["extensions/checkout-coupons/shopify.extension.toml", 'name = "Coupon picker"', 'name = "Coupon picker (Dev)"'],
  ["extensions/tip-selector/shopify.extension.toml", 'name = "Tip selector"', 'name = "Tip selector (Dev)"'],
  ["extensions/tip-price/locales/en.default.json", '"name": "Tip price",', '"name": "Tip price (Dev)",'],
  ["extensions/tip-guard/locales/en.default.json", '"name": "Tip guard",', '"name": "Tip guard (Dev)",'],
];

function swap(toDev) {
  for (const [file, prod, dev] of NAMES) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const [from, to] = toDev ? [prod, dev] : [dev, prod];
    if (text.includes(to) && !text.includes(from)) continue; // already in the wanted state
    if (!text.includes(from)) throw new Error(`${file}: expected ${JSON.stringify(from)}`);
    writeFileSync(path, text.replace(from, to));
  }
}

function leftovers() {
  return NAMES.filter(([file, , dev]) => readFileSync(join(root, file), "utf8").includes(dev)).map(([f]) => f);
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === "check") {
  const left = leftovers();
  if (left.length) {
    console.error(`Dev extension names are still applied in:\n  ${left.join("\n  ")}\nRun: node scripts/dev-names.mjs restore`);
    process.exit(1);
  }
} else if (mode === "restore") {
  swap(false);
  console.log("Production extension names restored.");
} else if (mode === "run") {
  const cmd = rest[0] === "--" ? rest.slice(1) : rest;
  if (!cmd.length) throw new Error("Usage: dev-names.mjs run -- <command...>");
  swap(true);
  console.log('Extension names set to "(Dev)" for this run.');
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    swap(false);
    console.log("Production extension names restored.");
  };
  const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", cwd: root });
  // Ctrl-C reaches the child through the terminal; keep this process alive to restore.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => {
    restore();
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on("error", (err) => {
    restore();
    console.error(err.message);
    process.exit(1);
  });
} else {
  console.error("Usage: dev-names.mjs run -- <command...> | check | restore");
  process.exit(2);
}
