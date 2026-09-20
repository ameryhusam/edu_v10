/**
 * Add one node to the learning path.
 *
 * This is a modal because the author is adding content at a precise point in
 * the outline, not navigating to a separate editor. The write still goes
 * through the content authoring endpoints: the modal collects intent only.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { textbookAdministrationApi } from './content.api';

export type ContentNodeCreateTarget =
  | { readonly kind: 'unit'; readonly textbookKey: string; readonly parentName: string }
  | { readonly kind: 'lesson'; readonly textbookKey: string; readonly unitKey: string; readonly parentName: string }
  | { readonly kind: 'concept'; readonly textbookKey: string; readonly lessonKey: string; readonly parentName: string };

export function ContentNodeCreateModal({
  target,
  onClose,
}: {
  readonly target: ContentNodeCreateTarget;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedMins, setEstimatedMins] = useState('');
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [passThreshold, setPassThreshold] = useState('0.85');
  const [difficulty, setDifficulty] = useState('3');
  const [importance, setImportance] = useState('3');
  const [isCore, setIsCore] = useState(true);

  const create = useMutation({
    mutationFn: () => {
      if (target.kind === 'unit') {
        return textbookAdministrationApi.createUnit({
          textbookKey: target.textbookKey,
          name,
          slug: slug.trim() ? slug.trim() : null,
          startPage: startPage ? Number(startPage) : null,
          endPage: endPage ? Number(endPage) : null,
        });
      }
      if (target.kind === 'lesson') {
        return textbookAdministrationApi.createLesson({
          unitKey: target.unitKey,
          name,
          slug: slug.trim() ? slug.trim() : null,
          description: description.trim() ? description.trim() : null,
          estimatedMins: estimatedMins ? Number(estimatedMins) : null,
          startPage: startPage ? Number(startPage) : null,
          endPage: endPage ? Number(endPage) : null,
        });
      }
      return textbookAdministrationApi.createConcept({
        lessonKey: target.lessonKey,
        name,
        slug: slug.trim() ? slug.trim() : null,
        description: description.trim() ? description.trim() : null,
        difficulty: Number(difficulty),
        importance: Number(importance),
        masteryThreshold: passThreshold ? Number(passThreshold) : 0.85,
        isCore,
        pageNumber: pageNumber ? Number(pageNumber) : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.outline(target.textbookKey) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  const title =
    target.kind === 'unit'
      ? t('content.addUnit')
      : target.kind === 'lesson'
        ? t('content.addLesson')
        : t('content.addConcept');

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <p className="text-sm text-text-muted">
            {t('content.addNodeHint', { parent: target.parentName })}
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('content.nodeName')}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('content.nodeSlug')}</span>
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
          <span className="text-2xs text-text-muted">{t('content.nodeSlugHint')}</span>
        </label>
        {target.kind !== 'unit' ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('content.nodeDescription')}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
            />
          </label>
        ) : null}

        {target.kind === 'lesson' ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('content.estimatedMinsLabel')}</span>
            <Input
              type="number"
              min="1"
              value={estimatedMins}
              onChange={(e) => setEstimatedMins(e.target.value)}
              placeholder="45"
            />
          </label>
        ) : null}

        {target.kind === 'unit' || target.kind === 'lesson' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('content.startPage')}</span>
              <Input
                type="number"
                min="1"
                value={startPage}
                onChange={(e) => setStartPage(e.target.value)}
                placeholder="1"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('content.endPage')}</span>
              <Input
                type="number"
                min="1"
                value={endPage}
                onChange={(e) => setEndPage(e.target.value)}
                placeholder="25"
              />
            </label>
          </div>
        ) : null}

        {target.kind === 'concept' ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface-sunken p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-text-muted">{t('concept.difficulty')} (1-5)</span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
                >
                  <option value="1">1 - سهل جداً</option>
                  <option value="2">2 - سهل</option>
                  <option value="3">3 - متوسط</option>
                  <option value="4">4 - متقدم</option>
                  <option value="5">5 - معقد</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-text-muted">{t('concept.importance')} (1-5)</span>
                <select
                  value={importance}
                  onChange={(e) => setImportance(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
                >
                  <option value="1">1 - ثانوي</option>
                  <option value="2">2 - إثرائي</option>
                  <option value="3">3 - أساسي</option>
                  <option value="4">4 - جوهري</option>
                  <option value="5">5 - حرِج</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-text-muted">{t('concept.pageNumber')}</span>
                <Input
                  type="number"
                  min="1"
                  value={pageNumber}
                  onChange={(e) => setPageNumber(e.target.value)}
                  placeholder="e.g. 14"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-text-muted">{t('concept.masteryThreshold')} (0.50 - 1.00)</span>
                <Input
                  type="number"
                  min="0.5"
                  max="1"
                  step="0.05"
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(e.target.value)}
                  placeholder="0.85"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isCore}
                onChange={(e) => setIsCore(e.target.checked)}
                className="size-4 rounded border-border text-accent focus:ring-accent"
              />
              <span className="text-xs font-medium text-text">{t('concept.isCore')}</span>
            </label>
          </div>
        ) : null}

        {create.isError ? <ErrorState error={create.error} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.working') : title}
          </Button>
        </div>
      </form>
    </div>
  );
}
