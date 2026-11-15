/**
 * Time-based rate cards ported from oh-my-pi (can1357/oh-my-pi, MIT).
 *
 * Extracted from packages/catalog/src/models.json at 0ce18d2. Only the five
 * upstream rows with `cost.timeBased` are here. Lookup is exact on
 * provider/model so reseller rows keep the host's flat rate.
 */

export interface TokenCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface PeakWindow {
  weekdays: readonly number[];
  startMinute: number;
  endMinute: number;
}

interface EffectiveRate extends TokenCost {
  effectiveFrom: number;
}

interface TimeBasedCost {
  offPeakMultiplier: number;
  peakWindows: readonly PeakWindow[];
  effectiveRates?: readonly EffectiveRate[];
}

interface PricingCard extends TokenCost {
  timeBased: TimeBasedCost;
}

const TIME_BASED_CARDS: Readonly<Record<string, PricingCard>> = {
  "deepseek/deepseek-flash": {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0,
    timeBased: {
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
      ],
    },
  },
  "deepseek/deepseek-v4-flash": {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0,
    timeBased: {
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
      ],
    },
  },
  "deepseek/deepseek-v4-flash-vision-exp": {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0,
    timeBased: {
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
      ],
    },
  },
  "deepseek/deepseek-v4-pro": {
    input: 1.32,
    output: 3.96,
    cacheRead: 0.044,
    cacheWrite: 0,
    timeBased: {
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
      ],
      effectiveRates: [{ effectiveFrom: 1_789_358_400_000, input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }],
    },
  },
  "google-antigravity/gemini-4-argon": {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 0,
    timeBased: {
      offPeakMultiplier: 1,
      peakWindows: [],
      effectiveRates: [
        { effectiveFrom: -8_640_000_000_000_000, input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
        { effectiveFrom: 1_796_112_000_000, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      ],
    },
  },
};

function cardFor(providerID: string, modelID: string): PricingCard | undefined {
  return TIME_BASED_CARDS[`${providerID}/${modelID}`];
}

/** The dated base card in force at `timestamp`, or the card's flat legs. */
function dueEffectiveRate(card: PricingCard, timestamp: number): TokenCost {
  let winner: EffectiveRate | undefined;
  for (const rate of card.timeBased.effectiveRates ?? []) {
    if (rate.effectiveFrom > timestamp) continue;
    if (winner === undefined || rate.effectiveFrom > winner.effectiveFrom) winner = rate;
  }
  return winner === undefined
    ? { input: card.input, output: card.output, cacheRead: card.cacheRead, cacheWrite: card.cacheWrite }
    : { input: winner.input, output: winner.output, cacheRead: winner.cacheRead, cacheWrite: winner.cacheWrite };
}

/** Resolve a model's base rates for its exact upstream provider/model row. */
export function effectiveTokenCost(
  providerID: string,
  modelID: string,
  fallback: TokenCost,
  timestamp = Date.now(),
): TokenCost {
  const card = cardFor(providerID, modelID);
  if (card === undefined) return fallback;
  return dueEffectiveRate(card, timestamp);
}

function isPeakPricingPeriod(card: PricingCard, timestamp: number): boolean {
  const day = Math.floor(timestamp / 86_400_000);
  const weekday = (((day + 4) % 7) + 7) % 7;
  const minute = Math.floor((timestamp - day * 86_400_000) / 60_000);
  for (const window of card.timeBased.peakWindows) {
    if (minute >= window.startMinute && minute < window.endMinute && window.weekdays.includes(weekday)) return true;
  }
  return false;
}

/** Peak/off-peak multiplier for a model's exact upstream provider/model row. */
export function timeBasedMultiplier(providerID: string, modelID: string, timestamp = Date.now()): number {
  const card = cardFor(providerID, modelID);
  if (card === undefined) return 1;
  return isPeakPricingPeriod(card, timestamp) ? 1 : card.timeBased.offPeakMultiplier;
}
