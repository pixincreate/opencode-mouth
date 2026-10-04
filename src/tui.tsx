/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Mouth: behavior dashboard TUI plugin.
 *
 * Registers the `/behavior` command. It opens a full-screen dashboard that
 * scans the project's sessions and measures profanity and friction signals
 * in both your prompts and the model's replies.
 */
import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { Plugin } from "@opencode/plugin/tui";
import { v1Host, v2Host, type Host } from "./host.ts";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { buildRoleStats, frictionOf, hitsOf, modelsOf, type ModelTotals, type Role, type RoleStats, type Totals } from "./aggregate.ts";
import { scan, yieldToUI, type LoadState } from "./scan.ts";
import { setupFrustration } from "./frustration-tui.tsx";
import {
  BAR_WIDTH,
  type Card,
  Cards,
  Chip,
  Panel,
  RANGES,
  bar,
  buildChartBuckets,
  clip,
  clockLabel,
  fmtInt,
  fmtRate,
  modelLabel,
  parseOptions,
  perHundred,
  rangeSince,
  shortenPath,
  type ColorToken,
  type Palette,
  type RangeKey,
  type Scope,
} from "./ui.tsx";

const ROUTE = "mouth-behavior";
const MODE = "mouth.behavior";
const MODEL_FILTER_KEY = "f";
/** Body column width: terminal minus root padding and the scrollbar gutter. */
const BODY_INSET = 9;
/** Panel borders + inner padding, on top of BODY_INSET, for text width math. */
const PANEL_CHROME = 4;
/** Scrollbar thumb fix: apply quickly, then again once layout settles. */
const THUMB_FIX_DELAY_MS = 100;
const THUMB_FIX_SETTLE_MS = 600;

