/**
 * The re-linking dialog: point a question at the concepts it measures.
 *
 * Two panes because the job has two halves that a reviewer alternates between
 * — find the item that is wrong, then say what it should be. A single list
 * with inline editors makes the second half fight the first for space.
 *
 * The screen shows the whole lesson bank, not just the unlinked items. An item
 * linked to the WRONG concept is the more damaging case: it silently feeds
 * mastery evidence to a concept the learner never practised, and nothing but a
 * human reading the stem will catch it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { cn } from '../../design-system/ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { questionLinkingApi, type BankQuestion } from './question-linking.api';
import { useDraftLinks, useLessonBank } from './use-question-linking';

interface QuestionLinkModalProps {
  readonly lessonKey: string;
  readonly onClose: () => void;
}

export function QuestionLinkModal({ lessonKey, onClose }: QuestionLinkModalProps): ReactNode {
  const { t } = useI18n();
  const { status, bank, reload } = useLessonBank(lessonKey);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const selected = bank?.questions.find((q) => q.key === selectedKey) ?? null;
  const conceptNames = new Map((bank?.concepts ?? []).map((concept) => [concept.key, concept.name]));
  const links = useDraftLinks(selected);

  // Escape closes. A dialog that can only be dismissed by finding the right
  // button is a dialog people leave open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    dialogRef.current?.ownerDocument.addEventListener('keydown', onKey);
    return () => dialogRef.current?.ownerDocument.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (): Promise<void> => {
    if (!selected) return;
    setSaving(true);
    setSaveError(false);
    try {
      await questionLinkingApi.setConcepts(selected.key, links.toPayload());
      reload();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('relink.title')}
        className="flex h-[min(42rem,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text">{t('relink.title')}</h2>
            <p className="truncate text-xs text-text-muted">{lessonKey}</p>
          </div>
          {bank ? <UnlinkedBadge count={bank.unlinkedCount} /> : null}
        </header>

        {status === 'loading' ? <Notice text={t('state.loading')} /> : null}
        {status === 'failed' ? <Notice text={t('relink.loadFailed')} tone="danger" /> : null}

        {status === 'ready' && bank ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.1fr_1fr]">
            <ul className="min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-e">
              {bank.questions.map((question) => (
                <li key={question.key}>
                  <QuestionRow
                    question={question}
                    conceptNames={conceptNames}
                    selected={question.key === selectedKey}
                    onSelect={() => setSelectedKey(question.key)}
                  />
                </li>
              ))}
            </ul>

            <section className="min-h-0 overflow-y-auto p-5">
              {selected ? (
                <>
                  <p className="mb-4 text-sm leading-relaxed text-text">{selected.text}</p>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                    {t('relink.chooseConcepts')}
                  </h3>

                  {bank.concepts.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('relink.noConceptsInLesson')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {bank.concepts.map((concept) => {
                        const link = links.draft.find((l) => l.conceptKey === concept.key);
                        return (
                          <li key={concept.key}>
                            <ConceptChoice
                              name={concept.name}
                              checked={Boolean(link)}
                              isPrimary={link?.isPrimary ?? false}
                              onToggle={() => links.toggle(concept.key)}
                              onMakePrimary={() => links.makePrimary(concept.key)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {links.draft.length === 0 ? (
                    <p className="mt-4 rounded-lg border border-warning-border bg-warning-subtle p-3 text-xs leading-relaxed text-warning">
                      {t('relink.unlinkedWarning')}
                    </p>
                  ) : null}
                  {saveError ? (
                    <p className="mt-3 text-xs text-danger">{t('relink.saveFailed')}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-text-muted">{t('relink.lessonBank')}</p>
              )}
            </section>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!selected || links.draft.length === 0 || saving}
            onClick={links.clear}
          >
            {t('relink.clear')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              // Zero links is savable — unlinking is a real decision. What is
              // refused is an ambiguous set: links with no single primary.
              disabled={
                !selected ||
                saving ||
                !links.isDirty ||
                (links.draft.length > 0 && !links.hasPrimary)
              }
              onClick={() => void save()}
            >
              {saving ? t('relink.saving') : t('relink.save')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function UnlinkedBadge({ count }: { readonly count: number }): ReactNode {
  const { t } = useI18n();
  if (count === 0) return <Badge tone="success">{t('relink.allLinked')}</Badge>;
  return <Badge tone="warning">{t('relink.unlinkedCount', { count })}</Badge>;
}

function Notice({
  text,
  tone = 'muted',
}: {
  readonly text: string;
  readonly tone?: 'muted' | 'danger';
}): ReactNode {
  return (
    <p className={cn('p-6 text-sm', tone === 'danger' ? 'text-danger' : 'text-text-muted')}>
      {text}
    </p>
  );
}

function QuestionRow({
  question,
  conceptNames,
  selected,
  onSelect,
}: {
  readonly question: BankQuestion;
  readonly conceptNames: ReadonlyMap<string, string>;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const { t } = useI18n();
  const unlinked = question.concepts.length === 0;
  const linkedNames = question.concepts.map((link) => conceptNames.get(link.conceptKey)).filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        'flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-start',
        'transition-colors hover:bg-surface-hover',
        selected && 'bg-accent-subtle',
      )}
    >
      <span className="line-clamp-2 text-sm text-text">{question.text}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        {unlinked ? (
          <Badge tone="warning">{t('relink.unlinkedBadge')}</Badge>
        ) : (
          <Badge tone="neutral">
            {linkedNames.length > 0
              ? linkedNames.join('، ')
              : t('relink.linkedTo', { count: question.concepts.length })}
          </Badge>
        )}
        {/* Provenance, because "is this from the book?" decides whether an
            author may reword the item or must leave it as printed. */}
        <Badge tone="info">{t(`relink.origin.${question.origin}` as MessageKey)}</Badge>
        {question.textbookRole ? (
          <Badge tone="neutral">{t(`relink.role.${question.textbookRole}` as MessageKey)}</Badge>
        ) : null}
      </span>
    </button>
  );
}

function ConceptChoice({
  name,
  checked,
  isPrimary,
  onToggle,
  onMakePrimary,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly isPrimary: boolean;
  readonly onToggle: () => void;
  readonly onMakePrimary: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-2.5',
        checked ? 'border-accent-border bg-accent-subtle' : 'border-border bg-surface',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={name}
        className="size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{name}</span>
      {checked ? (
        isPrimary ? (
          <Badge tone="accent">{t('relink.primary')}</Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={onMakePrimary}>
            {t('relink.setPrimary')}
          </Button>
        )
      ) : null}
    </div>
  );
}
