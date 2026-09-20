/**
 * Administering the academic structure.
 *
 * Four collections — subjects, grades, years, terms — behind one set of tabs,
 * because they are one job: describing the institution before any content or
 * person can refer to it. Schools are administered on their own surface
 * (`/admin/schools`), linked from here, because a school is a whole
 * management surface rather than a reference row.
 *
 * The collection definitions are data (`collections.ts`), not four components.
 * A per-collection component would mean four copies of "open the editor, save,
 * invalidate, close", and the fourth copy is always the one that forgets to
 * invalidate.
 *
 * Writes here are SYSTEM_ADMIN only, which the server enforces. The UI reflects
 * that by hiding the buttons, and still renders the server's refusal if one
 * arrives — hiding a control is a courtesy, never the check (§13).
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { RecordTable } from '../../design-system/patterns/record-table';
import { AcademicStructureInsights } from '../../features/catalogue/academic-structure-insights';
import { RecordEditor } from '../../design-system/patterns/record-editor';
import { COLLECTIONS, type CollectionId } from '../../features/catalogue/collections';
import { administrationApi } from '../../features/administration/administration.api';
import type { Column } from '../../design-system/patterns/data-table';
import type { GradeRecord } from '../../features/administration/administration.api';
import { GradeSubjectMatrix } from '../../features/catalogue/grade-subject-matrix';
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

  const [tab, setTab] = useState<CollectionId | 'matrix'>('subjects');
  const [editing, setEditing] = useState<{ values: Record<string, string>; isNew: boolean } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  /** The record awaiting a yes/no. Destructive and far-reaching acts confirm. */
  const [confirming, setConfirming] = useState<unknown | null>(null);

  const canWrite = hasRole('SYSTEM_ADMIN');
  const spec = tab === 'matrix' ? null : COLLECTIONS[tab];

  const list = useQuery({
    queryKey: queryKeys.administration.catalogue(tab),
    queryFn: () => spec!.list(),
    enabled: spec !== null,
  });

  // Years, for the terms tab: the create form must offer every year that
  // exists, not only the years that already have a term.
  const years = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
    enabled: tab === 'terms',
  });
  const yearKeys = (years.data ?? []).map((year) => year.key);

  // The grades tab joins the curriculum matrix: each grade row shows the
  // subjects it offers, and carries the row action that adds the standard
  // policy's subjects to that grade — the distribution, one row at a time.
  const matrix = useQuery({
    queryKey: queryKeys.administration.matrix(),
    queryFn: () => administrationApi.matrix.get(),
    enabled: tab === 'grades',
  });

  const fillGrade = useMutation({
    mutationFn: (gradeKey: string) => administrationApi.matrix.fill(true, gradeKey),
    onSuccess: async () => {
      await refresh();
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause, 'matrix.fillFailed')),
  });

  const matrixByGrade = (gradeKey: string): { offered: string[]; missing: number } => {
    const data = matrix.data;
    if (!data) return { offered: [], missing: 0 };
    const subjectName = new Map(data.subjects.map((s) => [s.key, s.name]));
    const grade = data.grades.find((g) => g.key === gradeKey);
    const offered: string[] = [];
    let missing = 0;
    for (const row of data.rows) {
      if (row.gradeKey === gradeKey && row.isActive) offered.push(subjectName.get(row.subjectKey) ?? row.subjectKey);
    }
    if (grade) {
      for (const subject of data.subjects) {
        if (!subject.isActive || subject.standardGradeLevels.length === 0) continue;
        const target = subject.standardGradeLevels.includes(grade.ordinal);
        const current = data.rows.some((r) => r.gradeKey === gradeKey && r.subjectKey === subject.key && r.isActive);
        if (target && !current) missing += 1;
      }
    }
    return { offered, missing };
  };

  const subjectsColumn = (t2: (key: MessageKey, params?: Record<string, string | number>) => string): Column<GradeRecord> => ({
    id: 'subjects',
    label: t2('matrix.linkedSubjects'),
    render: (grade) => {
      const { offered, missing } = matrixByGrade(grade.key);
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {offered.length > 0 ? (
            <span className="text-xs text-text-muted">{offered.join(' · ')}</span>
          ) : (
            <span className="text-xs text-text-muted">{t2('matrix.noLinkedSubjects')}</span>
          )}
          {canWrite && missing > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={fillGrade.isPending}
              onClick={() => fillGrade.mutate(grade.key)}
            >
              {t2('matrix.addFromPolicy', { count: missing })}
            </Button>
          ) : null}
        </div>
      );
    },
  });

  /** One invalidation for every write: the counts on the overview move too. */
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown, fallback: MessageKey): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t(fallback);

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      // Record-tab mutations: `spec` is non-null wherever these can fire.
      editing?.isNew ? spec!.create(values) : spec!.update(values),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause, 'catalogue.saveFailed')),
  });

  const remove = useMutation({
    mutationFn: (key: string) => spec!.remove(key),
    onSuccess: async () => {
      await refresh();
      setConfirming(null);
    },
    onError: (cause) => {
      setFailure(describe(cause, 'catalogue.deleteFailed'));
      setConfirming(null);
    },
  });

  /** Deactivate/activate: the retire lever. The server guards the meaning. */
  const toggleActive = useMutation({
    mutationFn: (input: { record: unknown; next: boolean }) =>
      spec!.lifecycle!.toggle(input.record, input.next),
    onSuccess: refresh,
    onError: (cause) => setFailure(describe(cause, 'catalogue.saveFailed')),
  });

  /** Make current: clears every other flag in one server-side transaction. */
  const makeCurrent = useMutation({
    mutationFn: (record: unknown) => spec!.current!.makeCurrent(record),
    onSuccess: refresh,
    onError: (cause) => setFailure(describe(cause, 'catalogue.saveFailed')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('catalogue.title')}
        subtitle={t('catalogue.subtitle')}
        actions={
          canWrite && spec ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setFailure(null);
                setEditing({ values: spec.blank(), isNew: true });
              }}
            >
              {t('catalogue.add')}
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label={t('catalogue.title')} className="flex flex-wrap gap-1.5">
        {(Object.keys(COLLECTIONS) as CollectionId[]).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={id === tab}
            onClick={() => {
              setTab(id);
              setFailure(null);
            }}
            className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
              id === tab
                ? 'border-accent-border bg-accent-subtle text-accent'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            {t(`catalogue.tab.${id}` as MessageKey)}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'matrix'}
          onClick={() => {
            setTab('matrix');
            setFailure(null);
          }}
          className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
            tab === 'matrix'
              ? 'border-accent-border bg-accent-subtle text-accent'
              : 'border-border bg-surface text-text-muted hover:text-text'
          }`}
        >
          {t('catalogue.tab.matrix')}
        </button>
        <Link
          to="/admin/schools"
          className="flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text-muted transition-colors hover:text-text"
        >
          {t('catalogue.tab.schools')}
        </Link>
      </div>

      {!canWrite ? <p className="text-xs text-text-muted">{t('catalogue.systemAdminOnly')}</p> : null}
      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {tab === 'matrix' ? (
        <GradeSubjectMatrix canWrite={canWrite} />
      ) : spec === null ? null : (
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
          columns={
            tab === 'grades'
              ? ([...spec.columns(t), subjectsColumn(t)] as unknown as readonly Column<unknown>[])
              : spec.columns(t)
          }
          keyOf={spec.keyOf}
          nameOf={spec.nameOf}
          searchTextOf={spec.searchTextOf}
          referencesOf={spec.referencesOf}
          activeOf={spec.lifecycle?.activeOf}
          onToggleActive={
            spec.lifecycle && canWrite
              ? (record, next) => {
                  setFailure(null);
                  toggleActive.mutate({ record, next });
                }
              : undefined
          }
          isCurrentOf={spec.current?.isCurrentOf}
          onMakeCurrent={
            spec.current && canWrite
              ? (record) => {
                  setFailure(null);
                  makeCurrent.mutate(record);
                }
              : undefined
          }
          canWrite={canWrite}
          busy={toggleActive.isPending || makeCurrent.isPending}
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
        </>
      )}
    </div>
  );
}
