/**
 * End-to-end tests for scripts/install.sh against a temporary config and
 * state directory. Uses MOUTH_INSTALL_PLUGIN_SRC so no network is needed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const sandbox = (major = 1, detected?: string): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), "mouth-install-"));
  const config = join(root, major === 1 ? "tui.jsonc" : "cli.json");
  const stateDir = join(root, "state");
  const pluginSrc = join(root, "fake-tui.js");
  const bin = join(root, "bin");
  mkdirSync(bin);
  if (detected !== undefined) writeFileSync(join(bin, "opencode"), `#!/bin/sh\nprintf '%s\\n' '${detected}'\n`, { mode: 0o755 });
  writeFileSync(pluginSrc, "export default { id: 'opencode-mouth', tui: async () => {} };\n");
  return {
    config,
    stateDir,
    pluginSrc,
    run: (...args: string[]) =>
      execFileSync("bash", [script, ...(detected === undefined ? ["--opencode-version", String(major)] : []), ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MOUTH_INSTALL_CONFIG: config,
          MOUTH_INSTALL_STATE_DIR: stateDir,
          MOUTH_INSTALL_PLUGIN_SRC: pluginSrc,
        },
      }),
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
};

const managedCount = (text: string): number => text.split("opencode-mouth:start").length - 1;

for (const major of [1, 2]) {
const key = major === 1 ? "plugin" : "plugins";
test(`v${major}: installer detects the host's version output`, () => {
  const box = sandbox(major, major === 1 ? "1.18.32" : "opencode v2.0.11");
  try {
    box.run();
    const config = JSON.parse(readFileSync(box.config, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
    assert.deepEqual(config[key], [major === 1 ? join(box.stateDir, "tui.js") : box.stateDir]);
  } finally { box.cleanup(); }
});
test(`v${major}: fresh install points at a loadable plugin`, () => {
  const box = sandbox(major);
  try {
    box.run();
    const installed = join(box.stateDir, "tui.js");
    assert.ok(existsSync(installed), "plugin file not copied into the state dir");
    const config = readFileSync(box.config, "utf8");
    assert.equal(managedCount(config), 1);
    assert.ok(config.includes(major === 1 ? installed : box.stateDir), "config does not point at the installed plugin");
    // OpenCode reads the file as JSONC; strip comments and trailing commas
    // to assert the structure is well formed.
    const parsed = JSON.parse(config.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
    assert.deepEqual(parsed[key], [major === 1 ? installed : box.stateDir]);
  } finally {
    box.cleanup();
  }
});

test(`v${major}: install preserves existing plugin entries`, () => {
  const box = sandbox(major);
  try {
    writeFileSync(box.config, `{\n  // "${key}": ["example-plugin"],\n  "${key}": [\n    "/existing/other-plugin.js"\n  ]\n}\n`);
    box.run();
    const config = readFileSync(box.config, "utf8");
    assert.ok(config.includes("/existing/other-plugin.js"), "existing entry was dropped");
    assert.equal(managedCount(config), 1);
    const parsed = JSON.parse(config.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
    assert.deepEqual(parsed[key], [major === 1 ? join(box.stateDir, "tui.js") : box.stateDir, "/existing/other-plugin.js"]);
  } finally {
    box.cleanup();
  }
});

test(`v${major}: inline arrays survive install, reinstall, and uninstall`, () => {
  const box = sandbox(major);
  const parse = () => JSON.parse(readFileSync(box.config, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
  try {
    writeFileSync(box.config, `{"${key}": ["other-plugin"], "theme": "test"}\n`);
    box.run();
    box.run();
    assert.deepEqual(parse(), { [key]: [major === 1 ? join(box.stateDir, "tui.js") : box.stateDir, "other-plugin"], theme: "test" });
    box.run("--uninstall");
    assert.deepEqual(parse(), { [key]: ["other-plugin"], theme: "test" });
  } finally { box.cleanup(); }
});

test(`v${major}: unsupported compact config fails without changing it`, () => {
  const box = sandbox(major);
  try {
    const original = '{"theme": "test"}\n';
    writeFileSync(box.config, original);
    assert.throws(() => box.run(), /unsupported config layout/);
    assert.equal(readFileSync(box.config, "utf8"), original);
  } finally { box.cleanup(); }
});

test(`v${major}: commented plugin examples remain comments`, () => {
  const box = sandbox(major);
  const parse = () => JSON.parse(readFileSync(box.config, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[\]}])/g, "$1"));
  try {
    writeFileSync(box.config, `{\n  // "${key}": ["example-plugin"],\n  "theme": "test"\n}\n`);
    box.run(); box.run();
    assert.deepEqual(parse(), { [key]: [major === 1 ? join(box.stateDir, "tui.js") : box.stateDir], theme: "test" });
    box.run("--uninstall");
    assert.deepEqual(parse(), { [key]: [], theme: "test" });
  } finally { box.cleanup(); }
});

test(`v${major}: block-comment layouts fail without changing config`, () => {
  const box = sandbox(major);
  try {
    const original = `{\n  /* example\n  "${key}": []\n  */\n  "theme": "test"\n}\n`;
    writeFileSync(box.config, original);
    assert.throws(() => box.run(), /Remove block comments/);
    assert.equal(readFileSync(box.config, "utf8"), original);
  } finally { box.cleanup(); }
});

test(`v${major}: reinstall replaces the managed entry instead of duplicating it`, () => {
  const box = sandbox(major);
  try {
    box.run();
    box.run();
    const config = readFileSync(box.config, "utf8");
    assert.equal(managedCount(config), 1);
  } finally {
    box.cleanup();
  }
});

test(`v${major}: uninstall removes only managed files and config`, () => {
  const box = sandbox(major);
  try {
    writeFileSync(box.config, `{\n  "${key}": [\n    "/existing/other-plugin.js"\n  ]\n}\n`);
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
}

test("invalid host version leaves config and installed files untouched", () => {
  const box = sandbox();
  try {
    assert.throws(() => box.run("--opencode-version", "3"), /requires 1 or 2/);
    assert.equal(existsSync(box.config), false);
    assert.equal(existsSync(box.stateDir), false);
  } finally { box.cleanup(); }
});

test("unrecognized detected version leaves config and installed files untouched", () => {
  const box = sandbox(2, "opencode unknown");
  try {
    assert.throws(() => box.run(), /cannot detect OpenCode version/);
    assert.equal(existsSync(box.config), false);
    assert.equal(existsSync(box.stateDir), false);
  } finally { box.cleanup(); }
});
