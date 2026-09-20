/**
 * Classical item analysis — PURE.
 *
 * Authoring validation catches items that *cannot* be graded. It cannot catch
 * the item that grades perfectly well against the wrong answer key, or the one
 * whose stem is so ambiguous that knowing the material makes you likelier to
 * pick the distractor. Only the responses reveal those, which is why this
 * exists as a separate capability rather than another rule in the gate.
 *
 * Three numbers do most of the work:
 *
 *   p       difficulty  — the proportion who got it right (confusingly named
 *                         by convention: a HIGH p is an EASY item)
 *   D       discrimination — how much better the strong learners did than the
 *                         weak ones on this item
 *   pbis    point-biserial — the same idea as a correlation with total score
 *
 * The one that matters most is D. A negative D means the learners who did best
 * overall did WORST on this item, and the overwhelmingly common cause is a
 * miskeyed answer. It is the single most valuable signal an item bank can
 * produce about itself, and legacy computed nothing of the kind.
 */

/** One learner's encounter with one item, as the analysis needs it. */
export interface ItemResponse {
  readonly learnerKey: string;
  readonly correct: boolean;
  /** Which option they chose, for distractor analysis. Null for non-MCQ. */
  readonly chosenOptionId: string | null;
  readonly timeSpentSeconds: number | null;
}

/** A learner's overall performance, used to split strong from weak. */
export interface LearnerScore {
  readonly learnerKey: string;
  /** Proportion correct across the whole assessment, 0..1. */
  readonly proportionCorrect: number;
}

export interface DistractorStat {
  readonly optionId: string;
  readonly chosenBy: number;
  readonly share: number;
  /**
   * Was this distractor chosen more by strong learners than weak ones?
   *
   * A positive value on a WRONG option is the signature of a defensible
   * alternative reading of the stem — or of a miskeyed item.
   */
  readonly discrimination: number;
}

export type ItemFlag =
  | 'MISKEYED_SUSPECTED'
  | 'NON_DISCRIMINATING'
  | 'TOO_EASY'
  | 'TOO_HARD'
  | 'DEAD_DISTRACTOR'
  | 'INSUFFICIENT_DATA';

export interface ItemStatistics {
  readonly responses: number;
  /** Proportion correct. Conventionally called difficulty; high means easy. */
  readonly difficulty: number;
  /** Upper-group minus lower-group success rate, −1..1. */
  readonly discrimination: number;
  /** Point-biserial correlation with total score, −1..1. */
  readonly pointBiserial: number;
  readonly medianSecondsToAnswer: number | null;
  readonly distractors: readonly DistractorStat[];
  readonly flags: readonly ItemFlag[];
}

/**
 * Below this, every statistic is noise.
 *
 * With 10 responses a single learner moves the difficulty by 0.1 and the
 * upper/lower split has three people in each group. Reporting a confident
 * −0.4 discrimination from that would send an author to rewrite a fine item.
 */
export const MIN_RESPONSES_FOR_ANALYSIS = 20;

/**
 * The classic upper/lower split.
 *
 * 27% is Kelley's result: it maximises the reliability of the difference
 * between the groups for a normal distribution. Splitting at the median uses
 * everyone but blurs the contrast; 10% sharpens the contrast but throws away
 * most of the sample.
 */
const GROUP_FRACTION = 0.27;

export function analyseItem(
  responses: readonly ItemResponse[],
  scores: readonly LearnerScore[],
): ItemStatistics {
  const n = responses.length;

  if (n === 0) {
    return {
      responses: 0,
      difficulty: 0,
      discrimination: 0,
      pointBiserial: 0,
      medianSecondsToAnswer: null,
      distractors: [],
      flags: ['INSUFFICIENT_DATA'],
    };
  }

  const correctCount = responses.filter((r) => r.correct).length;
  const difficulty = correctCount / n;

  const scoreByLearner = new Map(scores.map((s) => [s.learnerKey, s.proportionCorrect]));
  const discrimination = discriminationIndex(responses, scoreByLearner);
  const pointBiserial = pointBiserialCorrelation(responses, scoreByLearner);
  const distractors = analyseDistractors(responses, scoreByLearner);

  return {
    responses: n,
    difficulty: round(difficulty),
    discrimination: round(discrimination),
    pointBiserial: round(pointBiserial),
    medianSecondsToAnswer: medianTime(responses),
    distractors,
    flags: flagItem({ n, difficulty, discrimination, distractors }),
  };
}

/**
 * D = (proportion correct in the top group) − (in the bottom group).
 *
 * Learners with no recorded overall score are excluded rather than defaulted
 * to zero: treating an unknown as "weak" would manufacture discrimination out
 * of missing data.
 */
