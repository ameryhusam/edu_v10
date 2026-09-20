/**
 * Rename or re-describe a unit/lesson/concept already in the tree.
 *
 * Deliberately separate from ContentNodeCreateModal rather than a shared
 * "mode" prop: creation collects a slug (an identity decision), editing never
 * touches the slug (PATCH /content/nodes rejects it — the slug is frozen at
 * creation, see checkSlugImmutable). Sharing one component would mean a slug
 * field that sometimes lies about being editable.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { textbookAdministrationApi, type ContentNodeKind } from './content.api';

export interface ContentNodeEditTarget {
  readonly kind: ContentNodeKind;
  readonly key: string;
  readonly textbookKey: string;
  readonly name: string;
  readonly description?: string | null;
  readonly estimatedMins?: number | null;
  readonly difficulty?: number;
  readonly importance?: number;
  readonly masteryThreshold?: number;
  readonly isCore?: boolean;
  readonly isActive?: boolean;
  readonly startPage?: number | null;
  readonly endPage?: number | null;
  readonly pageNumber?: number | null;
}

const TITLE_KEY: Record<ContentNodeKind, MessageKey> = {
  textbook: 'textbookAdmin.textbook',
  unit: 'content.editUnit',
  lesson: 'content.editLesson',
  concept: 'content.editConcept',
};

export function ContentNodeEditModal({
  target,
  onClose,
}: {
  readonly target: ContentNodeEditTarget;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState(target.description ?? '');
  const [estimatedMins, setEstimatedMins] = useState(
    target.estimatedMins !== undefined && target.estimatedMins !== null
      ? String(target.estimatedMins)
      : '',
  );
  const [startPage, setStartPage] = useState(
    target.startPage !== undefined && target.startPage !== null ? String(target.startPage) : '',
  );
  const [endPage, setEndPage] = useState(
    target.endPage !== undefined && target.endPage !== null ? String(target.endPage) : '',
  );
  const [pageNumber, setPageNumber] = useState(
    target.pageNumber !== undefined && target.pageNumber !== null ? String(target.pageNumber) : '',
  );
  const [passThreshold, setPassThreshold] = useState(
    target.masteryThreshold !== undefined && target.masteryThreshold !== null
      ? String(target.masteryThreshold)
      : '0.85',
  );
  const [difficulty, setDifficulty] = useState(String(target.difficulty ?? 3));
  const [importance, setImportance] = useState(String(target.importance ?? 3));
  const [isCore, setIsCore] = useState(target.isCore ?? true);
  const [isActive, setIsActive] = useState(target.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== target.name) patch['name'] = name.trim();
      if (isActive !== (target.isActive ?? true)) patch['isActive'] = isActive;

      if (target.kind === 'unit') {
        patch['startPage'] = startPage ? Number(startPage) : null;
        patch['endPage'] = endPage ? Number(endPage) : null;
      }

      if (target.kind === 'lesson') {
        patch['description'] = description.trim() ? description.trim() : null;
        patch['estimatedMins'] = estimatedMins ? Number(estimatedMins) : null;
        patch['startPage'] = startPage ? Number(startPage) : null;
        patch['endPage'] = endPage ? Number(endPage) : null;
      }

      if (target.kind === 'concept') {
        patch['description'] = description.trim() ? description.trim() : null;
        patch['difficulty'] = Number(difficulty);
        patch['importance'] = Number(importance);
        patch['masteryThreshold'] = passThreshold ? Number(passThreshold) : 0.85;
        patch['isCore'] = isCore;
        patch['pageNumber'] = pageNumber ? Number(pageNumber) : null;
      }

      return textbookAdministrationApi.updateNode({ kind: target.kind, key: target.key, patch });
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
    save.mutate();
  }

  const title = t(TITLE_KEY[target.kind]);

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
          <p className="text-sm text-text-muted">{t('content.editNodeHint')}</p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('content.nodeName')}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
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

        <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-border bg-surface p-3">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="size-4 rounded border-border text-accent focus:ring-accent"
          />
          <div className="text-xs">
            <span className="font-medium text-text">{t('catalogue.active')}</span>
            <p className="text-text-muted">{t('content.activeHint')}</p>
          </div>
        </label>

        {save.isError ? <ErrorState error={save.error} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={save.isPending || !name.trim()}>
            {save.isPending ? t('common.working') : t('catalogue.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
