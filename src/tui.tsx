/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Mouth: frustration dashboard TUI plugin.
 *
 * Registers the `/frustration` command. The dashboard classifies user
 * messages as annoyed, at assistant, or angry from cached judge verdicts,
 * with regex signals as the fallback.
 */
import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { Plugin } from "@opencode/plugin/tui";
import { v1Host, v2Host } from "./host.ts";
import { setupFrustration } from "./frustration-tui.tsx";

export default {
  id: "opencode-mouth",
  tui: async (api, options) => {
    await setupFrustration(v1Host(api, options));
  },
  setup: async (context) => {
    await setupFrustration(v2Host(context));
  },
} satisfies TuiPluginModule & Plugin.Definition;
