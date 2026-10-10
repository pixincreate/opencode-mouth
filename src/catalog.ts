/**
 * Model catalog: a reviewed subset of oh-my-pi's pi-catalog
 * (packages/catalog, MIT) plus upstream's Frustration row merge
 * (packages/stats/src/frustration.ts, mergeFrustrationRows).
 *
 * The dashboard keeps one row per catalog identity (class/family/revision)
 * when a model can be classified, so variants served by different providers
 * merge into one model-version row like upstream. Models outside the table
 * keep one row per raw model id, also like upstream.
 */
import type { FrustrationCounts, FrustrationModelStats } from "./stats-db.ts";

/** Catalog identity of a model id, in pi-catalog terms. */
export interface ModelIdentity {
  modelClass: string;
  family?: string;
  revision?: string;
}

/** One merged dashboard row: a catalog identity or a raw model id. */
export interface MergedModelRow extends FrustrationCounts {
  key: string;
  label: string;
  modelClass: string | null;
  family: string | null;
  revision: string | null;
  /** Distinct raw model ids behind this row. */
  models: string[];
  firstSeen: number;
}

// --- revision helpers (ported from pi-catalog src/compat/revision.ts) --------

function parseComponent(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) return undefined;
  const component = Number(value);
  return component <= 255 ? component : undefined;
}

const fillRevision = (parts: readonly number[]): [number, number, number] => [
  parts[0] ?? 0,
  parts[1] ?? 0,
  parts[2] ?? 0,
];

/** Parse "4.5.0"-style text: one to three dot/dash separated components. */
function parseRevision(value: string): [number, number, number] | undefined {
  const parts = value.split(/[.-]/);
  if (parts.length < 1 || parts.length > 3) return undefined;
  const parsed: number[] = [];
  for (const part of parts) {
    const component = parseComponent(part);
    if (component === undefined) return undefined;
    parsed.push(component);
  }
  return fillRevision(parsed);
}

/**
 * Parse a version that starts at the first character and stop at the first
 * segment that is not a version component. Dates and billing suffixes are
 * ignored, and size tokens like "32b" never become a revision.
 */
function parseRevisionPrefix(value: string): [number, number, number] | undefined {
  if (!/^[0-9]/.test(value)) return undefined;
  const parsed: number[] = [];
  let index = 0;
  while (parsed.length < 3) {
    const start = index;
    while (index < value.length && value.charAt(index) >= "0" && value.charAt(index) <= "9") index++;
    if (index === start) break;
    const next = value.charAt(index);
    if (next === "b" || next === "B") break;
    const component = parseComponent(value.slice(start, index));
    if (component === undefined) break;
    parsed.push(component);
    if (parsed.length === 3) break;
    const separator = value.charAt(index);
    const digit = value.charAt(index + 1);
    if ((separator !== "." && separator !== "-") || !/^[0-9]$/.test(digit)) break;
    index++;
  }
  return parsed.length > 0 ? fillRevision(parsed) : undefined;
}

function compareRevision(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);
}

function formatRevision(revision: readonly number[]): string {
  return `${revision[0] ?? 0}.${revision[1] ?? 0}.${revision[2] ?? 0}`;
}

/** Drop trailing ".0" components so "4.0.0" shows as "4" and "4.5.0" as "4.5". */
function shortRevision(revision: string): string {
  return revision.replace(/(?:\.0)+$/, "");
}

// --- matchers (ported from pi-catalog src/compat/taxonomy.ts) ----------------

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globPattern = (glob: string): RegExp =>
  new RegExp(`^${glob.split("*").map(escapeRegExp).join(".*")}$`);

/** True when `token` equals `value` or starts it at a word boundary. */
function boundedMatch(value: string, token: string): boolean {
  if (value === token) return true;
  if (!value.startsWith(token)) return false;
  return /[-_.:0-9]/.test(value.charAt(token.length));
}

const bareOf = (model: string): string => model.slice(model.lastIndexOf("/") + 1);

type MatcherKind = "exact" | "bounded" | "namespace" | "prefix" | "glob";

/** Higher wins; matches pi-catalog's matcher ranking. */
const MATCHER_RANK: Record<MatcherKind, number> = { exact: 4, bounded: 3, namespace: 2, prefix: 1, glob: 0 };

