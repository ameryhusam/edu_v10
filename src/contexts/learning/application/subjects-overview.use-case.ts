/**
 * SubjectsOverview — the learner's shelf, rolled up by subject.
 *
 * The journey answers "where am I in THIS book?"; this answers "how am I
 * doing in science, in maths?" — the question a subject teacher, a parent
 * and a learner all ask before opening any single book.
 *
 * It computes nothing of its own: every per-book number is the journey's
 * own `progress.overall` for that book, re-read here and summed by concept
 * counts. Subject completion is mastered-concepts ÷ total-concepts across
 * the subject's books, NOT an average of percentages — averaging a 10-page
 * booklet and a 200-page book would report a subject that is half-learned
 * when one book is finished and the other untouched.
 */

import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { Errors } from '../../../shared/kernel/errors.js';
import type { JourneyService } from './journey.service.js';
import type { LearnerEntitlementReader } from './ports.js';

export interface SubjectTextbookProgress {
  readonly key: string;
  readonly title: string;
  readonly total: number;
  readonly mastered: number;
  readonly completion: number;
}

export interface SubjectOverview {
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly total: number;
  readonly mastered: number;
  readonly completion: number;
  readonly textbooks: readonly SubjectTextbookProgress[];
}

export class SubjectsOverviewUseCase {
  constructor(
    private readonly entitlements: LearnerEntitlementReader,
    private readonly journey: JourneyService,
  ) {}

  async execute(input: { learnerKey: string }): Promise<
    Result<{ subjects: readonly SubjectOverview[] }>
  > {
    const books = await this.entitlements.textbooksFor(input.learnerKey);

    // One pass per book; each pass is the same walk the learner's own path
    // screen does, so these numbers can never disagree with the path.
    const bySubject = new Map<
      string,
      { subjectKey: string; subjectName: string; total: number; mastered: number; textbooks: SubjectTextbookProgress[] }
    >();

    for (const book of books) {
      const view = await this.journey.path({
        learnerKey: input.learnerKey,
        textbookKey: book.key,
      });

      // An entitled book with no published concepts reports zeros rather
      // than vanishing: it is on the learner's shelf, and its emptiness is
      // information (a content gap), not an absence.
      const overall = view.ok
        ? view.value.progress.overall
        : { total: 0, mastered: 0, completion: 0 };

      const subject =
        bySubject.get(book.subjectKey) ??
        {
          subjectKey: book.subjectKey,
          subjectName: book.subjectName,
          total: 0,
          mastered: 0,
          textbooks: [],
        };
      subject.total += overall.total;
      subject.mastered += overall.mastered;
      subject.textbooks.push({
        key: book.key,
        title: book.title,
        total: overall.total,
        mastered: overall.mastered,
        completion: overall.completion,
      });
      bySubject.set(book.subjectKey, subject);
    }

    if (books.length === 0) {
      // Distinguishing "no entitlement" from "server error" matters: the
      // first is an honest empty shelf, the second is a 500.
      return Err(
        Errors.notFound(
          'learning.no_entitlements',
          'This learner is not entitled to any textbooks.',
          { learnerKey: input.learnerKey },
        ),
      );
    }

    const subjects = [...bySubject.values()].map((s) => ({
      subjectKey: s.subjectKey,
      subjectName: s.subjectName,
      total: s.total,
      mastered: s.mastered,
      completion: s.total > 0 ? round4(s.mastered / s.total) : 0,
      textbooks: s.textbooks,
    }));

    return Ok({ subjects });
  }
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
