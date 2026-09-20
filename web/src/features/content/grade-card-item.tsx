/**
 * grade-card-item.tsx
 *
 * Card component for displaying an active grade on Screen 1 of Textbook Administration.
 * Shows curriculum progress, total courses, published vs draft counts, and navigation.
 */

import { type ReactNode } from 'react';
import { GraduationCap, BookOpen, CheckCircle2, FileEdit, ArrowLeft, ArrowRight } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import type { GradeRecord } from '../catalogue/catalogue.api';

export interface GradeCardStats {
  readonly total: number;
  readonly published: number;
  readonly draft: number;
  readonly units: number;
  readonly questions: number;
}

export interface GradeCardItemProps {
  readonly grade: GradeRecord;
  readonly stats: GradeCardStats;
  readonly activeTermName: string;
  readonly onSelectGrade: (gradeKey: string) => void;
}

export function GradeCardItem({
  grade,
  stats,
  activeTermName,
  onSelectGrade,
}: GradeCardItemProps): ReactNode {
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';

  const percentPublished = stats.total > 0 ? Math.round((stats.published / stats.total) * 100) : 0;
  const isBasic = grade.ordinal <= 9;

  return (
    <div
      onClick={() => onSelectGrade(grade.key)}
      className="group flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-accent/40 hover:shadow-md cursor-pointer"
    >
      {/* Top Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent group-hover:bg-accent group-hover:text-white transition-colors">
              <GraduationCap className="size-6" />
            </span>
            <div>
              <h3 className="text-base font-extrabold text-text group-hover:text-accent transition-colors">
                {grade.name}
              </h3>
              <p className="text-2xs font-medium text-text-muted">{activeTermName}</p>
            </div>
          </div>

          <Badge tone={isBasic ? 'neutral' : 'accent'}>
            {isBasic ? t('textbookAdmin.stageBasic') : t('textbookAdmin.stageSecondary')}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-2xs font-semibold">
            <span className="text-text-muted">
              {t('textbookAdmin.publishedProgress', {
                published: stats.published,
                total: stats.total,
              })}
            </span>
            <span className="text-accent">{percentPublished}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subtle border border-border/50">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${percentPublished}%` }}
            />
          </div>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-2 gap-2 pt-1 text-2xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle p-2">
            <CheckCircle2 className="size-3.5 text-success shrink-0" />
            <span className="truncate font-semibold text-text">
              {t('textbookAdmin.publishedCount', { count: stats.published })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle p-2">
            <FileEdit className="size-3.5 text-warning shrink-0" />
            <span className="truncate font-semibold text-text">
              {t('textbookAdmin.draftCount', { count: stats.draft })}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Navigation CTA */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
          <BookOpen className="size-4" />
          <span>{t('textbookAdmin.materialsInGrade', { count: stats.total })}</span>
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs font-bold text-accent group-hover:bg-accent-subtle"
          onClick={(e) => {
            e.stopPropagation();
            onSelectGrade(grade.key);
          }}
        >
          <span>{t('textbookAdmin.viewGradeMaterials')}</span>
          {isRtl ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
