/**
 * Model catalog: a port of oh-my-pi's pi-catalog
 * (packages/catalog, MIT) plus upstream's Frustration row merge
 * (packages/stats/src/frustration.ts, mergeFrustrationRows).
 *
 * The dashboard keeps one row per catalog identity (class/family/revision)
 * when a model can be classified, so variants served by different providers
 * merge into one model-version row like upstream. Models outside the table
 * keep one row per raw model id, also like upstream.
 *
 * The rules and reviewed overrides live in `catalog-rules.ts`, generated from
 * the upstream KDL files pinned in `upstream.json`.
 */
import {
  CLASS_RULES,
  COLLAPSE,
  OVERRIDES,
  type ClassRule,
  type CollapseSuffix,
  type NamespaceRule,
  type OverrideRule,
} from "./catalog-rules.ts";
import type { FrustrationCounts, FrustrationModelStats } from "./stats-db.ts";

/** Catalog identity of a model id, in pi-catalog terms. */
export interface ModelIdentity {
  modelClass: string;
  family?: string;
  revision?: string;
  /** The id before variant suffixes were collapsed, when it differs. */
  logicalId?: string;
  /** The id named a thinking or reasoning variant. */
  thinkingVariant?: boolean;
  /** Effort tier from the variant suffix or lane. */
  effort?: string;
}

/** Two catalog matches tie and the caller asked for strict classification. */
export class AmbiguousIdentityError extends Error {
  readonly model: string;
  readonly first: string;
  readonly second: string;

  constructor(model: string, first: string, second: string, kind: "class" | "family" | "override") {
    super(`ambiguous ${kind} for \`${model}\`: \`${first}\` and \`${second}\` tie`);
    this.name = "AmbiguousIdentityError";
    this.model = model;
    this.first = first;
    this.second = second;
  }
}

/** One merged dashboard row: a catalog identity or a raw model id. */
export interface MergedModelRow extends FrustrationCounts {
  key: string;
  label: string;
  modelClass: string;
  family: string | null;
  revision: string | null;
  /** Distinct raw model ids behind this row. */
  models: string[];
  firstSeen: number;
}

