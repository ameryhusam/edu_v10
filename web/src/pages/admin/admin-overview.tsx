/**
 * The administrator's landing screen.
 *
 * Ordered by what a person actually needs: what is wrong, then what exists,
 * then what just happened. The counts are the boring half and they come
 * second, because a dashboard that opens with fifteen equal tiles makes the
 * reader do the triage the screen was supposed to do for them.
 *
 * Every number comes from one server call. Assembling this from fifteen list
 * endpoints and measuring array lengths would put the definition of the
 * summary in the browser, and would fetch entire tables to count them.
 *
 * The shape is the legacy command centre's, adapted: the foundation banner
 * opens the board with the current year, the numbered task map lists the six
 * jobs in dependency order, and only then come the triage and the inventory.
 * `command-center.tsx` holds the two cloned sections.
 */

import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, GraduationCap, School, Users } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { MetricCard, MetricGrid } from '../../design-system/patterns/metric-grid';
import { Badge } from '../../design-system/ui/badge';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { FoundationCard, TaskMap } from '../../features/administration/command-center';
import { PageHeader } from '../../design-system/patterns/page-header';
import {
  administrationApi,
  type AdminCollection,
  type AttentionId,
} from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import type { MessageKey } from '../../shared/i18n/messages';

/**
 * Where a collection can be administered.
 *
 * Absence is meaningful: a collection with no destination is reported but not
 * editable from here, because the thing that owns it enforces rules a table
 * editor would bypass. Attempts and evidence have no entry at all — they are
 * records of what happened, and an administrator editing history is not an
 * administrator, it is a data-integrity incident.
 */
const MANAGED_AT: Partial<Record<AdminCollection, string>> = {
  users: '/admin/users',
  learners: '/admin/users',
  educators: '/admin/teachers',
  schools: '/admin/schools',
  subjects: '/admin/structure',
  grades: '/admin/structure',
  academicYears: '/admin/structure',
  terms: '/admin/structure',
  enrollments: '/admin/enrollments',
  currentEnrollments: '/admin/enrollments',
  textbooks: '/admin/textbooks',
};

/** Every attention signal, and the screen that resolves it. */
const ATTENTION: ReadonlyArray<{ id: AttentionId; to: string | null }> = [
  { id: 'unlinkedQuestions', to: null },
  { id: 'suspendedUsers', to: '/admin/users' },
  { id: 'draftTextbooks', to: '/admin/textbooks' },
  { id: 'inactiveSchools', to: '/admin/schools' },
  { id: 'inactiveSubjects', to: '/admin/structure' },
  { id: 'inactiveGrades', to: '/admin/structure' },
  { id: 'learnersWithoutEnrollment', to: '/admin/enrollments' },
  { id: 'unscopedTeacherGrants', to: '/admin/teachers' },
];

/** Context, not faults: these are the system working, or near-misses at worst. */
const INFO_TONES: ReadonlySet<AttentionId> = new Set(['draftTextbooks']);

