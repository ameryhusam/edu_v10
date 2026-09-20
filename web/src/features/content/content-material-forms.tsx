/**
 * The lesson-material create and edit forms — split out of
 * content-materials-panel.tsx purely to keep that file under FE12's
 * useState budget. Both forms only ever call textbookAdministrationApi.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { useLessonBank } from '../../education/authoring/use-question-linking';
import { textbookAdministrationApi, type LessonMaterial } from './content.api';

const RESOURCE_KINDS = ['READING', 'VIDEO', 'WORKED_EXAMPLE', 'FLASHCARD_DECK', 'REMEDIAL', 'TEXTBOOK_PAGE'] as const;

export function MaterialEditForm({
  material,
  lessonKey,
  onClose,
}: {
  readonly material: LessonMaterial;
  readonly lessonKey: string;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(material.title);
  const [url, setUrl] = useState(material.url ?? '');
  const [body, setBody] = useState(material.body ?? '');
  const [estimatedMins, setEstimatedMins] = useState(
    material.estimatedMins !== null ? String(material.estimatedMins) : '',
  );

  const save = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.updateResource({
        resourceKey: material.key,
        title: title.trim(),
        url: url.trim() ? url.trim() : null,
        body: body.trim() ? body.trim() : null,
        estimatedMins: estimatedMins ? Number(estimatedMins) : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.lessonMaterials(lessonKey) });
      onClose();
    },
  });

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-3">
      <p className="text-sm font-bold text-text">{t('content.editResource')}</p>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.materialTitle')}</span>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.materialUrl')}</span>
        <Input value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.materialBody')}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.estimatedMinsLabel')}</span>
        <Input type="number" min="1" value={estimatedMins} onChange={(event) => setEstimatedMins(event.target.value)} />
      </label>
      {save.isError ? <ErrorState error={save.error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={save.isPending} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={save.isPending || !title.trim()} onClick={() => save.mutate()}>
          {save.isPending ? t('common.working') : t('catalogue.save')}
        </Button>
      </div>
    </div>
  );
}

export function MaterialCreateForm({
  lessonKey,
  onClose,
}: {
  readonly lessonKey: string;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<(typeof RESOURCE_KINDS)[number]>('READING');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [conceptKey, setConceptKey] = useState('');
  const [estimatedMins, setEstimatedMins] = useState('');
  const lessonBank = useLessonBank(lessonKey);

  const create = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.createLearningResource({
        kind,
        title,
        url: url.trim() ? url.trim() : null,
        body: body.trim() ? body.trim() : null,
        lessonKey: conceptKey.trim() ? null : lessonKey,
        conceptKey: conceptKey.trim() ? conceptKey.trim() : null,
        estimatedMins: estimatedMins ? Number(estimatedMins) : null,
      }),
    onSuccess: () => {
      setTitle('');
      setUrl('');
      setBody('');
      setConceptKey('');
      setEstimatedMins('');
      queryClient.invalidateQueries({ queryKey: queryKeys.content.lessonMaterials(lessonKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('content.addLearningPathContent')}
        className="max-h-[min(42rem,92vh)] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
      <div>
        <p className="text-sm font-bold text-text">{t('content.addLearningPathContent')}</p>
        <p className="text-xs leading-relaxed text-text-muted">{t('content.addMaterialHint')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-2xs font-medium text-text-muted">{t('content.resourceKind')}</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as (typeof RESOURCE_KINDS)[number])}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
          >
            {RESOURCE_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`resource.${value}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-2xs font-medium text-text-muted">{t('content.materialTitle')}</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-2xs font-medium text-text-muted">{t('content.materialUrl')}</span>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-2xs font-medium text-text-muted">{t('content.conceptScopeOptional')}</span>
          <select
            value={conceptKey}
            onChange={(event) => setConceptKey(event.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
          >
            <option value="">{t('content.lessonScope')}</option>
            {(lessonBank.bank?.concepts ?? []).map((concept) => (
              <option key={concept.key} value={concept.key}>
                {concept.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-2xs font-medium text-text-muted">{t('content.estimatedMinsLabel')}</span>
          <Input
            type="number"
            min="1"
            value={estimatedMins}
            onChange={(event) => setEstimatedMins(event.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.materialBody')}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      </label>
      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" disabled={create.isPending} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={create.isPending || (!url.trim() && !body.trim())}>
          {create.isPending ? t('common.working') : t('content.addMaterial')}
        </Button>
      </div>
      </form>
    </div>
  );
}
