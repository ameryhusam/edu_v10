import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { administrationApi } from '../administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

interface GradeSubjectDistributionModalProps {
  readonly open: boolean;
  readonly gradeKey: string | null;
  readonly onClose: () => void;
}

export function GradeSubjectDistributionModal({
  open,
  gradeKey,
  onClose,
}: GradeSubjectDistributionModalProps): React.ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const matrix = useQuery({
    queryKey: queryKeys.administration.matrix(),
    queryFn: () => administrationApi.matrix.get(),
    enabled: open,
  });

  const grade = useMemo(
    () => matrix.data?.grades.find((item) => item.key === gradeKey) ?? null,
    [gradeKey, matrix.data],
  );

  const stored = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const row of matrix.data?.rows ?? []) {
      if (row.gradeKey === gradeKey) result.set(row.subjectKey, row.isActive);
    }
    return result;
  }, [gradeKey, matrix.data]);

  const subjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    return (matrix.data?.subjects ?? [])
      .filter((subject) => subject.isActive)
      .filter((subject) => !query || subject.name.toLocaleLowerCase(locale).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale, matrix.data, search]);

  const effective = (subjectKey: string): boolean =>
    Object.prototype.hasOwnProperty.call(changes, subjectKey)
      ? changes[subjectKey]!
      : stored.get(subjectKey) ?? false;

  useEffect(() => {
    if (!open) {
      setSearch('');
      setChanges({});
      setFailure(null);
    }
  }, [open, gradeKey]);

  const save = useMutation({
    mutationFn: () =>
      administrationApi.matrix.save(
        Object.entries(changes).map(([subjectKey, isActive]) => ({
          gradeKey: gradeKey!,
          subjectKey,
          isActive,
        })),
      ),
    onSuccess: async () => {
      setChanges({});
      setFailure(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
      onClose();
    },
    onError: (cause) => {
      setFailure(cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed'));
    },
  });

  const toggle = (subjectKey: string): void => {
    setFailure(null);
    setChanges((current) => {
      const nextValue = !effective(subjectKey);
      const next = { ...current };
      if (nextValue === (stored.get(subjectKey) ?? false)) delete next[subjectKey];
      else next[subjectKey] = nextValue;
      return next;
    });
  };

  const enabledCount = (matrix.data?.subjects ?? []).filter(
    (subject) => subject.isActive && effective(subject.key),
  ).length;

  return (
    <ActionModal
      onClose={onClose}
      title={grade ? grade.name : t('catalogue.tab.grades')}
      subtitle={t('matrix.stats', { offered: enabledCount, total: matrix.data?.subjects.filter((s) => s.isActive).length ?? 0 })}
      kind="textbook"
      icon={<Check className="size-5" />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {Object.keys(changes).length > 0 ? t('matrix.pending', { count: Object.keys(changes).length }) : t('matrix.noLinkedSubjects')}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!gradeKey || Object.keys(changes).length === 0}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {t('catalogue.distribution')}
            </Button>
          </div>
        </div>
      }
    >
      {matrix.isPending ? <LoadingState /> : null}
      {matrix.isError ? <ErrorState error={matrix.error} onRetry={() => matrix.refetch()} /> : null}
      {failure ? <p className="mb-3 text-xs text-danger">{failure}</p> : null}
      {matrix.isSuccess ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('catalogue.search')}
              className="ps-9"
            />
          </div>
          <div className="max-h-[52vh] overflow-auto rounded-xl border border-border">
            <div className="grid gap-0 sm:grid-cols-2">
              {subjects.map((subject) => {
                const active = effective(subject.key);
                const pending = Object.prototype.hasOwnProperty.call(changes, subject.key);
                return (
                  <button
                    key={subject.key}
                    type="button"
                    onClick={() => toggle(subject.key)}
                    className="flex min-h-14 items-center gap-3 border-b border-border p-3 text-start transition hover:bg-surface-subtle sm:odd:border-e"
                    aria-pressed={active}
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${active ? 'border-accent/40 bg-accent-subtle text-accent' : 'border-border text-transparent'}`}>
                      <Check className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{subject.name}</span>
                    {pending ? <Badge tone="info">{t('matrix.pendingCell')}</Badge> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-text-muted">
            <Badge tone="success">{enabledCount} {t('catalogue.active')}</Badge>
            <Badge tone="neutral">{subjects.length} {t('catalogue.tab.subjects')}</Badge>
            {Object.keys(changes).length > 0 ? (
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-subtle" onClick={() => setChanges({})}>
                <X className="size-3" /> {t('matrix.discard')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </ActionModal>
  );
}
