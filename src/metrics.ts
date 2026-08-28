/**
 * Behavior metric engine.
 *
 * Ported from oh-my-pi (https://github.com/can1357/oh-my-pi),
 * `packages/stats/src/user-metrics.ts`, MIT licensed.
 *
 * Pure and side-effect free.
 */

export interface BehaviorMetrics {
  /** Total characters of analyzed text. */
  chars: number;
  /** Whitespace-delimited word count. */
  words: number;
  /**
   * Number of "yelling" sentences: sentences where more than half of the
   * alphabetic characters are uppercase, with enough letters and either two
   * uppercase runs ("WHAT THE HELL") or one elongated run ("CMOOON") so a
   * lone acronym or env var does not register.
   */
  yelling: number;
  /** Profanity hits (word-boundary, case-insensitive). */
  profanity: number;
  /** Per-word profanity tally, lowercased. */
  profanityWords: Record<string, number>;
  /**
   * Catch-all "obviously upset" signal: drama runs (`!!!`), elongated
   * interjections (`noooo`, `ugh`, `wtfff`), standalone `dude`, and sad
   * emoticons (`:(`). User messages only.
   */
  anguish: number;
  /** Corrective negation: `nope` / `wrong` / `that's not what i meant`. User messages only. */
  negation: number;
  /** The user repeating themselves: `i said`, `still doesnt`. User messages only. */
  repetition: number;
  /** Direct reproach: `you didnt`, `why did you`, `stop X-ing`. User messages only. */
  blame: number;
}

/**
 * Words considered profane/aggressive. Word-boundary, case-insensitive.
 *
 * Broad English coverage: f-/s-word families and their censored variants,
 * mild swears, intelligence-based insults, body-part insults, British/
 * Australian/Irish slang, religious exclamations, and chat acronyms.
 * Curated to exclude racial, homophobic, and other identity slurs, and
 * words whose dominant use in a coding corpus is technical rather than
 * profane (`dummy` data, `blast` radius, config `knob`, `trash` bin,
 * CRUD, `garbage` files) or plain opinion (`useless`, `awful`, `meh`,
 * `hate`).
 */
