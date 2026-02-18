#!/usr/bin/env node

/**
 * Preinstall Node version guard.
 * Prevents the better-sqlite3 ABI mismatch that occurs when
 * native modules are built under one Node version and run under another.
 *
 * Add to package.json scripts: "preinstall": "node scripts/check-node.mjs"
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nvmrcPath = resolve(__dirname, "..", ".nvmrc");

let expected;
try {
  expected = readFileSync(nvmrcPath, "utf-8").trim();
} catch {
  // No .nvmrc — skip check
  process.exit(0);
}

const actual = process.version.replace(/^v/, "").split(".")[0];

if (actual !== expected) {
  console.error(`\n❌  Node version mismatch`);
  console.error(`   Expected: v${expected}.x (from .nvmrc)`);
  console.error(`   Running:  ${process.version}`);
  console.error(`\n   Fix: nvm use ${expected}\n`);
  console.error(`   This matters because better-sqlite3 compiles native bindings`);
  console.error(`   against your current Node version. Switching versions later`);
  console.error(`   causes ERR_DLOPEN_FAILED at runtime.\n`);
  process.exit(1);
}
