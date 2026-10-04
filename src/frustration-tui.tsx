/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Mouth: frustration dashboard TUI plugin.
 *
 * Registers the `/frustration` command. User messages are ingested into a
 * local stats database (one row per message, like upstream's user_messages).
 * Cached judge verdicts replace the regex heuristics; unjudged messages fall
 * back to regex signals. Judging runs against a model you pick and stores
 * verdicts locally.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Host } from "./host.ts";
import { scan, yieldToUI, type LoadState, type ScanResult } from "./scan.ts";
import {
  frustrationByDay,
  frustrationByModel,
  frustrationOverall,
  isMostlyRegex,
  pendingProse,
  saveVerdict,
  type FrustrationCounts,
  type FrustrationDay,
  type FrustrationModelStats,
} from "./stats-db.ts";
import {
  estimateJudgeRun,
  idleJudgeJob,
  runJudge,
  type JudgeJobStatus,
  type JudgeModel,
  type PendingProse,
} from "./judge.ts";
import {
  BAR_WIDTH,
  type Card,
  Cards,
  Chip,
  Panel,
  RANGES,
  clip,
  clockLabel,
  fmtCost,
  fmtInt,
  fmtRate,
  parseOptions,
  rangeSince,
  shortenPath,
  type Palette,
  type RangeKey,
  type Scope,
} from "./ui.tsx";

const ROUTE = "mouth-frustration";
const MODE = "mouth.frustration";
const MAX_TABLE_ROWS = 12;
/** Body column width: terminal minus root padding and the scrollbar gutter. */
const BODY_INSET = 9;
/** Panel borders + inner padding, on top of BODY_INSET, for text width math. */
const PANEL_CHROME = 4;
/** Scrollbar thumb fix: apply quickly, then again once layout settles. */
const THUMB_FIX_DELAY_MS = 100;
const THUMB_FIX_SETTLE_MS = 600;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const bucketLabel = (day: string): string => {
  const [, month, date] = day.split("-");
  const index = Number(month) - 1;
  return `${MONTHS[index] ?? month} ${Number(date)}`;
};

interface FrustrationBucket {
  label: string;
  counts: FrustrationCounts;
}

/** Bucket per-day counts into at most 15 bars spanning the range. */
function buildTrendBuckets(
  byDay: FrustrationDay[],
  sinceMs: number | undefined,
  now: number,
  maxBars = 15,
): { buckets: FrustrationBucket[]; daysPerBucket: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  const dayKeyOf = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const startDay = sinceMs !== undefined ? dayKeyOf(sinceMs) : byDay[0]?.day ?? dayKeyOf(now);
  const start = new Date(`${startDay}T00:00:00`).getTime();
  const spanDays = Math.max(1, Math.round((now - start) / dayMs) + 1);
  const daysPerBucket = Math.max(1, Math.ceil(spanDays / maxBars));
  const bucketCount = Math.ceil(spanDays / daysPerBucket);
  const byKey = new Map(byDay.map((d) => [d.day, d]));

  const buckets: FrustrationBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = start + i * daysPerBucket * dayMs;
    const counts: FrustrationCounts = { messages: 0, judged: 0, annoyed: 0, atAssistant: 0, angry: 0 };
    for (let d = 0; d < daysPerBucket; d++) {
      const day = byKey.get(dayKeyOf(bucketStart + d * dayMs));
      if (!day) continue;
      counts.messages += day.messages;
      counts.judged += day.judged;
      counts.annoyed += day.annoyed;
      counts.atAssistant += day.atAssistant;
      counts.angry += day.angry;
    }
    buckets.push({ label: bucketLabel(dayKeyOf(bucketStart)), counts });
  }
  return { buckets, daysPerBucket };
}

// --- route ------------------------------------------------------------------

