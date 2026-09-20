/**
 * grades-active-view.tsx
 *
 * Screen 1: Active Grades list for Curriculum and Textbook Administration.
 * Features:
 * - Only Term 1 and Term 2 (removed "All terms" classification).
 * - Auto-selects active term.
 * - Displays active grades only.
 * - Stage filtering and instant search.
 * - Interactive navigation to Screen 2 upon clicking any grade.
 */

import { useState, useMemo, type ReactNode } from 'react';
import { Search, Plus, Sparkles, Building2 } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { GradeRecord } from '../catalogue/catalogue.api';
import type { TextbookSummary } from './content.api';
import { GradeCardItem, type GradeCardStats } from './grade-card-item';

export interface GradesActiveViewProps {
  readonly grades: readonly GradeRecord[];
  readonly textbooks: readonly TextbookSummary[];
  readonly selectedTermOrdinal: 1 | 2;
  readonly onSelectTermOrdinal: (termOrdinal: 1 | 2) => void;
  readonly onSelectGrade: (gradeKey: string) => void;
  readonly onOpenCreateModal: () => void;
  readonly onOpenBulkModal: () => void;
  readonly onOpenAccreditModal: () => void;
}

export function GradesActiveView({
  grades,
  textbooks,
  selectedTermOrdinal,
  onSelectTermOrdinal,
  onSelectGrade,
  onOpenCreateModal,
  onOpenBulkModal,
  onOpenAccreditModal,
}: GradesActiveViewProps): ReactNode {
  const { t } = useI18n();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<'ALL' | 'BASIC' | 'SECONDARY'>('ALL');

  // Filter only active grades
  const activeGrades = useMemo(() => {
    return grades.filter((g) => g.isActive !== false);
  }, [grades]);

  const activeTermName = selectedTermOrdinal === 1 ? t('textbookAdmin.term1') : t('textbookAdmin.term2');

  // Compute stats per grade for this term
  const statsByGradeKey = useMemo(() => {
    const map = new Map<string, GradeCardStats>();

    for (const grade of activeGrades) {
      const gradeBooks = textbooks.filter((b) => {
        if (b.gradeKey !== grade.key) return false;
        const bTerm = b.termKey?.toLowerCase() ?? '';
        const isT1 = bTerm.includes('1') || bTerm.includes('t1') || bTerm.includes('term1');
        const isT2 = bTerm.includes('2') || bTerm.includes('t2') || bTerm.includes('term2');
        return selectedTermOrdinal === 1 ? isT1 : isT2;
      });

      const published = gradeBooks.filter((b) => b.status === 'PUBLISHED').length;
      const draft = gradeBooks.filter((b) => b.status === 'DRAFT').length;
      let units = 0;
      let questions = 0;
      for (const b of gradeBooks) {
        units += b.unitCount ?? 0;
        questions += b.questionCount ?? 0;
      }

      map.set(grade.key, {
        total: gradeBooks.length,
        published,
        draft,
        units,
        questions,
      });
    }

    return map;
  }, [activeGrades, textbooks, selectedTermOrdinal]);

  // Filter grades by search and stage
  const filteredGrades = useMemo(() => {
    return activeGrades.filter((g) => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = g.name.toLowerCase().includes(q);
        const matchKey = g.key.toLowerCase().includes(q);
        if (!matchName && !matchKey) return false;
      }

      const isBasic = g.ordinal <= 9;
      if (selectedStage === 'BASIC' && !isBasic) return false;
      if (selectedStage === 'SECONDARY' && isBasic) return false;

      return true;
    });
  }, [activeGrades, searchQuery, selectedStage]);

  // Overall totals for active term
  const totals = useMemo(() => {
    let totalMaterials = 0;
    let totalPublished = 0;
    let totalDraft = 0;
    for (const stats of statsByGradeKey.values()) {
      totalMaterials += stats.total;
      totalPublished += stats.published;
      totalDraft += stats.draft;
    }
    return { totalMaterials, totalPublished, totalDraft };
  }, [statsByGradeKey]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-text">{t('textbookAdmin.gradesTitle')}</h1>
            <Badge tone="accent">{t('textbookAdmin.activeGradesOnly')}</Badge>
          </div>
          <p className="text-xs text-text-muted">{t('textbookAdmin.gradesSubtitle')}</p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={onOpenCreateModal} className="gap-1.5">
            <Plus className="size-4" />
            <span>{t('textbookAdmin.addTextbookButton')}</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenBulkModal} className="gap-1.5">
            <Sparkles className="size-4 text-accent" />
            <span>{t('textbookAdmin.bulkSetupButton')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenAccreditModal} className="gap-1.5">
            <Building2 className="size-4 text-text-muted" />
            <span>{t('textbookAdmin.accreditToSchoolButton')}</span>
          </Button>
        </div>
      </div>

      {/* Term Selector & Live Filter Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        {/* Term 1 & Term 2 ONLY (No 'All' option) */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-muted">{t('settings.terms')}:</span>
          <div className="inline-flex rounded-xl border border-border bg-surface-subtle p-1">
            <button
              type="button"
              onClick={() => onSelectTermOrdinal(1)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                selectedTermOrdinal === 1
                  ? 'bg-surface text-accent shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {t('textbookAdmin.term1')}
            </button>
            <button
              type="button"
              onClick={() => onSelectTermOrdinal(2)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                selectedTermOrdinal === 2
                  ? 'bg-surface text-accent shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {t('textbookAdmin.term2')}
            </button>
          </div>
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {t('textbookAdmin.activeTermLabel')}
          </Badge>
        </div>

        {/* Stage Filter Buttons */}
        <div className="flex items-center gap-1.5">
          <Button
            variant={selectedStage === 'ALL' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSelectedStage('ALL')}
            className="text-xs font-semibold"
          >
            {t('textbookAdmin.allStages')}
          </Button>
          <Button
            variant={selectedStage === 'BASIC' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSelectedStage('BASIC')}
            className="text-xs font-semibold"
          >
            {t('textbookAdmin.stageBasic')}
          </Button>
          <Button
            variant={selectedStage === 'SECONDARY' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSelectedStage('SECONDARY')}
            className="text-xs font-semibold"
          >
            {t('textbookAdmin.stageSecondary')}
          </Button>
        </div>

        {/* Search */}
        <div className="relative w-full lg:w-72">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('textbookAdmin.searchGrades')}
            className="ps-9 text-xs"
          />
        </div>
      </div>

      {/* Summary Metrics Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <span className="text-2xs font-semibold text-text-muted">{t('settings.grades')}</span>
          <p className="text-lg font-black text-text">{filteredGrades.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactTotal')}</span>
          <p className="text-lg font-black text-text">{totals.totalMaterials}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactPublished')}</span>
          <p className="text-lg font-black text-success">{totals.totalPublished}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactDraft')}</span>
          <p className="text-lg font-black text-warning">{totals.totalDraft}</p>
        </div>
      </div>

      {/* Active Grades Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filteredGrades.map((grade) => (
          <GradeCardItem
            key={grade.key}
            grade={grade}
            stats={statsByGradeKey.get(grade.key) || { total: 0, published: 0, draft: 0, units: 0, questions: 0 }}
            activeTermName={activeTermName}
            onSelectGrade={onSelectGrade}
          />
        ))}
      </div>
    </div>
  );
}
