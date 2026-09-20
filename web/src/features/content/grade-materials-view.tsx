/**
 * grade-materials-view.tsx
 *
 * Screen 2: Materials of the Selected Grade and Selected Term.
 * Features:
 * - Direct navigation back to the Grade list (Screen 1).
 * - Term switcher (Term 1 & Term 2) for immediate flipping.
 * - Comprehensive controls against each subject/textbook:
 *   1. Publish / Activate (DRAFT -> PUBLISHED) with confirmation.
 *   2. Content Management tab/action (إدارة المحتوى).
 *   3. Attached PDF Management modal trigger.
 *   4. Granular Import & Export actions.
 *   5. Outline inspection and Edit metadata.
 */

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
import type { GradeRecord, SubjectRecord, TermRecord } from '../catalogue/catalogue.api';
import type { TextbookSummary } from './content.api';

export interface GradeMaterialsViewProps {
  readonly grade: GradeRecord;
  readonly terms: readonly TermRecord[];
  readonly subjects: readonly SubjectRecord[];
  readonly textbooks: readonly TextbookSummary[];
  readonly selectedTermOrdinal: 1 | 2;
  readonly onSelectTermOrdinal: (termOrdinal: 1 | 2) => void;
  readonly onBackToGrades: () => void;
  readonly onPublishTextbook: (textbookKey: string) => Promise<void>;
  readonly onOpenPdfModal: (textbook: TextbookSummary) => void;
  readonly onOpenImportModal: (textbookKey: string) => void;
  readonly onOpenOutlineModal: (textbook: TextbookSummary) => void;
  readonly onOpenEditModal: (textbook: TextbookSummary) => void;
  readonly onOpenCreateModal: () => void;
  readonly onOpenBulkModal: () => void;
  readonly onNavigateToContentManager: (textbookKey: string) => void;
}

