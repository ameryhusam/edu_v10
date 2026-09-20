/**
 * One unit's card in the outline browser: its lessons, its concepts, and the
 * reorder/edit affordances for all three levels. Split out of
 * ContentOutlineBrowser purely to keep that file under FE12's line budget —
 * this component owns no state and makes no requests of its own; every
 * mutation and every piece of data comes from the parent via props.
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import type { OutlineUnit } from './content.api';
import type { ContentNodeCreateTarget } from './content-node-create-modal';
import type { ContentNodeEditTarget } from './content-node-edit-modal';

export interface UnitOutlineSectionProps {
  readonly unit: OutlineUnit & { readonly lessons: OutlineUnit['lessons'] };
  readonly unitIndex: number;
  readonly units: readonly OutlineUnit[];
  readonly textbookKey: string;
  readonly reorderPending: boolean;
  readonly onReorder: (input: { kind: 'unit' | 'lesson' | 'concept'; parentKey: string; orderedKeys: readonly string[] }) => void;
  readonly onEdit: (target: ContentNodeEditTarget) => void;
  readonly onCreate: (target: ContentNodeCreateTarget) => void;
  readonly onOpenConcept: (conceptKey: string) => void;
  readonly onOpenLesson: (lessonKey: string) => void;
  readonly onLinkLesson: (lessonKey: string) => void;
}

export function UnitOutlineSection({
  unit,
  unitIndex,
  units,
  textbookKey,
  reorderPending,
  onReorder,
  onEdit,
  onCreate,
  onOpenConcept,
  onOpenLesson,
  onLinkLesson,
}: UnitOutlineSectionProps): ReactNode {
  const { t } = useI18n();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <section key={unit.key} className="rounded-2xl border border-border bg-surface p-4 transition-all">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <span className="text-text-muted text-xs transition-transform inline-block">
            {isCollapsed ? '◀' : '▼'}
          </span>
          <div>
            <p className="text-2xs font-bold uppercase tracking-wide text-text-muted">
              {t('content.unit')} {unit.orderIndex}
            </p>
            <h2 className="text-base font-extrabold text-text">{unit.name}</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={t('content.moveUp')}
              disabled={unitIndex === 0 || reorderPending}
              onClick={() => {
                const keys = units.map((u) => u.key);
                [keys[unitIndex - 1]!, keys[unitIndex]!] = [keys[unitIndex]!, keys[unitIndex - 1]!];
                onReorder({ kind: 'unit', parentKey: textbookKey, orderedKeys: keys });
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={t('content.moveDown')}
              disabled={unitIndex === units.length - 1 || reorderPending}
              onClick={() => {
                const keys = units.map((u) => u.key);
                [keys[unitIndex]!, keys[unitIndex + 1]!] = [keys[unitIndex + 1]!, keys[unitIndex]!];
                onReorder({ kind: 'unit', parentKey: textbookKey, orderedKeys: keys });
              }}
            >
              ↓
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onEdit({ kind: 'unit', key: unit.key, textbookKey, name: unit.name })
            }
          >
            {t('content.edit')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onCreate({
                kind: 'lesson',
                textbookKey,
                unitKey: unit.key,
                parentName: unit.name,
              })
            }
          >
            {t('content.addLesson')}
          </Button>
          <Badge tone="neutral">{unit.lessons.length} {t('content.lessons')}</Badge>
        </div>
      </header>
      {!isCollapsed ? (
      <ol className="space-y-2 pt-3">
        {unit.lessons.map((lesson, lessonIndex) => (
          <li
            key={lesson.key}
            className="grid gap-3 rounded-xl border border-border bg-surface-raised p-3 md:grid-cols-[1fr_auto] md:items-center"
          >
            <div>
              <p className="text-sm font-bold text-text">
                <span className="text-text-muted tabular-nums">
                  {t('content.lesson')} {lesson.orderIndex}
                </span>{' '}
                {lesson.name}
              </p>
              <p className="text-2xs text-text-muted">
                {lesson.conceptCount} {t('content.concepts')} · {lesson.resourceCount}{' '}
                {t('content.materials')}
                {lesson.estimatedMins !== null
                  ? ` · ${t('content.estimatedMins', { count: lesson.estimatedMins })}`
                  : ''}
              </p>
              {(lesson.concepts ?? []).length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(lesson.concepts ?? []).map((concept, conceptIndex) => {
                    const conceptSiblings = lesson.concepts ?? [];
                    return (
                      <li
                        key={concept.key}
                        className="flex items-center gap-0.5 rounded-full border border-border bg-surface ps-2.5 pe-1 py-0.5"
                      >
                        <button
                          type="button"
                          className="text-2xs font-medium text-text hover:underline"
                          onClick={() => onOpenConcept(concept.key)}
                        >
                          {concept.name}
                        </button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          className="size-6"
                          aria-label={t('content.moveUp')}
                          disabled={conceptIndex === 0 || reorderPending}
                          onClick={() => {
                            const keys = conceptSiblings.map((c) => c.key);
                            [keys[conceptIndex - 1]!, keys[conceptIndex]!] = [
                              keys[conceptIndex]!,
                              keys[conceptIndex - 1]!,
                            ];
                            onReorder({ kind: 'concept', parentKey: lesson.key, orderedKeys: keys });
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          className="size-6"
                          aria-label={t('content.moveDown')}
                          disabled={conceptIndex === conceptSiblings.length - 1 || reorderPending}
                          onClick={() => {
                            const keys = conceptSiblings.map((c) => c.key);
                            [keys[conceptIndex]!, keys[conceptIndex + 1]!] = [
                              keys[conceptIndex + 1]!,
                              keys[conceptIndex]!,
                            ];
                            onReorder({ kind: 'concept', parentKey: lesson.key, orderedKeys: keys });
                          }}
                        >
                          ↓
                        </Button>
                        <button
                          type="button"
                          className="rounded-full px-1.5 text-2xs text-text-muted hover:text-text"
                          aria-label={t('content.edit')}
                          onClick={() =>
                            onEdit({
                              kind: 'concept',
                              key: concept.key,
                              textbookKey,
                              name: concept.name,
                            })
                          }
                        >
                          {t('content.edit')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={t('content.moveUp')}
                  disabled={lessonIndex === 0 || reorderPending}
                  onClick={() => {
                    const keys = unit.lessons.map((l) => l.key);
                    [keys[lessonIndex - 1]!, keys[lessonIndex]!] = [keys[lessonIndex]!, keys[lessonIndex - 1]!];
                    onReorder({ kind: 'lesson', parentKey: unit.key, orderedKeys: keys });
                  }}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={t('content.moveDown')}
                  disabled={lessonIndex === unit.lessons.length - 1 || reorderPending}
                  onClick={() => {
                    const keys = unit.lessons.map((l) => l.key);
                    [keys[lessonIndex]!, keys[lessonIndex + 1]!] = [keys[lessonIndex + 1]!, keys[lessonIndex]!];
                    onReorder({ kind: 'lesson', parentKey: unit.key, orderedKeys: keys });
                  }}
                >
                  ↓
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onEdit({
                    kind: 'lesson',
                    key: lesson.key,
                    textbookKey,
                    name: lesson.name,
                    estimatedMins: lesson.estimatedMins,
                  })
                }
              >
                {t('content.edit')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onCreate({
                    kind: 'concept',
                    textbookKey,
                    lessonKey: lesson.key,
                    parentName: lesson.name,
                  })
                }
              >
                {t('content.addConcept')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onOpenLesson(lesson.key)}>
                {t('content.lessonMaterials')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onLinkLesson(lesson.key)}>
                {t('content.linkQuestions')}
              </Button>
              <Link
                to={`/lesson?lesson=${lesson.key}`}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-surface-hover"
              >
                {t('content.previewLesson')}
              </Link>
            </div>
          </li>
        ))}
      </ol>
      ) : null}
    </section>
  );
}
