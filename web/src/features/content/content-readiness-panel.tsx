import type { ReactNode } from 'react';
import { Badge } from '../../design-system/ui/badge';
import { Card, CardContent } from '../../design-system/ui/card';
import { useI18n } from '../../shared/i18n/i18n';

export function ContentMetric({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <span className="rounded-xl border border-border bg-surface-raised px-3 py-2">
      <span className="block text-2xs text-text-muted">{label}</span>
      <span className="text-lg font-extrabold tabular-nums text-text">{value}</span>
    </span>
  );
}

export function ReadinessPanel({
  ready,
  issues,
}: {
  readonly ready: boolean;
  readonly issues: readonly { code: string; message: string; at?: string }[];
}): ReactNode {
  const { t } = useI18n();
  return (
    <Card elevation={ready ? 'flat' : 'raised'}>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-text">{t('content.readinessTitle')}</p>
            <p className="text-xs text-text-muted">
              {ready ? t('content.readinessReady') : t('content.readinessBlocked')}
            </p>
          </div>
          <Badge tone={ready ? 'success' : 'warning'}>
            {ready ? t('content.ready') : t('content.issuesCount', { count: issues.length })}
          </Badge>
        </div>
        {issues.length > 0 ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {issues.slice(0, 6).map((issue) => (
              <li key={`${issue.code}:${issue.at ?? ''}`} className="rounded-lg border border-border bg-surface p-2">
                <p className="text-xs font-bold text-text">{issue.code}</p>
                <p className="text-2xs text-text-muted">{issue.message}</p>
                {issue.at ? <p className="mt-1 truncate text-2xs text-text-subtle">{issue.at}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