export function GradeMaterialsView({
  grade,
  subjects,
  textbooks,
  selectedTermOrdinal,
  onSelectTermOrdinal,
  onBackToGrades,
  onPublishTextbook,
  onOpenPdfModal,
  onOpenImportModal,
  onOpenOutlineModal,
  onOpenEditModal,
  onOpenCreateModal,
  onOpenBulkModal,
  onNavigateToContentManager,
}: GradeMaterialsViewProps): ReactNode {
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';

  const [searchQuery, setSearchQuery] = useState('');
  const [publishTarget, setPublishTarget] = useState<TextbookSummary | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Subject lookup map
  const subjectsMap = useMemo(() => {
    const map = new Map<string, SubjectRecord>();
    for (const s of subjects) map.set(s.key, s);
    return map;
  }, [subjects]);

  // Filter textbooks for this grade and selected term
  const gradeMaterials = useMemo(() => {
    return textbooks.filter((b) => {
      if (b.gradeKey !== grade.key) return false;
      const bTerm = b.termKey?.toLowerCase() ?? '';
      const isT1 = bTerm.includes('1') || bTerm.includes('t1') || bTerm.includes('term1');
      const isT2 = bTerm.includes('2') || bTerm.includes('t2') || bTerm.includes('term2');
      return selectedTermOrdinal === 1 ? isT1 : isT2;
    });
  }, [textbooks, grade.key, selectedTermOrdinal]);

  // Filtered by search query
  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return gradeMaterials;
    const q = searchQuery.trim().toLowerCase();
    return gradeMaterials.filter((b) => {
      const subject = subjectsMap.get(b.subjectKey);
      return (
        b.title.toLowerCase().includes(q) ||
        b.key.toLowerCase().includes(q) ||
        (subject && subject.name.toLowerCase().includes(q))
      );
    });
  }, [gradeMaterials, searchQuery, subjectsMap]);

  const activeTermName = selectedTermOrdinal === 1 ? t('textbookAdmin.term1') : t('textbookAdmin.term2');
  const publishedCount = gradeMaterials.filter((b) => b.status === 'PUBLISHED').length;
  const draftCount = gradeMaterials.filter((b) => b.status === 'DRAFT').length;

  const handleConfirmPublish = async () => {
    if (!publishTarget) return;
    setIsPublishing(true);
    try {
      await onPublishTextbook(publishTarget.key);
      setPublishTarget(null);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumbs & Back Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onBackToGrades}
            className="gap-1.5 font-bold text-xs"
          >
            {isRtl ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
            <span>{t('textbookAdmin.backToGrades')}</span>
          </Button>

          <div className="h-4 w-px bg-border" />

          <div>
            <h1 className="text-xl font-black text-text">{grade.name}</h1>
            <p className="text-xs text-text-muted">{activeTermName}</p>
          </div>
        </div>

        {/* Term Switcher & Top Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Term 1 / Term 2 Direct Switcher */}
          <div className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-xs">
            <button
              type="button"
              onClick={() => onSelectTermOrdinal(1)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                selectedTermOrdinal === 1
                  ? 'bg-surface-raised text-accent shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {t('textbookAdmin.term1')}
            </button>
            <button
              type="button"
              onClick={() => onSelectTermOrdinal(2)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                selectedTermOrdinal === 2
                  ? 'bg-surface-raised text-accent shadow-xs'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {t('textbookAdmin.term2')}
            </button>
          </div>

          <Button variant="primary" size="sm" onClick={onOpenCreateModal} className="gap-1.5 text-xs">
            <Plus className="size-4" />
            <span>{t('textbookAdmin.addTextbookButton')}</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenBulkModal} className="gap-1.5 text-xs">
            <Sparkles className="size-4 text-accent" />
            <span>{t('textbookAdmin.bulkSetupButton')}</span>
          </Button>
        </div>
      </div>

      {/* Grade Summary Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-text">
            <BookOpen className="size-4 text-accent" />
            <span>{t('textbookAdmin.materialsInGrade', { count: gradeMaterials.length })}</span>
          </span>
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="size-4" />
            <span>{t('textbookAdmin.publishedCount', { count: publishedCount })}</span>
          </span>
          {draftCount > 0 && (
            <span className="flex items-center gap-1.5 text-warning">
              <span>●</span>
              <span>{t('textbookAdmin.draftCount', { count: draftCount })}</span>
            </span>
          )}
        </div>

        {/* Material Search */}
        <div className="relative w-full md:w-64">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('catalogue.search')}
            className="ps-9 text-xs"
          />
        </div>
      </div>

      {/* Materials List */}
      {filteredMaterials.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-3">
          <BookOpen className="mx-auto size-12 text-text-muted/30" />
          <h3 className="text-sm font-bold text-text">{t('textbookAdmin.noSubjectsInTerm')}</h3>
          <p className="text-xs text-text-muted">{t('textbookAdmin.emptyBody')}</p>
          <div className="pt-2">
            <Button variant="primary" size="sm" onClick={onOpenBulkModal}>
              {t('textbookAdmin.bulkSetupButton')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMaterials.map((book) => {
            const subject = subjectsMap.get(book.subjectKey);
            const isPublished = book.status === 'PUBLISHED';

            return (
              <div
                key={book.key}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-accent/30 lg:flex-row lg:items-center lg:justify-between"
              >
                {/* Book Details */}
                <div className="flex min-w-0 items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent">
                    <BookOpen className="size-6" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-text truncate">{book.title}</h3>
                      <Badge tone={isPublished ? 'success' : 'neutral'}>
                        {isPublished ? t('textbookAdmin.compactPublished') : t('textbookAdmin.compactDraft')}
                      </Badge>
                      {book.edition ? <Badge tone="neutral">{book.edition}</Badge> : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-2xs text-text-muted font-medium">
                      <span>{subject?.name || book.subjectKey}</span>
                      <span>·</span>
                      <span dir="ltr" className="font-mono">{book.key}</span>
                      <span>·</span>
                      <span>{t('textbookAdmin.outlineUnitsCount', { count: book.unitCount ?? 0 })}</span>
                      <span>·</span>
                      <span>{t('textbookAdmin.outlineQuestionsCount', { count: book.questionCount ?? 0 })}</span>
                    </div>

                    {/* PDF info pill */}
                    <div className="pt-1">
                      {book.totalPages ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-0.5 text-2xs font-semibold text-text-muted border border-border">
                          <FileText className="size-3 text-accent" />
                          <span>{t('textbookAdmin.totalPages')}: {book.totalPages}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-2xs text-text-muted">
                          <FileText className="size-3 opacity-60" />
                          <span>{t('textbookAdmin.pdfNoneAttached')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Course Control Buttons Bar */}
                <div className="flex flex-wrap items-center gap-2 self-end lg:self-center">
                  {/* 1. Publish Now Button (if draft) */}
                  {!isPublished && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setPublishTarget(book)}
                      className="gap-1.5 text-xs font-bold bg-success hover:bg-success/90 text-white"
                    >
                      <CheckCircle2 className="size-3.5" />
                      <span>{t('textbookAdmin.publishNow')}</span>
                    </Button>
                  )}

                  {/* 2. Manage Content Tab Button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onNavigateToContentManager(book.key)}
                    className="gap-1.5 text-xs font-bold"
                  >
                    <ListTree className="size-3.5 text-accent" />
                    <span>{t('textbookAdmin.manageContentBtn')}</span>
                  </Button>

                  {/* 3. PDF Modal Trigger */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenPdfModal(book)}
                    className="gap-1.5 text-xs font-medium"
                  >
                    <FileText className="size-3.5 text-text-muted" />
                    <span>{t('textbookAdmin.pdfModalBtn')}</span>
                  </Button>

                  {/* 4. Import Outline Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenImportModal(book.key)}
                    className="gap-1 text-xs text-text-muted hover:text-text"
                  >
                    <Upload className="size-3.5" />
                    <span>{t('content.importPackageTitle')}</span>
                  </Button>

                  {/* 5. Export Outline Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadJson(`${book.key}-export.json`, book)}
                    className="gap-1 text-xs text-text-muted hover:text-text"
                  >
                    <Download className="size-3.5" />
                    <span>{t('textbookAdmin.downloadExport')}</span>
                  </Button>

                  {/* 6. View Outline Modal */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenOutlineModal(book)}
                    className="gap-1 text-xs text-text-muted hover:text-text"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>{t('textbookAdmin.viewOutline')}</span>
                  </Button>

                  {/* 7. Edit Book Info */}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => onOpenEditModal(book)}
                    aria-label={t('textbookAdmin.editTextbook')}
                    className="text-text-muted hover:text-text"
                  >
                    <Edit3 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation to Publish Textbook */}
      {publishTarget && (
        <ConfirmDialog
          title={t('textbookAdmin.publishConfirmTitle')}
          body={t('textbookAdmin.publishConfirmBody', {
            title: publishTarget.title,
          })}
          confirmLabel={t('textbookAdmin.publishNow')}
          pending={isPublishing}
          onConfirm={handleConfirmPublish}
          onCancel={() => setPublishTarget(null)}
        />
      )}
    </div>
  );
}
