import type { TuiPluginApi, TuiToast } from "@opencode-ai/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "@opentui/solid";
import type { SessionMessageInfo } from "@opencode/client";
import type { MessageSample } from "./aggregate.ts";
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

export interface Host {
  options: unknown;
  theme(): Palette;
  sessions(options: ScopeOptions): Promise<Array<{ samples(): Promise<MessageSample[]> }>>;
  toast(input: TuiToast): void;
  select(input: { title: string; options: Array<{ title: string; value: string; description: string }> }): Promise<string | undefined>;
  current(): { name?: string; restore(): void };
  navigate(name: string): void;
  commands(route: string, mode: string, open: () => void, commands: Command[]): () => void;
  route(name: string, render: () => JSX.Element): () => void;
  pushMode(mode: string): () => void;
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
      return (response.data ?? []).map((session) => ({
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
      }));
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
    commands(_route, mode, open, commands) {
      const global = api.keymap.registerLayer({ commands: [{
        name: "mouth.behavior.open", title: "Mouth: behavior dashboard", category: "Mouth",
        namespace: "palette", slashName: "behavior", desc: "Measure profanity and friction in your sessions", run: open,
      }] });
      const local = api.keymap.registerLayer({ mode, bindings: commands.flatMap((command) =>
        command.bind.split(",").map((key) => ({ key, cmd: command.run, desc: command.title }))),
      });
      return () => { local(); global(); };
    },
    route: (name, render) => api.route.register([{ name, render }]),
    pushMode: (mode) => api.mode.push(mode),
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
      return (response.data ?? []).map((session) => ({
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
      }));
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
    commands(_route, mode, open, commands) {
      return context.ui.slot({ append: "app", render() {
        context.keymap.layer(() => ({ mode: "global", commands: [{
          id: "mouth.behavior.open", title: "Mouth: behavior dashboard", group: "Mouth", palette: true,
          description: "Measure profanity and friction in your sessions", slash: { name: "behavior" }, run: open,
        }], bindings: ["mouth.behavior.open"] }));
        context.keymap.layer(() => ({ mode, commands, bindings: [...commands.map((command) => command.id), "app.exit"] }));
        return null;
      } });
    },
    route: (name, render) => context.ui.router.register({ name, render }),
    pushMode: (mode) => context.keymap.mode.push(mode),
  };
}