function matches(kind: MatcherKind, candidate: string, token: string): boolean {
  if (kind === "exact") return candidate === token;
  if (kind === "bounded") return boundedMatch(candidate, token);
  if (kind === "namespace") return candidate.startsWith(`${token}/`);
  if (kind === "prefix") return candidate.startsWith(token);
  return globPattern(token).test(candidate);
}

// --- class rules (reviewed subset of pi-catalog rules/taxonomy/) -------------

interface FamilyRule {
  family: string;
  glob: string;
  priority?: number;
}

interface RevisionRule {
  prefix: string;
  anywhere?: boolean;
}

interface ClassRule {
  name: string;
  exact?: readonly string[];
  bounded?: readonly string[];
  namespace?: readonly string[];
  prefix?: readonly string[];
  glob?: readonly string[];
  skipBare?: readonly string[];
  families: readonly FamilyRule[];
  revisions: readonly RevisionRule[];
}

/**
 * Classes without a revision rule (kimi, minimax, mistral) can never produce
 * a merged row: like upstream, the merge only groups identities that carry
 * a revision, so those classes stay one row per raw model id.
 */
const CLASS_RULES: readonly ClassRule[] = [
  {
    name: "deepseek",
    namespace: ["deepseek"],
    bounded: ["deepseek"],
    families: [
      { family: "r1", glob: "*deepseek-r1*" },
      { family: "reasoner", glob: "*deepseek-reasoner*" },
      { family: "flash", glob: "*deepseek*v4*flash*" },
      { family: "flash", glob: "*deepseek-flash" },
      { family: "pro", glob: "*deepseek*v4*pro*" },
      { family: "v4", glob: "*deepseek-v4*" },
      { family: "v3", glob: "*deepseek-v3*" },
    ],
    revisions: [{ prefix: "deepseek-v", anywhere: true }],
  },
  {
    name: "anthropic",
    namespace: ["anthropic"],
    bounded: ["anthropic", "claude"],
    families: [
      { family: "opus", glob: "*opus*" },
      { family: "sonnet", glob: "*sonnet*" },
      { family: "haiku", glob: "*haiku*" },
      { family: "fable", glob: "*fable*" },
      { family: "mythos", glob: "*mythos*" },
    ],
    revisions: [{ prefix: "claude-", anywhere: true }],
  },
  {
    name: "openai",
    namespace: ["openai"],
    exact: ["o1", "o3", "o4"],
    prefix: ["gpt-", "chatgpt-", "codex-", "o1-", "o1.", "o3-", "o3.", "o4-", "o4."],
    skipBare: ["o1", "o3", "o4"],
    families: [
      { family: "gpt", glob: "gpt-*" },
      { family: "chatgpt", glob: "chatgpt-*" },
      { family: "codex-spark", glob: "*codex-spark*", priority: 20 },
      { family: "codex", glob: "*codex*", priority: 10 },
      { family: "o-series", glob: "o1" },
      { family: "o-series", glob: "o1-*" },
      { family: "o-series", glob: "o1.*" },
      { family: "o-series", glob: "o3" },
      { family: "o-series", glob: "o3-*" },
      { family: "o-series", glob: "o3.*" },
      { family: "o-series", glob: "o4" },
      { family: "o-series", glob: "o4-*" },
      { family: "o-series", glob: "o4.*" },
    ],
    revisions: [{ prefix: "chatgpt-" }, { prefix: "gpt-", anywhere: true }, { prefix: "o" }],
  },
  {
    name: "gemini",
    bounded: ["gemini"],
    families: [
      { family: "lite", glob: "*flash-lite*", priority: 10 },
      { family: "flash", glob: "*flash*" },
      { family: "pro", glob: "*pro*" },
    ],
    revisions: [{ prefix: "gemini-" }],
  },
  {
    name: "xai",
    namespace: ["x-ai", "xai"],
    bounded: ["grok"],
    prefix: ["cursor-grok-"],
    families: [{ family: "grok", glob: "*grok*" }],
    revisions: [{ prefix: "cursor-grok-" }, { prefix: "grok-", anywhere: true }],
  },
  {
    name: "qwen",
    bounded: ["qwen", "deepseek-r1-distill-qwen"],
    glob: ["*distill-qwen*"],
    families: [
      { family: "qwq", glob: "*qwq*" },
      { family: "coder", glob: "*qwen3-coder*" },
      { family: "next", glob: "*qwen*next*" },
      { family: "omni", glob: "*qwen*omni*" },
      { family: "vl", glob: "*qwen*vl*" },
      { family: "qwenlong", glob: "*qwenlong*" },
    ],
    revisions: [{ prefix: "qwen" }],
  },
  {
    name: "kimi",
    namespace: ["moonshotai"],
    bounded: ["kimi"],
    exact: ["k3", "k3-256k"],
    families: [
      { family: "k2.7-code", glob: "*kimi-k2.7-code*" },
      { family: "k2.6", glob: "*kimi-k2.6*" },
      { family: "k2.5", glob: "*kimi-k2.5*" },
      { family: "k2-thinking", glob: "*kimi-k2-thinking*" },
      { family: "k2", glob: "*kimi-k2*" },
      { family: "k3", glob: "*kimi-k3*" },
    ],
    revisions: [],
  },
  {
    name: "glm",
    bounded: ["glm", "zai-glm"],
    families: [
      { family: "vision", glob: "*glm-5v*", priority: 20 },
      { family: "flash", glob: "*glm*flash*" },
      { family: "air", glob: "*glm*air*" },
      { family: "turbo", glob: "*glm*turbo*" },
    ],
    revisions: [{ prefix: "glm-", anywhere: true }],
  },
  {
    name: "minimax",
    namespace: ["minimax"],
    bounded: ["minimax", "hailuo"],
    families: [
      { family: "m1", glob: "*minimax-m1*" },
      { family: "m2", glob: "*minimax-m2*" },
      { family: "m3", glob: "*minimax-m3*" },
    ],
    revisions: [],
  },
  {
    name: "mistral",
    bounded: ["mistral", "mixtral"],
    families: [
      { family: "mistral", glob: "*mistral*" },
      { family: "mixtral", glob: "*mixtral*" },
    ],
    revisions: [],
  },
  {
    name: "meta",
    namespace: ["meta-llama"],
    bounded: ["muse-spark", "llama"],
    families: [
      { family: "llama", glob: "*llama*" },
      { family: "muse-spark", glob: "*muse-spark*" },
    ],
    revisions: [{ prefix: "muse-spark-" }],
  },
];

