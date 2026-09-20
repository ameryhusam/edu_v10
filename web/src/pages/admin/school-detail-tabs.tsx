/**
 * The tab bodies of a school's detail page: its people, its cohorts, and its
 * adopted textbooks.
 *
 * People are read from the same server-side directory the users screen uses,
 * filtered by the school — one query shape, one paging contract. The adoption
 * tab writes: adopting a textbook for a school-year pair is the entitlement
 * decision that decides what this school's learners can read.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { Pager } from '../../design-system/patterns/pager';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { PublicationBadge } from '../../features/content/publication-badge';
import { adminApi, type DirectoryUser } from '../../features/people/people.api';
import {
  textbookAdministrationApi,
  type AdoptionRow,
} from '../../features/content/content.api';
import { administrationApi, type AcademicYearRecord } from '../../features/administration/administration.api';
import { AccreditTextbookForm } from './accredit-textbook-form';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

const PAGE_SIZE = 25;

export function SchoolPeopleTab({
  schoolKey,
  role,
}: {
  readonly schoolKey: string;
  readonly role: 'TEACHER' | 'STUDENT';
}): ReactNode {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);

  const directory = useQuery({
    queryKey: queryKeys.provisioning.users({ schoolKey, role, limit: PAGE_SIZE, offset }),
    queryFn: () => adminApi.users({ schoolKey, role, limit: PAGE_SIZE, offset }),
  });

  const columns: readonly Column<DirectoryUser>[] = [
    {
      id: 'name',
      label: t('userForm.fullName'),
      render: (user) => <span className="font-semibold text-text">{user.fullName}</span>,
    },
    { id: 'username', label: t('userForm.username'), render: (user) => user.username },
    {
      id: 'roles',
      label: t('userForm.roles'),
      render: (user) => user.roles.join(', '),
    },
  ];

  return (
    <div className="space-y-4">
      {directory.isPending ? <LoadingState /> : null}
      {directory.isError ? (
        <ErrorState error={directory.error} onRetry={() => directory.refetch()} />
      ) : null}
      {directory.isSuccess && directory.data.rows.length === 0 ? (
        <EmptyState
          title={t(role === 'TEACHER' ? 'teachers.emptyTitle' : 'admin.noUsers')}
          body={role === 'TEACHER' ? t('teachers.emptyBody') : t('admin.noUsersHint')}
        />
      ) : null}
      {directory.isSuccess && directory.data.rows.length > 0 ? (
        <>
          <DataTable
            rows={directory.data.rows}
            columns={columns}
            keyOf={(user) => user.key}
            caption={t(role === 'TEACHER' ? 'schoolDetail.teachers' : 'schoolDetail.students')}
          />
          <Pager
            total={directory.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onOffsetChange={setOffset}
          />
        </>
      ) : null}
    </div>
  );
}

export function SchoolCohortsTab({ schoolKey }: { readonly schoolKey: string }): ReactNode {
  const { t } = useI18n();

  const years = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
  });

  const currentYear = (years.data ?? []).find((year: AcademicYearRecord) => year.isCurrent);

  const cohorts = useQuery({
    queryKey: queryKeys.provisioning.cohorts(schoolKey),
    queryFn: () => adminApi.cohorts(schoolKey),
    enabled: currentYear !== undefined,
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">{t('schoolDetail.cohortsNote')}</p>
      {cohorts.isPending ? <LoadingState /> : null}
      {cohorts.isError ? (
        <ErrorState error={cohorts.error} onRetry={() => cohorts.refetch()} />
      ) : null}
      {cohorts.isSuccess && cohorts.data.length === 0 ? (
        <EmptyState title={t('schoolDetail.noCohorts')} />
      ) : null}
      {cohorts.isSuccess && cohorts.data.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {cohorts.data.map((cohort) => (
            <li
              key={cohort.gradeKey}
              className="flex items-center justify-between gap-3 bg-surface px-4 py-3 text-sm"
            >
              <span className="font-medium text-text">{cohort.gradeName}</span>
              <span className="flex items-center gap-2">
                <Badge tone="accent">{cohort.currentCount}</Badge>
                <span className="text-xs text-text-muted">{t('schoolDetail.currentCount')}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SchoolTextbooksTab({ schoolKey }: { readonly schoolKey: string }): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const mayAccredit = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN');

  const [accrediting, setAccrediting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AdoptionRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const adoptions = useQuery({
    queryKey: queryKeys.textbookAdministration.adoptions({ schoolKey }),
    queryFn: () => textbookAdministrationApi.adoptions({ schoolKey }),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const withdraw = useMutation({
    mutationFn: (row: AdoptionRow) =>
      textbookAdministrationApi.unadopt({
        textbookKey: row.textbookKey,
        schoolKey: row.schoolKey,
        academicYearKey: row.academicYearKey,
      }),
    onSuccess: async () => {
      await refresh();
      setWithdrawing(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setWithdrawing(null);
    },
  });

  const columns: readonly Column<AdoptionRow>[] = [
    {
      id: 'textbook',
      label: t('textbookAdmin.textbook'),
      render: (row) => <span className="font-semibold text-text">{row.textbookTitle}</span>,
    },
    { id: 'year', label: t('enrollments.year'), render: (row) => row.academicYearKey },
    {
      id: 'status',
      label: t('catalogue.state'),
      render: (row) => <PublicationBadge status={row.textbookStatus} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">{t('textbookAdmin.publishedOnlyNote')}</p>
        {mayAccredit ? (
          <Button variant="secondary" size="sm" onClick={() => setAccrediting((v) => !v)}>
            {t('textbookAdmin.accreditBooks')}
          </Button>
        ) : null}
      </div>

      {accrediting ? (
        <AccreditTextbookForm
          schoolKey={schoolKey}
          onDone={async () => {
            await refresh();
          }}
        />
      ) : null}

      {adoptions.isPending ? <LoadingState /> : null}
      {adoptions.isError ? (
        <ErrorState error={adoptions.error} onRetry={() => adoptions.refetch()} />
      ) : null}

      {adoptions.isSuccess && adoptions.data.rows.length === 0 ? (
        <EmptyState title={t('textbookAdmin.noAdoptions')} />
      ) : null}

      {adoptions.isSuccess && adoptions.data.rows.length > 0 ? (
        <DataTable
          rows={adoptions.data.rows}
          columns={columns}
          keyOf={(row) => `${row.textbookKey}-${row.academicYearKey}`}
          caption={t('schoolDetail.textbooks')}
          rowActions={(row) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWithdrawing(row)}
            >
              {t('textbookAdmin.unadopt')}
            </Button>
          )}
        />
      ) : null}

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {withdrawing !== null ? (
        <ConfirmDialog
          title={t('textbookAdmin.unadopt')}
          body={t('textbookAdmin.confirmUnadopt', {
            book: withdrawing.textbookTitle,
            school: withdrawing.schoolName,
            year: withdrawing.academicYearKey,
          })}
          confirmLabel={t('textbookAdmin.unadopt')}
          pending={withdraw.isPending}
          destructive
          onConfirm={() => withdraw.mutate(withdrawing)}
          onCancel={() => setWithdrawing(null)}
        />
      ) : null}
    </div>
  );
}
