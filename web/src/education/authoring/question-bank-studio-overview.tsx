/** Overview strip for the Question Bank Studio. */

import type { ReactNode } from 'react';
import { BookMarked, FileCheck2, Link2, PenSquare, ShieldCheck } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Card, CardContent } from '../../design-system/ui/card';
import type { QuestionRecord } from './question-bank.api';
import { useI18n } from '../../shared/i18n/i18n';

export function QuestionBankStudioOverview({
  rows,
  total,
}: {
  readonly rows: readonly QuestionRecord[];
  readonly total: number;
}): ReactNode {
  const { t } = useI18n();
  const published = rows.filter((question) => question.status === 'PUBLISHED').length;
  const draft = rows.filter((question) => question.status === 'DRAFT').length;
  const unlinked = rows.filter((question) => question.concepts.length === 0).length;
  const essays = rows.filter((question) => question.type === 'ESSAY').length;
  const ministerial = rows.filter((question) => question.origin === 'MINISTERIAL').length;

  const metrics = [
    { label: t('questionStudio.total'), value: total, tone: 'neutral' as const },
    { label: t('questionStudio.published'), value: published, tone: 'success' as const },
    { label: t('questionStudio.drafts'), value: draft, tone: 'warning' as const },
    { label: t('questionStudio.unlinked'), value: unlinked, tone: 'warning' as const },
    { label: t('questionStudio.manual'), value: essays, tone: 'info' as const },
    { label: t('questionStudio.ministerial'), value: ministerial, tone: 'info' as const },
  ];
  const lanes = [
    { icon: PenSquare, title: t('questionStudio.laneCreate'), body: t('questionStudio.laneCreateBody') },
    { icon: FileCheck2, title: t('questionStudio.laneImport'), body: t('questionStudio.laneImportBody') },
    { icon: Link2, title: t('questionStudio.laneLink'), body: t('questionStudio.laneLinkBody') },
    { icon: ShieldCheck, title: t('questionStudio.laneReview'), body: t('questionStudio.laneReviewBody') },
    { icon: BookMarked, title: t('questionStudio.laneExam'), body: t('questionStudio.laneExamBody') },
  ];

  return (
    <Card elevation="flat">
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-text">{t('questionStudio.title')}</h2>
            <p className="mt-1 text-2xs leading-relaxed text-text-muted">{t('questionStudio.subtitle')}</p>
          </div>
          <Badge tone="info">{t('questionStudio.studioBadge')}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-surface-raised p-3">
              <p className="text-2xs text-text-muted">{metric.label}</p>
              <p className="mt-1 text-xl font-bold text-text">{metric.value}</p>
              <Badge tone={metric.tone}>{metric.label}</Badge>
            </div>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {lanes.map((lane) => {
            const Icon = lane.icon;
            return (
              <div key={lane.title} className="rounded-xl border border-border bg-surface p-3">
                <Icon className="mb-2 size-4 text-accent" aria-hidden="true" />
                <p className="text-xs font-bold text-text">{lane.title}</p>
                <p className="mt-1 text-2xs leading-relaxed text-text-muted">{lane.body}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
