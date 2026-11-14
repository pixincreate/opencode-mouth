/**
 * Model catalog rules ported from oh-my-pi (can1357/oh-my-pi, MIT).
 *
 * Generated from packages/catalog/src/compat/rules/taxonomy/*.kdl at the
 * commits pinned in upstream.json. Keep this file aligned with upstream
 * when the upstream-watch issue reports drift.
 */

export interface NamespaceRule {
  token: string;
  bounded?: boolean;
}

export interface FamilyRule {
  family: string;
  glob: string;
  priority?: number;
}

export interface RevisionRule {
  prefix: string;
  anywhere?: boolean;
}

export interface ClassRule {
  name: string;
  exact?: readonly string[];
  bounded?: readonly string[];
  namespace?: readonly NamespaceRule[];
  prefix?: readonly string[];
  glob?: readonly string[];
  skipBare?: readonly string[];
  families: readonly FamilyRule[];
  revisions: readonly RevisionRule[];
}

export interface OverrideRule {
  provider?: string;
  model?: string;
  glob?: string;
  logical?: string;
  modelClass?: string;
  family?: string;
  revision?: string;
  expiresAtMs?: number;
}

export interface CollapseSuffix {
  suffix: string;
  thinking?: boolean;
  effort?: string;
  exceptBarePrefix?: string;
}

export interface CollapseLane {
  suffix: string;
  providers: readonly string[];
  barePrefix?: string;
}

export interface EffortFamily {
  provider: string;
  logical: string;
  aliases: readonly string[];
}

