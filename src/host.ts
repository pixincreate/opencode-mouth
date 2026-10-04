import type { TuiPluginApi, TuiToast } from "@opencode-ai/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "@opentui/solid";
import type { SessionMessageInfo } from "@opencode/client";
import type { MessageSample } from "./aggregate.ts";
import { JUDGE_RESPONSE_SCHEMA, JUDGE_SYSTEM_PROMPT, type JudgeModel, type JudgeRequest } from "./judge.ts";
import { palette, type Palette } from "./theme.ts";
import { v2Samples } from "./messages.ts";

export interface ScopeOptions {
  sessionLimit: number;
  scope: "project" | "directory" | "global";
}

export interface Command {
  id: string;
  title: string;
  group: string;
  bind: string;
  run(): void;
}

/** Palette entry a route registers under the "Mouth" category. */
export interface PaletteCommand {
  id: string;
  title: string;
  description: string;
  slash: string;
}

export interface Host {
  options: unknown;
  theme(): Palette;
  sessions(options: ScopeOptions): Promise<{ target: string; list: Array<{ samples(): Promise<MessageSample[]> }> }>;
  toast(input: TuiToast): void;
  select(input: { title: string; options: Array<{ title: string; value: string; description: string }> }): Promise<string | undefined>;
  current(): { name?: string; restore(): void };
  navigate(name: string): void;
  commands(route: string, mode: string, open: () => void, commands: Command[], palette: PaletteCommand): () => void;
  route(name: string, render: () => JSX.Element): () => void;
  pushMode(mode: string): () => void;
  /** Every model the judge can run on, with pricing for the estimate. */
  judgeModels(): Promise<JudgeModel[]>;
  /** The configured default model, when the host knows one. */
  defaultJudgeModel(): Promise<{ providerID: string; modelID: string } | undefined>;
  /** One raw judge request: send the prompt, return the model's reply text. */
  judge(input: JudgeRequest): Promise<string>;
}

export function v1Host(api: TuiPluginApi, options: unknown): Host {
  return {
    options,
    theme: () => api.theme.current,
    async sessions(opts) {
      const response = await api.client.session.list({
        limit: opts.sessionLimit,
        roots: true,
        ...(opts.scope === "project" ? { scope: "project" as const } : {}),
      }, { throwOnError: true });
      return {
        target: api.state.path.directory,
        list: (response.data ?? []).map((session) => ({
          async samples() {
            const response = await api.client.session.messages({ sessionID: session.id }, { throwOnError: true });
            return (response.data ?? []).flatMap(({ info, parts }) => {
              const text = parts.filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
                .map((part) => part.type === "text" ? part.text : "").join("\n");
              if (!text.trim()) return [];
              const model = info.role === "user" ? info.model : { providerID: info.providerID, modelID: info.modelID };
              return [{ role: info.role, providerID: model?.providerID ?? "unknown", modelID: model?.modelID ?? "unknown", created: info.time.created, text }];
            });
          },
        })),
      };
    },
    toast: (input) => api.ui.toast(input),
    select: (input) => new Promise((resolve) => {
      api.ui.dialog.setSize("medium");
      api.ui.dialog.replace(() => api.ui.DialogSelect<string>({
        ...input,
        onSelect(option) {
          resolve(option.value);
          api.ui.dialog.clear();
        },
      }), () => resolve(undefined));
    }),
    current() {
      const current = api.route.current;
      return { name: current.name, restore: () => api.route.navigate(current.name, "params" in current ? current.params : undefined) };
    },
    navigate: (name) => api.route.navigate(name),
    commands(_route, mode, open, commands, palette) {
      const global = api.keymap.registerLayer({ commands: [{
        name: palette.id, title: palette.title, category: "Mouth",
        namespace: "palette", slashName: palette.slash, desc: palette.description, run: open,
      }] });
      const local = api.keymap.registerLayer({ mode, bindings: commands.flatMap((command) =>
        command.bind.split(",").map((key) => ({ key, cmd: command.run, desc: command.title }))),
      });
      return () => { local(); global(); };
    },
    route: (name, render) => api.route.register([{ name, render }]),
    pushMode: (mode) => api.mode.push(mode),
    async judgeModels() {
      const response = await api.client.config.providers({}, { throwOnError: true });
      return (response.data?.providers ?? []).flatMap((provider) =>
        Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
          providerID: provider.id,
          modelID,
          name: model.name ?? modelID,
          inputCost: model.cost?.input ?? 0,
          outputCost: model.cost?.output ?? 0,
        })),
      );
    },
    async defaultJudgeModel() {
      const response = await api.client.config.providers({}, { throwOnError: true });
      const first = Object.entries(response.data?.default ?? {})[0];
      return first ? { providerID: first[0], modelID: first[1] } : undefined;
    },
    async judge({ model, prompt, signal }) {
      const created = await api.client.session.create({
        title: "mouth judge",
        model: { id: model.modelID, providerID: model.providerID },
      }, { throwOnError: true });
      const sessionID = created.data?.id;
      if (!sessionID) throw new Error("could not create a judge session");
      try {
        const response = await api.client.session.prompt({
          sessionID,
          model: { providerID: model.providerID, modelID: model.modelID },
          system: JUDGE_SYSTEM_PROMPT,
          tools: {},
          format: { type: "json_schema", schema: JUDGE_RESPONSE_SCHEMA, retryCount: 1 },
          parts: [{ type: "text", text: prompt }],
        }, { throwOnError: true, signal });
        return (response.data?.parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      } finally {
        await api.client.session.delete({ sessionID }, { throwOnError: false }).catch(() => undefined);
      }
    },
  };
}