export function AdminOverviewPage(): ReactNode {
  const { t, locale } = useI18n();

  const overview = useQuery({
    queryKey: queryKeys.administration.overview(),
    queryFn: () => administrationApi.overview(),
  });

  if (overview.isPending) return <LoadingState />;
  if (overview.isError)
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  const { collections, usersByStatus, textbooksByStatus, attention } = overview.data;
  const alerts = ATTENTION.filter(({ id }) => attention[id] > 0);

  // The four headline counts, in «Nebula's» stat-card row. Chosen because an
  // administrator's first question is "is the platform populated" — people,
  // learners, schools, books — before the triage below asks "what is wrong".
  // The labels reuse the collection names the records section already shows,
  // so the same thing is called the same thing twice on one screen.
  const totalOf = (id: AdminCollection): number =>
    collections.find((entry) => entry.collection === id)?.total ?? 0;

  /** The task map's badges, keyed by collection: server totals, read as-is. */
  const totals = Object.fromEntries(
    collections.map((entry) => [entry.collection, entry.total]),
  ) as Record<AdminCollection, number>;

  return (
    <div className="space-y-8">
      <PageHeader
        badge={t('admin.badge')}
        title={t('admin.overviewTitle')}
        subtitle={t('admin.overviewSubtitle')}
      />

      {/* The legacy board's opening banner: which year is current — or the
          fact that none is, which on a fresh install is the first job. */}
      <FoundationCard year={overview.data.currentAcademicYear} />

      <MetricGrid>
        <MetricCard
          title={t('collection.users')}
          value={formatCount(locale, totalOf('users'))}
          icon={<Users className="size-5" />}
          tone="accent"
        />
        <MetricCard
          title={t('collection.learners')}
          value={formatCount(locale, totalOf('learners'))}
          icon={<GraduationCap className="size-5" />}
          tone="success"
        />
        <MetricCard
          title={t('collection.schools')}
          value={formatCount(locale, totalOf('schools'))}
          icon={<School className="size-5" />}
          tone="info"
        />
        <MetricCard
          title={t('collection.textbooks')}
          value={formatCount(locale, totalOf('textbooks'))}
          icon={<BookOpen className="size-5" />}
          tone="accent"
        />
      </MetricGrid>

      <TaskMap totals={totals} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-muted">{t('admin.needsAttention')}</h2>

        {alerts.length === 0 ? (
          <Card elevation="flat">
            <CardContent className="py-4 text-sm text-text-muted">{t('admin.allClear')}</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map(({ id, to }) => (
              <AttentionCard
                key={id}
                id={id}
                value={formatCount(locale, attention[id])}
                to={to}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-muted">{t('admin.records')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((entry) => (
            <CountCard
              key={entry.collection}
              collection={entry.collection}
              total={formatCount(locale, entry.total)}
              to={MANAGED_AT[entry.collection] ?? null}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard titleKey="admin.usersByStatus" rows={usersByStatus} />
        <BreakdownCard titleKey="admin.textbooksByStatus" rows={textbooksByStatus} />
      </div>

      <ActivityFeed />
    </div>
  );
}

function AttentionCard({
  id,
  value,
  to,
}: {
  readonly id: AttentionId;
  readonly value: string;
  readonly to: string | null;
}): ReactNode {
  const { t } = useI18n();

  // Draft textbooks are context, not a fault — an author working is the system
  // behaving correctly. Colouring it like a problem would teach people to
  // ignore the colour.
  const tone = INFO_TONES.has(id) ? 'info' : 'warning';

  const body = (
    <Card elevation="default" interactive={to !== null} className="h-full">
      <CardContent className="space-y-1.5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-text">
            {t(`admin.attention.${id}` as MessageKey)}
          </span>
          <Badge tone={tone}>{value}</Badge>
        </div>
        <p className="text-xs leading-relaxed text-text-muted">
          {t(`admin.attention.${id}Note` as MessageKey)}
        </p>
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function CountCard({
  collection,
  total,
  to,
}: {
  readonly collection: AdminCollection;
  readonly total: string;
  readonly to: string | null;
}): ReactNode {
  const { t } = useI18n();

  const body = (
    <Card elevation="default" interactive={to !== null} className="h-full">
      <CardContent className="flex items-baseline justify-between gap-3 py-4">
        <span className="text-sm text-text-muted">
          {t(`collection.${collection}` as MessageKey)}
        </span>
        <span className="text-xl font-bold tabular-nums text-text">{total}</span>
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function BreakdownCard({
  titleKey,
  rows,
}: {
  readonly titleKey: MessageKey;
  readonly rows: readonly { status: string; total: number }[];
}): ReactNode {
  const { t, locale } = useI18n();

  return (
    <Card elevation="default">
      <CardContent className="space-y-3 py-4">
        <h3 className="text-sm font-semibold text-text">{t(titleKey)}</h3>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.status} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-muted">{row.status}</span>
              <span className="font-semibold tabular-nums text-text">
                {formatCount(locale, row.total)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * The audit trail, newest first. The actor is shown as the system when no
 * person was recorded — "someone did this" would be a guess, and a blank
 * reads as missing data.
 */
function ActivityFeed(): ReactNode {
  const { t, locale } = useI18n();
  const activity = useQuery({
    queryKey: queryKeys.administration.activity(),
    queryFn: () => administrationApi.activity(),
  });

  if (activity.isPending)
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-muted">{t('admin.activity.title')}</h2>
        <LoadingState />
      </section>
    );
  if (activity.isError) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-muted">{t('admin.activity.title')}</h2>
      {activity.data.length === 0 ? (
        <Card elevation="flat">
          <CardContent className="py-4 text-sm text-text-muted">
            {t('admin.activity.empty')}
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {activity.data.map((entry, index) => (
            <li
              key={`${entry.createdAt}-${index}`}
              className="flex flex-wrap items-baseline justify-between gap-2 bg-surface px-4 py-2.5 text-sm"
            >
              <span className="text-text">
                <span className="font-medium">{entry.actorName ?? t('admin.activity.unknownActor')}</span>
                <span className="text-text-muted"> · {entry.action}</span>
              </span>
              <span className="text-xs text-text-muted">
                {new Date(entry.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
