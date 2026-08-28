/**
 * End-to-end tests for scripts/install.sh against a temporary config and
 * state directory. Uses MOUTH_INSTALL_PLUGIN_SRC so no network is needed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../scripts/install.sh", import.meta.url).pathname;

interface Sandbox {
  config: string;
  stateDir: string;
  pluginSrc: string;
  run: (...args: string[]) => string;
  cleanup: () => void;
}

const sandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), "mouth-install-"));
  const config = join(root, "tui.jsonc");
  const stateDir = join(root, "state");
  const pluginSrc = join(root, "fake-tui.js");
  writeFileSync(pluginSrc, "export default { id: 'opencode-mouth', tui: async () => {} };\n");
  return {
    config,
    stateDir,
    pluginSrc,
    run: (...args: string[]) =>
      execFileSync("bash", [script, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOUTH_INSTALL_CONFIG: config,
          MOUTH_INSTALL_STATE_DIR: stateDir,
          MOUTH_INSTALL_PLUGIN_SRC: pluginSrc,
        },
      }),
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
};

const managedCount = (text: string): number => text.split("opencode-mouth:start").length - 1;

test("fresh install copies the plugin and writes a managed config entry", () => {
  const box = sandbox();
  try {
    box.run();
    const installed = join(box.stateDir, "tui.js");
    assert.ok(existsSync(installed), "plugin file not copied into the state dir");
    const config = readFileSync(box.config, "utf8");
    assert.equal(managedCount(config), 1);
    assert.ok(config.includes(installed), "config does not point at the installed plugin");
    // OpenCode reads the file as JSONC; strip comments and trailing commas
    // to assert the structure is well formed.
    JSON.parse(config.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
  } finally {
    box.cleanup();
  }
});

test("install preserves existing plugin entries", () => {
  const box = sandbox();
  try {
    writeFileSync(box.config, '{\n  "plugin": [\n    "/existing/other-plugin.js"\n  ]\n}\n');
    box.run();
    const config = readFileSync(box.config, "utf8");
    assert.ok(config.includes("/existing/other-plugin.js"), "existing entry was dropped");
    assert.equal(managedCount(config), 1);
  } finally {
    box.cleanup();
  }
});

test("reinstall replaces the managed entry instead of duplicating it", () => {
  const box = sandbox();
  try {
    box.run();
    box.run();
    const config = readFileSync(box.config, "utf8");
    assert.equal(managedCount(config), 1);
  } finally {
    box.cleanup();
  }
});

test("uninstall removes the managed entry and state dir, keeps the rest", () => {
  const box = sandbox();
  try {
    writeFileSync(box.config, '{\n  "plugin": [\n    "/existing/other-plugin.js"\n  ]\n}\n');
    box.run();
    box.run("--uninstall");
    const config = readFileSync(box.config, "utf8");
    assert.equal(managedCount(config), 0);
    assert.ok(config.includes("/existing/other-plugin.js"), "existing entry was dropped");
    assert.ok(!existsSync(box.stateDir), "state dir was not removed");
  } finally {
    box.cleanup();
  }
});