/** Options for {@link classifyModel}. */
export interface ClassifyOptions {
  /**
   * Resolve ambiguous matches to unknown instead of guessing. The merge uses
   * this; strict callers throw AmbiguousIdentityError.
   */
  lenient?: boolean;
  /** Observation time for override expiry. When omitted, expiring aliases stay active. */
  observedAtMs?: number;
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
 * ignored, and a digit run followed by any ASCII letter (size or product
 * tokens like "32b" or "4o") never becomes a revision component.
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
    if (/[A-Za-z]/.test(next)) break;
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

/** True when a parsed revision is at least the given floor. */
export function revisionAtLeast(revision: string | undefined, floor: string): boolean {
  if (revision === undefined) return false;
  const parsedRevision = parseRevision(revision);
  const parsedFloor = parseRevision(floor);
  return parsedRevision !== undefined && parsedFloor !== undefined && compareRevision(parsedRevision, parsedFloor) >= 0;
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

/**
 * A namespace matcher looks at the whole provider-qualified id. Bounded
 * namespaces split on `/`, `.`, and `:` so Bedrock-style `vendor.model` ids
 * match; unbounded namespaces only compare `/`-separated parts.
 */
function namespaceMatches(entry: NamespaceRule, lower: string): boolean {
  const parts = entry.bounded ? lower.split(/[/.:]/) : lower.split("/");
  for (const part of parts) {
    if (!part) continue;
    if (entry.bounded ? boundedMatch(part, entry.token) : part === entry.token) return true;
  }
  return false;
}

function scoreClass(rule: ClassRule, lower: string, bare: string): { rank: number; length: number } | undefined {
  let best: { rank: number; length: number } | undefined;
  const consider = (kind: MatcherKind, token: string): void => {
    const rank = MATCHER_RANK[kind];
    if (!best || rank > best.rank || (rank === best.rank && token.length > best.length)) {
      best = { rank, length: token.length };
    }
  };
  for (const token of rule.exact ?? []) if (bare === token) consider("exact", token);
  for (const token of rule.bounded ?? []) if (boundedMatch(bare, token)) consider("bounded", token);
  for (const entry of rule.namespace ?? []) if (namespaceMatches(entry, lower)) consider("namespace", entry.token);
  for (const token of rule.prefix ?? []) if (bare.startsWith(token)) consider("prefix", token);
  for (const token of rule.glob ?? []) if (globPattern(token).test(bare)) consider("glob", token);
  return best;
}

interface FamilyRanking {
  family?: string;
  tied?: readonly [string, string];
}

function rankFamilies(rule: ClassRule, subject: string): FamilyRanking {
  let winner: { family: string; priority: number; specificity: number } | undefined;
  let tied: [string, string] | undefined;
  for (const entry of rule.families) {
    if (!globPattern(entry.glob).test(subject)) continue;
    const priority = entry.priority ?? 0;
    const specificity = entry.glob.replace(/\*/g, "").length;
    if (winner && priority === winner.priority && specificity === winner.specificity && entry.family !== winner.family) {
      tied = [winner.family, entry.family];
    } else if (
      !winner ||
      priority > winner.priority ||
      (priority === winner.priority && specificity > winner.specificity)
    ) {
      winner = { family: entry.family, priority, specificity };
      tied = undefined;
    }
  }
  return { family: winner?.family, tied };
}

/**
 * A Bedrock-style `vendor.model` id names the product after the class
 * namespace. Strip that prefix only for ambiguous family matches.
 */
function stripClassNamespace(rule: ClassRule, bare: string): string | undefined {
  const separator = bare.search(/[.:]/);
  if (separator <= 0 || separator === bare.length - 1) return undefined;
  const namespace = bare.slice(0, separator);
  const tokens = [
    ...(rule.exact ?? []),
    ...(rule.bounded ?? []),
    ...(rule.namespace ?? []).map((entry) => entry.token),
    ...(rule.prefix ?? []),
    ...(rule.glob ?? []),
  ];
  if (!tokens.includes(namespace)) return undefined;
  return bare.slice(separator + 1);
}

function classifyFamily(rule: ClassRule, bare: string, lenient: boolean, model: string): string | undefined {
  const initial = rankFamilies(rule, bare);
  if (initial.tied === undefined) return initial.family;
  const scoped = stripClassNamespace(rule, bare);
  if (scoped !== undefined) {
    const rescored = rankFamilies(rule, scoped);
    if (rescored.family !== undefined && rescored.tied === undefined) return rescored.family;
  }
  if (lenient) return undefined;
  throw new AmbiguousIdentityError(model, initial.tied[0], initial.tied[1], "family");
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

function classifyRanks(model: string, lenient: boolean): ModelIdentity {
  const lower = model.trim().toLowerCase();
  const bare = bareOf(lower);
  let winner: { rule: ClassRule; rank: number; length: number } | undefined;
  let tied: [string, string] | undefined;
  for (const rule of CLASS_RULES) {
    const score = scoreClass(rule, lower, bare);
    if (!score) continue;
    if (winner && score.rank === winner.rank && score.length === winner.length && rule.name !== winner.rule.name) {
      tied = [winner.rule.name, rule.name];
      continue;
    }
    if (!winner || score.rank > winner.rank || (score.rank === winner.rank && score.length > winner.length)) {
      winner = { rule, ...score };
      tied = undefined;
    }
  }
  if (!winner) return { modelClass: "unknown" };
  if (tied !== undefined) {
    if (lenient) return { modelClass: "unknown" };
    throw new AmbiguousIdentityError(lower, tied[0], tied[1], "class");
  }
  const family = classifyFamily(winner.rule, bare, lenient, lower);
  const revision = extractRevision(winner.rule, bare);
  return {
    modelClass: winner.rule.name,
    ...(family !== undefined ? { family } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

/** Infer family and revision for a known class, used to fill partial overrides. */
function ranksInClass(classId: string, model: string, lenient: boolean): Omit<ModelIdentity, "modelClass"> {
  const rule = CLASS_RULES.find((entry) => entry.name === classId);
  if (!rule) return {};
  const lower = model.trim().toLowerCase();
  const bare = bareOf(lower);
  const family = classifyFamily(rule, bare, lenient, lower);
  const revision = extractRevision(rule, bare);
  return {
    ...(family !== undefined ? { family } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function nonWildcardBytes(glob: string): number {
  let count = 0;
  for (const character of glob) if (character !== "*") count++;
  return count;
}

function overrideIsActive(override: OverrideRule, observedAtMs: number | undefined): boolean {
  return override.expiresAtMs === undefined || observedAtMs === undefined || observedAtMs < override.expiresAtMs;
}

interface PatternRanking {
  winner?: { specificity: number; override: OverrideRule };
  tied?: readonly [OverrideRule, OverrideRule];
}

function rankPatternOverrides(
  provider: string | undefined,
  bare: string,
  observedAtMs: number | undefined,
): PatternRanking {
  let winner: { specificity: number; override: OverrideRule } | undefined;
  let tied: [OverrideRule, OverrideRule] | undefined;
  for (const override of OVERRIDES) {
    if (override.glob === undefined || override.model !== undefined) continue;
    if (override.provider?.toLowerCase() !== provider) continue;
    if (!overrideIsActive(override, observedAtMs)) continue;
    if (!globPattern(override.glob).test(bare)) continue;
    const specificity = nonWildcardBytes(override.glob);
    if (winner && specificity === winner.specificity) {
      tied = [winner.override, override];
    } else if (!winner || specificity > winner.specificity) {
      winner = { specificity, override };
      tied = undefined;
    }
  }
  return { winner: tied === undefined ? winner : undefined, tied };
}

/**
 * Match a reviewed override: exact model ids first (provider-scoped before
 * provider-agnostic), then glob patterns by non-wildcard specificity.
 */
function findOverride(
  provider: string,
  bare: string,
  observedAtMs: number | undefined,
  lenient: boolean,
): OverrideRule | undefined {
  const lowerProvider = provider.toLowerCase();
  const lowerBare = bare.toLowerCase();
  for (const override of OVERRIDES) {
    if (override.model === undefined || override.model.toLowerCase() !== lowerBare) continue;
    if (override.provider?.toLowerCase() !== lowerProvider) continue;
    if (overrideIsActive(override, observedAtMs)) return override;
  }
  for (const override of OVERRIDES) {
    if (override.model === undefined || override.model.toLowerCase() !== lowerBare) continue;
    if (override.provider !== undefined) continue;
    if (overrideIsActive(override, observedAtMs)) return override;
  }
  let ranked = rankPatternOverrides(lowerProvider, lowerBare, observedAtMs);
  if (ranked.winner === undefined && ranked.tied === undefined) {
    ranked = rankPatternOverrides(undefined, lowerBare, observedAtMs);
  }
  if (ranked.tied !== undefined) {
    if (lenient) return undefined;
    const label = (override: OverrideRule): string => override.glob ?? override.model ?? "override";
    throw new AmbiguousIdentityError(lowerBare, label(ranked.tied[0]), label(ranked.tied[1]), "override");
  }
  return ranked.winner?.override;
}

interface CollapsedVariant {
  logicalId: string;
  thinkingVariant: boolean;
  effort?: string;
}

/**
 * Strip variant suffixes that name an effort, thinking mode, or lane, so the
 * identity describes the model weights rather than the request route. Ported
 * from upstream `collapseVariantId`; the override path never collapses.
 */
function collapseVariantId(provider: string, model: string): CollapsedVariant {
  const lower = model.toLowerCase();
  const lowerProvider = provider.toLowerCase();
  for (const family of COLLAPSE.effortFamilies) {
    if (family.provider !== lowerProvider) continue;
    if (family.aliases.includes(lower)) return { logicalId: family.logical, thinkingVariant: false };
  }
  const bare = bareOf(lower);
  let suffix: CollapseSuffix | undefined;
  for (const rule of COLLAPSE.suffixes) {
    if (!lower.endsWith(rule.suffix)) continue;
    if (rule.exceptBarePrefix !== undefined && bare.startsWith(rule.exceptBarePrefix)) continue;
    if (!suffix || rule.suffix.length > suffix.suffix.length) suffix = rule;
  }
  if (suffix) {
    return {
      logicalId: model.slice(0, model.length - suffix.suffix.length),
      thinkingVariant: suffix.thinking === true,
      ...(suffix.effort !== undefined ? { effort: suffix.effort } : {}),
    };
  }
  for (const lane of COLLAPSE.lanes) {
    if (!lane.providers.includes(lowerProvider)) continue;
    if (!lower.endsWith(lane.suffix)) continue;
    const trimmed = lower.slice(0, lower.length - lane.suffix.length);
    const trimmedBare = bareOf(trimmed);
    if (lane.barePrefix !== undefined && !trimmedBare.startsWith(lane.barePrefix)) continue;
    let effort: CollapseSuffix | undefined;
    for (const rule of COLLAPSE.suffixes) {
      if (rule.effort === undefined || !trimmed.endsWith(rule.suffix)) continue;
      if (rule.exceptBarePrefix !== undefined && trimmedBare.startsWith(rule.exceptBarePrefix)) continue;
      if (!effort || rule.suffix.length > effort.suffix.length) effort = rule;
    }
    if (effort === undefined) continue;
    const effortTier = effort.effort;
    if (effortTier === undefined) continue;
    const base = model.slice(0, trimmed.length - effort.suffix.length);
    if (!base || base.endsWith("/")) continue;
    return {
      logicalId: `${base}${model.slice(trimmed.length)}`,
      thinkingVariant: false,
      effort: effortTier,
    };
  }
  return { logicalId: model, thinkingVariant: false };
}

/**
 * Resolve a provider/model pair to a catalog identity. Unknown models keep
 * `modelClass: "unknown"`. In lenient mode (what the merge uses) ambiguous
 * matches resolve to unknown instead of throwing.
 */
export function classifyModel(provider: string, model: string, options?: ClassifyOptions): ModelIdentity {
  const lenient = options?.lenient ?? false;
  const observedAtMs = options?.observedAtMs;
  const trimmed = model.trim();
  const bare = bareOf(trimmed);
  const override = findOverride(provider, bare, observedAtMs, lenient);
  if (override) {
    const logical = override.logical ?? trimmed;
    const modelClass = override.modelClass ?? classifyRanks(logical, lenient).modelClass;
    const inferred = ranksInClass(modelClass, logical, lenient);
    const family = override.family ?? inferred.family;
    const revision = override.revision ?? inferred.revision;
    return {
      modelClass,
      ...(family !== undefined ? { family } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(logical !== trimmed ? { logicalId: logical } : {}),
    };
  }
  const collapsed =
    trimmed.length === model.length ? collapseVariantId(provider, trimmed) : { logicalId: trimmed, thinkingVariant: false };
  const identity = classifyRanks(collapsed.logicalId, lenient);
  return {
    ...identity,
    ...(collapsed.logicalId !== trimmed ? { logicalId: collapsed.logicalId } : {}),
    ...(collapsed.thinkingVariant ? { thinkingVariant: true } : {}),
    ...(collapsed.effort !== undefined ? { effort: collapsed.effort } : {}),
  };
}

function compareModelRows(a: MergedModelRow, b: MergedModelRow): number {
  const aRevision = a.revision ? parseRevision(a.revision) : undefined;
  const bRevision = b.revision ? parseRevision(b.revision) : undefined;
  if (!aRevision || !bRevision) {
    if (aRevision) return -1;
    if (bRevision) return 1;
    return a.firstSeen - b.firstSeen;
  }
  if (a.modelClass !== b.modelClass) return a.modelClass < b.modelClass ? -1 : 1;
  const revision = compareRevision(aRevision, bRevision);
  if (revision !== 0) return revision;
  const aFamily = a.family ?? "";
  const bFamily = b.family ?? "";
  return aFamily < bFamily ? -1 : aFamily > bFamily ? 1 : 0;
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
      modelClass: identity.modelClass,
      family: identity.family ?? null,
      revision: classified ? (identity.revision ?? null) : null,
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
