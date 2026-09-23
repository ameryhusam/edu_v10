import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  FolderTree,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import { LoadingState, ErrorState } from '../../design-system/patterns/data-states';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { TextbookCreateModal } from '../../features/content/textbook-create-modal';
import { TextbookBulkGradeModal } from '../../features/content/textbook-bulk-grade-modal';
import { TextbookAccreditModal } from '../../features/content/textbook-accredit-modal';
import { TextbookEditModal } from '../../features/content/textbook-edit-modal';
import { TextbookOutlineModal } from '../../features/content/textbook-outline-modal';
import { TextbookPdfModal } from '../../features/content/textbook-pdf-modal';
import { ContentImportModal } from '../../features/content/content-import-modal';
import { TextbookWorkspaceModal } from '../../features/content/textbook-workspace-modal';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type TextbookAdminSummary,
  type PublicationStatus,
  type PublicationAction,
} from '../../features/content/content.api';
import { administrationApi } from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const statuses: readonly PublicationStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'];

const statusTone: Record<PublicationStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

const nextAction: Partial<Record<PublicationStatus, PublicationAction>> = {
  DRAFT: 'SUBMIT',
  IN_REVIEW: 'APPROVE',
  PUBLISHED: 'ARCHIVE',
};

export function TextbooksAdminPage(): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const { t, direction } = useI18n();
  const rtl = direction === 'rtl';

  const [selectedPart, setSelectedPart] = useState<1 | 2>(1);
  const [selectedGradeKey, setSelectedGradeKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PublicationStatus | undefined>();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [accreditOpen, setAccreditOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [editBook, setEditBook] = useState<TextbookSummary | null>(null);
  const [pdfBook, setPdfBook] = useState<TextbookSummary | null>(null);
  const [outlineBook, setOutlineBook] = useState<TextbookSummary | null>(null);
  const [importBookKey, setImportBookKey] = useState<string | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<{ book: TextbookSummary; action: PublicationAction } | null>(null);

  const gradesQuery = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const subjectsQuery = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });
  const textbooksQuery = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'ALL', limit: 250 }),
    queryFn: () => textbookAdministrationApi.textbooks({ limit: 250 }),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ key, action }: { key: string; action: PublicationAction }) =>
      textbookAdministrationApi.transition(key, action),
    onSuccess: async () => {
      setTransitionTarget(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    },
  });

  const grades = gradesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const textbooks = textbooksQuery.data?.rows ?? [];
  const subjectsByKey = useMemo(() => new Map(subjects.map((subject) => [subject.key, subject])), [subjects]);
  const displayGrades = useMemo(() => [...grades].sort((a, b) => a.ordinal - b.ordinal), [grades]);
  const selectedGrade = selectedGradeKey
    ? displayGrades.find((grade) => grade.key === selectedGradeKey) ?? null
    : null;

  const partValue = selectedPart === 1 ? 'PART_1' : 'PART_2';
  const visibleBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return textbooks.filter((book) => {
      if (selectedGradeKey && book.gradeKey !== selectedGradeKey) return false;
      if (book.part !== partValue) return false;
      if (statusFilter && book.status !== statusFilter) return false;
      if (!q) return true;
      const subject = subjectsByKey.get(book.subjectKey);
      return [book.title, book.key, subject?.name, book.subjectKey]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q));
    });
  }, [partValue, search, selectedGradeKey, statusFilter, subjectsByKey, textbooks]);

  const gradeStats = useMemo(() => {
    return new Map(displayGrades.map((grade) => {
      const books = textbooks.filter((book) => book.gradeKey === grade.key && book.part === partValue);
      return [grade.key, {
        total: books.length,
        published: books.filter((book) => book.status === 'PUBLISHED').length,
        review: books.filter((book) => book.status === 'IN_REVIEW').length,
        draft: books.filter((book) => book.status === 'DRAFT').length,
      }];
    }));
  }, [displayGrades, partValue, textbooks]);

  const totals = useMemo(() => ({
    total: visibleBooks.length,
    published: visibleBooks.filter((book) => book.status === 'PUBLISHED').length,
    review: visibleBooks.filter((book) => book.status === 'IN_REVIEW').length,
    draft: visibleBooks.filter((book) => book.status === 'DRAFT').length,
  }), [visibleBooks]);

  if (gradesQuery.isLoading || subjectsQuery.isLoading || textbooksQuery.isLoading) return <LoadingState />;
  if (gradesQuery.isError || subjectsQuery.isError || textbooksQuery.isError) {
    return <ErrorState error={gradesQuery.error || subjectsQuery.error || textbooksQuery.error || new Error('Failed to load textbook management')} />;
  }

  const canApprove = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN');
  const canManageDeployment = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN');
  const canAuthor = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR');

  const actionFor = (book: TextbookSummary): PublicationAction | undefined => {
    if (!canAuthor) return undefined;
    const action = nextAction[book.status];
    if (action === 'APPROVE' && !canApprove) return undefined;
    return action;
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title={t('textbookAdmin.gradesTitle')}
        subtitle={t('textbookAdmin.gradesSubtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setWorkspaceOpen(true)} className="gap-1.5">
              <Upload className="size-4" />
              تجهيز PDF
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              {t('textbookAdmin.addTextbookButton')}
            </Button>
            {canManageDeployment ? (
              <Button variant="ghost" size="sm" onClick={() => setBulkOpen(true)} className="gap-1.5">
                <Sparkles className="size-4" />
                {t('textbookAdmin.bulkSetupButton')}
              </Button>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label={t('textbookAdmin.compactTotal')} value={totals.total} icon={<BookOpen />} />
        <SummaryCard label={t('textbookAdmin.compactPublished')} value={totals.published} icon={<CheckCircle2 />} tone="success" />
        <SummaryCard label={t('textbookAdmin.compactDraft')} value={totals.draft} icon={<FileText />} tone="warning" />
        <SummaryCard label="قيد المراجعة" value={totals.review} icon={<FolderTree />} tone="info" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        <div className="border-b border-border bg-surface-subtle/70 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text-muted">{t('textbookAdmin.physicalPart')}</span>
              <div className="inline-flex rounded-xl border border-border bg-surface p-1">
                {[1, 2].map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => setSelectedPart(part as 1 | 2)}
                    className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${selectedPart === part ? 'bg-accent text-accent-foreground shadow-xs' : 'text-text-muted hover:text-text'}`}
                  >
                    {part === 1 ? t('textbookAdmin.part1') : t('textbookAdmin.part2')}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
              <Button variant={!statusFilter ? 'secondary' : 'ghost'} size="sm" onClick={() => setStatusFilter(undefined)} className="text-xs">
                {t('common.all')}
              </Button>
              {statuses.map((status) => (
                <Button key={status} variant={statusFilter === status ? 'secondary' : 'ghost'} size="sm" onClick={() => setStatusFilter(status)} className="text-xs">
                  {t(`publication.${status}` as never)}
                </Button>
              ))}
              <div className="relative ms-1 w-full sm:w-64">
                <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('catalogue.search')} className="ps-9 text-xs" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-[520px] lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b border-border bg-surface-subtle/35 lg:border-b-0 lg:border-e">
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-text">{t('settings.grades')}</p>
                  <p className="text-2xs text-text-muted">{displayGrades.length} {t('settings.grades')}</p>
                </div>
                <Users className="size-4 text-text-muted" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1.5 lg:overflow-visible">
                <button
                  type="button"
                  onClick={() => setSelectedGradeKey(null)}
                  className={`min-w-max rounded-xl border px-3 py-2 text-start text-xs font-bold transition lg:flex lg:w-full lg:items-center lg:justify-between ${selectedGradeKey === null ? 'border-accent/40 bg-accent/10 text-accent' : 'border-transparent text-text-muted hover:border-border hover:bg-surface'}`}
                >
                  <span>{t('common.all')}</span>
                  <span>{textbooks.filter((book) => book.part === partValue).length}</span>
                </button>
                {displayGrades.map((grade) => {
                  const stats = gradeStats.get(grade.key) ?? { total: 0, published: 0, review: 0, draft: 0 };
                  const selected = grade.key === selectedGradeKey;
                  return (
                    <button
                      key={grade.key}
                      type="button"
                      onClick={() => setSelectedGradeKey(grade.key)}
                      className={`min-w-[150px] rounded-xl border px-3 py-2.5 text-start transition lg:flex lg:w-full lg:items-center lg:justify-between ${selected ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:border-border hover:bg-surface'}`}
                    >
                      <span className="min-w-0">
                        <span className={`block truncate text-xs font-bold ${selected ? 'text-accent' : 'text-text'}`}>{grade.name}</span>
                        <span className="mt-0.5 block text-2xs text-text-muted">{t('textbookAdmin.materialsInGrade', { count: stats.total })}</span>
                      </span>
                      <span className="rounded-lg bg-surface px-2 py-1 text-2xs font-bold text-text-muted">{stats.published}/{stats.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="min-w-0 p-4 sm:p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {selectedGrade ? (
                    <button type="button" onClick={() => setSelectedGradeKey(null)} className="rounded-lg p-1 text-text-muted hover:bg-surface-subtle" aria-label={t('textbookAdmin.backToGrades')}>
                      {rtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                    </button>
                  ) : null}
                  <h2 className="text-lg font-black text-text">{selectedGrade?.name ?? t('textbookAdmin.gradesTitle')}</h2>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {selectedGrade ? t('textbookAdmin.materialsInGrade', { count: visibleBooks.length }) : 'إدارة الكتب ومحتوى الصفوف من مساحة واحدة.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManageDeployment ? (
                  <Button variant="ghost" size="sm" onClick={() => setAccreditOpen(true)} className="gap-1.5">
                    <Users className="size-3.5" />
                    {t('textbookAdmin.accreditToSchoolButton')}
                  </Button>
                ) : null}
                {selectedGrade ? (
                  <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                    <Plus className="size-3.5" />
                    {t('textbookAdmin.addTextbookButton')}
                  </Button>
                ) : null}
              </div>
            </div>

            {visibleBooks.length === 0 ? (
              <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-border bg-surface-subtle/40 p-8 text-center">
                <div className="max-w-sm space-y-3">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-subtle text-accent">
                    <BookOpen className="size-7" />
                  </span>
                  <h3 className="text-sm font-black text-text">لا توجد كتب مطابقة</h3>
                  <p className="text-xs leading-5 text-text-muted">غيّر الفلتر أو ابحث عن كتاب آخر، أو ابدأ تجهيز PDF جديد من مساحة العمل.</p>
                  <Button variant="primary" size="sm" onClick={() => setWorkspaceOpen(true)} className="gap-1.5">
                    <Upload className="size-3.5" />
                    تجهيز PDF
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleBooks.map((book) => {
                  const subject = subjectsByKey.get(book.subjectKey);
                  const action = actionFor(book);
                  return (
                    <article key={book.key} className="group rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/35 hover:shadow-sm sm:p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                        <div className="flex min-w-0 flex-1 gap-4">
                          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface-subtle">
                            {book.coverUrl ? <img src={book.coverUrl} alt="" className="size-full object-cover" loading="lazy" /> : <BookOpen className="size-6 text-accent" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-black text-text">{book.title}</h3>
                              <Badge tone={statusTone[book.status]}>{t(`publication.${book.status}` as never)}</Badge>
                              {book.edition ? <Badge tone="neutral">{book.edition}</Badge> : null}
                            </div>
                            <p className="mt-1 text-xs text-text-muted">{subject?.name ?? book.subjectKey} · {book.part === 'PART_1' ? t('textbookAdmin.part1') : t('textbookAdmin.part2')}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Metric label={t('textbookAdmin.unitsCount')} value={book.unitCount ?? 0} />
                              <Metric label={t('textbookAdmin.questionsCount')} value={book.questionCount ?? 0} />
                              <Metric label={t('textbookAdmin.totalPages')} value={book.totalPages ?? 0} />
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 xl:max-w-[520px] xl:justify-end">
                          {action ? (
                            <Button variant="primary" size="sm" onClick={() => setTransitionTarget({ book, action })} className="gap-1.5">
                              <CheckCircle2 className="size-3.5" />
                              {t(`textbookAdmin.${action === 'SUBMIT' ? 'submit' : action === 'APPROVE' ? 'approve' : 'archive'}` as never)}
                            </Button>
                          ) : null}
                          <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/content?textbook=${encodeURIComponent(book.key)}`)} className="gap-1.5">
                            <FolderTree className="size-3.5" />
                            {t('textbookAdmin.manageContentBtn')}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setPdfBook(book)} className="gap-1.5">
                            <FileText className="size-3.5" />
                            {t('textbookAdmin.pdfModalBtn')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setOutlineBook(book)} className="gap-1.5">
                            <BookOpen className="size-3.5" />
                            {t('textbookAdmin.viewOutline')}
                          </Button>
                          <Button variant="ghost" size="iconSm" onClick={() => setEditBook(book)} aria-label={t('textbookAdmin.editTextbook')}>
                            <Edit3 className="size-4" />
                          </Button>
                          <Button variant="ghost" size="iconSm" onClick={() => {
                            textbookAdministrationApi.exportTextbook(book.key).then((pkg) => {
                              const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const anchor = document.createElement('a');
                              anchor.href = url;
                              anchor.download = `${book.key}-export.json`;
                              anchor.click();
                              URL.revokeObjectURL(url);
                            });
                          }} aria-label={t('textbookAdmin.downloadExport')}>
                            <Download className="size-4" />
                          </Button>
                          <Button variant="ghost" size="iconSm" onClick={() => setImportBookKey(book.key)} aria-label={t('content.importPackageTitle')}>
                            <Archive className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </section>

      {transitionTarget ? (
        <ConfirmDialog
          title={t(`textbookAdmin.${transitionTarget.action === 'SUBMIT' ? 'submit' : transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never)}
          body={t('textbookAdmin.confirmTransition', {
            action: t(`textbookAdmin.${transitionTarget.action === 'SUBMIT' ? 'submit' : transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never),
            name: transitionTarget.book.title,
          })}
          confirmLabel={t(`textbookAdmin.${transitionTarget.action === 'SUBMIT' ? 'submit' : transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never)}
          pending={transitionMutation.isPending}
          destructive={transitionTarget.action === 'ARCHIVE'}
          onConfirm={() => transitionMutation.mutate({ key: transitionTarget.book.key, action: transitionTarget.action })}
          onCancel={() => setTransitionTarget(null)}
        />
      ) : null}

      <TextbookWorkspaceModal open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} initialCoordinates={{ part: partValue, grade: selectedGradeKey ?? undefined }} />
      <TextbookCreateModal open={createOpen} onClose={() => setCreateOpen(false)} initialGradeKey={selectedGradeKey ?? undefined} initialPart={partValue} />
      <TextbookBulkGradeModal open={bulkOpen} onClose={() => setBulkOpen(false)} initialGradeKey={selectedGradeKey ?? undefined} initialPart={partValue} />
      <TextbookAccreditModal open={accreditOpen} onClose={() => setAccreditOpen(false)} />
      <TextbookEditModal open={!!editBook} textbook={editBook as TextbookAdminSummary | null} onClose={() => setEditBook(null)} />
      <TextbookPdfModal open={!!pdfBook} textbook={pdfBook} onClose={() => setPdfBook(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all })} />
      <TextbookOutlineModal open={!!outlineBook} textbook={outlineBook} onClose={() => setOutlineBook(null)} />
      <ContentImportModal open={!!importBookKey} textbookKey={importBookKey} onClose={() => setImportBookKey(null)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: ReactNode;
  readonly tone?: 'default' | 'success' | 'warning' | 'info';
}): ReactNode {
  const toneClass = {
    default: 'bg-surface-subtle text-accent',
    success: 'bg-success-subtle text-success',
    warning: 'bg-warning-subtle text-warning',
    info: 'bg-info-subtle text-info',
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-bold uppercase tracking-wide text-text-muted">{label}</span>
        <span className={`grid size-8 place-items-center rounded-xl ${toneClass}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-black text-text">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle px-2.5 py-1 text-2xs font-semibold text-text-muted">
      <span>{label}</span>
      <span className="font-black text-text">{value}</span>
    </span>
  );
}
