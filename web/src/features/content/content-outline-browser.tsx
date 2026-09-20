/**
 * The content browser — one curriculum, one outline, two audiences.
 *
 * The administrator triages the catalogue with it (content setup), the author
 * prepares a book with it, and the teacher prepares class material with it.
 * Complete LMS-grade CRUD support for units, lessons, concepts, and resources,
 * with package import, export, search filtering, and state controls.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { QuestionLinkModal } from '../../education/authoring/question-link-modal';
import { ConceptDetailDrawer } from './concept-detail-drawer';
import { ContentNodeCreateModal, type ContentNodeCreateTarget } from './content-node-create-modal';
import { ContentNodeEditModal, type ContentNodeEditTarget } from './content-node-edit-modal';
import { ContentImportModal } from './content-import-modal';
import { TextbookResourcesModal } from './textbook-resources-modal';
import { UnitOutlineSection } from './unit-outline-section';
import { PublicationBadge } from './publication-badge';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { textbookLabelParts, textbookSubtitleParts } from '../../design-system/patterns/textbook-label';
import { textbookAdministrationApi, type TextbookSummary } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { ContentMetric, ReadinessPanel } from './content-readiness-panel';
import { LessonMaterialsDrawer } from './lesson-materials-drawer';
import { exportCurriculumPackage } from './curriculum-export';

export function ContentOutlineBrowser({
  titleKey,
  subtitleKey,
}: {
  readonly titleKey: MessageKey;
  readonly subtitleKey: MessageKey;
}): ReactNode {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTextbookParam = searchParams.get('textbook') ?? '';
  const [textbookKey, setTextbookKey] = useState(selectedTextbookParam);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [linkLesson, setLinkLesson] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<ContentNodeCreateTarget | null>(null);
  const [editTarget, setEditTarget] = useState<ContentNodeEditTarget | null>(null);
  const [conceptKey, setConceptKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const queryClient = useQueryClient();

  const reorder = useMutation({
    mutationFn: (input: { kind: 'unit' | 'lesson' | 'concept'; parentKey: string; orderedKeys: readonly string[] }) =>
      textbookAdministrationApi.reorder(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.content.outline(textbookKey) });
    },
  });

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({}),
    queryFn: () => textbookAdministrationApi.textbooks({}),
  });

  const outline = useQuery({
    queryKey: queryKeys.content.outline(textbookKey),
    queryFn: () => textbookAdministrationApi.outline(textbookKey),
    enabled: textbookKey !== '',
  });

  const readiness = useQuery({
    queryKey: queryKeys.content.readiness(textbookKey),
    queryFn: () => textbookAdministrationApi.readiness(textbookKey),
    enabled: textbookKey !== '',
  });

  useEffect(() => {
    setTextbookKey(selectedTextbookParam);
    setOpenLesson(null);
    setLinkLesson(null);
    setCreateTarget(null);
    setSearchQuery('');
  }, [selectedTextbookParam]);

  const units = useMemo(
    () =>
      [...(outline.data ?? [])]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((unit) => ({
          ...unit,
          lessons: [...unit.lessons].sort((a, b) => a.orderIndex - b.orderIndex),
        })),
    [outline.data],
  );

  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return units;
    const query = searchQuery.trim().toLowerCase();
    return units
      .map((unit) => {
        const unitMatches = unit.name.toLowerCase().includes(query);
        const matchingLessons = unit.lessons.filter(
          (lesson) =>
            lesson.name.toLowerCase().includes(query) ||
            (lesson.concepts ?? []).some((c) => c.name.toLowerCase().includes(query)),
        );
        if (unitMatches) return unit;
        if (matchingLessons.length > 0) {
          return { ...unit, lessons: matchingLessons };
        }
        return null;
      })
      .filter((u): u is (typeof units)[0] => u !== null);
  }, [units, searchQuery]);

  const summary = useMemo(() => {
    const lessons = units.flatMap((unit) => unit.lessons);
    return {
      unitCount: units.length,
      lessonCount: lessons.length,
      conceptCount: lessons.reduce((sum, lesson) => sum + lesson.conceptCount, 0),
      resourceCount: lessons.reduce((sum, lesson) => sum + lesson.resourceCount, 0),
    };
  }, [units]);

  const selected = (textbooks.data?.rows ?? []).find((book: TextbookSummary) => book.key === textbookKey);

  const handleExport = (): void => {
    if (!selected) return;
    exportCurriculumPackage(selected, units);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t(titleKey)} subtitle={t(subtitleKey)} />

      {/* Textbook Selector & Top bar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="block max-w-md flex-1 space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('content.textbook')}</span>
          <select
            value={textbookKey}
            onChange={(e) => {
              const next = e.target.value;
              setTextbookKey(next);
              setSearchParams(next ? { textbook: next } : {});
              setOpenLesson(null);
              setLinkLesson(null);
              setCreateTarget(null);
              setSearchQuery('');
            }}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text"
          >
            <option value="">{t('content.pickTextbook')}</option>
            {(textbooks.data?.rows ?? []).map((book: TextbookSummary) => (
              <option key={book.key} value={book.key}>
                {textbookLabelParts({ title: book.title, subjectName: book.subjectName, gradeName: book.gradeName }).join(
                  ' — ',
                )}
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                setCreateTarget({
                  kind: 'unit',
                  textbookKey: selected.key,
                  parentName: selected.title,
                })
              }
            >
              + {t('content.addUnit')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              📥 {t('contentImport.title')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setResourcesOpen(true)}>
              📚 {t('content.allResources')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>
              📤 {t('content.exportPackage')}
            </Button>
          </div>
        ) : null}
      </div>

      {textbooks.isPending ? <LoadingState /> : null}
      {textbooks.isError ? <ErrorState error={textbooks.error} onRetry={() => textbooks.refetch()} /> : null}

      {textbooks.isSuccess && textbookKey === '' ? (
        <EmptyState title={t('content.pickFirst')} body={t('content.pickFirstBody')} />
      ) : null}

      {textbookKey !== '' && outline.isPending ? <LoadingState /> : null}
      {textbookKey !== '' && outline.isError ? (
        <ErrorState error={outline.error} onRetry={() => outline.refetch()} />
      ) : null}

      {/* Selected Textbook Control Card */}
      {selected ? (
        <Card elevation="flat">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold text-text">{selected.title}</p>
                  <PublicationBadge status={selected.status} />
                </div>
                <p className="text-xs text-text-muted">
                  {textbookSubtitleParts({
                    title: selected.title,
                    subjectName: selected.subjectName,
                    gradeName: selected.gradeName,
                    termName: selected.termName,
                  }).join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setCreateTarget({
                      kind: 'unit',
                      textbookKey: selected.key,
                      parentName: selected.title,
                    })
                  }
                >
                  + {t('content.addUnit')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                  📥 {t('contentImport.title')}
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <ContentMetric label={t('textbookAdmin.unitsCount')} value={summary.unitCount} />
              <ContentMetric label={t('content.lessons')} value={summary.lessonCount} />
              <ContentMetric label={t('content.concepts')} value={summary.conceptCount} />
              <ContentMetric label={t('content.materials')} value={summary.resourceCount} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {textbookKey !== '' && readiness.isSuccess ? (
        <ReadinessPanel ready={readiness.data.ready} issues={readiness.data.issues} />
      ) : null}

      {/* Outline Search & Filters */}
      {textbookKey !== '' && outline.isSuccess && units.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex-1 max-w-sm">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('content.filterOutline')}
            />
          </div>
          <div className="text-xs text-text-muted">
            {filteredUnits.length} {t('textbookAdmin.unitsCount')}
          </div>
        </div>
      ) : null}

      {/* Empty Outline State */}
      {textbookKey !== '' && outline.isSuccess && units.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center space-y-4">
          <div className="text-4xl">📖</div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-text">{t('content.emptyOutline')}</h3>
            <p className="text-xs text-text-muted max-w-md mx-auto">{t('content.emptyOutlineBody')}</p>
          </div>
          {selected ? (
            <div className="flex justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  setCreateTarget({
                    kind: 'unit',
                    textbookKey: selected.key,
                    parentName: selected.title,
                  })
                }
              >
                + {t('content.addUnit')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                📥 {t('contentImport.title')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Units List */}
      {textbookKey !== '' && outline.isSuccess && filteredUnits.length > 0 ? (
        <div className="space-y-4">
          {filteredUnits.map((unit, unitIndex) => (
            <UnitOutlineSection
              key={unit.key}
              unit={unit}
              unitIndex={unitIndex}
              units={filteredUnits}
              textbookKey={textbookKey}
              reorderPending={reorder.isPending}
              onReorder={(input) => reorder.mutate(input)}
              onEdit={setEditTarget}
              onCreate={setCreateTarget}
              onOpenConcept={setConceptKey}
              onOpenLesson={setOpenLesson}
              onLinkLesson={setLinkLesson}
            />
          ))}
        </div>
      ) : null}

      {/* Modals & Drawers */}
      {linkLesson !== null ? (
        <QuestionLinkModal lessonKey={linkLesson} onClose={() => setLinkLesson(null)} />
      ) : null}

      {createTarget !== null ? (
        <ContentNodeCreateModal target={createTarget} onClose={() => setCreateTarget(null)} />
      ) : null}

      {editTarget !== null ? (
        <ContentNodeEditModal target={editTarget} onClose={() => setEditTarget(null)} />
      ) : null}

      {conceptKey !== null ? (
        <ConceptDetailDrawer conceptKey={conceptKey} onClose={() => setConceptKey(null)} />
      ) : null}

      {importOpen ? (
        <ContentImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          textbookKey={textbookKey}
        />
      ) : null}

      {resourcesOpen && selected ? (
        <TextbookResourcesModal
          open={resourcesOpen}
          onClose={() => setResourcesOpen(false)}
          textbookKey={selected.key}
          textbookTitle={selected.title}
        />
      ) : null}

      {openLesson !== null ? (
        <LessonMaterialsDrawer
          lessonKey={openLesson}
          onClose={() => setOpenLesson(null)}
        />
      ) : null}
    </div>
  );
}
