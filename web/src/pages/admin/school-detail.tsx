/**
 * One school, in full — the detail surface the audit's gap G2 called for.
 *
 * The tabs read from different services on purpose: people and cohorts are
 * provisioning queries over the school's scope, textbooks is the adoption
 * set. What they share is the school, not a storage pattern — the page is a
 * lens on one institution, and each tab asks the service that owns the data.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../design-system/ui/button';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { ActiveBadge } from '../../design-system/patterns/active-badge';
import { SchoolPeopleTab, SchoolCohortsTab, SchoolTextbooksTab } from './school-detail-tabs';
import { schoolsApi } from '../../features/schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

type TabId = 'overview' | 'teachers' | 'students' | 'cohorts' | 'textbooks';

const TABS: readonly { id: TabId; labelKey: MessageKey }[] = [
  { id: 'overview', labelKey: 'schoolDetail.overview' },
  { id: 'teachers', labelKey: 'schoolDetail.teachers' },
  { id: 'students', labelKey: 'schoolDetail.students' },
  { id: 'cohorts', labelKey: 'schoolDetail.cohorts' },
  { id: 'textbooks', labelKey: 'schoolDetail.textbooks' },
];

export function SchoolDetailPage(): ReactNode {
  const { schoolKey = '' } = useParams<{ schoolKey: string }>();
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const canWrite = hasRole('SYSTEM_ADMIN');

  const [tab, setTab] = useState<TabId>('overview');
  const [failure, setFailure] = useState<string | null>(null);

  const school = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
    // The list is the cache entry; find the one this page is about.
    select: (rows) => rows.find((row) => row.key === schoolKey) ?? null,
  });

  const toggleActive = useMutation({
    mutationFn: (next: boolean) => schoolsApi.update(schoolKey, { isActive: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.administration.all }),
    onError: (cause) =>
      setFailure(
        cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed'),
      ),
  });

  if (school.isPending) return <LoadingState />;
  if (school.isError)
    return <ErrorState error={school.error} onRetry={() => school.refetch()} />;
  if (!school.data)
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t('schoolDetail.notFound')}</p>
        <Link to="/admin/schools" className="text-sm text-accent hover:underline">
          ← {t('schools.title')}
        </Link>
      </div>
    );

  const record = school.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/schools" className="text-sm text-text-muted transition-colors hover:text-text">
          ← {t('schools.title')}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text">{record.name}</h1>
            <ActiveBadge isActive={record.isActive} />
          </div>
          <p className="text-sm text-text-muted">
            {record.key}
            {record.city ? ` · ${record.city}` : ''}
          </p>
        </div>
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate(!record.isActive)}
          >
            {record.isActive ? t('catalogue.deactivate') : t('catalogue.activate')}
          </Button>
        ) : null}
      </header>

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      <nav className="flex flex-wrap gap-1 rounded-xl bg-surface-sunken p-1" aria-label={t('schools.title')}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={
              tab === entry.id
                ? 'rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text shadow-sm'
                : 'rounded-lg px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text'
            }
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs font-medium text-text-muted">{t('schools.enrollments')}</dt>
            <dd className="mt-1 text-2xl font-bold text-text">{record.enrollmentCount}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs font-medium text-text-muted">{t('schools.grants')}</dt>
            <dd className="mt-1 text-2xl font-bold text-text">{record.roleGrantCount}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs font-medium text-text-muted">{t('catalogue.city')}</dt>
            <dd className="mt-1 text-2xl font-bold text-text">{record.city ?? '—'}</dd>
          </div>
        </dl>
      ) : null}

      {tab === 'teachers' ? <SchoolPeopleTab schoolKey={schoolKey} role="TEACHER" /> : null}
      {tab === 'students' ? <SchoolPeopleTab schoolKey={schoolKey} role="STUDENT" /> : null}
      {tab === 'cohorts' ? <SchoolCohortsTab schoolKey={schoolKey} /> : null}
      {tab === 'textbooks' ? <SchoolTextbooksTab schoolKey={schoolKey} /> : null}
    </div>
  );
}