export async function setupFrustration(host: Host): Promise<void> {
  const opts = parseOptions(host.options);
  const th: Palette = host.theme;

  const [range, setRange] = createSignal<RangeKey>(opts.range);
  const [scope, setScope] = createSignal<Scope>(opts.scope);
  const [state, setState] = createSignal<LoadState>({ status: "idle" });
  const [overall, setOverall] = createSignal<FrustrationCounts>({
    messages: 0,
    judged: 0,
    annoyed: 0,
    atAssistant: 0,
    angry: 0,
  });
  const [byModel, setByModel] = createSignal<FrustrationModelStats[]>([]);
  const [byDay, setByDay] = createSignal<FrustrationDay[]>([]);
  const [pending, setPending] = createSignal<PendingProse[]>([]);
  const [models, setModels] = createSignal<JudgeModel[]>([]);
  const [model, setModel] = createSignal<JudgeModel>();
  const [job, setJob] = createSignal<JudgeJobStatus>(idleJudgeJob());
  const [hideRegex, setHideRegex] = createSignal(true);

  let returnRoute: ReturnType<Host["current"]> | undefined;
  let scroller: ScrollBoxRenderable | undefined;
  let loading = false;
  let controller: AbortController | undefined;
  let returnScope: Scope = opts.scope === "global" ? "project" : opts.scope;

  const sinceMs = (): number | undefined => rangeSince(range());

  const loadStats = (): void => {
    const since = sinceMs();
    setOverall(frustrationOverall(since));
    setByModel(frustrationByModel(since));
    setByDay(frustrationByDay(since));
    setPending(pendingProse(since));
  };

  const load = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    const wantedScope = scope();
    setState({ status: "loading", done: 0, total: 0 });
    try {
      await yieldToUI();
      const result = await scan(host, { ...opts, scope: wantedScope }, (done, total) =>
        setState({ status: "loading", done, total }),
      );
      setState({ status: "ready", ...result });
      loadStats();
      if (!model()) void loadModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message });
      host.toast({ variant: "error", title: "mouth", message, duration: 5000 });
    } finally {
      loading = false;
      if (scope() !== wantedScope) void load();
    }
  };

  const loadModels = async (): Promise<void> => {
    try {
      const list = await host.judgeModels();
      setModels(list);
      if (model() || list.length === 0) return;
      const preferred = await host.defaultJudgeModel();
      const match = preferred
        ? list.find((entry) => entry.providerID === preferred.providerID && entry.modelID === preferred.modelID)
        : undefined;
      setModel(match ?? list[0]);
    } catch {
      // No judge models available; the panel explains what to configure.
    }
  };

  const pickModel = async (): Promise<void> => {
    if (models().length === 0) await loadModels();
    const list = models();
    if (list.length === 0) {
      host.toast({ variant: "warning", title: "mouth", message: "No judge model available", duration: 5000 });
      return;
    }
    const choice = await host.select({
      title: "Judge model",
      options: list.map((entry) => ({
        title: `${entry.name} (${entry.providerID}/${entry.modelID})`,
        value: `${entry.providerID}/${entry.modelID}`,
        description: `$${entry.inputCost}/M in · $${entry.outputCost}/M out`,
      })),
    });
    const picked = list.find((entry) => `${entry.providerID}/${entry.modelID}` === choice);
    if (picked) setModel(picked);
  };

  const judgeNow = async (): Promise<void> => {
    const current = model();
    if (!current) {
      host.toast({ variant: "warning", title: "mouth", message: "No judge model available", duration: 5000 });
      return;
    }
    if (job().state === "running") return;
    const queue = pending();
    if (queue.length === 0) {
      host.toast({ variant: "info", title: "mouth", message: "Everything in this range is already judged", duration: 4000 });
      return;
    }
    controller = new AbortController();
    setJob({ ...idleJudgeJob(), state: "running", total: queue.length, judge: current.name, startedAt: Date.now() });
    const final = await runJudge({
      pending: queue,
      model: current,
      signal: controller.signal,
      judge: (request) => host.judge(request),
      save: (verdict) => saveVerdict(verdict),
      onProgress: (progress) => setJob({ ...progress }),
    });
    setJob(final);
    controller = undefined;
    loadStats();
  };

  const cancel = (): void => {
    if (job().state === "running") controller?.abort();
  };

  const toggleGlobal = (): void => {
    if (scope() === "global") {
      setScope(returnScope);
    } else {
      returnScope = scope();
      setScope("global");
    }
    void load();
  };

  const open = (): void => {
    if (host.current().name !== ROUTE) returnRoute = host.current();
    host.navigate(ROUTE);
    if (state().status === "idle" || state().status === "error") void load();
  };

  const close = (): void => {
    if (returnRoute) returnRoute.restore();
    else host.navigate("home");
  };

  const scrollBy = (lines: number): void => {
    if (!scroller) return;
    const top = scroller.scrollTop + lines;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.height, top));
  };

  const commands = [
    { id: "mouth.frustration.close", title: "Close", group: "Mouth", bind: "escape,q", run: close },
    { id: "mouth.frustration.judge", title: "Judge with model", group: "Mouth", bind: "u", run: () => void judgeNow() },
    { id: "mouth.frustration.model", title: "Pick judge model", group: "Mouth", bind: "m", run: () => void pickModel() },
    { id: "mouth.frustration.cancel", title: "Cancel judging", group: "Mouth", bind: "c", run: cancel },
    { id: "mouth.frustration.scope", title: "Toggle global scope", group: "Mouth", bind: "g", run: toggleGlobal },
    { id: "mouth.frustration.rescan", title: "Rescan sessions", group: "Mouth", bind: "r", run: () => void load() },
    ...RANGES.map((entry, index) => ({
      id: `mouth.frustration.range.${entry.key}`,
      title: `Range ${entry.label}`,
      group: "Mouth",
      bind: String(index + 1),
      run: () => {
        setRange(entry.key);
        loadStats();
      },
    })),
    { id: "mouth.frustration.scroll.down", title: "Scroll down", group: "Mouth", bind: "j,down", run: () => scrollBy(2) },
    { id: "mouth.frustration.scroll.up", title: "Scroll up", group: "Mouth", bind: "k,up", run: () => scrollBy(-2) },
  ];

  const unregisterCommands = host.commands(ROUTE, MODE, open, commands, {
    id: "mouth.frustration.open",
    title: "Mouth: frustration dashboard",
    description: "Judge how annoyed your messages sound",
    slash: "frustration",
  });

  const unregisterRoute = host.route(ROUTE, () => {
    const popMode = host.pushMode(MODE);
    onCleanup(popMode);
    onCleanup(() => {
      scroller = undefined;
      controller?.abort();
    });

    const dim = useTerminalDimensions();
    const width = () => dim().width;

    const cards = (): Card[] => {
      const counts = overall();
      return [
        {
          label: "Judged",
          value: fmtRate(counts.judged, counts.messages),
          sub: `${fmtInt(counts.judged)} judged · ${fmtInt(counts.messages - counts.judged)} regex`,
        },
        {
          label: "Annoyed",
          value: fmtRate(counts.annoyed, counts.messages),
          sub: `${fmtInt(counts.annoyed)} of ${fmtInt(counts.messages)} messages`,
          color: "warning",
        },
        {
          label: "At assistant",
          value: fmtRate(counts.atAssistant, counts.messages),
          sub: `${fmtInt(counts.atAssistant)} messages`,
          color: "error",
        },
        {
          label: "Angry",
          value: fmtRate(counts.angry, counts.messages),
          sub: `${fmtInt(counts.angry)} messages`,
          color: "error",
        },
      ];
    };

    const modelRows = (): FrustrationModelStats[] =>
      byModel()
        .filter((row) => !hideRegex() || !isMostlyRegex(row))
        .slice(0, MAX_TABLE_ROWS);

    const modelLine = (row: FrustrationModelStats): string =>
      `${fmtRate(row.atAssistant, row.messages)} at assistant · ${fmtInt(row.judged)}/${fmtInt(row.messages)} judged`;

    const stacked = (row: FrustrationModelStats) => {
      const total = Math.max(1, row.messages);
      const angry = Math.round((row.angry / total) * BAR_WIDTH);
      const mid = Math.round(((row.atAssistant - row.angry) / total) * BAR_WIDTH);
      const other = Math.round(((row.annoyed - row.atAssistant) / total) * BAR_WIDTH);
      return { angry, mid, other, rest: Math.max(0, BAR_WIDTH - angry - mid - other) };
    };

    const judgePanel = () => {
      const current = model();
      const currentJob = job();
      const queue = pending();
      const currentEstimate = current ? estimateJudgeRun(queue, current) : undefined;
      return (
        <Panel title="Judge" subtitle="cached verdicts replace regex signals; unjudged messages fall back to regex" th={th}>
          <Show
            when={current}
            fallback={<text fg={th().warning}>No judge model available. Configure a provider and model in OpenCode.</text>}
          >
            <box flexDirection="row" gap={2}>
              <text fg={th().text}>{clip(current!.name, 40)}</text>
              <text fg={th().textMuted}>
                {current!.providerID}/{current!.modelID}
              </text>
              <Chip label="change" active={false} th={th} onPick={() => void pickModel()} />
            </box>
            <Switch>
              <Match when={currentJob.state === "running"}>
                <box flexDirection="row" gap={2}>
                  <text fg={th().accent}>
                    {fmtInt(currentJob.done)}/{fmtInt(currentJob.total)} judged · {fmtInt(currentJob.failed)} failed
                  </text>
                  <Chip label="cancel" active={false} th={th} onPick={cancel} />
                </box>
              </Match>
              <Match when={queue.length === 0}>
                <text fg={th().textMuted}>Everything in this range is already judged.</text>
              </Match>
              <Match when={currentEstimate}>
                <box flexDirection="row" gap={2}>
                  <text fg={th().textMuted}>
                    {fmtInt(currentEstimate!.messages)} messages · {fmtInt(currentEstimate!.chars)} chars · ~
                    {fmtInt(currentEstimate!.inputTokens)} input tokens · ~{fmtCost(currentEstimate!.cost)}
                  </text>
                  <Chip label="run judge" active={false} th={th} onPick={() => void judgeNow()} />
                </box>
              </Match>
            </Switch>
            <Show when={currentJob.state === "done" || currentJob.state === "failed" || currentJob.state === "cancelled"}>
              <text fg={currentJob.state === "failed" ? th().error : th().textMuted}>
                Last run: {currentJob.state} · {fmtInt(currentJob.done)} judged · {fmtInt(currentJob.failed)} failed · ~
                {fmtCost(currentJob.cost)}
              </text>
            </Show>
            <Show when={currentJob.error}>
              <text fg={th().error}>{clip(currentJob.error!, 240)}</text>
            </Show>
          </Show>
        </Panel>
      );
    };

    const trendPanel = () => {
      const current = buildTrendBuckets(byDay(), sinceMs(), Date.now());
      if (current.buckets.length === 0) return null;
      const max = Math.max(...current.buckets.map((bucket) => bucket.counts.atAssistant), 1);
      return (
        <Panel
          title="At assistant trend"
          subtitle={`share of user messages · each bar is one day${current.daysPerBucket > 1 ? ` or ${current.daysPerBucket} days` : ""}`}
          th={th}
        >
          <For each={current.buckets}>
            {(bucket) => {
              const ratio = () => bucket.counts.atAssistant / max;
              return (
                <box flexDirection="row" gap={2}>
                  <text fg={th().textMuted}>{bucket.label.padEnd(6)}</text>
                  <text fg={th().error}>{"█".repeat(Math.round(ratio() * BAR_WIDTH))}</text>
                  <text fg={th().border}>{"░".repeat(Math.max(0, BAR_WIDTH - Math.round(ratio() * BAR_WIDTH)))}</text>
                  <text fg={th().text}>{fmtRate(bucket.counts.atAssistant, bucket.counts.messages)}</text>
                  <text fg={th().textMuted}>
                    {fmtInt(bucket.counts.atAssistant)} / {fmtInt(bucket.counts.messages)} msgs
                  </text>
                </box>
              );
            }}
          </For>
        </Panel>
      );
    };

    const tablePanel = () => {
      const rows = modelRows();
      if (rows.length === 0) return null;
      const cellWidth = 8;
      const nameWidth = Math.max(16, width() - BODY_INSET - PANEL_CHROME - cellWidth * 5);
      const cell = (value: string) => value.padStart(cellWidth - 1) + " ";
      return (
        <Panel title="Frustration by model" subtitle="share of user messages · f toggles regex-only rows" th={th}>
          <box flexDirection="row">
            <text fg={th().textMuted}>{"Model".padEnd(nameWidth)}</text>
            <text fg={th().textMuted}>{cell("MSGS")}</text>
            <text fg={th().textMuted}>{cell("JUDGED")}</text>
            <text fg={th().textMuted}>{cell("ANNOY%")}</text>
            <text fg={th().textMuted}>{cell("ASST%")}</text>
            <text fg={th().textMuted}>{cell("ANGRY%")}</text>
          </box>
          <For each={rows}>
            {(row) => {
              const parts = stacked(row);
              return (
                <box flexDirection="row">
                  <text fg={th().text}>{clip(`${row.provider}/${row.model}`, nameWidth - 1).padEnd(nameWidth)}</text>
                  <text fg={th().error}>{"█".repeat(parts.angry)}</text>
                  <text fg={th().warning}>{"█".repeat(parts.mid)}</text>
                  <text fg={th().info}>{"█".repeat(parts.other)}</text>
                  <text fg={th().border}>{"░".repeat(parts.rest)}</text>
                  <text fg={th().textMuted}>{cell(fmtInt(row.messages))}</text>
                  <text fg={th().textMuted}>{cell(fmtInt(row.judged))}</text>
                  <text fg={th().text}>{cell(fmtRate(row.annoyed, row.messages))}</text>
                  <text fg={th().error}>{cell(fmtRate(row.atAssistant, row.messages))}</text>
                  <text fg={th().error}>{cell(fmtRate(row.angry, row.messages))}</text>
                  <Show when={isMostlyRegex(row)}>
                    <text fg={th().warning}> regex</text>
                  </Show>
                </box>
              );
            }}
          </For>
          <Show when={byModel().length > rows.length}>
            <text fg={th().textMuted}>… {fmtInt(byModel().length - rows.length)} more models</text>
          </Show>
        </Panel>
      );
    };

    createEffect(() => {
      const current = state();
      if (current.status !== "ready" || !scroller) return;
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

    const ready = (): (ScanResult & { status: "ready" }) | undefined => {
      const current = state();
      return current.status === "ready" ? current : undefined;
    };

    return (
      <box
        width={width()}
        height={dim().height}
        backgroundColor={th().backgroundPanel}
        flexDirection="column"
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row" flexShrink={0} gap={2}>
          <text fg={th().accent}>
            <b>MOUTH</b>
          </text>
          <text fg={th().textMuted}>how annoyed your messages sound</text>
          <box flexGrow={1} />
          <text fg={th().textMuted}>1-5 range · u judge · m model · g global · r rescan · esc close</text>
        </box>
        <box flexDirection="row" flexShrink={0} gap={1} paddingTop={1} paddingBottom={1} flexWrap="wrap">
          <For each={RANGES}>
            {(entry) => (
              <Chip
                label={entry.label}
                active={range() === entry.key}
                th={th}
                onPick={() => {
                  setRange(entry.key);
                  loadStats();
                }}
              />
            )}
          </For>
          <text fg={th().border}>│</text>
          <Chip
            label={clip(model() ? model()!.name : "no judge model", 28)}
            active={false}
            th={th}
            onPick={() => void pickModel()}
          />
          <Chip
            label={hideRegex() ? "hide regex rows" : "show all rows"}
            active={hideRegex()}
            th={th}
            onPick={() => setHideRegex(!hideRegex())}
          />
          <Show when={ready()}>
            {(view: () => ScanResult & { status: "ready" }) => (
              <text fg={th().textMuted}>
                {" "}
                {fmtInt(view().sessions)} sessions
                {view().target ? ` · ${shortenPath(view().target!)}` : ""}
                {view().failures > 0 ? ` · ${fmtInt(view().failures)} failed` : ""} · scanned{" "}
                {clockLabel(view().loadedAt)}
              </text>
            )}
          </Show>
        </box>
        <Switch>
          <Match when={state().status === "loading"}>
            <box flexDirection="column" gap={1}>
              <text fg={th().text}>Scanning sessions…</text>
              <box flexDirection="row">
                <text fg={th().accent}>{"█".repeat(30)}</text>
                <text fg={th().textMuted}>
                  {" "}
                  {fmtInt((state() as { done: number }).done)}/{fmtInt((state() as { total: number }).total)}
                </text>
              </box>
            </box>
          </Match>
          <Match when={state().status === "error"}>
            <text fg={th().error}>Failed to load sessions: {(state() as { message: string }).message}</text>
          </Match>
          <Match when={ready()}>
            <Show
              when={overall().messages > 0}
              fallback={<text fg={th().textMuted}>No user messages in this range.</text>}
            >
              <scrollbox
                ref={(el: ScrollBoxRenderable) => {
                  scroller = el;
                }}
                flexGrow={1}
              >
                <box flexDirection="column" gap={1} flexShrink={0} width={width() - BODY_INSET}>
                  <Cards cards={cards()} th={th} />
                  {judgePanel()}
                  {tablePanel()}
                  {trendPanel()}
                </box>
              </scrollbox>
            </Show>
          </Match>
        </Switch>
      </box>
    );
  });

  onCleanup(() => {
    unregisterCommands();
    unregisterRoute();
  });
}
