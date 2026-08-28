/**
 * Builds dist/tui.js.
 *
 * Solid JSX cannot be compiled by esbuild alone, so .tsx files go through
 * Babel with babel-preset-solid first, using the same options OpenCode's
 * runtime loader uses (`moduleName: "@opentui/solid"`, `generate:
 * "universal"`). Imports of @opentui/* and solid-js stay external: when
 * OpenCode loads dist/tui.js from a path outside node_modules, its runtime
 * loader rewrites those imports to the host's own module instances.
 */
import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import * as esbuild from "esbuild";
import { readFile, rm } from "node:fs/promises";

const solidPlugin = {
  name: "solid-jsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const result = await transformAsync(source, {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [
          [ts, {}],
          [solid, { moduleName: "@opentui/solid", generate: "universal" }],
        ],
      });
      return { contents: result.code, loader: "js" };
    });
  },
};

await rm("./dist", { force: true, recursive: true });

await esbuild.build({
  bundle: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  entryPoints: ["./src/tui.tsx"],
  outfile: "./dist/tui.js",
  external: ["@opentui/core", "@opentui/solid", "@opentui/keymap", "solid-js"],
  plugins: [solidPlugin],
});

console.log("Built dist/tui.js");
