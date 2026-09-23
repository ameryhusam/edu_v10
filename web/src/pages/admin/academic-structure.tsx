/**
 * Academic structure workspace.
 *
 * The page is deliberately limited to the information an administrator needs
 * to operate the catalogue: subjects, grades, academic years and terms.
 * Distribution is a grade capability, not a separate catalogue tab.
 *
 * A grade row therefore exposes only:
 *   Grade · Stage · Distribution
 *
 * The distribution editor opens as a focused modal. It never asks for edition,
 * year, term or textbook data: those belong to downstream content/adoption
 * workflows, not the catalogue distribution itself.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { RecordTable } from '../../design-system/patterns/record-table';
import { RecordEditor } from '../../design-system/patterns/record-editor';
import { PageHeader } from '../../design-system/patterns/page-header';
import { AcademicStructureInsights } from '../../features/catalogue/academic-structure-insights';
import { GradeSubjectDistributionModal } from '../../features/catalogue/grade-subject-distribution-modal';
import { COLLECTIONS, type CollectionId } from '../../features/catalogue/collections';
import type { GradeRecord } from '../../features/catalogue/catalogue.api';
import { administrationApi } from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';
import type { MessageKey } from '../../shared/i18n/messages';

export function AcademicStructurePage(): ReactNode {
  const { t, locale } = useI18n();
  const { hasRole } = useSession();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<CollectionId>('subjects');
  const [search, setSearch] = useState('');
  const [distributionGrade, setDistributionGrade] = useState<GradeRecord | null>(null);
  const [editing, setEditing] = useState<{ values: Record<string, string>; isNew: boolean } | null>(null);
  const [confirming, setConfirming] = useState<unknown | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const canWrite = hasRole('SYSTEM_ADMIN');
  const spec = COLLECTIONS[tab];

  const list = useQuery({
    queryKey: queryKeys.administration.catalogue(tab),
    queryFn: () => spec.list(),
  });

  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });

  const matrix = useQuery({
    queryKey: queryKeys.administration.matrix(),
    queryFn: () => administrationApi.matrix.get(),
  });

  const years = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
    enabled: tab === 'terms',
  });

  const yearKeys = (years.data ?? []).map((year) => year.key);

  const gradeDistributionCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of matrix.data?.rows ?? []) {
      if (!row.isActive) continue;
      map.set(row.gradeKey, (map.get(row.gradeKey) ?? 0) + 1);
    }
    return map;
  }, [matrix.data]);

  const filteredGrades = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale);
    return (grades.data ?? [])
      .filter((grade) => !q || [grade.name, grade.stage ?? ''].some((value) => value.toLocaleLowerCase(locale).includes(q)))
      .sort((a, b) => a.ordinal - b.ordinal);
  }, [grades.data, locale, search]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown, fallback: MessageKey): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t(fallback);

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      editing?.isNew ? spec.create(values) : spec.update(values),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause, 'catalogue.saveFailed')),
  });

  const remove = useMutation({
    mutationFn: (key: string) => spec.remove(key),
    onSuccess: async () => {
      await refresh();
      setConfirming(null);
    },
    onError: (cause) => {
      setFailure(describe(cause, 'catalogue.deleteFailed'));
      setConfirming(null);
    },
  });

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title={t('catalogue.title')}
        subtitle={t('catalogue.subtitle')}
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setFailure(null);
                setEditing({ values: spec.blank(), isNew: true });
              }}
            >
              <Plus className="size-4" />
              {t('catalogue.add')}
            </Button>
          ) : undefined
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StructureStat label={t('catalogue.tab.subjects')} {...(tab === 'subjects' ? { value: list.data?.length ?? 0 } : {})} />
        <StructureStat label={t('catalogue.tab.grades')} value={grades.data?.length ?? 0} />
        <StructureStat label={t('catalogue.tab.academicYears')} {...(tab === 'academicYears' ? { value: list.data?.length ?? 0 } : {})} />
        <StructureStat label={t('catalogue.tab.terms')} {...(tab === 'terms' ? { value: list.data?.length ?? 0 } : {})} />
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-xs">
        <div className="border-b border-border bg-surface-subtle/45 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav
              role="tablist"
              aria-label={t('catalogue.title')}
              className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
            >
              {(Object.keys(COLLECTIONS) as CollectionId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setSearch('');
                    setFailure(null);
                  }}
                  className={`shrink-0 rounded-lg px-3.5 py-2 text-xs font-bold transition ${tab === id ? 'bg-accent text-accent-foreground shadow-xs' : 'text-text-muted hover:bg-surface-subtle hover:text-text'}`}
                >
                  {t(`catalogue.tab.${id}` as MessageKey)}
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center gap-2">
              {tab === 'grades' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  disabled={!canWrite}
                  onClick={() => setDistributionGrade(filteredGrades[0] ?? grades.data?.[0] ?? null)}
                >
                  <SlidersHorizontal className="size-4" />
                  {t('catalogue.distribution')}
                </Button>
              ) : null}
              <div className="relative w-full sm:w-64">
                <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('catalogue.search')} className="ps-9" />
              </div>
            </div>
          </div>
        </div>

        {!canWrite ? <p className="px-5 pt-4 text-xs text-text-muted">{t('catalogue.systemAdminOnly')}</p> : null}
        {failure ? <p className="px-5 pt-4 text-xs text-danger">{failure}</p> : null}

        {tab === 'grades' ? (
          <GradeTable
            grades={filteredGrades}
            distributionCount={gradeDistributionCount}
            loading={grades.isPending || matrix.isPending}
            error={grades.error ?? matrix.error}
            canWrite={canWrite}
            onRetry={() => {
              void grades.refetch();
              void matrix.refetch();
            }}
            onDistribute={(grade) => setDistributionGrade(grade)}
            onEdit={(grade) => {
              setFailure(null);
              setEditing({ values: COLLECTIONS.grades.toForm(grade), isNew: false });
            }}
          />
        ) : (
          <>
            {list.isPending ? <LoadingState /> : null}
            {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
            {list.isSuccess ? (
              <>
                <AcademicStructureInsights
                  records={list.data}
                  activeOf={spec.lifecycle?.activeOf}
                  currentOf={spec.current?.isCurrentOf}
                  referencesOf={spec.referencesOf}
                />
                <RecordTable
                  records={list.data}
                  columns={spec.columns(t)}
                  keyOf={spec.keyOf}
                  nameOf={spec.nameOf}
                  searchTextOf={spec.searchTextOf}
                  referencesOf={spec.referencesOf}
                  activeOf={spec.lifecycle?.activeOf}
                  canWrite={canWrite}
                  onEdit={(record) => {
                    setFailure(null);
                    setEditing({ values: spec.toForm(record), isNew: false });
                  }}
                  onDelete={(record) => {
                    setFailure(null);
                    setConfirming(record);
                  }}
                />
              </>
            ) : null}
          </>
        )}
      </section>

      <GradeSubjectDistributionModal
        open={distributionGrade !== null}
        gradeKey={distributionGrade?.key ?? null}
        onClose={() => setDistributionGrade(null)}
      />

      {confirming !== null ? (
        <ConfirmDialog
          title={t('catalogue.confirmDeleteTitle')}
          body={t('catalogue.confirmDelete', { name: spec.nameOf(confirming) })}
          confirmLabel={t('catalogue.delete')}
          pending={remove.isPending}
          destructive
          onConfirm={() => remove.mutate(spec.keyOf(confirming))}
          onCancel={() => setConfirming(null)}
        />
      ) : null}

      {editing ? (
        <RecordEditor
          title={t(`catalogue.tab.${tab}` as MessageKey)}
          fields={spec.fields(t, list.isSuccess ? list.data : [], yearKeys)}
          initial={editing.values}
          isNew={editing.isNew}
          saving={save.isPending}
          errorText={failure}
          onSave={(values) => save.mutate(values)}
          onClose={() => {
            setEditing(null);
            setFailure(null);
          }}
        />
      ) : null}
    </div>
  );
}

function GradeTable({
  grades,
  distributionCount,
  loading,
  error,
  canWrite,
  onRetry,
  onDistribute,
  onEdit,
}: {
  readonly grades: readonly GradeRecord[];
  readonly distributionCount: ReadonlyMap<string, number>;
  readonly loading: boolean;
  readonly error: unknown;
  readonly canWrite: boolean;
  readonly onRetry: () => void;
  readonly onDistribute: (grade: GradeRecord) => void;
  readonly onEdit: (grade: GradeRecord) => void;
}): ReactNode {
  const { t } = useI18n();

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error instanceof Error ? error : new Error('Failed to load grades')} onRetry={onRetry} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-subtle/45 text-xs text-text-muted">
          <tr>
            <th className="px-5 py-3 text-start font-bold">{t('catalogue.name')}</th>
            <th className="px-5 py-3 text-start font-bold">{t('catalogue.stage')}</th>
            <th className="px-5 py-3 text-end font-bold">{t('matrix.saveDistribution')}</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((grade) => (
            <tr key={grade.key} className="border-t border-border transition hover:bg-surface-subtle/35">
              <td className="px-5 py-4 font-bold text-text">{grade.name}</td>
              <td className="px-5 py-4 text-text-muted">{grade.stage ?? '—'}</td>
              <td className="px-5 py-4 text-end">
                <div className="flex items-center justify-end gap-2">
                  <Badge tone="neutral">{distributionCount.get(grade.key) ?? 0}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={!canWrite}
                    onClick={() => onDistribute(grade)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    {t('matrix.saveDistribution')}
                  </Button>
                  {canWrite ? (
                    <button
                      type="button"
                      className="sr-only focus:not-sr-only focus:rounded-md focus:bg-surface-subtle focus:px-2 focus:py-1"
                      onClick={() => onEdit(grade)}
                    >
                      {t('catalogue.edit')}
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {grades.length === 0 ? <p className="p-10 text-center text-xs text-text-muted">{t('catalogue.empty')}</p> : null}
    </div>
  );
}

function StructureStat({ label, value }: { readonly label: string; readonly value?: number }): ReactNode {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
      <p className="text-2xs font-bold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-black text-text">{value ?? '—'}</p>
    </div>
  );
}