const PROFANITY: readonly string[] = [
  // f-word family
  "fuck",
  "fucks",
  "fucked",
  "fucking",
  "fuckin",
  "fucker",
  "fuckers",
  "fuckup",
  "fuckups",
  "fuckhead",
  "fuckheads",
  "fuckface",
  "fuckwit",
  "fuckwits",
  "fucktard",
  "fuckery",
  "fuckoff",
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "clusterfuck",
  "ratfuck",
  "unfuck",
  // censored / euphemistic f-word
  "fk",
  "fks",
  "fking",
  "fkin",
  "fker",
  "fck",
  "fcks",
  "fcking",
  "fckin",
  "fcker",
  "fuk",
  "fuking",
  "fukin",
  "eff",
  "effs",
  "effed",
  "effing",
  "frick",
  "fricks",
  "fricked",
  "fricking",
  "frickin",
  "freaking",
  "freakin",
  "freaked",
  // s-word family
  "shit",
  "shits",
  "shat",
  "shitty",
  "shittier",
  "shittiest",
  "shite",
  "shites",
  "shited",
  "shitting",
  "shitter",
  "shitters",
  "shithead",
  "shitheads",
  "shitshow",
  "shitstorm",
  "shitstain",
  "shitfaced",
  "shitload",
  "shitbag",
  "shitcan",
  "shitcanned",
  "shitpost",
  "shitposting",
  "bullshit",
  "bullshits",
  "bullshitting",
  "bullshitter",
  "horseshit",
  "batshit",
  "dogshit",
  "dipshit",
  "jackshit",
  "dumbshit",
  "holyshit",
  // mild swears
  "damn",
  "damns",
  "damned",
  "damning",
  "dammit",
  "goddamn",
  "goddamned",
  "goddamnit",
  "goddammit",
  "darn",
  "darns",
  "darned",
  "darnit",
  "dang",
  "danged",
  "dangit",
  "hell",
  "hells",
  "heck",
  "hecks",
  "heckin",
  "gosh",
  "bloody",
  "bollocks",
  "bollox",
  // crap family
  "crap",
  "craps",
  "crappy",
  "crappier",
  "crappiest",
  "crapped",
  "crapping",
  "crapload",
  "crapola",
  // piss family
  "piss",
  "pisses",
  "pissed",
  "pissing",
  "pisser",
  "pisspoor",
  "pisstake",
  "pisshead",
  // ass family
  "ass",
  "asses",
  "asshole",
  "assholes",
  "asshat",
  "asshats",
  "asswipe",
  "asswipes",
  "assclown",
  "assbag",
  "asskisser",
  "dumbass",
  "dumbasses",
  "jackass",
  "jackasses",
  "smartass",
  "smartasses",
  "badass",
  "badasses",
  "lazyass",
  "fatass",
  "hardass",
  "halfass",
  "halfassed",
  "arse",
  "arsed",
  "arsehole",
  "arseholes",
  "arsewipe",
  // bitch family
  "bitch",
  "bitches",
  "bitched",
  "bitching",
  "bitchy",
  "bitchier",
  "bitchiest",
  "sonofabitch",
  "biatch",
  "biotch",
  // strong vulgarity
  "cunt",
  "cunts",
  "cunty",
  "cuntish",
  "twat",
  "twats",
  "twatty",
  "bastard",
  "bastards",
  // body-part insults
  "dick",
  "dicks",
  "dickhead",
  "dickheads",
  "dickish",
  "dickwad",
  "dickwads",
  "dickface",
  "dickbag",
  "prick",
  "pricks",
  "prickish",
  "cock",
  "cocks",
  "cocky",
  "cockier",
  "cockiest",
  "cockhead",
  "cockblock",
  "cocksucker",
  "cocksuckers",
  "knobhead",
  "knobheads",
  "knobend",
  "wanker",
  "wankers",
  "wankery",
  "tosser",
  "tossers",
  "jerkoff",
  "jerkoffs",
  "douche",
  "douches",
  "douchebag",
  "douchebags",
  "douchey",
  "scumbag",
  "scumbags",
  "scum",
  "sleazebag",
  "sleazeball",
  "slimeball",
  "lowlife",
  "lowlifes",
  "deadbeat",
  // intelligence-based insults
  "idiot",
  "idiots",
  "idiotic",
  "idiocy",
  "stupid",
  "stupider",
  "stupidest",
  "stupidity",
  "moron",
  "morons",
  "moronic",
  "imbecile",
  "imbeciles",
  "retard",
  "retards",
  "retarded",
  "dumb",
  "dumber",
  "dumbest",
  "dumbo",
  "fool",
  "fools",
  "foolish",
  "foolery",
  "clown",
  "clowns",
  "clownish",
  "buffoon",
  "buffoons",
  "simpleton",
  "halfwit",
  "halfwits",
  "nitwit",
  "nitwits",
  "dimwit",
  "dimwits",
  "dolt",
  "dolts",
  "doltish",
  "knucklehead",
  "knuckleheads",
  "blockhead",
  "blockheads",
  "lamebrain",
  "airhead",
  "airheads",
  "scatterbrain",
  "numbnuts",
  "numbskull",
  "numpty",
  "numpties",
  "muppet",
  "muppets",
  "pillock",
  "pillocks",
  "plonker",
  "plonkers",
  "prat",
  "prats",
  "berk",
  "berks",
  "ninny",
  "ninnies",
  "dingbat",
  "dingbats",
  "putz",
  "putzes",
  "schmuck",
  "schmucks",
  "jerk",
  "jerks",
  "jerkface",
  "gits",
  "sod",
  "sodding",
  "bugger",
  "buggered",
  // generic aggression / dismissal
  "suck",
  "sucks",
  "sucked",
  "sucking",
  "sucky",
  "suckage",
  "trashy",
  // religious exclamations
  "jesus",
  "christ",
  "jeez",
  "jeezus",
  "sheesh",
  "godsake",
  // chat acronyms
  "wtf",
  "wth",
  "wtaf",
  "stfu",
  "gtfo",
  "omfg",
  "omg",
  "ffs",
  "jfc",
  "kys",
  "fml",
  "smh",
  "smdh",
  "smfh",
  "idgaf",
  "idfc",
  "lmfao",
  "fubar",
  "snafu",
];

