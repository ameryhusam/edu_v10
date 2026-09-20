/**
 * The curriculum matrix — توزيع المواد على الصفوف.
 *
 * The legacy SubjectDistributionStudio's algorithm, restated for this
 * codebase. The rules that survived the port, verbatim in spirit:
 *
 *   · NOTHING is written until «حفظ التوزيع» is pressed. Toggling a cell is a
 *     local override, visibly pending, and un-toggling reverts to the stored
 *     truth. The save is one batch, not N single-cell writes.
 *   · FILL IS A PREVIEW FIRST: «التعبئة وفق السياسة» computes what the
 *     subjects' own standard policy would change and shows the counts; only a
 *     confirmed second call writes. The policy is the national offer, not a
 *     suggestion — applying it wins over stored contradictions, exactly what
 *     the administrator asked for when pressing "apply the policy".
 *
 * The touches the new architecture added: cells are catalogue-wide (no year or
 * term dimensions — yearly variation lives in textbook adoption), a cell's
 * truth is a stored row (absence = not offered, not "default to on"), and a
 * subject with no claimed policy ([]) is left entirely to the administrator —
 * the matrix marks it and the fill never touches it.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogueApi as administrationApi, type GradeSubjectMatrix } from './catalogue.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { Button } from '../../design-system/ui/button';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { describeApiError } from '../../shared/api/error-messages';
import { ApiError } from '../../shared/api/errors';

/** Overrides live under `${gradeKey}:${subjectKey}` — only cells the
 *  administrator has touched; absence is "as stored". */
type Overrides = Record<string, boolean>;

const cellKey = (gradeKey: string, subjectKey: string): string => `${gradeKey}:${subjectKey}`;

