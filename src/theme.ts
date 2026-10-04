/**
 * V2 theme adapter.
 *
 * OpenCode V2 resolves themes into token objects instead of the flat color
 * names V1 exposed. The dashboard components only need a handful of colors,
 * so this module maps the V2 tokens onto the same field names the V1 palette
 * used and keeps the component code free of token-path knowledge.
 */
import type { RGBA } from "@opentui/core";
import type { Context } from "@opencode/plugin/tui/context";

type Theme = Context["theme"];

export interface Palette {
  border: RGBA;
  text: RGBA;
  textMuted: RGBA;
  accent: RGBA;
  primary: RGBA;
  error: RGBA;
  warning: RGBA;
  success: RGBA;
  info: RGBA;
  backgroundPanel: RGBA;
  backgroundElement: RGBA;
  selectedListItemText: RGBA;
}

export const palette = (theme: Theme): Palette => ({
  border: theme.border.base,
  text: theme.text.base,
  textMuted: theme.text.muted,
  accent: theme.hue.accent[500],
  primary: theme.text.action.primary.base,
  error: theme.text.feedback.error.base,
  warning: theme.text.feedback.warning.base,
  success: theme.text.feedback.success.base,
  info: theme.text.feedback.info.base,
  backgroundPanel: theme.background.raised.base,
  backgroundElement: theme.background.raised.high,
  selectedListItemText: theme.text.action.primary.selected,
});
