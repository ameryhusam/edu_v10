/**
 * Diagnostic placement.
 *
 * The diagnostic does not store a separate "level". It writes ordinary
 * DIAGNOSTIC attempt evidence, then the placement endpoint reads mastery to
 * suggest the first honest starting point in the book.
 */

import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { ExamRunner, type RunScope } from '../../education/assessment/exam-runner';
import {
  useDiagnosticPlacement,
  useJourney,
  useLearnerTextbooks,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import { TextbookPicker } from '../../education/learning/textbook-picker';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';

export function DiagnosticPage(): ReactNode {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const textbooks = useLearnerTextbooks();
  const { selected, select } = useSelectedTextbook(textbooks.data?.textbooks);
  const requested = searchParams.get('textbook');
  const active =
    requested && textbooks.data?.textbooks.some((book) => book.key === requested)
      ? requested
      : selected;

  const journey = useJourney({ textbookKey: active });
  const placement = useDiagnosticPlacement({ textbookKey: active });

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }
  if (textbooks.data.textbooks.length === 0) {
    return <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />;
  }

  const book = textbooks.data.textbooks.find((candidate) => candidate.key === active) ?? null;
  const firstLesson = journey.data?.lessons.slice().sort((a, b) => a.order - b.order)[0] ?? null;
  const diagnosticScope: RunScope | null =
    journey.isSuccess && firstLesson && book
      ? {
          key: `diagnostic-${book.key}`,
          title: t('diagnostic.runnerTitle', { book: book.title }),
          description: t('diagnostic.runnerIntro'),
          isAdaptive: true,
          timeLimitMins: null,
          textbookKey: book.key,
          conceptKeys: journey.data.path.map((node) => node.conceptKey),
          lessonKey: firstLesson.key,
        }
      : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('diagnostic.title')} subtitle={t('diagnostic.subtitle')} />

      {textbooks.data.textbooks.length > 1 ? (
        <TextbookPicker books={textbooks.data.textbooks} selected={active} onSelect={select} />
      ) : null}

      {placement.isPending || journey.isPending ? (
        <LoadingState />
      ) : placement.isError ? (
        <ErrorState error={placement.error} onRetry={() => void placement.refetch()} />
      ) : journey.isError ? (
        <ErrorState error={journey.error} onRetry={() => void journey.refetch()} />
      ) : placement.data.status === 'PLACED' && placement.data.placement ? (
        <Card elevation="raised">
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success-subtle text-success">
                <ClipboardCheck className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-text">{t('diagnostic.placedTitle')}</h2>
                <p className="text-sm text-text-muted">
                  {placement.data.placement.lessonName} · {placement.data.placement.conceptName}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {t('diagnostic.placedSummary', {
                    mastered: formatCount(locale, placement.data.summary.masteredConcepts),
                    total: formatCount(locale, placement.data.summary.totalConcepts),
                    mastery: formatRatioAsPercent(locale, placement.data.placement.mastery),
                  })}
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => navigate(`/lesson?lesson=${placement.data.placement!.lessonKey}`)}
            >
              {t('learning.continueLearning')}
            </Button>
          </CardContent>
        </Card>
      ) : placement.data.status === 'COMPLETE' ? (
        <Card elevation="raised">
          <CardContent className="space-y-3">
            <h2 className="text-lg font-bold text-text">{t('diagnostic.completeTitle')}</h2>
            <p className="text-sm text-text-muted">{t('diagnostic.completeBody')}</p>
            <Button variant="primary" onClick={() => navigate('/')}>
              {t('lesson.returnHome')}
            </Button>
          </CardContent>
        </Card>
      ) : diagnosticScope ? (
        <ExamRunner
          exam={diagnosticScope}
          attemptKind="DIAGNOSTIC"
          onExit={() => navigate('/')}
          completionNotice={
            <p className="rounded-xl border border-info-border bg-info-subtle p-3 text-xs text-info">
              {t('diagnostic.finishedNotice')}
            </p>
          }
          completionActions={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => navigate('/')}>
                {t('lesson.returnHome')}
              </Button>
              <Button variant="secondary" onClick={() => void placement.refetch()}>
                {t('diagnostic.refreshPlacement')}
              </Button>
            </div>
          }
        />
      ) : (
        <EmptyState title={t('diagnostic.noScopeTitle')} body={t('diagnostic.noScopeBody')} />
      )}
    </div>
  );
}