function discriminationIndex(
  responses: readonly ItemResponse[],
  scoreByLearner: ReadonlyMap<string, number>,
): number {
  const ranked = responses
    .filter((r) => scoreByLearner.has(r.learnerKey))
    .sort((a, b) => scoreByLearner.get(b.learnerKey)! - scoreByLearner.get(a.learnerKey)!);

  if (ranked.length < 2) return 0;

  const groupSize = Math.max(1, Math.round(ranked.length * GROUP_FRACTION));
  const upper = ranked.slice(0, groupSize);
  const lower = ranked.slice(-groupSize);

  const rate = (group: readonly ItemResponse[]) =>
    group.filter((r) => r.correct).length / group.length;

  return rate(upper) - rate(lower);
}

/**
 * Point-biserial: the correlation between getting this item right and doing
 * well overall.
 *
 * Uses the whole sample rather than two extreme groups, so it is the more
 * stable of the two — but it is also less legible to an author, which is why
 * both are reported.
 */
function pointBiserialCorrelation(
  responses: readonly ItemResponse[],
  scoreByLearner: ReadonlyMap<string, number>,
): number {
  const paired = responses.flatMap((r) => {
    const score = scoreByLearner.get(r.learnerKey);
    return score === undefined ? [] : [{ correct: r.correct, score }];
  });

  if (paired.length < 2) return 0;

  const correct = paired.filter((p) => p.correct);
  const incorrect = paired.filter((p) => !p.correct);
  if (correct.length === 0 || incorrect.length === 0) return 0;

  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const all = paired.map((p) => p.score);
  const overallMean = mean(all);

  const variance = mean(all.map((x) => (x - overallMean) ** 2));
  const sd = Math.sqrt(variance);
  // Everyone scored identically overall: nothing to correlate with.
  if (sd === 0) return 0;

  const p = correct.length / paired.length;
  return ((mean(correct.map((c) => c.score)) - overallMean) / sd) * Math.sqrt(p / (1 - p));
}

function analyseDistractors(
  responses: readonly ItemResponse[],
  scoreByLearner: ReadonlyMap<string, number>,
): readonly DistractorStat[] {
  const withOption = responses.filter((r) => r.chosenOptionId !== null);
  if (withOption.length === 0) return [];

  const byOption = new Map<string, ItemResponse[]>();
  for (const response of withOption) {
    const list = byOption.get(response.chosenOptionId!) ?? [];
    list.push(response);
    byOption.set(response.chosenOptionId!, list);
  }

  const overallMean = averageScore(withOption, scoreByLearner);

  return [...byOption.entries()]
    .map(([optionId, chose]) => ({
      optionId,
      chosenBy: chose.length,
      share: round(chose.length / withOption.length),
      // How much better, on average, the people who picked this option did
      // overall. Positive on a wrong option is the miskey signature.
      discrimination: round(averageScore(chose, scoreByLearner) - overallMean),
    }))
    .sort((a, b) => b.chosenBy - a.chosenBy);
}

function averageScore(
  responses: readonly ItemResponse[],
  scoreByLearner: ReadonlyMap<string, number>,
): number {
  const scores = responses.flatMap((r) => {
    const score = scoreByLearner.get(r.learnerKey);
    return score === undefined ? [] : [score];
  });
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function medianTime(responses: readonly ItemResponse[]): number | null {
  const times = responses
    .flatMap((r) => (r.timeSpentSeconds == null ? [] : [r.timeSpentSeconds]))
    .sort((a, b) => a - b);
  if (times.length === 0) return null;

  const mid = Math.floor(times.length / 2);
  // Median, not mean: one learner who left the tab open for an hour would
  // drag a mean into meaninglessness.
  return times.length % 2 === 0 ? (times[mid - 1]! + times[mid]!) / 2 : times[mid]!;
}

function flagItem(input: {
  n: number;
  difficulty: number;
  discrimination: number;
  distractors: readonly DistractorStat[];
}): readonly ItemFlag[] {
  const flags: ItemFlag[] = [];

  if (input.n < MIN_RESPONSES_FOR_ANALYSIS) {
    // Say only this. Any other flag from a thin sample is a guess wearing a
    // number, and an author cannot tell the difference.
    return ['INSUFFICIENT_DATA'];
  }

  // The signal worth waking someone up for.
  if (input.discrimination < -0.05) flags.push('MISKEYED_SUSPECTED');
  else if (input.discrimination < 0.2) flags.push('NON_DISCRIMINATING');

  if (input.difficulty > 0.95) flags.push('TOO_EASY');
  if (input.difficulty < 0.2) flags.push('TOO_HARD');

  // An option nobody ever picks is doing no work; the item is effectively
  // one option shorter than it looks, and guessing is that much easier.
  if (input.distractors.length > 1 && input.distractors.some((d) => d.chosenBy === 0)) {
    flags.push('DEAD_DISTRACTOR');
  }

  return flags;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Should this item be pulled for review?
 *
 * Deliberately narrow. A report that flags a third of the bank gets ignored,
 * and then the miskeyed item stays live anyway.
 */
export function needsAuthorReview(stats: ItemStatistics): boolean {
  return stats.flags.includes('MISKEYED_SUSPECTED');
}