const PROFANITY_RE = new RegExp(String.raw`\b(?:${PROFANITY.join("|")})\b`, "gi");
const SENTENCE_RE = /[^.!?\n]+/g;
const LETTER_RE = /\p{L}/gu;
const UPPER_LETTER_RE = /\p{Lu}/gu;
const YELLING_MIN_LETTERS = 4;
const YELLING_THRESHOLD = 0.5;
// Runs starting with `!` or `?` followed by 2+ of `!?1`. The `1` is the
// classic shift-key mishit ("!!!111") counted as part of the same burst.
const DRAMA_RE = /[!?][!?1]{2,}/g;
const WORD_RE = /\S+/g;

// Anguish/exasperation interjections. Interjections whose short form
// collides with normal prose ("no", "ahh", "why", "yes", "god") require
// real elongation; unambiguous ones ("ugh", "argh", "grr") match plain.
const ANGUISH_PATTERNS: readonly string[] = [
  "no{3,}", //          nooo, noooooo
  "a+h{2,}", //         ahh, aaaahhh
  "u+r?g+h+", //        ugh, ughh, urgh, uuugh
  "a+r+g+h+", //        argh, aaargh, arrgghhh
  "g+r{2,}", //         grr, grrrr
  "st+o{3,}p+", //      stooop, sttooopp
  "w+h+y{3,}", //       whyyy, whyyyyy
  "f+u{3,}c*k*", //     fuuu, fuuuck
  "wtf{3,}", //         wtfff
  "o+m+g{2,}", //       omgg, omggg
  "ye+s{3,}", //        yesss, yeessss
  "g+o+d{3,}", //       goddd, goddddd
  "br+u+h{2,}", //      bruhh, bruuuhh
];
const ANGUISH_RE = new RegExp(String.raw`\b(?:${ANGUISH_PATTERNS.join("|")})\b`, "gi");
const DUDE_RE = /\bdude\b/gi;
// Sad emoticons. Requires a leading boundary so code fragments like
// `foo:(bar)` don't fire; `\(+` folds `:(((` into one hit.
const SAD_EMOTICON_RE = /(?<=^|[\s.!?])[:;]-?\(+/g;

// Corrective negation, anchored to the very start of the trimmed prose
// body: real frustration negation overwhelmingly opens the message.
const NEGATION_LEAD_RE =
  /^[ \t]*(?:(?:nope|nah|nvm|wrong|incorrect)\b|no(?=\s*(?:[,.!?;:–—]|-(?!\w)|$|(?:i|im|u|you|ur|we|it|its|that|thats|this|the|they|theyre|he|she|man|dude|bro|wait|dont|not|stop|just|again|please|plz|but|actually|literally|seriously|sorry|no|never|nothing|wtf|why|what|wrong)\b)))/gi;
const NEGATION_PHRASE_RE =
  /\b(?:that['’]?s\s+not\s+(?:what|right|it)|not\s+what\s+i\s+(?:meant|asked|said|wanted)|makes\s+(?:no|zero)\s+sense)\b/gi;

// User repeating themselves. Bare `still` / `again` are too ambiguous, so
// `still` only counts when followed by a negative or sameness marker.
const REPETITION_RECALL_RE =
  /\b(?:(?:like|as)\s+i\s+(?:said|told\s+you|asked)|i\s+(?:meant|said|told\s+you|asked\s+you|already\s+(?:said|told|did|asked|wrote)))\b/gi;
const REPETITION_STILL_RE =
  /\bstill\s+(?:doesn['’]?t|doesnt|isn['’]?t|isnt|not|broken|wrong|fails|failing|the\s+same|same)\b/gi;

// Direct second-person reproach anchored to accusatory verbs.
const BLAME_YOU_RE = /\byou\s+(?:didn['’]?t|did\s+not|broke|missed|forgot|keep|always|never|still|ignored)\b/gi;
const BLAME_WHY_RE = /\bwhy\s+(?:would|did)\s+(?:you|u)\b/gi;
// `stop <verb>ing` counts only as an imperative at sentence start.
const BLAME_STOP_RE = /(?:^|(?<=[.!?\n]))\s*stop\s+\w+ing\b/gim;

// Stripped from the analyzed body before scoring so that structured
// content (code, XML/HTML, URLs, file mentions, quoted blocks) does not
// pollute behavior signals.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const XML_TAG_PAIR_RE = /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g;
const XML_TAG_BARE_RE = /<\/?[A-Za-z][\w-]*\b[^>]*\/?>/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const FILE_MENTION_RE = /(^|\s)@[\w./-]+/g;
// Dotted tokens: filenames (`AGENTS.md`), dotted identifiers (`Bun.file`),
// versions (`1.2.3`). Stripped so SENTENCE_RE does not split them into
// all-caps fragments that register as yelling.
const DOTTED_TOKEN_RE = /(?<=^|[\s("'[])[\w-]+(?:\.[\w-]+)+(?=$|[\s)"'\],:;!?]|\.(?!\w))/g;
const QUOTE_LINE_RE = /^[ \t]*>.*$/gm;
const IMAGE_MARKER_RE = /\[Image #\d+\]/g;
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// Users don't really get angry with detailed, formatted prompts: if the
// remaining prose is this many lines or more, the emotional signals
// (yelling, anguish, negation, repetition, blame) score zero. Profanity is
// exempt - a swear in a long prompt is still a swear. This is a deliberate
// deviation from upstream oh-my-pi, which zeroes profanity too.
const MAX_PROSE_LINES = 3;

/** Count regex hits without materializing the match array. */
function countMatches(text: string, re: RegExp): number {
  let count = 0;
  re.lastIndex = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

/** Count regex hits and tally each lowercased match into `into`. */
function tallyMatches(text: string, re: RegExp, into: Record<string, number>): number {
  let count = 0;
  re.lastIndex = 0;
  let match = re.exec(text);
  while (match !== null) {
    count++;
    const word = match[0].toLowerCase();
    into[word] = (into[word] ?? 0) + 1;
    match = re.exec(text);
  }
  return count;
}

// A sentence needs 2+ uppercase runs, or a single elongated run with a
// tripled letter, before its caps ratio can count as yelling.
const UPPER_RUN_RE = /\p{Lu}{2,}/gu;
const TRIPLED_LETTER_RE = /(\p{Lu})\1\1/u;

function isShoutedSentence(sentence: string): boolean {
  const runs = sentence.match(UPPER_RUN_RE);
  if (!runs) return false;
  if (runs.length >= 2) return true;
  return runs[0].length >= YELLING_MIN_LETTERS && TRIPLED_LETTER_RE.test(runs[0]);
}

function countYellingSentences(text: string): number {
  let count = 0;
  SENTENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = SENTENCE_RE.exec(text);
  while (match !== null) {
    const sentence = match[0];
    const letters = countMatches(sentence, LETTER_RE);
    if (letters >= YELLING_MIN_LETTERS) {
      const upper = countMatches(sentence, UPPER_LETTER_RE);
      if (upper / letters > YELLING_THRESHOLD && isShoutedSentence(sentence)) count++;
    }
    match = SENTENCE_RE.exec(text);
  }
  return count;
}

/**
 * Strip structured content so that pasted code, harness wrappers, file
 * mentions and quoted blocks don't dilute or fake behavior signals.
 */
export function stripStructuredContent(text: string): string {
  return text
    .replace(FENCED_CODE_RE, "\n")
    .replace(XML_TAG_PAIR_RE, "\n")
    .replace(XML_TAG_BARE_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(URL_RE, " ")
    .replace(FILE_MENTION_RE, "$1 ")
    .replace(DOTTED_TOKEN_RE, " ")
    .replace(QUOTE_LINE_RE, "")
    .replace(IMAGE_MARKER_RE, " ")
    .replace(ANSI_ESCAPE_RE, "");
}

function countNonEmptyLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length > 0) count++;
  }
  return count;
}

function emptyMetrics(chars = 0, words = 0): BehaviorMetrics {
  return {
    chars,
    words,
    yelling: 0,
    profanity: 0,
    profanityWords: {},
    anguish: 0,
    negation: 0,
    repetition: 0,
    blame: 0,
  };
}

/**
 * Compute behavior metrics for a user message.
 *
 * Signals are computed on a stripped prose body. Profanity counts in any
 * message; the emotional signals score zero on long, well-formatted
 * messages because those are deliberate, not emotional outbursts.
 */
export function analyzeUserMessage(text: string): BehaviorMetrics {
  const trimmed = text.trim();
  if (!trimmed) return emptyMetrics();

  const chars = trimmed.length;
  const words = countMatches(trimmed, WORD_RE);

  const prose = stripStructuredContent(trimmed).trim();
  if (!prose) return emptyMetrics(chars, words);

  const profanityWords: Record<string, number> = {};
  const profanity = tallyMatches(prose, PROFANITY_RE, profanityWords);

  if (countNonEmptyLines(prose) >= MAX_PROSE_LINES) {
    const result = emptyMetrics(chars, words);
    result.profanity = profanity;
    result.profanityWords = profanityWords;
    return result;
  }

  const anguish =
    countMatches(prose, DRAMA_RE) +
    countMatches(prose, ANGUISH_RE) +
    countMatches(prose, DUDE_RE) +
    countMatches(prose, SAD_EMOTICON_RE);

  const negation = countMatches(prose, NEGATION_LEAD_RE) + countMatches(prose, NEGATION_PHRASE_RE);
  const repetition = countMatches(prose, REPETITION_RECALL_RE) + countMatches(prose, REPETITION_STILL_RE);
  const blame =
    countMatches(prose, BLAME_YOU_RE) + countMatches(prose, BLAME_WHY_RE) + countMatches(prose, BLAME_STOP_RE);

  return {
    chars,
    words,
    yelling: countYellingSentences(prose),
    profanity,
    profanityWords,
    anguish,
    negation,
    repetition,
    blame,
  };
}

/**
 * Compute behavior metrics for an assistant message.
 *
 * Only profanity and yelling apply: the frustration signals (anguish,
 * negation, repetition, blame) are tuned for user tantrums and stay zero.
 * Unlike user messages there is no prose-length guard; assistant output is
 * long by nature, and profanity in it counts wherever it appears outside
 * code, quotes, and other structured content.
 */
export function analyzeAssistantMessage(text: string): BehaviorMetrics {
  const trimmed = text.trim();
  if (!trimmed) return emptyMetrics();

  const chars = trimmed.length;
  const words = countMatches(trimmed, WORD_RE);

  const prose = stripStructuredContent(trimmed).trim();
  if (!prose) return emptyMetrics(chars, words);

  const profanityWords: Record<string, number> = {};
  const profanity = tallyMatches(prose, PROFANITY_RE, profanityWords);

  const result = emptyMetrics(chars, words);
  result.yelling = countYellingSentences(prose);
  result.profanity = profanity;
  result.profanityWords = profanityWords;
  return result;
}
