/**
 * Textbook & Curriculum learning resources modal.
 *
 * Full CRUD management of learning resources (reading materials, videos, worked examples,
 * flashcards, remedial resources) across the textbook and its lessons/concepts.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { Input } from '../../design-system/ui/input';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import {
  textbookAdministrationApi,
  type ResourceRecord,
} from './content.api';
import { ResourceEditorForm, RESOURCE_KINDS } from './resource-editor-form';

export interface TextbookResourcesModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly textbookKey: string;
  readonly textbookTitle: string;
}

export function TextbookResourcesModal({
  open,
  onClose,
  textbookKey,
  textbookTitle,
}: TextbookResourcesModalProps): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ResourceRecord | null>(null);
  const [retiring, setRetiring] = useState<ResourceRecord | null>(null);

  const resources = useQuery({
    queryKey: queryKeys.content.all,
    queryFn: () => textbookAdministrationApi.textbookResources(textbookKey),
    enabled: open && Boolean(textbookKey),
  });

  const retireMutation = useMutation({
    mutationFn: (resourceKey: string) =>
      textbookAdministrationApi.retireResource(resourceKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      setRetiring(null);
    },
  });

  function startEdit(r: ResourceRecord): void {
    setEditing(r);
    setCreating(false);
  }

  if (!open) return null;

  const allItems = resources.data ?? [];
  const filtered = allItems.filter((r) => {
    if (selectedKind !== 'ALL' && r.kind !== selectedKind) return false;
    if (search.trim() && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-4xl space-y-4 rounded-2xl border border-border bg-surface-raised p-6 shadow-xl max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold text-text">{t('resource.resourcesList')}</h2>
            <p className="text-xs text-text-muted">{textbookTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {!creating && !editing ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCreating(true);
                  setEditing(null);
                }}
              >
                + {t('resource.addResource')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>

        {/* Create or Edit Form */}
        {creating || editing ? (
          <ResourceEditorForm
            textbookKey={textbookKey}
            initialResource={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        ) : null}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={selectedKind === 'ALL' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setSelectedKind('ALL')}
            >
              {t('common.all')} ({allItems.length})
            </Button>
            {RESOURCE_KINDS.map((k) => {
              const count = allItems.filter((r) => r.kind === k).length;
              if (count === 0 && selectedKind !== k) return null;
              return (
                <Button
                  key={k}
                  variant={selectedKind === k ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedKind(k)}
                >
                  {t(`resource.${k}` as MessageKey)} ({count})
                </Button>
              );
            })}
          </div>

          <div className="w-full sm:w-56">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.search')}
            />
          </div>
        </div>

        {/* Resources List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {resources.isPending ? <LoadingState /> : null}
          {resources.isError ? (
            <ErrorState error={resources.error} onRetry={() => resources.refetch()} />
          ) : null}

          {resources.isSuccess && filtered.length === 0 ? (
            <EmptyState title={t('resource.noResources')} body={t('resource.noResourcesBody')} />
          ) : null}

          {resources.isSuccess && filtered.length > 0 ? (
            <ul className="space-y-2">
              {filtered.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3.5 hover:border-accent/40"
                >
                  <div className="space-y-1.5 flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text">{item.title}</span>
                      <Badge tone="neutral">
                        {t(`resource.${item.kind}` as MessageKey)}
                      </Badge>
                      {item.estimatedMins ? (
                        <span className="text-2xs text-text-muted">
                          ⏱️ {t('content.estimatedMins', { count: item.estimatedMins })}
                        </span>
                      ) : null}
                      {item.pageStart ? (
                        <span className="text-2xs text-text-muted">
                          📄 ص {item.pageStart} {item.pageEnd ? `- ${item.pageEnd}` : ''}
                        </span>
                      ) : null}
                    </div>

                    {item.body ? (
                      <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                        {item.body}
                      </p>
                    ) : null}

                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        🔗 {item.url}
                      </a>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                      ✏️ {t('content.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRetiring(item)}>
                      🗑️ {t('resource.retire')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {retiring ? (
          <ConfirmDialog
            title={t('resource.retire')}
            body={t('content.confirmRetireResource', { title: retiring.title })}
            confirmLabel={t('resource.retire')}
            pending={retireMutation.isPending}
            destructive
            onConfirm={() => retireMutation.mutate(retiring.key)}
            onCancel={() => setRetiring(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