export function GradeSubjectMatrix({ canWrite }: { readonly canWrite: boolean }): React.ReactNode {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const [overrides, setOverrides] = useState<Overrides>({});
  const [failure, setFailure] = useState<string | null>(null);
  /** The fill preview awaiting a yes/no. */
  const [pendingFill, setPendingFill] = useState<{
    toEnable: number;
    toDisable: number;
    unchanged: number;
  } | null>(null);
  /** The restore preview awaiting a separate yes/no — a different contract. */
  const [pendingRestore, setPendingRestore] = useState<{
    toEnable: number;
    toDisable: number;
    unchanged: number;
  } | null>(null);

  const matrix = useQuery({
    queryKey: queryKeys.administration.matrix(),
    queryFn: () => administrationApi.matrix.get(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown, fallback: MessageKey): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t(fallback);

  /** The save: the batch is the unit. Local overrides leave with the rows. */
  const save = useMutation({
    mutationFn: (input: { changes: { gradeKey: string; subjectKey: string; isActive: boolean }[] }) =>
      administrationApi.matrix.save(input.changes),
    onSuccess: async () => {
      setOverrides({});
      setFailure(null);
      await refresh();
    },
    onError: (cause) => setFailure(describe(cause, 'catalogue.saveFailed')),
  });

  /**
   * Restore the installed defaults. Same preview-first contract as the fill;
   * the difference is written into the confirm copy — a restore also turns
   * off what the policy never offered.
   */
  const restore = useMutation({
    mutationFn: (apply: boolean) => administrationApi.matrix.restore(apply),
    onSuccess: async (preview, apply) => {
      if (!apply) {
        setPendingRestore({
          toEnable: preview.toEnable,
          toDisable: preview.toDisable,
          unchanged: preview.unchanged,
        });
        return;
      }
      setOverrides({});
      setPendingRestore(null);
      setFailure(null);
      await refresh();
    },
    onError: (cause) => setFailure(describe(cause, 'matrix.fillFailed')),
  });

  /** The confirmed second half of the fill: preview first, then apply. */
  const fill = useMutation({
    mutationFn: (apply: boolean) => administrationApi.matrix.fill(apply),
    onSuccess: async (preview, apply) => {
      if (!apply) {
        setPendingFill({ toEnable: preview.toEnable, toDisable: preview.toDisable, unchanged: preview.unchanged });
        return;
      }
      // Fill rewrites stored cells; local overrides on top of that would be
      // two truths racing, so they go with the write.
      setOverrides({});
      setPendingFill(null);
      setFailure(null);
      await refresh();
    },
    onError: (cause) => setFailure(describe(cause, 'matrix.fillFailed')),
  });

  const data = matrix.data;

  /** Stored truth per cell, for O(1) lookups instead of N array scans. */
  const stored = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of data?.rows ?? []) map.set(cellKey(row.gradeKey, row.subjectKey), row.isActive);
    return map;
  }, [data]);

  /** A subject's policy, as ordinals, for the hint dot. */
  const policy = useMemo(() => {
    const map = new Map<string, readonly number[]>();
    for (const subject of data?.subjects ?? []) map.set(subject.key, subject.standardGradeLevels);
    return map;
  }, [data]);

  const effective = (gradeKey: string, subjectKey: string): boolean =>
    cellKey(gradeKey, subjectKey) in overrides
      ? overrides[cellKey(gradeKey, subjectKey)]!
      : (stored.get(cellKey(gradeKey, subjectKey)) ?? false);

  const toggle = (gradeKey: string, subjectKey: string): void => {
    const key = cellKey(gradeKey, subjectKey);
    setFailure(null);
    setOverrides((current) => {
      const next = { ...current };
      if (key in next) {
        // Un-toggle: back to whatever is stored — the override disappears,
        // it does not flip to a second pending value.
        delete next[key];
      } else {
        next[key] = !(stored.get(key) ?? false);
      }
      return next;
    });
  };

  const pendingCount = Object.keys(overrides).length;

  const stats = useMemo(() => {
    if (!data) return { offered: 0, total: 0 };
    let offered = 0;
    let total = 0;
    for (const subject of data.subjects) {
      if (!subject.isActive) continue;
      for (const grade of data.grades) {
        if (!grade.isActive) continue;
        total += 1;
        if (effective(grade.key, subject.key)) offered += 1;
      }
    }
    return { offered, total };
    // `effective` closes over `stored`/`overrides`; both are deps in spirit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, stored, overrides]);

  if (matrix.isPending) return <LoadingState />;
  if (matrix.isError) return <ErrorState error={matrix.error} onRetry={() => matrix.refetch()} />;
  if (!data) return null;

  const activeGrades = data.grades.filter((g) => g.isActive);

  return (
    <div className="space-y-4">
      {/* Stats + actions: what the matrix holds, and the two writes. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          {t('matrix.stats', { offered: stats.offered, total: stats.total })}
          {pendingCount > 0 ? (
            <span className="ms-2 text-accent">{t('matrix.pending', { count: pendingCount })}</span>
          ) : null}
        </p>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fill.mutate(false)}
              disabled={fill.isPending || save.isPending || restore.isPending}
            >
              {fill.isPending && !pendingFill ? t('matrix.filling') : t('matrix.fillFromPolicy')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => restore.mutate(false)}
              disabled={fill.isPending || save.isPending || restore.isPending}
            >
              {restore.isPending && !pendingRestore ? t('matrix.filling') : t('matrix.restoreDefaults')}
            </Button>
            {pendingCount > 0 ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOverrides({})}
                  disabled={save.isPending}
                >
                  {t('matrix.discard')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    save.mutate({
                      changes: Object.entries(overrides).map(([key, isActive]) => {
                        const [gradeKey, subjectKey] = key.split(':');
                        return { gradeKey: gradeKey!, subjectKey: subjectKey!, isActive };
                      }),
                    })
                  }
                  disabled={save.isPending}
                >
                  {save.isPending ? t('catalogue.saving') : t('matrix.saveDistribution')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th scope="col" className="p-2 text-start font-medium text-text-muted">
                {t('matrix.subject')}
              </th>
              {activeGrades.map((grade) => (
                <th key={grade.key} scope="col" className="p-2 text-center font-medium text-text-muted">
                  {t('matrix.gradeColumn', { ordinal: grade.ordinal })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((subject) => {
              const levels = policy.get(subject.key) ?? [];
              return (
                <tr key={subject.key} className="border-b border-border last:border-b-0">
                  <th scope="row" className="p-2 text-start font-medium">
                    <span className={subject.isActive ? '' : 'text-text-muted line-through'}>
                      {subject.name}
                    </span>
                    {levels.length === 0 ? (
                      <span className="ms-2 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                        {t('matrix.noPolicy')}
                      </span>
                    ) : null}
                  </th>
                  {activeGrades.map((grade) => {
                    const key = cellKey(grade.key, subject.key);
                    const on = effective(grade.key, subject.key);
                    const isOverride = key in overrides;
                    const policySaysOn = levels.includes(grade.ordinal);
                    const policySaysOff = levels.length > 0 && !policySaysOn;
                    return (
                      <td key={grade.key} className="p-1 text-center">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`${subject.name} — ${t('matrix.gradeColumn', { ordinal: grade.ordinal })}`}
                          disabled={!canWrite || !subject.isActive}
                          onClick={() => toggle(grade.key, subject.key)}
                          title={
                            isOverride
                              ? t('matrix.pendingCell')
                              : policySaysOn && !on
                                ? t('matrix.policyHintOn')
                                : policySaysOff && on
                                  ? t('matrix.policyHintOff')
                                  : undefined
                          }
                          className={`h-8 w-8 rounded-lg border text-xs transition-colors ${
                            on
                              ? 'border-accent-border bg-accent-subtle text-accent'
                              : 'border-border bg-surface text-text-muted'
                          } ${isOverride ? 'ring-2 ring-accent' : ''} ${
                            canWrite && subject.isActive ? 'cursor-pointer hover:border-accent-border' : 'opacity-60'
                          }`}
                        >
                          {on ? '✓' : policySaysOn && !isOverride ? '·' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">{t('matrix.legend')}</p>

      {/* The mandatory restore confirmation — stricter words for a reset. */}
      {pendingRestore ? (
        <ConfirmDialog
          title={t('matrix.restoreConfirmTitle')}
          body={t('matrix.restoreConfirmBody', {
            enable: pendingRestore.toEnable,
            disable: pendingRestore.toDisable,
            unchanged: pendingRestore.unchanged,
          })}
          confirmLabel={t('matrix.restoreApply')}
          destructive
          pending={restore.isPending}
          onConfirm={() => restore.mutate(true)}
          onCancel={() => setPendingRestore(null)}
        />
      ) : null}

      {/* The mandatory fill confirmation: counts were computed, nothing written. */}
      {pendingFill ? (
        <ConfirmDialog
          title={t('matrix.fillConfirmTitle')}
          body={t('matrix.fillConfirmBody', {
            enable: pendingFill.toEnable,
            disable: pendingFill.toDisable,
            unchanged: pendingFill.unchanged,
          })}
          confirmLabel={t('matrix.fillApply')}
          pending={fill.isPending}
          onConfirm={() => fill.mutate(true)}
          onCancel={() => setPendingFill(null)}
        />
      ) : null}
    </div>
  );
}
