import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import {
  textbookAdministrationApi,
  type ResourceRecord,
} from './content.api';

export const RESOURCE_KINDS = [
  'READING',
  'VIDEO',
  'WORKED_EXAMPLE',
  'FLASHCARD_DECK',
  'REMEDIAL',
  'TEXTBOOK_PAGE',
] as const;

export interface ResourceEditorFormProps {
  readonly textbookKey: string;
  readonly initialResource: ResourceRecord | null;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}

export function ResourceEditorForm({
  textbookKey,
  initialResource,
  onCancel,
  onSaved,
}: ResourceEditorFormProps): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<(typeof RESOURCE_KINDS)[number]>(
    (initialResource?.kind as (typeof RESOURCE_KINDS)[number]) ?? 'READING',
  );
  const [title, setTitle] = useState(initialResource?.title ?? '');
  const [url, setUrl] = useState(initialResource?.url ?? '');
  const [body, setBody] = useState(initialResource?.body ?? '');
  const [pageStart, setPageStart] = useState(
    initialResource?.pageStart !== null && initialResource?.pageStart !== undefined
      ? String(initialResource.pageStart)
      : '',
  );
  const [pageEnd, setPageEnd] = useState(
    initialResource?.pageEnd !== null && initialResource?.pageEnd !== undefined
      ? String(initialResource.pageEnd)
      : '',
  );
  const [estimatedMins, setEstimatedMins] = useState(
    initialResource?.estimatedMins !== null && initialResource?.estimatedMins !== undefined
      ? String(initialResource.estimatedMins)
      : '',
  );

  const createMutation = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.createLearningResource({
        kind,
        title: title.trim(),
        textbookKey,
        url: url.trim() ? url.trim() : null,
        body: body.trim() ? body.trim() : null,
        pageStart: pageStart ? Number(pageStart) : null,
        pageEnd: pageEnd ? Number(pageEnd) : null,
        estimatedMins: estimatedMins ? Number(estimatedMins) : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      onSaved();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (resourceKey: string) =>
      textbookAdministrationApi.updateResource({
        resourceKey,
        title: title.trim(),
        url: url.trim() ? url.trim() : null,
        body: body.trim() ? body.trim() : null,
        pageStart: pageStart ? Number(pageStart) : null,
        pageEnd: pageEnd ? Number(pageEnd) : null,
        estimatedMins: estimatedMins ? Number(estimatedMins) : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      onSaved();
    },
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (initialResource) {
          updateMutation.mutate(initialResource.key);
        } else {
          createMutation.mutate();
        }
      }}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-sm font-bold text-text">
          {initialResource ? t('resource.editResource') : t('resource.addResource')}
        </span>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          ✕
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {!initialResource ? (
          <label className="space-y-1">
            <span className="text-xs font-medium text-text-muted">{t('content.resourceKind')} *</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof RESOURCE_KINDS)[number])}
              className="h-10 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
            >
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`resource.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-text-muted">{t('content.materialTitle')} *</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-text-muted">{t('content.materialUrl')}</span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
        </label>

        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-text-muted">{t('content.materialBody')}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-text-muted">{t('content.estimatedMinsLabel')}</span>
          <Input
            type="number"
            min="1"
            value={estimatedMins}
            onChange={(e) => setEstimatedMins(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-text-muted">{t('resource.pageStart')}</span>
            <Input
              type="number"
              value={pageStart}
              onChange={(e) => setPageStart(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-text-muted">{t('resource.pageEnd')}</span>
            <Input
              type="number"
              value={pageEnd}
              onChange={(e) => setPageEnd(e.target.value)}
            />
          </label>
        </div>
      </div>

      {createMutation.isError ? <ErrorState error={createMutation.error} /> : null}
      {updateMutation.isError ? <ErrorState error={updateMutation.error} /> : null}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={!title.trim() || createMutation.isPending || updateMutation.isPending}
        >
          {createMutation.isPending || updateMutation.isPending
            ? t('common.working')
            : t('catalogue.save')}
        </Button>
      </div>
    </form>
  );
}
