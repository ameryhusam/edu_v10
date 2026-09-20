/**
 * Lesson materials drawer content.
 *
 * Reading and remedial resources are authored against the existing textbook,
 * lesson or concept keys. The server still derives the stored resource key,
 * so this is a UI for the canonical content write path, not a parallel import.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { textbookAdministrationApi, type LessonMaterial } from './content.api';
import { MaterialCreateForm, MaterialEditForm } from './content-material-forms';

export function MaterialsList({ lessonKey }: { readonly lessonKey: string }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LessonMaterial | null>(null);
  const [retiring, setRetiring] = useState<LessonMaterial | null>(null);
  const materials = useQuery({
    queryKey: queryKeys.content.lessonMaterials(lessonKey),
    queryFn: () => textbookAdministrationApi.lessonMaterials(lessonKey),
  });

  const retire = useMutation({
    mutationFn: (resourceKey: string) => textbookAdministrationApi.retireResource(resourceKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.lessonMaterials(lessonKey) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      setRetiring(null);
    },
  });

  return (
    <div className="space-y-4">
      <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
        {t('content.addLearningPathContent')}
      </Button>
      {creating ? <MaterialCreateForm lessonKey={lessonKey} onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <MaterialEditForm
          material={editing}
          lessonKey={lessonKey}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {materials.isPending ? <LoadingState /> : null}
      {materials.isError ? <ErrorState error={materials.error} onRetry={() => materials.refetch()} /> : null}
      {materials.isSuccess && materials.data.length === 0 ? (
        <EmptyState title={t('content.noMaterials')} body={t('content.noMaterialsBody')} />
      ) : null}
      {materials.isSuccess && materials.data.length > 0 ? (
        <ul className="space-y-2">
          {materials.data.map((material: LessonMaterial) => (
            <li
              key={material.key}
              className="space-y-1 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{material.title}</span>
                <Badge tone="neutral">{t(`resource.${material.kind}` as MessageKey)}</Badge>
              </div>
              <p className="text-2xs text-text-muted">
                {material.scope === 'CONCEPT'
                  ? material.conceptName ?? t('content.conceptScope')
                  : t('content.lessonScope')}
              </p>
              {material.estimatedMins !== null ? (
                <p className="text-xs text-text-muted">{t('content.estimatedMins', { count: material.estimatedMins })}</p>
              ) : null}
              {material.url ? (
                <a
                  href={material.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-accent underline"
                >
                  {material.url}
                </a>
              ) : null}
              {material.body ? (
                <p className="text-xs leading-relaxed text-text-muted">{material.body}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(material)}>
                  {t('content.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRetiring(material)}>
                  {t('content.retireResource')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {retiring !== null ? (
        <ConfirmDialog
          title={t('content.retireResource')}
          body={t('content.confirmRetireResource', { title: retiring.title })}
          confirmLabel={t('content.retireResource')}
          pending={retire.isPending}
          destructive
          onConfirm={() => retire.mutate(retiring.key)}
          onCancel={() => setRetiring(null)}
        />
      ) : null}
    </div>
  );
}

