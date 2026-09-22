import { useState, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { PublicationBadge } from './publication-badge';
import { textbookAdministrationApi, type TextbookSummary } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { downloadJson } from '../../shared/platform/download';

export function TextbookOutlineModal({
  open,
  onClose,
  textbook,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly textbook: TextbookSummary | null;
}): ReactNode {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [collapsedUnits, setCollapsedUnits] = useState<Record<string, boolean>>({});

  const textbookKey = textbook?.key ?? '';

  const outline = useQuery({
    queryKey: queryKeys.textbookAdministration.outline(textbookKey),
    queryFn: () => textbookAdministrationApi.outline(textbookKey),
    enabled: open && Boolean(textbookKey),
  });

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
    if (!search.trim()) return units;
    const q = search.trim().toLowerCase();
    return units
      .map((unit) => {
        const matchUnit = unit.name.toLowerCase().includes(q);
        const matchLessons = unit.lessons.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            (l.concepts ?? []).some((c) => c.name.toLowerCase().includes(q)),
        );
        if (matchUnit) return unit;
        if (matchLessons.length > 0) return { ...unit, lessons: matchLessons };
        return null;
      })
      .filter((u): u is (typeof units)[0] => u !== null);
  }, [units, search]);

  const summary = useMemo(() => {
    const allLessons = units.flatMap((u) => u.lessons);
    const totalConcepts = allLessons.reduce((acc, l) => acc + (l.conceptCount || (l.concepts?.length ?? 0)), 0);
    const totalResources = allLessons.reduce((acc, l) => acc + (l.resourceCount ?? 0), 0);
    return {
      unitCount: units.length,
      lessonCount: allLessons.length,
      conceptCount: totalConcepts,
      resourceCount: totalResources,
    };
  }, [units]);

  if (!open || !textbook) return null;

  const handleExport = () => {
    const pkg = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      textbook: {
        key: textbook.key,
        title: textbook.title,
        subjectName: textbook.subjectName,
        gradeName: textbook.gradeName,
        part: textbook.part,
        edition: textbook.edition,
      },
      units: units.map((u) => ({
        name: u.name,
        orderIndex: u.orderIndex,
        lessons: u.lessons.map((l) => ({
          name: l.name,
          orderIndex: l.orderIndex,
          estimatedMins: l.estimatedMins,
          concepts: (l.concepts ?? []).map((c) => ({
            name: c.name,
            orderIndex: c.orderIndex,
          })),
        })),
      })),
    };

    downloadJson(`${textbook.key}_curriculum.json`, pkg);
  };

  const toggleCollapse = (key: string) => {
    setCollapsedUnits((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-surface-raised/60">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-text">{textbook.title}</span>
              <PublicationBadge status={textbook.status} />
            </div>
            <p className="text-xs text-text-muted">
              {textbook.gradeName} · {textbook.subjectName} · {textbook.part === 'PART_1' ? t('textbookAdmin.part1') : t('textbookAdmin.part2')} · {t('textbookAdmin.edition')} {textbook.edition}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>

        {/* Compact stats bar & fast actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-text">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {t('textbookAdmin.outlineUnitsCount', { count: summary.unitCount })}
            </span>
            <span className="flex items-center gap-1.5 font-medium text-text">
              <span className="h-2 w-2 rounded-full bg-success" />
              {t('textbookAdmin.outlineLessonsCount', { count: summary.lessonCount })}
            </span>
            <span className="flex items-center gap-1.5 font-medium text-text">
              <span className="h-2 w-2 rounded-full bg-info" />
              {t('textbookAdmin.outlineConceptsCount', { count: summary.conceptCount })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleExport}>
              📤 {t('content.exportPackage')}
            </Button>
            <Link
              to={`/admin/content?textbook=${encodeURIComponent(textbook.key)}`}
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-semibold text-accent-contrast shadow-sm hover:opacity-90 transition-opacity"
            >
              📚 {t('textbookAdmin.openContentManager')}
            </Link>
          </div>
        </div>

        {/* Filter Input */}
        <div className="border-b border-border px-6 py-2.5 bg-surface-raised/30">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('content.filterOutline')}
          />
        </div>

        {/* Modal Body: Complete Curriculum Hierarchy */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {outline.isPending ? (
            <LoadingState />
          ) : outline.isError ? (
            <ErrorState error={outline.error} onRetry={() => outline.refetch()} />
          ) : filteredUnits.length === 0 ? (
            <EmptyState
              title={t('content.noUnits')}
              body={t('content.noUnitsHint')}
              action={
                <Link
                  to={`/admin/content?textbook=${encodeURIComponent(textbook.key)}`}
                  onClick={onClose}
                  className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-contrast"
                >
                  📚 {t('textbookAdmin.openContentManager')}
                </Link>
              }
            />
          ) : (
            filteredUnits.map((unit, unitIdx) => {
              const isCollapsed = collapsedUnits[unit.key] ?? false;
              return (
                <div
                  key={unit.key}
                  className="rounded-xl border border-border bg-surface-raised/40 overflow-hidden"
                >
                  {/* Unit Title Bar */}
                  <button
                    type="button"
                    onClick={() => toggleCollapse(unit.key)}
                    className="flex w-full items-center justify-between p-4 text-start hover:bg-surface-hover/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-xs font-bold text-accent">
                        {unitIdx + 1}
                      </span>
                      <span className="text-base font-bold text-text">{unit.name}</span>
                      <span className="rounded-md bg-surface px-2 py-0.5 text-2xs font-medium text-text-muted border border-border">
                        {unit.lessons.length} {t('content.lessons')}
                      </span>
                    </div>
                    <span className="text-sm text-text-muted">{isCollapsed ? '▾' : '▴'}</span>
                  </button>

                  {/* Lessons list */}
                  {!isCollapsed ? (
                    <div className="divide-y divide-border border-t border-border bg-surface">
                      {unit.lessons.length === 0 ? (
                        <p className="p-3 text-center text-xs text-text-muted">{t('content.noLessonsInUnit')}</p>
                      ) : (
                        unit.lessons.map((lesson, lessonIdx) => (
                          <div key={lesson.key} className="p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-text-muted">
                                  {unitIdx + 1}.{lessonIdx + 1}
                                </span>
                                <span className="text-sm font-medium text-text">{lesson.name}</span>
                                {lesson.estimatedMins ? (
                                  <span className="rounded bg-surface-raised px-1.5 py-0.5 text-2xs text-text-muted">
                                    ⏱️ {lesson.estimatedMins} د
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-2xs font-medium text-text-muted">
                                {(lesson.concepts ?? []).length} {t('content.concepts')}
                              </span>
                            </div>

                            {/* Concepts pills */}
                            {(lesson.concepts ?? []).length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 ps-5">
                                {(lesson.concepts ?? []).map((concept) => (
                                  <span
                                    key={concept.key}
                                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs text-text"
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                    {concept.name}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface-raised/60 px-6 py-3">
          <Link
            to={`/admin/content?textbook=${encodeURIComponent(textbook.key)}`}
            onClick={onClose}
            className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
          >
            ← {t('textbookAdmin.goToContentSetup')}
          </Link>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