export const CLASS_RULES: readonly ClassRule[] = [
  {
    name: "ai21",
    bounded: ["jamba"],
    namespace: [
    { token: "ai21" },
    ],
    families: [
    { family: "jamba", glob: "*jamba*" },
    ],
    revisions: [
    ],
  },
  {
    name: "amazon",
    bounded: ["nova", "titan"],
    namespace: [
    { token: "amazon", bounded: true },
    ],
    families: [
    { family: "nova", glob: "*nova*" },
    { family: "titan", glob: "*titan*" },
    ],
    revisions: [
    ],
  },
  {
    name: "anthropic",
    bounded: ["anthropic", "claude"],
    namespace: [
    { token: "anthropic", bounded: true },
    ],
    families: [
    { family: "opus", glob: "*opus*" },
    { family: "sonnet", glob: "*sonnet*" },
    { family: "haiku", glob: "*haiku*" },
    { family: "fable", glob: "*fable*" },
    { family: "mythos", glob: "*mythos*" },
    ],
    revisions: [
    { prefix: "claude-", anywhere: true },
    ],
  },
  {
    name: "baidu",
    bounded: ["ernie"],
    families: [
    { family: "ernie", glob: "*ernie*" },
    ],
    revisions: [
    ],
  },
  {
    name: "bytedance",
    bounded: ["doubao"],
    families: [
    { family: "doubao", glob: "*doubao*" },
    ],
    revisions: [
    ],
  },
  {
    name: "cohere",
    bounded: ["command"],
    namespace: [
    { token: "cohere" },
    ],
    families: [
    { family: "command", glob: "*command*" },
    ],
    revisions: [
    ],
  },
  {
    name: "deepseek",
    bounded: ["deepseek"],
    namespace: [
    { token: "deepseek", bounded: true },
    ],
    families: [
    { family: "r1", glob: "*deepseek-r1*" },
    { family: "reasoner", glob: "*deepseek-reasoner*" },
    { family: "flash", glob: "*deepseek*v4*flash*" },
    { family: "flash", glob: "*deepseek-flash" },
    { family: "pro", glob: "*deepseek*v4*pro*" },
    { family: "v4", glob: "*deepseek-v4*" },
    { family: "v3", glob: "*deepseek-v3*" },
    ],
    revisions: [
    { prefix: "deepseek-v", anywhere: true },
    ],
  },
  {
    name: "gemini",
    bounded: ["gemini"],
    families: [
    { family: "lite", glob: "*flash-lite*", priority: 10 },
    { family: "flash", glob: "*flash*" },
    { family: "pro", glob: "*pro*" },
    ],
    revisions: [
    { prefix: "gemini-" },
    ],
  },
  {
    name: "gemma",
    bounded: ["gemma"],
    families: [
    ],
    revisions: [
    { prefix: "gemma-" },
    ],
  },
  {
    name: "glm",
    bounded: ["glm", "zai-glm"],
    families: [
    { family: "flash", glob: "*flash*" },
    { family: "air", glob: "*air*" },
    { family: "turbo", glob: "*turbo*" },
    { family: "vision", glob: "*glm-5v*", priority: 20 },
    ],
    revisions: [
    { prefix: "glm-", anywhere: true },
    ],
  },
  {
    name: "gpt-oss",
    bounded: ["gpt-oss"],
    namespace: [
    { token: "gpt-oss", bounded: true },
    ],
    families: [
    { family: "120b", glob: "*gpt-oss-120b*" },
    { family: "20b", glob: "*gpt-oss-20b*" },
    ],
    revisions: [
    ],
  },
  {
    name: "kimi",
    exact: ["k3", "k3-256k"],
    bounded: ["kimi"],
    namespace: [
    { token: "moonshotai" },
    ],
    families: [
    { family: "k2", glob: "*kimi-k2*" },
    { family: "k2.5", glob: "*kimi-k2.5*", priority: 10 },
    { family: "k2.6", glob: "*kimi-k2.6*", priority: 10 },
    { family: "k2.6", glob: "*kimi-k2p6*", priority: 10 },
    { family: "k2.7-code", glob: "*kimi-k2.7-code*", priority: 10 },
    { family: "k2.7-code", glob: "*kimi-k2-7-code*", priority: 10 },
    { family: "k2.7-code", glob: "*kimi-k2p7*code*", priority: 10 },
    { family: "k2-thinking", glob: "*kimi-k2-thinking*", priority: 20 },
    { family: "k3", glob: "*kimi-k3*" },
    { family: "k3", glob: "k3" },
    { family: "k3", glob: "k3-256k" },
    ],
    revisions: [
    ],
  },
  {
    name: "meta",
    bounded: ["muse-spark", "muse-wonder", "muse-ember", "llama", "meta-llama"],
    namespace: [
    { token: "meta-llama" },
    ],
    families: [
    { family: "llama", glob: "*llama*" },
    { family: "muse-spark", glob: "*muse-spark*" },
    { family: "muse-wonder", glob: "*muse-wonder*" },
    { family: "muse-ember", glob: "*muse-ember*" },
    ],
    revisions: [
    { prefix: "muse-spark-" },
    { prefix: "muse-wonder-" },
    { prefix: "muse-ember-" },
    ],
  },
  {
    name: "mimo",
    bounded: ["mimo"],
    families: [
    { family: "v2", glob: "*mimo-v2*" },
    ],
    revisions: [
    ],
  },
  {
    name: "minimax",
    bounded: ["minimax", "hailuo"],
    namespace: [
    { token: "minimax" },
    ],
    families: [
    { family: "m1", glob: "*minimax-m1*" },
    { family: "m2", glob: "*minimax-m2*" },
    { family: "m3", glob: "*minimax-m3*" },
    ],
    revisions: [
    ],
  },
  {
    name: "mistral",
    bounded: ["mistral", "mixtral"],
    families: [
    { family: "mistral", glob: "*mistral*" },
    { family: "mixtral", glob: "*mixtral*" },
    ],
    revisions: [
    ],
  },
  {
    name: "openai",
    exact: ["o1", "o3", "o4"],
    namespace: [
    { token: "openai" },
    { token: "openai", bounded: true },
    ],
    prefix: ["gpt-", "chatgpt-", "codex-", "o1-", "o1.", "o3-", "o3.", "o4-", "o4."],
    skipBare: ["o1", "o3", "o4"],
    families: [
    { family: "gpt", glob: "gpt-*" },
    { family: "chatgpt", glob: "chatgpt-*" },
    { family: "gpt-image", glob: "gpt-image-*" },
    { family: "gpt-image", glob: "chatgpt-image-*" },
    { family: "o-series", glob: "o1" },
    { family: "o-series", glob: "o1-*" },
    { family: "o-series", glob: "o1.*" },
    { family: "o-series", glob: "o3" },
    { family: "o-series", glob: "o3-*" },
    { family: "o-series", glob: "o3.*" },
    { family: "o-series", glob: "o4" },
    { family: "o-series", glob: "o4-*" },
    { family: "o-series", glob: "o4.*" },
    { family: "codex", glob: "*codex*", priority: 10 },
    { family: "codex-spark", glob: "*codex-spark*", priority: 20 },
    ],
    revisions: [
    { prefix: "chatgpt-" },
    { prefix: "gpt-", anywhere: true },
    { prefix: "o" },
    ],
  },
  {
    name: "qwen",
    bounded: ["qwen", "deepseek-r1-distill-qwen"],
    glob: ["*distill-qwen*"],
    families: [
    { family: "qwq", glob: "*qwq*" },
    { family: "coder", glob: "*qwen3-coder*" },
    { family: "next", glob: "*qwen3-next*" },
    { family: "omni", glob: "*qwen3-omni*" },
    { family: "vl", glob: "*qwen3-vl*" },
    { family: "qwenlong", glob: "*qwenlong*" },
    ],
    revisions: [
    { prefix: "qwen" },
    ],
  },
  {
    name: "stepfun",
    bounded: ["step"],
    families: [
    { family: "step", glob: "*step*" },
    ],
    revisions: [
    ],
  },
  {
    name: "unknown",
    families: [
    ],
    revisions: [
    ],
  },
  {
    name: "xai",
    bounded: ["grok"],
    namespace: [
    { token: "x-ai" },
    { token: "xai", bounded: true },
    ],
    prefix: ["cursor-grok-"],
    families: [
    { family: "grok", glob: "*grok*" },
    ],
    revisions: [
    { prefix: "cursor-grok-" },
    { prefix: "grok-", anywhere: true },
    ],
  },
];

