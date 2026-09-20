/**
 * Exam results for a teacher — PURE.
 *
 * "How did 7-B do on this exam?" Everything here arranges numbers that
 * Assessment already computed and stored; nothing is re-derived.
 *
 * The one rule that shapes this file: **a score is read, never recomputed.**
 * Assessment grades each answer at submit time against the answer key and the
 * rulebook version in force, then stores the attempt total. Recomputing it here
 * — even with "the same" formula — would produce a second source of truth that
 * silently diverges the first time grading changes. The legacy dashboard did
 * exactly this and showed two different scores for one sitting.
 *
 * Pending review is treated as first-class for the same honesty reason: while a
 * human still has essays to mark, the cohort's average is not yet a fact, and
 * this module says so rather than quietly averaging the machine-markable part.
 */

/** One learner's sitting, as Assessment recorded it. */
export interface ExamSitting {
  readonly learnerKey: string;
  readonly attemptKey: string;
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly correctCount: number | null;
  readonly incorrectCount: number | null;
  readonly pendingReviewCount: number | null;
  readonly submittedAt: Date | null;
}

export interface ExamItemOutcome {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pending: number;
}

/** A learner's row in the results table. */
export interface SittingRow {
  readonly learnerKey: string;
  readonly attemptKey: string;
  readonly status: 'SUBMITTED' | 'IN_PROGRESS';
  readonly score: number | null;
  readonly maxScore: number | null;
  /** `score / maxScore`, null when not submitted or not yet fully marked. */
  readonly percentage: number | null;
  readonly awaitingReview: boolean;
  readonly submittedAt: Date | null;
}

export interface ScoreBand {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly learners: number;
}

export interface ItemOutcomeRow {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pending: number;
  readonly answered: number;
  /** `correct / answered`, null when nobody has answered it yet. */
  readonly correctRate: number | null;
}

export interface ExamResults {
  readonly examKey: string;
  readonly title: string;
  readonly assigned: number;
  readonly submitted: number;
  readonly inProgress: number;
  readonly notStarted: number;
  readonly awaitingReview: number;
  /** Null until at least one sitting is fully marked. */
  readonly meanPercentage: number | null;
  readonly medianPercentage: number | null;
  readonly lowestPercentage: number | null;
  readonly highestPercentage: number | null;
  readonly distribution: readonly ScoreBand[];
  readonly sittings: readonly SittingRow[];
  readonly items: readonly ItemOutcomeRow[];
  /** Learners in scope with no attempt at all. Named, not just counted. */
  readonly notStartedLearners: readonly string[];
}

/**
 * Fixed bands. Deliberately not configurable: a teacher comparing two exams
 * must be comparing the same buckets, and a per-call band definition is how a
 * "distribution" becomes unreadable across screens.
 */
const BANDS: readonly { label: string; from: number; to: number }[] = [
  { label: '0-49', from: 0, to: 0.5 },
  { label: '50-64', from: 0.5, to: 0.65 },
  { label: '65-79', from: 0.65, to: 0.8 },
  { label: '80-89', from: 0.8, to: 0.9 },
  { label: '90-100', from: 0.9, to: 1.0001 },
];

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round4((sorted[mid - 1]! + sorted[mid]!) / 2)
    : round4(sorted[mid]!);
}

/**
 * A sitting counts toward the statistics only when it is submitted AND has
 * nothing left for a human to mark. A half-marked paper has no percentage yet.
 */
function comparablePercentage(sitting: ExamSitting): number | null {
  if (sitting.submittedAt === null) return null;
  if ((sitting.pendingReviewCount ?? 0) > 0) return null;
  if (sitting.score === null || sitting.maxScore === null || sitting.maxScore <= 0) return null;
  return round4(sitting.score / sitting.maxScore);
}

export function summariseExam(input: {
  examKey: string;
  title: string;
  /** Everyone the teacher expects to sit it — including those who have not. */
  learnerKeys: readonly string[];
  sittings: readonly ExamSitting[];
  items: readonly ExamItemOutcome[];
}): ExamResults {
  const rows: SittingRow[] = input.sittings.map((s) => {
    const percentage = comparablePercentage(s);
    return {
      learnerKey: s.learnerKey,
      attemptKey: s.attemptKey,
      status: s.submittedAt === null ? ('IN_PROGRESS' as const) : ('SUBMITTED' as const),
      score: s.score,
      maxScore: s.maxScore,
      percentage,
      awaitingReview: (s.pendingReviewCount ?? 0) > 0,
      submittedAt: s.submittedAt,
    };
  });

  const sat = new Set(rows.map((r) => r.learnerKey));
  // Named, not just counted: "eight did not sit it" is not actionable, but a
  // list of who is.
  const notStartedLearners = input.learnerKeys.filter((k) => !sat.has(k));

  const comparable = rows.flatMap((r) => (r.percentage === null ? [] : [r.percentage]));
  const mean =
    comparable.length > 0
      ? round4(comparable.reduce((sum, p) => sum + p, 0) / comparable.length)
      : null;

  const distribution: ScoreBand[] = BANDS.map((band) => ({
    label: band.label,
    from: band.from,
    to: band.to,
    learners: comparable.filter((p) => p >= band.from && p < band.to).length,
  }));

  const items: ItemOutcomeRow[] = [...input.items]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((i) => {
      // Pending answers are excluded from the denominator: an unmarked essay is
      // not evidence that the item was answered wrongly.
      const answered = i.correct + i.incorrect;
      return {
        questionKey: i.questionKey,
        orderIndex: i.orderIndex,
        correct: i.correct,
        incorrect: i.incorrect,
        pending: i.pending,
        answered,
        correctRate: answered > 0 ? round4(i.correct / answered) : null,
      };
    });

  return {
    examKey: input.examKey,
    title: input.title,
    assigned: input.learnerKeys.length,
    submitted: rows.filter((r) => r.status === 'SUBMITTED').length,
    inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
    notStarted: notStartedLearners.length,
    awaitingReview: rows.filter((r) => r.awaitingReview).length,
    meanPercentage: mean,
    medianPercentage: median(comparable),
    lowestPercentage: comparable.length > 0 ? Math.min(...comparable) : null,
    highestPercentage: comparable.length > 0 ? Math.max(...comparable) : null,
    distribution,
    sittings: rows.sort((a, b) => a.learnerKey.localeCompare(b.learnerKey)),
    items,
    notStartedLearners,
  };
}