export function v2Host(context: Context): Host {
  return {
    options: context.options,
    theme: () => palette(context.theme),
    async sessions(opts) {
      const directory = context.location?.directory ?? context.data.location.default().directory;
      const filter = opts.scope === "directory" ? { directory }
        : { project: (await context.client.location.get({ location: { directory } })).project.id };
      const response = await context.client.session.list({ limit: opts.sessionLimit, order: "desc", parentID: null, ...filter });
      return {
        target: directory,
        list: (response.data ?? []).map((session) => ({
          async samples() {
            const messages: SessionMessageInfo[] = [];
            let cursor: string | undefined;
            do {
              const response = await context.client.message.list({ sessionID: session.id, ...(cursor ? { cursor } : { order: "asc" as const }) });
              if (!response.data?.length) break;
              messages.push(...response.data);
              cursor = response.cursor?.next ?? undefined;
            } while (cursor);
            return v2Samples(messages, session.model);
          },
        })),
      };
    },
    toast: (input) => context.ui.toast.show(input),
    select: (input) => {
      context.ui.dialog.set({ size: "medium" });
      return context.ui.dialog.select<string>(input);
    },
    current() {
      const current = { ...context.ui.router.current() };
      return { name: current.type === "plugin" ? current.name : current.type, restore: () => context.ui.router.navigate(current) };
    },
    navigate: (name) => context.ui.router.navigate(name === "home" ? { type: "home" } : { type: "plugin", name }),
    commands(_route, mode, open, commands, palette) {
      return context.ui.slot({ append: "app", render() {
        context.keymap.layer(() => ({ mode: "global", commands: [{
          id: palette.id, title: palette.title, group: "Mouth", palette: true,
          description: palette.description, slash: { name: palette.slash }, run: open,
        }], bindings: [palette.id] }));
        context.keymap.layer(() => ({ mode, commands, bindings: [...commands.map((command) => command.id), "app.exit"] }));
        return null;
      } });
    },
    route: (name, render) => context.ui.router.register({ name, render }),
    pushMode: (mode) => context.keymap.mode.push(mode),
    async judgeModels() {
      const response = await context.client.model.list({});
      return (response.data ?? [])
        .filter((model) => model.enabled)
        .map((model) => {
          const cost = model.cost.find((entry) => !entry.tier) ?? model.cost[0];
          return {
            providerID: model.providerID,
            modelID: model.modelID,
            name: model.name,
            inputCost: cost?.input ?? 0,
            outputCost: cost?.output ?? 0,
          };
        });
    },
    async defaultJudgeModel() {
      const response = await context.client.model.default();
      return response.data ? { providerID: response.data.providerID, modelID: response.data.modelID } : undefined;
    },
    async judge({ model, prompt, signal }) {
      const response = await context.client.generate.text(
        { prompt, model: { id: model.modelID, providerID: model.providerID } },
        { signal },
      );
      return response.text;
    },
  };
}
