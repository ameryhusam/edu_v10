import { useState, useMemo, type ReactNode } from 'react';
import { Search, Plus, Sparkles, Building2 } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { GradeRecord } from '../catalogue/catalogue.api';
import type { TextbookSummary, PublicationStatus } from './content.api';
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
  readonly onOpenWorkspaceModal?: () => void;
  readonly statusFilter?: PublicationStatus | undefined;
  readonly onSelectStatus: (status: PublicationStatus | undefined) => void;
}

const statuses: readonly PublicationStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'];

export function GradesActiveView({ grades, textbooks, selectedTermOrdinal, onSelectTermOrdinal, onSelectGrade, onOpenCreateModal, onOpenBulkModal, onOpenAccreditModal, onOpenWorkspaceModal, statusFilter, onSelectStatus }: GradesActiveViewProps): ReactNode {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<'ALL' | 'BASIC' | 'SECONDARY'>('ALL');
  const activeGrades = useMemo(() => grades.filter((g) => g.isActive !== false), [grades]);
  const activeTermName = selectedTermOrdinal === 1 ? t('textbookAdmin.term1') : t('textbookAdmin.term2');
  const gradeBooksForTerm = (gradeKey: string) => textbooks.filter((b) => {
    if (b.gradeKey !== gradeKey) return false;
    const term = b.termKey.toLowerCase();
    const inTerm = selectedTermOrdinal === 1 ? term.includes('1') || term.includes('t1') || term.includes('term1') : term.includes('2') || term.includes('t2') || term.includes('term2');
    return inTerm && (!statusFilter || b.status === statusFilter);
  });
  const statsByGradeKey = useMemo(() => {
    const map = new Map<string, GradeCardStats>();
    for (const grade of activeGrades) {
      const books = gradeBooksForTerm(grade.key);
      map.set(grade.key, {
        total: books.length,
        published: books.filter((b) => b.status === 'PUBLISHED').length,
        draft: books.filter((b) => b.status === 'DRAFT').length,
        units: books.reduce((sum, b) => sum + (b.unitCount ?? 0), 0),
        questions: books.reduce((sum, b) => sum + (b.questionCount ?? 0), 0),
      });
    }
    return map;
  }, [activeGrades, textbooks, selectedTermOrdinal, statusFilter]);
  const filteredGrades = useMemo(() => activeGrades.filter((g) => {
    const q = searchQuery.trim().toLowerCase();
    if (q && !g.name.toLowerCase().includes(q) && !g.key.toLowerCase().includes(q)) return false;
    const isBasic = g.ordinal <= 9;
    return selectedStage === 'ALL' || (selectedStage === 'BASIC' ? isBasic : !isBasic);
  }), [activeGrades, searchQuery, selectedStage]);
  const totals = [...statsByGradeKey.values()].reduce((acc, stats) => ({ total: acc.total + stats.total, published: acc.published + stats.published, draft: acc.draft + stats.draft }), { total: 0, published: 0, draft: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="space-y-1"><div className="flex items-center gap-2"><h1 className="text-xl font-black text-text">{t('textbookAdmin.gradesTitle')}</h1><Badge tone="accent">{t('textbookAdmin.activeGradesOnly')}</Badge></div><p className="text-xs text-text-muted">{t('textbookAdmin.gradesSubtitle')}</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="primary" size="sm" onClick={onOpenCreateModal} className="gap-1.5"><Plus className="size-4" /><span>{t('textbookAdmin.addTextbookButton')}</span></Button>{onOpenWorkspaceModal && (<Button variant="secondary" size="sm" onClick={onOpenWorkspaceModal} className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"><Sparkles className="size-4 text-primary" /><span>مساحة العمل والتقطيع (Workspace)</span></Button>)}<Button variant="secondary" size="sm" onClick={onOpenBulkModal} className="gap-1.5"><Sparkles className="size-4 text-accent" /><span>{t('textbookAdmin.bulkSetupButton')}</span></Button><Button variant="ghost" size="sm" onClick={onOpenAccreditModal} className="gap-1.5"><Building2 className="size-4 text-text-muted" /><span>{t('textbookAdmin.accreditToSchoolButton')}</span></Button></div></div>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-2"><span className="text-xs font-bold text-text-muted">{t('settings.terms')}:</span><div className="inline-flex rounded-xl border border-border bg-surface-subtle p-1"><button type="button" onClick={() => onSelectTermOrdinal(1)} className={`rounded-lg px-4 py-1.5 text-xs font-bold ${selectedTermOrdinal === 1 ? 'bg-surface text-accent shadow-xs' : 'text-text-muted'}`}>{t('textbookAdmin.term1')}</button><button type="button" onClick={() => onSelectTermOrdinal(2)} className={`rounded-lg px-4 py-1.5 text-xs font-bold ${selectedTermOrdinal === 2 ? 'bg-surface text-accent shadow-xs' : 'text-text-muted'}`}>{t('textbookAdmin.term2')}</button></div></div><div className="flex flex-wrap items-center gap-1.5"><Button variant={!statusFilter ? 'secondary' : 'ghost'} size="sm" onClick={() => onSelectStatus(undefined)} className="text-xs">{t('common.all')}</Button>{statuses.map((status) => <Button key={status} variant={statusFilter === status ? 'secondary' : 'ghost'} size="sm" onClick={() => onSelectStatus(status)} className="text-xs">{t(`publication.${status}` as never)}</Button>)}</div><div className="flex items-center gap-1.5"><Button variant={selectedStage === 'ALL' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedStage('ALL')} className="text-xs">{t('textbookAdmin.allStages')}</Button><Button variant={selectedStage === 'BASIC' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedStage('BASIC')} className="text-xs">{t('textbookAdmin.stageBasic')}</Button><Button variant={selectedStage === 'SECONDARY' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedStage('SECONDARY')} className="text-xs">{t('textbookAdmin.stageSecondary')}</Button></div><div className="relative w-full lg:w-72"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('textbookAdmin.searchGrades')} className="ps-9 text-xs" /></div></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-border bg-surface p-3.5"><span className="text-2xs font-semibold text-text-muted">{t('settings.grades')}</span><p className="text-lg font-black text-text">{filteredGrades.length}</p></div><div className="rounded-xl border border-border bg-surface p-3.5"><span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactTotal')}</span><p className="text-lg font-black text-text">{totals.total}</p></div><div className="rounded-xl border border-border bg-surface p-3.5"><span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactPublished')}</span><p className="text-lg font-black text-success">{totals.published}</p></div><div className="rounded-xl border border-border bg-surface p-3.5"><span className="text-2xs font-semibold text-text-muted">{t('textbookAdmin.compactDraft')}</span><p className="text-lg font-black text-warning">{totals.draft}</p></div></div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{filteredGrades.map((grade) => <GradeCardItem key={grade.key} grade={grade} stats={statsByGradeKey.get(grade.key) || { total: 0, published: 0, draft: 0, units: 0, questions: 0 }} activeTermName={activeTermName} onSelectGrade={onSelectGrade} />)}</div>
    </div>
  );
}
