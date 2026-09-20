/**
 * My subjects.
 *
 * The books a learner holds, grouped the way a learner thinks of them — by
 * subject — rather than the way the catalogue stores them. Each shelf now has
 * a subject identity, a visible mastery bar and a direct resume action; the
 * target still comes from the journey endpoint, so the page never invents a
 * curriculum position.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, FlaskConical, Globe2, Languages, Palette, PenLine } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { PageHeader } from '../../design-system/patterns/page-header';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { ProgressBar } from '../../education/progress/progress-bar';
import { useJourney, useLearnerTextbooks, useSubjects } from '../../education/learning/use-learning';
import type { LearnerTextbook, PathNode, SubjectOverview } from '../../education/learning/learning.api';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import { cn } from '../../design-system/ui/cn';

export function SubjectsPage(): ReactNode {
  const { t, locale } = useI18n();
  const textbooks = useLearnerTextbooks();
  const subjects = useSubjects();

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }

  const books = textbooks.data.textbooks;
  if (books.length === 0) {
    return <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />;
  }

  const bySubject = new Map<string, { name: string; books: LearnerTextbook[] }>();
  for (const book of books) {
    const group = bySubject.get(book.subjectKey) ?? { name: book.subjectName, books: [] };
    group.books.push(book);
    bySubject.set(book.subjectKey, group);
  }

  const rollupByKey = new Map(
    (subjects.data?.subjects ?? []).map((s) => [s.subjectKey, s]),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('subjects.title')} subtitle={t('subjects.intro')} />

      <div className="grid gap-4 md:grid-cols-2">
        {[...bySubject.entries()].map(([subjectKey, group]) => {
          const rollup = rollupByKey.get(subjectKey);
          const visual = subjectVisual(subjectKey);
          return (
            <Card key={subjectKey} elevation="raised" className={cn('overflow-hidden', visual.ring)}>
              <CardContent className="space-y-4 py-5">
                <div className="flex items-center gap-3">
                  <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl ring-1', visual.iconBox)}>
                    {visual.icon}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-extrabold text-text">{group.name}</h2>
                    <p className="text-2xs text-text-muted">
                      {t('subjects.booksCount', { n: formatCount(locale, group.books.length) })}
                    </p>
                  </div>
                </div>

                {rollup ? <SubjectMasteryBar overview={rollup} /> : null}

                <div className="grid gap-2">
                  {group.books.map((book) => (
                    <BookTile
                      key={book.key}
                      book={book}
                      rollup={rollup?.textbooks.find((entry) => entry.key === book.key) ?? null}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BookTile({
  book,
  rollup,
}: {
  readonly book: LearnerTextbook;
  readonly rollup: SubjectOverview['textbooks'][number] | null;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link to={`/path?textbook=${book.key}`} className="min-w-0 text-sm font-bold text-text hover:text-accent">
          {book.title}
        </Link>
        <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs text-text-muted">
          {book.gradeName} · {book.termName} · {book.academicYearKey}
        </span>
      </div>
      {rollup ? (
        <div className="mt-3">
          <ProgressBar
            completion={rollup.completion}
            label={t('subjects.bookMasteryLong', {
              mastered: String(rollup.mastered),
              total: String(rollup.total),
            })}
          />
        </div>
      ) : null}
      <BookResumeLink book={book} />
    </div>
  );
}

function BookResumeLink({ book }: { readonly book: LearnerTextbook }): ReactNode {
  const { t } = useI18n();
  const journey = useJourney({ textbookKey: book.key });
  const resume = journey.isSuccess ? findResumeNode(journey.data.path, journey.data.currentConceptKey) : null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {resume ? (
        <Link
          to={`/lesson?lesson=${resume.lessonKey}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-transparent bg-accent px-3 text-sm font-semibold text-text-on-accent shadow-sm hover:bg-accent-hover"
        >
          {t('subjects.resumeBook', { lesson: resume.lessonName })}
        </Link>
      ) : null}
      <Link
        to={`/path?textbook=${book.key}`}
        className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-text hover:bg-surface-hover"
      >
        {t('subjects.openPath')}
      </Link>
    </div>
  );
}

/** The subject's own bar: mastered concepts across its books, from the server. */
function SubjectMasteryBar({ overview }: { readonly overview: SubjectOverview }): ReactNode {
  const { t } = useI18n();
  return (
    <ProgressBar
      completion={overview.completion}
      label={t('subjects.subjectMastery', {
        mastered: String(overview.mastered),
        total: String(overview.total),
      })}
    />
  );
}

function findResumeNode(path: readonly PathNode[], currentConceptKey: string | null): PathNode | null {
  return (
    path.find((node) => node.conceptKey === currentConceptKey) ??
    path.find((node) => node.state === 'IN_PROGRESS' || node.state === 'STRUGGLING') ??
    path.find((node) => node.state === 'NOT_STARTED') ??
    null
  );
}

function subjectVisual(subjectKey: string): {
  readonly icon: ReactNode;
  readonly iconBox: string;
  readonly ring: string;
} {
  const key = subjectKey.toUpperCase();
  if (key.includes('MATH')) {
    return {
      icon: <Calculator className="size-6" aria-hidden="true" />,
      iconBox: 'bg-accent-subtle text-accent ring-accent-border',
      ring: 'border-accent-border',
    };
  }
  if (key.includes('SCI') || key.includes('BIO') || key.includes('CHEM') || key.includes('PHYS')) {
    return {
      icon: <FlaskConical className="size-6" aria-hidden="true" />,
      iconBox: 'bg-success-subtle text-success ring-success-border',
      ring: 'border-success-border',
    };
  }
  if (key.includes('ARAB')) {
    return {
      icon: <PenLine className="size-6" aria-hidden="true" />,
      iconBox: 'bg-warning-subtle text-warning ring-warning-border',
      ring: 'border-warning-border',
    };
  }
  if (key.includes('ENG') || key.includes('LANG')) {
    return {
      icon: <Languages className="size-6" aria-hidden="true" />,
      iconBox: 'bg-info-subtle text-info ring-info-border',
      ring: 'border-info-border',
    };
  }
  if (key.includes('ART')) {
    return {
      icon: <Palette className="size-6" aria-hidden="true" />,
      iconBox: 'bg-advisory-subtle text-advisory ring-advisory-border',
      ring: 'border-advisory-border',
    };
  }
  return {
    icon: <Globe2 className="size-6" aria-hidden="true" />,
    iconBox: 'bg-surface-sunken text-text-muted ring-border',
    ring: 'border-border',
  };
}
