import { type ReactNode } from 'react';
import { FileText, ExternalLink, Trash2 } from 'lucide-react';
import { ActionStepCard } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { TextbookSummary, ResourceRecord } from './content.api';

export interface TextbookPdfAttachedListProps {
  readonly textbook: TextbookSummary;
  readonly pdfResources: readonly ResourceRecord[];
  readonly isLoading: boolean;
  readonly onRetire: (resource: ResourceRecord) => void;
}

export function TextbookPdfAttachedList({
  textbook,
  pdfResources,
  isLoading,
  onRetire,
}: TextbookPdfAttachedListProps): ReactNode {
  const { t } = useI18n();

  return (
    <ActionStepCard step={1} title={t('textbookAdmin.pdfCurrentAttached')}>
      {isLoading ? (
        <div className="py-4 text-center text-xs text-text-muted">{t('common.working')}</div>
      ) : pdfResources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center">
          <FileText className="mx-auto size-8 text-text-muted/40" />
          <p className="mt-2 text-xs text-text-muted">{t('textbookAdmin.pdfNoneAttached')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pdfResources.map((res) => (
            <div
              key={res.key}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent">
                  <FileText className="size-5" />
                </span>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-xs font-bold text-text">{res.title}</h4>
                    <Badge tone="neutral">PDF</Badge>
                    {textbook.totalPages ? (
                      <Badge tone="accent">{`${textbook.totalPages} ${t('textbookAdmin.totalPages')}`}</Badge>
                    ) : null}
                  </div>
                  {res.url ? (
                    <p className="truncate text-2xs text-text-muted" dir="ltr">
                      {res.url}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                {res.url ? (
                  <a
                    href={res.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-subtle"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>{t('textbookAdmin.pdfOpen')}</span>
                  </a>
                ) : null}
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => onRetire(res)}
                  aria-label={t('textbookAdmin.pdfRetire')}
                  className="text-danger hover:bg-danger-subtle"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ActionStepCard>
  );
}
