import { useState, useMemo, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Plus,
  Sparkles,
  CheckCircle2,
  FileText,
  Upload,
  Download,
  ListTree,
  Edit3,
  Search,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { downloadJson } from '../../shared/platform/download';
import { useI18n } from '../../shared/i18n/i18n';
import type { GradeRecord, SubjectRecord } from '../catalogue/catalogue.api';
import type { PublicationAction, PublicationStatus, TextbookSummary } from './content.api';

export interface GradeMaterialsViewProps {
  readonly grade: GradeRecord;
  readonly subjects: readonly SubjectRecord[];
  readonly textbooks: readonly TextbookSummary[];
  readonly selectedPartOrdinal: 1 | 2;
  readonly onSelectPartOrdinal: (termOrdinal: 1 | 2) => void;
  readonly onBackToGrades: () => void;
  readonly onTransitionTextbook: (textbook: TextbookSummary, action: PublicationAction) => Promise<void>;
  readonly onOpenPdfModal: (textbook: TextbookSummary) => void;
  readonly onOpenImportModal: (textbookKey: string) => void;
  readonly onOpenOutlineModal: (textbook: TextbookSummary) => void;
  readonly onOpenEditModal: (textbook: TextbookSummary) => void;
  readonly onOpenCreateModal: () => void;
  readonly onOpenBulkModal: () => void;
  readonly onNavigateToContentManager: (textbookKey: string) => void;
  readonly canApprove?: boolean;
  readonly canManageDeployment?: boolean;
}

const transitionFor: Partial<Record<PublicationStatus, PublicationAction>> = {
  DRAFT: 'SUBMIT',
  IN_REVIEW: 'APPROVE',
  PUBLISHED: 'ARCHIVE',
};

const statusTone: Record<PublicationStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

export function GradeMaterialsView({
  grade,
  subjects,
  textbooks,
  selectedPartOrdinal,
  onSelectPartOrdinal,
  onBackToGrades,
  onTransitionTextbook,
  onOpenPdfModal,
  onOpenImportModal,
  onOpenOutlineModal,
  onOpenEditModal,
  onOpenCreateModal,
  onOpenBulkModal,
  onNavigateToContentManager,
  canApprove = false,
  canManageDeployment = false,
}: GradeMaterialsViewProps): ReactNode {
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';
  const [searchQuery, setSearchQuery] = useState('');
  const [transitionTarget, setTransitionTarget] = useState<{ textbook: TextbookSummary; action: PublicationAction } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const subjectsMap = useMemo(() => new Map(subjects.map((subject) => [subject.key, subject])), [subjects]);
  const gradeMaterials = useMemo(() => textbooks.filter((book) => {
    if (book.gradeKey !== grade.key) return false;
    return selectedPartOrdinal === 1 ? book.part === 'PART_1' : book.part === 'PART_2';
  }), [textbooks, grade.key, selectedPartOrdinal]);
  const filteredMaterials = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return gradeMaterials;
    return gradeMaterials.filter((book) => {
      const subject = subjectsMap.get(book.subjectKey);
      return book.title.toLowerCase().includes(query) || book.key.toLowerCase().includes(query) || subject?.name.toLowerCase().includes(query);
    });
  }, [gradeMaterials, searchQuery, subjectsMap]);
  const activePartName = selectedPartOrdinal === 1 ? t('textbookAdmin.part1') : t('textbookAdmin.part2');
  const publishedCount = gradeMaterials.filter((book) => book.status === 'PUBLISHED').length;
  const draftCount = gradeMaterials.filter((book) => book.status === 'DRAFT').length;

  const confirmTransition = async () => {
    if (!transitionTarget) return;
    setIsTransitioning(true);
    try {
      await onTransitionTextbook(transitionTarget.textbook, transitionTarget.action);
      setTransitionTarget(null);
    } finally {
      setIsTransitioning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onBackToGrades} className="gap-1.5 font-bold text-xs">
            {isRtl ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
            <span>{t('textbookAdmin.backToGrades')}</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div><h1 className="text-xl font-black text-text">{grade.name}</h1><p className="text-xs text-text-muted">{activePartName}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-xs">
            <button type="button" onClick={() => onSelectPartOrdinal(1)} className={`rounded-lg px-3.5 py-1.5 text-xs font-bold ${selectedPartOrdinal === 1 ? 'bg-surface-raised text-accent shadow-xs' : 'text-text-muted'}`}>{t('textbookAdmin.part1')}</button>
            <button type="button" onClick={() => onSelectPartOrdinal(2)} className={`rounded-lg px-3.5 py-1.5 text-xs font-bold ${selectedPartOrdinal === 2 ? 'bg-surface-raised text-accent shadow-xs' : 'text-text-muted'}`}>{t('textbookAdmin.part2')}</button>
          </div>
          <Button variant="primary" size="sm" onClick={onOpenCreateModal} className="gap-1.5 text-xs"><Plus className="size-4" />{t('textbookAdmin.addTextbookButton')}</Button>
          {canManageDeployment ? <Button variant="secondary" size="sm" onClick={onOpenBulkModal} className="gap-1.5 text-xs"><Sparkles className="size-4 text-accent" />{t('textbookAdmin.bulkSetupButton')}</Button> : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold"><span className="flex items-center gap-1.5 text-text"><BookOpen className="size-4 text-accent" />{t('textbookAdmin.materialsInGrade', { count: gradeMaterials.length })}</span><span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-4" />{t('textbookAdmin.publishedCount', { count: publishedCount })}</span>{draftCount > 0 ? <span className="flex items-center gap-1.5 text-warning">● {t('textbookAdmin.draftCount', { count: draftCount })}</span> : null}</div>
        <div className="relative w-full md:w-64"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('catalogue.search')} className="ps-9 text-xs" /></div>
      </div>

      {filteredMaterials.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-3"><BookOpen className="mx-auto size-12 text-text-muted/30" /><h3 className="text-sm font-bold text-text">{t('textbookAdmin.noSubjectsInPart')}</h3><p className="text-xs text-text-muted">{t('textbookAdmin.emptyBody')}</p>{canManageDeployment ? <Button variant="primary" size="sm" onClick={onOpenBulkModal}>{t('textbookAdmin.bulkSetupButton')}</Button> : null}</div> : <div className="space-y-4">{filteredMaterials.map((book) => {
        const subject = subjectsMap.get(book.subjectKey);
        const action = canApprove ? transitionFor[book.status] : book.status === 'DRAFT' ? 'SUBMIT' : undefined;
        return <div key={book.key} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-accent/30 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4"><div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-subtle">{book.coverUrl ? <img src={book.coverUrl} alt={book.title} className="size-full object-cover" loading="lazy" /> : <span className="grid size-full place-items-center text-accent"><BookOpen className="size-6" /></span>}</div><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-text truncate">{book.title}</h3><Badge tone={statusTone[book.status]}>{t(`publication.${book.status}` as never)}</Badge>{book.edition ? <Badge tone="neutral">{book.edition}</Badge> : null}</div><div className="flex flex-wrap items-center gap-3 text-2xs text-text-muted font-medium"><span>{subject?.name || book.subjectKey}</span><span>·</span><span dir="ltr" className="font-mono">{book.key}</span><span>·</span><span>{t('textbookAdmin.outlineUnitsCount', { count: book.unitCount ?? 0 })}</span><span>·</span><span>{t('textbookAdmin.outlineQuestionsCount', { count: book.questionCount ?? 0 })}</span></div><div className="pt-1">{book.totalPages ? <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-0.5 text-2xs font-semibold text-text-muted border border-border"><FileText className="size-3 text-accent" />{t('textbookAdmin.totalPages')}: {book.totalPages}</span> : <span className="inline-flex items-center gap-1 text-2xs text-text-muted"><FileText className="size-3 opacity-60" />{t('textbookAdmin.pdfNoneAttached')}</span>}</div></div></div>
          <div className="flex flex-wrap items-center gap-2 self-end lg:self-center">{action ? <Button variant="primary" size="sm" onClick={() => setTransitionTarget({ textbook: book, action })} className="gap-1.5 text-xs font-bold"><CheckCircle2 className="size-3.5" />{t(`textbookAdmin.${action === 'SUBMIT' ? 'submit' : action === 'APPROVE' ? 'approve' : 'archive'}` as never)}</Button> : null}<Button variant="secondary" size="sm" onClick={() => onNavigateToContentManager(book.key)} className="gap-1.5 text-xs font-bold"><ListTree className="size-3.5 text-accent" />{t('textbookAdmin.manageContentBtn')}</Button><Button variant="secondary" size="sm" onClick={() => onOpenPdfModal(book)} className="gap-1.5 text-xs"><FileText className="size-3.5 text-text-muted" />{t('textbookAdmin.pdfModalBtn')}</Button><Button variant="ghost" size="sm" onClick={() => onOpenImportModal(book.key)} className="gap-1 text-xs text-text-muted"><Upload className="size-3.5" />{t('content.importPackageTitle')}</Button><Button variant="ghost" size="sm" onClick={() => downloadJson(`${book.key}-export.json`, book)} className="gap-1 text-xs text-text-muted"><Download className="size-3.5" />{t('textbookAdmin.downloadExport')}</Button><Button variant="ghost" size="sm" onClick={() => onOpenOutlineModal(book)} className="gap-1 text-xs text-text-muted"><ExternalLink className="size-3.5" />{t('textbookAdmin.viewOutline')}</Button><Button variant="ghost" size="iconSm" onClick={() => onOpenEditModal(book)} aria-label={t('textbookAdmin.editTextbook')} className="text-text-muted"><Edit3 className="size-4" /></Button></div>
        </div>;
      })}</div>}

      {transitionTarget ? <ConfirmDialog title={t('textbookAdmin.confirmTransition', { action: t(`textbookAdmin.${transitionTarget.action === 'SUBMIT' ? 'submit' : transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never), name: transitionTarget.textbook.title })} body={t('textbookAdmin.confirmTransition', { action: t(`textbookAdmin.${transitionTarget.action === 'SUBMIT' ? 'submit' : transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never), name: transitionTarget.textbook.title })} confirmLabel={t('common.working')} pending={isTransitioning} onConfirm={confirmTransition} onCancel={() => setTransitionTarget(null)} /> : null}
    </div>
  );
}