export const OVERRIDES: readonly OverrideRule[] = [
  { provider: "nanogpt", model: "Gemma-4-31B-Claude-4.6-Opus-Reasoning-Distilled", logical: "Gemma-4-31B-Claude-4.6-Opus-Reasoning-Distilled", modelClass: "anthropic", family: "opus" },
  { provider: "nanogpt", model: "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-Derestricted", logical: "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-Derestricted", modelClass: "anthropic", family: "opus" },
  { provider: "nanogpt", model: "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-Derestricted-Lite", logical: "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-Derestricted-Lite", modelClass: "anthropic", family: "opus" },
  { provider: "deepseek", model: "deepseek-flash", modelClass: "deepseek", family: "flash", revision: "4.1.0" },
  { provider: "opencode-go", model: "deepseek-flash", modelClass: "deepseek", family: "flash", revision: "4.1.0" },
  { provider: "vercel-ai-gateway", model: "deepseek-v3.2-thinking", logical: "deepseek/deepseek-v3.2-thinking", modelClass: "deepseek" },
  { provider: "opencode-zen", model: "big-pickle", modelClass: "deepseek" },
  { provider: "umans", model: "umans-deepseek-v4-flash-0731", logical: "umans-deepseek-v4-flash-0731", modelClass: "deepseek" },
  { provider: "umans", model: "umans-deepseek-v4-flash-0731-lab", logical: "umans-deepseek-v4-flash-0731-lab", modelClass: "deepseek" },
  { provider: "venice", model: "e2ee-deepseek-v4-flash", logical: "e2ee-deepseek-v4-flash", modelClass: "deepseek" },
  { provider: "umans", model: "umans-glm-5.3-flash-lab", modelClass: "glm" },
  { provider: "abliteration", model: "abliterated-model-large-v2", modelClass: "glm", revision: "5.3.0" },
  { provider: "abliteration", model: "abliterated-model-large", modelClass: "glm", revision: "5.2.0" },
  { provider: "abliteration", model: "abliterated-model", modelClass: "glm" },
  { provider: "venice", model: "e2ee-gpt-oss-120b-p", logical: "e2ee-gpt-oss-120b-p", modelClass: "gpt-oss" },
  { provider: "venice", model: "e2ee-gpt-oss-20b-p", logical: "e2ee-gpt-oss-20b-p", modelClass: "gpt-oss" },
  { provider: "venice", model: "openai-gpt-oss-120b", logical: "openai-gpt-oss-120b", modelClass: "gpt-oss" },
  { glob: "*k3.1-pro", modelClass: "kimi", family: "k3", revision: "3.1.0" },
  { glob: "*k3.1-pro-highspeed", modelClass: "kimi", family: "k3", revision: "3.1.0" },
  { provider: "kilo", model: "kimi-k2-thinking", logical: "moonshotai/kimi-k2-thinking", modelClass: "kimi" },
  { provider: "openrouter", model: "kimi-k2-thinking", logical: "moonshotai/kimi-k2-thinking", modelClass: "kimi" },
  { provider: "vercel-ai-gateway", model: "kimi-k2-thinking", logical: "moonshotai/kimi-k2-thinking", modelClass: "kimi" },
  { provider: "venice", model: "xiaomi-mimo-v2-5", logical: "xiaomi-mimo-v2-5", modelClass: "mimo" },
  { model: "daybreak-blue-latest", logical: "daybreak-blue-latest", modelClass: "unknown", revision: "5.6.0", expiresAtMs: 1799712000000 },
  { model: "daybreak-red-latest", logical: "daybreak-red-latest", modelClass: "unknown", revision: "5.6.0", expiresAtMs: 1799712000000 },
  { model: "gpt-daybreak-blue-latest", logical: "gpt-daybreak-blue-latest", modelClass: "openai", revision: "5.6.0", expiresAtMs: 1799712000000 },
  { model: "gpt-daybreak-red-latest", logical: "gpt-daybreak-red-latest", modelClass: "openai", revision: "5.6.0", expiresAtMs: 1799712000000 },
  { provider: "yolo-auto", model: "yolo", modelClass: "qwen", revision: "3.8.0" },
  { glob: "*bonsai-27b*", modelClass: "qwen", revision: "3.6.0" },
  { glob: "*bonsai-2-27b*", modelClass: "qwen", revision: "3.8.0" },
  { provider: "kilo", model: "qwq-32b", logical: "qwen/qwq-32b", modelClass: "qwen" },
  { provider: "nanogpt", model: "EVA-Qwen2.5-32B-v0.2", logical: "EVA-UNIT-01/EVA-Qwen2.5-32B-v0.2", modelClass: "qwen" },
  { provider: "nanogpt", model: "EVA-Qwen2.5-72B-v0.2", logical: "EVA-UNIT-01/EVA-Qwen2.5-72B-v0.2", modelClass: "qwen" },
  { provider: "nanogpt", model: "QwenLong-L1-32B", logical: "Tongyi-Zhiwen/QwenLong-L1-32B", modelClass: "qwen" },
  { provider: "nanogpt", model: "dolphin-2.9.2-qwen2-72b", logical: "cognitivecomputations/dolphin-2.9.2-qwen2-72b", modelClass: "qwen" },
  { provider: "nanogpt", model: "cogito-v1-preview-qwen-32B", logical: "deepcogito/cogito-v1-preview-qwen-32B", modelClass: "qwen" },
  { provider: "nanogpt", model: "qwq-32b-preview", logical: "qwen/qwq-32b-preview", modelClass: "qwen" },
  { provider: "nanogpt", model: "GrayLine-Qwen3-8B", logical: "soob3123/GrayLine-Qwen3-8B", modelClass: "qwen" },
  { provider: "novita", model: "deepseek-r1-0528-qwen3-8b", logical: "deepseek/deepseek-r1-0528-qwen3-8b", modelClass: "qwen" },
  { provider: "openrouter", model: "qwq-32b", logical: "qwen/qwq-32b", modelClass: "qwen" },
  { provider: "umans", model: "umans-qwen3.6-35b-a3b", logical: "umans-qwen3.6-35b-a3b", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen-2-5-7b-p", logical: "e2ee-qwen-2-5-7b-p", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-30b-a3b-p", logical: "e2ee-qwen3-30b-a3b-p", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-5-122b-a10b", logical: "e2ee-qwen3-5-122b-a10b", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-6-27b", logical: "e2ee-qwen3-6-27b", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-6-35b-a3b", logical: "e2ee-qwen3-6-35b-a3b", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-6-35b-a3b-uncensored-p", logical: "e2ee-qwen3-6-35b-a3b-uncensored-p", modelClass: "qwen" },
  { provider: "venice", model: "e2ee-qwen3-vl-30b-a3b-p", logical: "e2ee-qwen3-vl-30b-a3b-p", modelClass: "qwen" },
];

export const COLLAPSE: {
  suffixes: readonly CollapseSuffix[];
  lanes: readonly CollapseLane[];
  effortFamilies: readonly EffortFamily[];
} = {
  suffixes: [
    { suffix: "-thinking", thinking: true },
    { suffix: "-extra-high", effort: "xhigh" },
    { suffix: "-none", effort: "off" },
    { suffix: "-minimal", effort: "minimal" },
    { suffix: "-medium", effort: "medium" },
    { suffix: "-xhigh", effort: "xhigh" },
    { suffix: "-high", effort: "high" },
    { suffix: "-low", effort: "low" },
    { suffix: "-max", effort: "max", exceptBarePrefix: "qwen" },
  ],
  lanes: [
    { suffix: "-fast", providers: ["cursor"] },
  ],
  effortFamilies: [
    { provider: "cursor", logical: "gpt-5.6-luna", aliases: [] },
    { provider: "cursor", logical: "gpt-5.6-sol", aliases: [] },
    { provider: "cursor", logical: "gpt-5.6-terra", aliases: [] },
  ],
};
