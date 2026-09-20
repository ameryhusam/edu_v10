/**
 * Misconception state — derived from the evidence stream, never asserted.
 *
 * This closes a real defect. Diagnosis already worked: choosing a distractor
 * tagged with a misconception writes `mastery_evidence.misconceptionKey`. But
 * nothing ever promoted that evidence into learner state, so
 * `learner_misconceptions` was read by two capabilities and written by none.
 * The REMEDIATE branch of `decideNextActivity` and the `MISCONCEPTION`
 * remediation trigger were both unreachable in production.
 *
 * ── Why this is a pure function over the whole stream ──────────────────────
 *
 * Legacy's writer (`analytics.repository.ts:66`, itself never called) did
 * `confidence: min(0.95, existing.confidence + 0.1)` — it read its own previous
 * output and incremented. That is path-dependent: the same evidence replayed
 * twice gives a different answer, and a retried submission inflates the number.
 * It is the same mistake as an incrementally-patched mastery column, and it is
 * why `RecomputeMasteryUseCase` deliberately does not read the stored record.
 *
 * So this function takes the ordered evidence for ONE concept and returns the
 * complete state. Nothing is incremented; everything is counted. Running it
 * twice over the same stream produces byte-identical output.
 *
 * ── Why resolution is derived ──────────────────────────────────────────────
 *
 * Legacy never set `isResolved` anywhere, so a misconception diagnosed once
 * followed a learner forever. Here a misconception clears when the learner has
 * since answered the concept correctly enough times without re-triggering it —
 * evidence closing what evidence opened, the same rule remediation episodes
 * follow (RW1/RW2). There is deliberately no "mark as resolved" input: a
 * teacher declaring a wrong model fixed is `PATCH {masteryAchieved}` wearing a
 * new hat.
 */

/** One observation from the evidence stream, narrowed to what this needs. */
export interface MisconceptionObservation {
  readonly isCorrect: boolean;
  readonly weight: number;
  readonly observedAt: Date;
  /** The misconception this answer implicated, when one was diagnosed. */
  readonly misconceptionKey?: string | undefined;
}

export interface MisconceptionState {
  readonly misconceptionKey: string;
  /** Total times this wrong model has been observed. Counted, never incremented. */
  readonly occurrences: number;
  /** Belief that the learner genuinely holds it, in [0,1]. */
  readonly confidence: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly isResolved: boolean;
  /** When it cleared; null while still open. */
  readonly resolvedAt: Date | null;
}

/**
 * Correct answers on the concept, after the last sighting, needed to clear it.
 *
 * Two rather than one: a single correct answer is as likely to be a guess as a
 * corrected mental model, and clearing on it would make misconceptions flicker
 * open and closed. Three would leave stale claims on record long after the
 * learner recovered.
 */
export const CLEARING_STREAK = 2;

/**
 * Confidence that the learner holds a diagnosed misconception.
 *
 * Rises with repetition and saturates: one sighting is suggestive, three is
 * convincing, and no amount of evidence reaches certainty because a distractor
 * is an inference about thinking, not an observation of it. The 0.95 ceiling is
 * carried over from legacy's intent; the shape is a pure function of the count
 * instead of legacy's running increment.
 */
export function misconceptionConfidence(occurrences: number): number {
  if (occurrences <= 0) return 0;
  return Number(Math.min(0.95, 1 - 0.5 ** occurrences).toFixed(4));
}

/**
 * Derive every misconception state for ONE concept from its ordered evidence.
 *
 * Caller supplies evidence for a single concept, chronologically ordered.
 * Returns one state per misconception ever diagnosed — including resolved ones,
 * because "held this in October, cleared it in November" is exactly the history
 * a teacher wants, and dropping resolved rows would make a recurrence look like
 * a first sighting.
 */
export function deriveMisconceptionStates(
  evidence: readonly MisconceptionObservation[],
): MisconceptionState[] {
  // Zero-weight observations carry no signal at all (skipped, ungradable,
  // awaiting manual review). They must neither diagnose a misconception nor
  // count toward clearing one — the same exclusion mastery applies.
  const scored = evidence.filter((e) => e.weight > 0);

  const sightings = new Map<string, Date[]>();
  for (const e of scored) {
    if (!e.misconceptionKey) continue;
    const list = sightings.get(e.misconceptionKey);
    if (list) list.push(e.observedAt);
    else sightings.set(e.misconceptionKey, [e.observedAt]);
  }

  const states: MisconceptionState[] = [];

  for (const [misconceptionKey, seenAt] of sightings) {
    const firstSeenAt = seenAt[0]!;
    const lastSeenAt = seenAt[seenAt.length - 1]!;

    // Correct answers on this concept AFTER the most recent sighting. A correct
    // answer before it proves nothing: the learner demonstrated the wrong model
    // more recently than the right one.
    const since = scored.filter((e) => e.observedAt.getTime() > lastSeenAt.getTime());

    let streak = 0;
    let resolvedAt: Date | null = null;
    for (const e of since) {
      // Re-triggering any misconception on this concept breaks the streak: the
      // learner is still reasoning wrongly about it, just differently.
      if (e.misconceptionKey) {
        streak = 0;
        continue;
      }
      if (!e.isCorrect) {
        streak = 0;
        continue;
      }
      streak += 1;
      if (streak >= CLEARING_STREAK) {
        resolvedAt = e.observedAt;
        break;
      }
    }

    states.push({
      misconceptionKey,
      occurrences: seenAt.length,
      confidence: misconceptionConfidence(seenAt.length),
      firstSeenAt,
      lastSeenAt,
      isResolved: resolvedAt !== null,
      resolvedAt,
    });
  }

  // Deterministic order so two runs produce identical output, and so a stored
  // row set can be compared without sorting at the call site.
  return states.sort((a, b) => a.misconceptionKey.localeCompare(b.misconceptionKey));
}
