/**
 * Contract tests for the built bundle.
 *
 * OpenCode loads dist/tui.js from a path outside node_modules and rewrites
 * its imports of host runtime modules to the host's own instances. That
 * only works if the bundle is valid ESM and imports nothing outside the
 * host-provided module set. Run `npm run build` before these tests; the
 * `check` script and CI do.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const distPath = new URL("../dist/tui.js", import.meta.url).pathname;

/** Modules OpenCode's runtime loader can rewrite to host instances. Bun built-ins (bun:sqlite) and node built-ins (node:fs, node:path) resolve natively in the host runtime. */
const HOST_MODULES = new Set([
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "@opentui/keymap",
  "solid-js",
  "solid-js/store",
  "bun:sqlite",
  "node:fs",
  "node:path",
]);

const readDist = (): string => {
  assert.ok(existsSync(distPath), "dist/tui.js is missing; run `npm run build` first");
  return readFileSync(distPath, "utf8");
};

test("dist bundle parses as an ES module", () => {
  const code = readDist();
  const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: code,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("dist bundle imports only host-provided modules", () => {
  const code = readDist();
  const specifiers = new Set<string>();
  for (const match of code.matchAll(/(?:^|\n)\s*import\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g)) {
    specifiers.add(match[1]);
  }
  assert.ok(specifiers.size > 0, "expected at least one import in the bundle");
  for (const specifier of specifiers) {
    assert.ok(
      HOST_MODULES.has(specifier),
      `unexpected import "${specifier}"; the host loader cannot provide it`,
    );
  }
});

test("dist bundle has no dynamic imports", () => {
  const code = readDist();
  assert.ok(!/\bimport\s*\(/.test(code), "dynamic import() would bypass the host module rewrite");
});