/** Provider-scoped aliases pinned by oh-my-pi PR #14199. */
const OVERRIDES: ReadonlyArray<{ provider: string; model: string; identity: ModelIdentity }> = [
  {
    provider: "deepseek",
    model: "deepseek-flash",
    identity: { modelClass: "deepseek", family: "flash", revision: "4.1.0" },
  },
  {
    provider: "opencode-go",
    model: "deepseek-flash",
    identity: { modelClass: "deepseek", family: "flash", revision: "4.1.0" },
  },
];

function scoreClass(rule: ClassRule, candidates: readonly string[]): { rank: number; length: number } | undefined {
  let best: { rank: number; length: number } | undefined;
  const kinds: ReadonlyArray<readonly [MatcherKind, readonly string[] | undefined]> = [
    ["exact", rule.exact],
    ["bounded", rule.bounded],
    ["namespace", rule.namespace],
    ["prefix", rule.prefix],
    ["glob", rule.glob],
  ];
  for (const [kind, tokens] of kinds) {
    for (const token of tokens ?? []) {
      for (const candidate of candidates) {
        if (!matches(kind, candidate, token)) continue;
        const rank = MATCHER_RANK[kind];
        if (!best || rank > best.rank || (rank === best.rank && token.length > best.length)) {
          best = { rank, length: token.length };
        }
      }
    }
  }
  return best;
}

function matchFamily(rule: ClassRule, bare: string, lenient: boolean): string | undefined {
  const hits = rule.families
    .filter((entry) => globPattern(entry.glob).test(bare))
    .map((entry) => ({ entry, specificity: entry.glob.replace(/\*/g, "").length }))
    .sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || b.specificity - a.specificity);
  const first = hits[0];
  if (!first) return undefined;
  const second = hits[1];
  const tied = second !== undefined
    && (first.entry.priority ?? 0) === (second.entry.priority ?? 0)
    && first.specificity === second.specificity;
  if (tied && lenient) return undefined;
  return first.entry.family;
}

