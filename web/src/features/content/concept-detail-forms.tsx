/**
 * The two write forms inside ConceptDetailDrawer — split out purely to keep
 * the drawer file under FE12's line budget. Same file family, same domain
 * rules: the misconception create and prerequisite link forms only ever
 * call textbookAdministrationApi; they never decide what is legal, they only
 * collect input and surface the server's Result.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { textbookAdministrationApi } from './content.api';

export function MisconceptionForm({
  conceptKey,
  onDone,
  onCancel,
}: {
  readonly conceptKey: string;
  readonly onDone: () => Promise<void>;
  readonly onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [correction, setCorrection] = useState('');

  const create = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.createMisconception({
        conceptKey,
        name,
        description,
        correction: correction.trim() ? correction.trim() : null,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-3">
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.misconceptionName')}</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.misconceptionDescription')}</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.misconceptionCorrection')}</span>
        <textarea
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      </label>
      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={create.isPending} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={create.isPending || !name.trim() || !description.trim()}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t('common.working') : t('content.addMisconception')}
        </Button>
      </div>
    </div>
  );
}

export function PrerequisiteLinkForm({
  conceptKey,
  ownerTextbookKey,
  onDone,
  onCancel,
}: {
  readonly conceptKey: string;
  readonly ownerTextbookKey: string;
  readonly onDone: () => Promise<void>;
  readonly onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [crossGrade, setCrossGrade] = useState(false);
  const [sourceTextbookKey, setSourceTextbookKey] = useState(ownerTextbookKey);

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({}),
    queryFn: () => textbookAdministrationApi.textbooks({ limit: 100 }),
    enabled: crossGrade,
  });

  const outline = useQuery({
    queryKey: queryKeys.content.outline(sourceTextbookKey),
    queryFn: () => textbookAdministrationApi.outline(sourceTextbookKey),
    enabled: sourceTextbookKey !== '',
  });

  const concepts = useMemo(
    () =>
      (outline.data ?? []).flatMap((unit) =>
        unit.lessons.flatMap((lesson) =>
          (lesson.concepts ?? [])
            .filter((concept) => concept.key !== conceptKey)
            .map((concept) => ({ key: concept.key, name: `${lesson.name} — ${concept.name}` })),
        ),
      ),
    [outline.data, conceptKey],
  );

  const [prerequisiteKey, setPrerequisiteKey] = useState('');

  const link = useMutation({
    mutationFn: () => textbookAdministrationApi.linkPrerequisite({ conceptKey, prerequisiteKey }),
    onSuccess: onDone,
  });

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-3">
      <label className="flex items-center gap-2 text-xs text-text">
        <input
          type="checkbox"
          checked={crossGrade}
          onChange={(event) => {
            setCrossGrade(event.target.checked);
            setPrerequisiteKey('');
            if (!event.target.checked) setSourceTextbookKey(ownerTextbookKey);
          }}
        />
        {t('content.crossGradePrerequisite')}
      </label>

      {crossGrade ? (
        <label className="block space-y-1">
          <span className="text-2xs font-medium text-text-muted">{t('content.pickPrerequisiteTextbook')}</span>
          <select
            value={sourceTextbookKey}
            onChange={(event) => {
              setSourceTextbookKey(event.target.value);
              setPrerequisiteKey('');
            }}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
          >
            <option value="">—</option>
            {(textbooks.data?.rows ?? []).map((book) => (
              <option key={book.key} value={book.key}>
                {book.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className="text-2xs font-medium text-text-muted">{t('content.pickPrerequisiteConcept')}</span>
        <select
          value={prerequisiteKey}
          onChange={(event) => setPrerequisiteKey(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
        >
          <option value="">—</option>
          {concepts.map((concept) => (
            <option key={concept.key} value={concept.key}>
              {concept.name}
            </option>
          ))}
        </select>
      </label>

      {link.isError ? <ErrorState error={link.error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={link.isPending} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={link.isPending || !prerequisiteKey} onClick={() => link.mutate()}>
          {link.isPending ? t('common.working') : t('content.addPrerequisite')}
        </Button>
      </div>
    </div>
  );
}