const METRICS = [
  { key: "total", label: "All signals", roles: ["user", "assistant"] },
  { key: "yelling", label: "Yelling (CAPS)", roles: ["user", "assistant"] },
  { key: "profanity", label: "Profanity", roles: ["user", "assistant"] },
  { key: "anguish", label: "Anguish (!!!, nooo, ugh)", roles: ["user"] },
  { key: "negation", label: "Negation (no/nope/wrong)", roles: ["user"] },
  { key: "repetition", label: "Repetition (i meant, still doesnt)", roles: ["user"] },
  { key: "blame", label: "Blame (you didnt, stop X-ing)", roles: ["user"] },
  { key: "friction", label: "Friction (neg + rep + blame)", roles: ["user"] },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

const metricValue = (totals: Totals, metric: MetricKey): number => {
  if (metric === "total") return hitsOf(totals);
  if (metric === "friction") return frictionOf(totals);
  return totals[metric];
};

const metricsForRole = (role: Role) => METRICS.filter((m) => (m.roles as readonly Role[]).includes(role));

// --- dashboard --------------------------------------------------------------

// --- dashboard components ---------------------------------------------------

const roleCards = (role: Role, stats: RoleStats): Card[] => {
  const t = stats.totals;
  const worst = [...stats.byModel].sort((a, b) => hitsOf(b) - hitsOf(a))[0];
  const cards: Card[] = [
    { label: role === "user" ? "Your messages" : "Model messages", value: fmtInt(t.messages), sub: "in range" },
    { label: "Yelling (CAPS)", value: fmtInt(t.yelling), sub: perHundred(t.yelling, t.messages), color: "warning" },
    { label: "Profanity hits", value: fmtInt(t.profanity), sub: perHundred(t.profanity, t.messages), color: "error" },
  ];
  if (role === "user") {
    cards.push(
      { label: "Anguish signals", value: fmtInt(t.anguish), sub: perHundred(t.anguish, t.messages), color: "info" },
      {
        label: "Friction signals",
        value: fmtInt(frictionOf(t)),
        sub: perHundred(frictionOf(t), t.messages),
        color: "accent",
      },
    );
  } else {
    cards.push(
      { label: "Dirty vocabulary", value: fmtInt(stats.words.length), sub: "distinct words", color: "info" },
      {
        label: "Favorite word",
        value: stats.words[0]?.word ?? "—",
        sub: stats.words[0] ? `${fmtInt(stats.words[0].count)} times` : undefined,
        color: "accent",
      },
    );
  }
  cards.push({
    label: role === "user" ? "Highest friction model" : "Pottiest model",
    value: worst && hitsOf(worst) > 0 ? clip(worst.modelID, 18) : "—",
    sub: worst && hitsOf(worst) > 0 ? `${fmtInt(hitsOf(worst))} hits` : undefined,
  });
  return cards;
};


function TrendChart(props: {
  stats: RoleStats;
  metric: MetricKey;
  sinceMs: number | undefined;
  th: Palette;
}) {
  const chart = () => buildChartBuckets(props.stats.byDay, props.sinceMs, Date.now());
  const metricLabel = () => METRICS.find((m) => m.key === props.metric)?.label ?? props.metric;
  const maxRate = () =>
    Math.max(
      0.0001,
      ...chart().buckets.map((b) => (b.totals.messages > 0 ? metricValue(b.totals, props.metric) / b.totals.messages : 0)),
    );
  const subtitle = () => {
    const per = chart().daysPerBucket;
    const span = per === 1 ? "each bar is one day" : `each bar is ${per} days`;
    return `${metricLabel()} rate per message · ${span} · m cycles metric`;
  };
  return (
    <Panel title="Trend" subtitle={subtitle()} th={props.th}>
      <For each={chart().buckets}>
        {(bucket) => {
          const hits = metricValue(bucket.totals, props.metric);
          const rate = bucket.totals.messages > 0 ? hits / bucket.totals.messages : 0;
          const cells = bar(rate / maxRate(), BAR_WIDTH);
          return (
            <text>
              <span style={{ fg: props.th().textMuted }}>{bucket.label.padStart(6)} </span>
              <span style={{ fg: props.th().accent }}>{cells.fill}</span>
              <span style={{ fg: props.th().border }}>{cells.rest}</span>
              <span style={{ fg: props.th().text }}> {fmtRate(hits, bucket.totals.messages).padStart(5)}</span>
              <span style={{ fg: props.th().textMuted }}>
                {"  "}
                {bucket.totals.messages > 0
                  ? `${fmtInt(hits)} hits / ${fmtInt(bucket.totals.messages)} msgs`
                  : "no messages"}
              </span>
            </text>
          );
        }}
      </For>
    </Panel>
  );
}

/** Model rows shown before the tail collapses into a hint; keeps the scrollbar usable in global scope. */
const MAX_MODEL_ROWS = 12;

function ModelTable(props: { role: Role; stats: RoleStats; width: number; th: Palette }) {
  const columns = () =>
    props.role === "user"
      ? (["MSGS", "CAPS%", "PROF%", "ANGST%", "FRICT%", "HITS%"] as const)
      : (["MSGS", "CAPS%", "PROF%", "HITS%"] as const);
  const numeric = (model: ModelTotals): string[] => {
    const cells = [
      fmtInt(model.messages),
      fmtRate(model.yelling, model.messages),
      fmtRate(model.profanity, model.messages),
    ];
    if (props.role === "user") {
      cells.push(fmtRate(model.anguish, model.messages), fmtRate(frictionOf(model), model.messages));
    }
    cells.push(fmtRate(hitsOf(model), model.messages));
    return cells;
  };
  const cellWidth = 7;
  const nameWidth = () => Math.max(16, props.width - 6 - columns().length * (cellWidth + 1));
  return (
    <Panel title="By model" subtitle="rates are per message · f filters" th={props.th}>
      <text fg={props.th().textMuted}>
        {"MODEL".padEnd(nameWidth())} {columns().map((c) => c.padStart(cellWidth)).join(" ")}
      </text>
      <For each={props.stats.byModel.slice(0, MAX_MODEL_ROWS)}>
        {(model) => (
          <text>
            <span style={{ fg: props.th().text }}>
              {clip(modelLabel(model), nameWidth() - 1).padEnd(nameWidth())}
            </span>
            <span style={{ fg: props.th().textMuted }}>
              {" "}
              {numeric(model).map((c) => c.padStart(cellWidth)).join(" ")}
            </span>
          </text>
        )}
      </For>
      <Show when={props.stats.byModel.length > MAX_MODEL_ROWS}>
        <text fg={props.th().textMuted}>
          {`… and ${fmtInt(props.stats.byModel.length - MAX_MODEL_ROWS)} more models · ${MODEL_FILTER_KEY} to filter`}
        </text>
      </Show>
      <Show when={props.stats.byModel.length === 0}>
        <text fg={props.th().textMuted}>No messages recorded in this range.</text>
      </Show>
    </Panel>
  );
}

function Breakdown(props: { role: Role; stats: RoleStats; th: Palette }) {
  const t = () => props.stats.totals;
  const rows = () => {
    const out: { label: string; total: number; rate: string; color: ColorToken }[] = [];
    const push = (label: string, total: number, color: ColorToken) =>
      out.push({ label, total, rate: fmtRate(total, t().messages), color });
    push("Yelling (CAPS)", t().yelling, "warning");
    push("Profanity", t().profanity, "error");
    if (props.role === "user") {
      push("Anguish (!!!, nooo, dude, :()", t().anguish, "info");
      push("Negation (no/nope/wrong)", t().negation, "info");
      push("Repetition (i meant, still doesnt)", t().repetition, "info");
      push("Blame (you didnt, stop X-ing)", t().blame, "info");
      push("Friction (neg + rep + blame)", frictionOf(t()), "accent");
    }
    push("All signals", hitsOf(t()), "accent");
    return out;
  };
  const avg = (total: number) => (t().messages > 0 ? Math.round(total / t().messages) : 0);
  return (
    <Panel title="Signal breakdown" subtitle="totals and share of messages in range" th={props.th}>
      <For each={rows()}>
        {(row) => (
          <text>
            <span style={{ fg: props.th().text }}>{row.label.padEnd(36)}</span>
            <span style={{ fg: props.th()[row.color] }}>{fmtInt(row.total).padStart(8)}</span>
            <span style={{ fg: props.th().textMuted }}>{row.rate.padStart(8)} of msgs</span>
          </text>
        )}
      </For>
      <text>
        <span style={{ fg: props.th().text }}>{"Message size".padEnd(36)}</span>
        <span style={{ fg: props.th().textMuted }}>
          {`avg ${fmtInt(avg(t().chars))} chars · ${fmtInt(avg(t().words))} words`}
        </span>
      </text>
    </Panel>
  );
}

function TopWords(props: { stats: RoleStats; th: Palette }) {
  const top = () => props.stats.words.slice(0, 12);
  return (
    <Panel title="Top offenders" subtitle="profanity by frequency" th={props.th}>
      <Show
        when={top().length > 0}
        fallback={<text fg={props.th().success}>Squeaky clean. Nothing to report.</text>}
      >
        <text>
          {top().flatMap((entry, index) => [
            <span style={{ fg: props.th().error }}>{entry.word}</span>,
            <span style={{ fg: props.th().textMuted }}>
              {` ×${fmtInt(entry.count)}${index < top().length - 1 ? "   " : ""}`}
            </span>,
          ])}
        </text>
      </Show>
    </Panel>
  );
}


// --- plugin -----------------------------------------------------------------

const setupDashboard = async (host: Host) => {
  const opts = parseOptions(host.options);
  const [role, setRole] = createSignal<Role>("user");
  const [scope, setScope] = createSignal<Scope>(opts.scope);
  const [range, setRange] = createSignal<RangeKey>(opts.range);
  const [metric, setMetric] = createSignal<MetricKey>("total");
  const [modelFilter, setModelFilter] = createSignal<string | undefined>(undefined);
  const [state, setState] = createSignal<LoadState>({ status: "idle" });
  let returnRoute: ReturnType<Host["current"]> | undefined;
  let scroller: ScrollBoxRenderable | undefined;
  let loading = false;
  // Where `g` returns to when leaving the global scope. If the config itself
  // starts global, the first toggle drops to the whole project.
  let returnScope: Scope = opts.scope === "global" ? "project" : opts.scope;

  const th: Palette = host.theme;

  const sinceMs = (): number | undefined => rangeSince(range());

  const load = async () => {
    if (loading) return;
    loading = true;
    const wantedScope = scope();
    setState({ status: "loading", done: 0, total: 0 });
    // Paint the loading state before any scanning work runs: the callers set
    // signals and start the scan in the same event handler, and without this
    // yield the first synchronous queries delay the repaint.
    await yieldToUI();
    try {
      const result = await scan(host, { ...opts, scope: wantedScope }, (done, total) =>
        setState({ status: "loading", done, total }),
      );
      setState({ status: "ready", ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message });
      host.toast({ variant: "error", title: "mouth", message, duration: 5000 });
    } finally {
      loading = false;
    }
    // The scope can change while a scan is in flight (toggleGlobal is a no-op
    // then), and the header always renders the live scope — rescan instead of
    // leaving it next to the other scope's data.
    if (scope() !== wantedScope) void load();
  };

  const toggleGlobal = () => {
    if (scope() === "global") {
      setScope(returnScope);
    } else {
      returnScope = scope();
      setScope("global");
    }
    void load();
  };

  const open = () => {
    const current = host.current();
    if (current.name !== ROUTE) returnRoute = current;
    host.navigate(ROUTE);
    if (state().status === "idle" || state().status === "error") void load();
  };

  const close = () => {
    const back = returnRoute;
    if (back && back.name !== ROUTE) {
      back.restore();
    } else {
      host.navigate("home");
    }
  };

  const pickRole = (next: Role) => {
    setRole(next);
    if (!metricsForRole(next).some((m) => m.key === metric())) setMetric("total");
    setModelFilter(undefined);
  };

  const cycleMetric = () => {
    const list = metricsForRole(role());
    const index = list.findIndex((m) => m.key === metric());
    setMetric(list[(index + 1) % list.length].key);
  };

  const pickModel = async () => {
    const value = state();
    if (value.status !== "ready") return;
    const models = modelsOf(value.records, role());
    if (models.length === 0) return;
    const picked = await host.select({
      title: "Filter by model",
      options: [
        { title: "All models", value: "", description: "clear the filter" },
        ...models.map((m) => ({
          title: m.key,
          value: m.key,
          description: `${fmtInt(m.messages)} messages`,
        })),
      ],
    });
    if (picked === undefined) return;
    setModelFilter(picked === "" ? undefined : picked);
  };

  const scrollBy = (lines: number) => {
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, scroller.scrollTop + lines);
  };

  const dashboardCommands = [
    {
      id: "mouth.behavior.close",
      title: "Close dashboard",
      group: "Mouth",
      bind: "escape,q",
      run: () => close(),
    },
    {
      id: "mouth.behavior.role",
      title: "Toggle you / model",
      group: "Mouth",
      bind: "tab",
      run: () => pickRole(role() === "user" ? "assistant" : "user"),
    },
    {
      id: "mouth.behavior.metric",
      title: "Cycle trend metric",
      group: "Mouth",
      bind: "m",
      run: () => cycleMetric(),
    },
    {
      id: "mouth.behavior.model",
      title: "Filter by model",
      group: "Mouth",
      bind: MODEL_FILTER_KEY,
      run: () => void pickModel(),
    },
    {
      id: "mouth.behavior.scope",
      title: "Toggle global scope",
      group: "Mouth",
      bind: "g",
      run: () => toggleGlobal(),
    },
    {
      id: "mouth.behavior.rescan",
      title: "Rescan sessions",
      group: "Mouth",
      bind: "r",
      run: () => void load(),
    },
    ...RANGES.map((r, index) => ({
      id: `mouth.behavior.range.${r.key}`,
      title: `Range ${r.label}`,
      group: "Mouth",
      bind: String(index + 1),
      run: () => setRange(r.key),
    })),
    {
      id: "mouth.behavior.scroll.down",
      title: "Scroll down",
      group: "Mouth",
      bind: "j,down",
      run: () => scrollBy(2),
    },
    {
      id: "mouth.behavior.scroll.up",
      title: "Scroll up",
      group: "Mouth",
      bind: "k,up",
      run: () => scrollBy(-2),
    },
  ];
  const unregisterCommands = host.commands(ROUTE, MODE, open, dashboardCommands, {
    id: "mouth.behavior.open",
    title: "Mouth: behavior dashboard",
    description: "Measure profanity and friction in your sessions",
    slash: "behavior",
  });

  const unregisterRoute = host.route(ROUTE, () => {
      const popMode = host.pushMode(MODE);
      onCleanup(popMode);
        onCleanup(() => {
          scroller = undefined;
        });
        const dim = useTerminalDimensions();
        const width = () => dim().width;
        const stats = createMemo(() => {
          const value = state();
          if (value.status !== "ready") return undefined;
          return buildRoleStats(value.records, {
            role: role(),
            since: sinceMs(),
            model: modelFilter(),
          });
        });
        // opentui's slider clamps viewPortSize to the scroll range
        // (Math.min(size, max - min)), capping the thumb at 50% of the track
        // no matter how short the scroll distance is — with a 12-line range
        // the thumb renders half the track instead of ~80%. Pin the honest
        // thumb size (viewport/content) on the slider instance; recomputed
        // whenever the body changes, restored when content fits the viewport.
        createEffect(() => {
          const current = stats();
          if (!current || !scroller) return;
          const fix = () => {
            const box = scroller as any;
            const sb = box?.verticalScrollBar;
            const slider = sb?.slider;
            if (!slider || !box.viewport) return;
            const viewport = box.viewport.height;
            const content = sb.scrollSize;
            const virtualTrack = slider.height * 2; // half-block cell rendering
            if (!viewport || !content || !virtualTrack) return;
            if (!slider.__honestThumb) slider.__honestThumb = slider.getVirtualThumbSize;
            if (content <= viewport) {
              slider.getVirtualThumbSize = slider.__honestThumb;
              return;
            }
            const virtualThumb = Math.min(virtualTrack, Math.floor(virtualTrack * (viewport / content)));
            slider.getVirtualThumbSize = () => virtualThumb;
            sb.requestRender?.();
          };
          const first = setTimeout(fix, THUMB_FIX_DELAY_MS);
          const second = setTimeout(fix, THUMB_FIX_SETTLE_MS);
          onCleanup(() => {
            clearTimeout(first);
            clearTimeout(second);
          });
        });

        return (
          <box
            width={dim().width}
            height={dim().height}
            backgroundColor={th().backgroundPanel}
            flexDirection="column"
            paddingTop={1}
            paddingLeft={2}
            paddingRight={2}
          >
            <box flexShrink={0} flexDirection="row" justifyContent="space-between">
              <text>
                <span style={{ fg: th().accent }}>
                  <b>MOUTH</b>
                </span>
                <span style={{ fg: th().textMuted }}> measure what comes out of your model's mouth</span>
              </text>
              <text fg={th().textMuted}>tab view · 1-5 range · m metric · f model · g global · r rescan · esc close</text>
            </box>

            {/* flexShrink keeps these rows intact when the body overflows the fixed-height root — otherwise yoga eats their padding one line at a time */}
            <box flexShrink={0} flexDirection="row" gap={1} paddingTop={1} paddingBottom={1} flexWrap="wrap">
              <Chip label="you" active={role() === "user"} th={th} onPick={() => pickRole("user")} />
              <Chip label="model" active={role() === "assistant"} th={th} onPick={() => pickRole("assistant")} />
              <text fg={th().border}>│</text>
              <For each={RANGES}>
                {(r) => (
                  <Chip label={r.label} active={range() === r.key} th={th} onPick={() => setRange(r.key)} />
                )}
              </For>
              <text fg={th().border}>│</text>
              <Chip
                label={modelFilter() ? clip(modelFilter() ?? "", 28) : "all models"}
                active={modelFilter() !== undefined}
                th={th}
                onPick={pickModel}
              />
              <Show when={state().status === "ready"}>
                <text fg={th().textMuted}>
                  {(() => {
                    const value = state();
                    if (value.status !== "ready") return "";
                    const failed = value.failures > 0 ? ` · ${value.failures} failed` : "";
                    const where = value.target ? ` · ${shortenPath(value.target)}` : "";
                    return ` ${fmtInt(value.sessions)} sessions (${scope()}${where})${failed} · scanned ${clockLabel(value.loadedAt)}`;
                  })()}
                </text>
              </Show>
            </box>

            <Switch>
              <Match when={state().status === "loading"}>
                <box flexDirection="column" gap={1} paddingTop={1}>
                  <text fg={th().text}>Scanning sessions…</text>
                  <text>
                    {(() => {
                      const value = state();
                      if (value.status !== "loading") return "";
                      const ratio = value.total > 0 ? value.done / value.total : 0;
                      const cells = bar(ratio, 30);
                      return (
                        <>
                          <span style={{ fg: th().accent }}>{cells.fill}</span>
                          <span style={{ fg: th().border }}>{cells.rest}</span>
                          <span style={{ fg: th().textMuted }}>
                            {" "}
                            {value.done}/{value.total}
                          </span>
                        </>
                      );
                    })()}
                  </text>
                </box>
              </Match>
              <Match when={state().status === "error"}>
                <text fg={th().error}>
                  {(() => {
                    const value = state();
                    return value.status === "error" ? `Failed to load sessions: ${value.message}` : "";
                  })()}
                </text>
              </Match>
              <Match when={stats()} keyed>
                {(current: RoleStats) => (
                  <Show
                    when={current.totals.messages > 0}
                    fallback={
                      <text fg={th().textMuted}>
                        No {role() === "user" ? "user" : "model"} messages match the current filters.
                      </text>
                    }
                  >
                    <scrollbox ref={(el: ScrollBoxRenderable) => { scroller = el; }} flexGrow={1}>
                      {/* Panels draw their borders OUTSIDE their measured width (opentui), so
                          the content box must stay a few columns short of the scrollbox edge —
                          otherwise panel borders paint over the scrollbar column and the thumb
                          peeks through only in the gap rows between panels */}
                      <box flexDirection="column" gap={1} flexShrink={0} width={width() - BODY_INSET}>
                        <Cards cards={roleCards(role(), current)} th={th} />
                        <TrendChart stats={current} metric={metric()} sinceMs={sinceMs()} th={th} />
                        <ModelTable role={role()} stats={current} width={width() - BODY_INSET - PANEL_CHROME} th={th} />
                        <Breakdown role={role()} stats={current} th={th} />
                        <TopWords stats={current} th={th} />
                      </box>
                    </scrollbox>
                  </Show>
                )}
              </Match>
            </Switch>
          </box>
        );
  });

  return () => {
    unregisterCommands();
    unregisterRoute();
  };
};

export default {
  id: "opencode-mouth",
  tui: async (api, options) => {
    const host = v1Host(api, options);
    await Promise.all([setupDashboard(host), setupFrustration(host)]);
  },
  setup: async (context) => {
    const host = v2Host(context);
    await Promise.all([setupDashboard(host), setupFrustration(host)]);
  },
} satisfies TuiPluginModule & Plugin.Definition;