function extractRevision(rule: ClassRule, bare: string): string | undefined {
  if (rule.skipBare?.includes(bare)) return undefined;
  for (const revisionRule of rule.revisions) {
    let tail: string | undefined;
    if (revisionRule.anywhere) {
      const index = bare.indexOf(revisionRule.prefix);
      if (index >= 0) tail = bare.slice(index + revisionRule.prefix.length);
    } else if (bare.startsWith(revisionRule.prefix)) {
      tail = bare.slice(revisionRule.prefix.length);
    }
    if (tail === undefined) continue;
    const digit = tail.search(/[0-9]/);
    if (digit < 0) return undefined;
    const parsed = parseRevisionPrefix(tail.slice(digit));
    return parsed ? formatRevision(parsed) : undefined;
  }
  return undefined;
}

/**
 * Resolve a provider/model pair to a catalog identity. Unknown models keep
 * `modelClass: "unknown"`. In lenient mode (what the merge uses) ambiguous
 * matches resolve to unknown instead of guessing.
 */
export function classifyModel(provider: string, model: string, options?: { lenient?: boolean }): ModelIdentity {
  const lenient = options?.lenient ?? false;
  const input = model.toLowerCase();
  const providerID = provider.toLowerCase();
  const bare = bareOf(input);
  for (const override of OVERRIDES) {
    if (override.provider === providerID && (override.model === input || override.model === bare)) {
      return { ...override.identity };
    }
  }
  const candidates = [...new Set([bare, input, providerID, `${providerID}/${input}`])];
  const scored: Array<{ rule: ClassRule; rank: number; length: number }> = [];
  for (const rule of CLASS_RULES) {
    const score = scoreClass(rule, candidates);
    if (score) scored.push({ rule, ...score });
  }
  if (scored.length === 0) return { modelClass: "unknown" };
  const maxRank = Math.max(...scored.map((entry) => entry.rank));
  const top = scored.filter((entry) => entry.rank === maxRank);
  const maxLength = Math.max(...top.map((entry) => entry.length));
  const best = top.filter((entry) => entry.length === maxLength);
  if (best.length > 1 && lenient) return { modelClass: "unknown" };
  const rule = best[0].rule;
  const family = matchFamily(rule, bare, lenient);
  const revision = extractRevision(rule, bare);
  return {
    modelClass: rule.name,
    ...(family !== undefined ? { family } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function compareModelRows(a: MergedModelRow, b: MergedModelRow): number {
  if ((a.modelClass !== null) !== (b.modelClass !== null)) return a.modelClass !== null ? -1 : 1;
  if (a.modelClass !== null && b.modelClass !== null) {
    if (a.modelClass !== b.modelClass) return a.modelClass < b.modelClass ? -1 : 1;
    const revision = compareRevision(
      parseRevision(a.revision ?? "") ?? [0, 0, 0],
      parseRevision(b.revision ?? "") ?? [0, 0, 0],
    );
    if (revision !== 0) return revision;
    return (a.family ?? "").localeCompare(b.family ?? "");
  }
  return a.firstSeen - b.firstSeen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Merge per-(model, provider) rows into catalog identities, like upstream's
 * mergeFrustrationRows: classified identities merge by class/family/revision,
 * everything else merges by raw model id. Counts sum, firstSeen keeps the
 * earliest sighting, and classified rows sort first.
 */
export function mergeModelRows(rows: readonly FrustrationModelStats[]): MergedModelRow[] {
  const merged = new Map<string, MergedModelRow>();
  for (const row of rows) {
    const identity = classifyModel(row.provider, row.model, { lenient: true });
    const classified = identity.modelClass !== "unknown" && identity.revision !== undefined;
    const key = classified ? `${identity.modelClass}/${identity.family ?? ""}/${identity.revision}` : row.model;
    const existing = merged.get(key);
    if (existing) {
      existing.messages += row.messages;
      existing.judged += row.judged;
      existing.annoyed += row.annoyed;
      existing.atAssistant += row.atAssistant;
      existing.angry += row.angry;
      existing.firstSeen = Math.min(existing.firstSeen, row.firstSeen);
      if (!existing.models.includes(row.model)) existing.models.push(row.model);
      continue;
    }
    merged.set(key, {
      key,
      label: classified
        ? [identity.family, shortRevision(identity.revision!)].filter(Boolean).join(" ")
        : row.model,
      modelClass: classified ? identity.modelClass : null,
      family: identity.family ?? null,
      revision: identity.revision ?? null,
      models: [row.model],
      firstSeen: row.firstSeen,
      messages: row.messages,
      judged: row.judged,
      annoyed: row.annoyed,
      atAssistant: row.atAssistant,
      angry: row.angry,
    });
  }
  return [...merged.values()].sort(compareModelRows);
}
