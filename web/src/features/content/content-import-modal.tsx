/**
 * Content package import modal with multi-format support (Excel/CSV, JSON, Text Outline)
 * and intelligent conflict resolution.
 */

import { useState, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Code, FileText, CheckCircle2, Download } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { downloadJson, downloadText } from '../../shared/platform/download';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import {
  textbookAdministrationApi,
  type ContentImportOutcome,
} from './content.api';
import {
  parseCurriculumCsv,
  parseTextOutline,
  compareWithOutline,
  EXCEL_TEMPLATE_CSV,
  type ConflictItem,
  type ParsedCurriculumPackage,
} from './csv-curriculum-parser';
import { ContentConflictResolver } from './content-conflict-resolver';

export interface ContentImportModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly textbookKey?: string | null | undefined;
}

export function ContentImportModal({
  open,
  onClose,
  textbookKey,
}: ContentImportModalProps): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Mode: Excel (CSV), JSON, Text
  const [activeTab, setActiveTab] = useState<'EXCEL' | 'JSON' | 'TEXT'>('EXCEL');
  const [targetKey, setTargetKey] = useState(textbookKey || '');
  const [rawInputText, setRawInputText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [identicalCount, setIdenticalCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [dryRunResult, setDryRunResult] = useState<ContentImportOutcome | null>(null);

  // Granular inclusion options
  const includeResources = true;
  const includeMisconceptions = true;
  const includeQuestions = true;

  // Fetch outline for the target textbook to perform comparison
  const { data: systemOutline = [] } = useQuery({
    queryKey: ['admin-textbook-outline-for-import', targetKey],
    queryFn: () => (targetKey ? textbookAdministrationApi.outline(targetKey) : Promise.resolve([])),
    enabled: open && !!targetKey,
  });

  // Parse input according to active tab
  const parsedPackage: ParsedCurriculumPackage | null = useMemo(() => {
    if (!rawInputText.trim()) return null;
    try {
      if (activeTab === 'EXCEL') {
        return parseCurriculumCsv(rawInputText, targetKey || undefined);
      }
      if (activeTab === 'JSON') {
        const parsed = JSON.parse(rawInputText);
        return {
          textbookKey: targetKey || parsed.textbookKey || '',
          units: parsed.units || [],
        };
      }
      return parseTextOutline(rawInputText, targetKey || '');
    } catch {
      return null;
    }
  }, [rawInputText, activeTab, targetKey]);

  // Run conflict comparison whenever parsedPackage or systemOutline changes
  const runComparison = (pkg: ParsedCurriculumPackage) => {
    if (!pkg) return;
    const result = compareWithOutline(pkg, systemOutline);
    setConflicts(result.conflicts);
    setIdenticalCount(result.identicalCount);
    setNewCount(result.newCount);
  };

  const handleTextChange = (text: string) => {
    setRawInputText(text);
    setParseError(null);
    setDryRunResult(null);
    try {
      if (activeTab === 'JSON' && text.trim()) {
        JSON.parse(text);
      }
    } catch {
      setParseError(t('contentImport.invalidJson'));
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleTextChange(text);
      if (file.name.endsWith('.csv')) {
        setActiveTab('EXCEL');
      } else if (file.name.endsWith('.json')) {
        setActiveTab('JSON');
      }
    };
    reader.readAsText(file);
  };

  const importMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (!parsedPackage) throw new Error(t('contentImport.invalidJson'));

      // Apply conflict resolutions to package
      const finalUnits = parsedPackage.units.map((unit) => {
        const unitConflict = conflicts.find((c) => c.type === 'unit' && c.orderIndex === unit.orderIndex);
        const resolvedUnitName = unitConflict && unitConflict.choice === 'SYSTEM' ? unitConflict.systemValue : unit.name;

        const resolvedLessons = unit.lessons.map((lesson) => {
          const lessonConflict = conflicts.find((c) => c.type === 'lesson' && c.orderIndex === lesson.orderIndex);
          const resolvedLessonName = lessonConflict && lessonConflict.choice === 'SYSTEM' ? lessonConflict.systemValue : lesson.name;

          const resolvedConcepts = lesson.concepts.map((concept) => {
            const conceptConflict = conflicts.find((c) => c.type === 'concept' && c.orderIndex === concept.orderIndex);
            const resolvedConceptName = conceptConflict && conceptConflict.choice === 'SYSTEM' ? conceptConflict.systemValue : concept.name;
            return { ...concept, name: resolvedConceptName };
          });

          return { ...lesson, name: resolvedLessonName, concepts: resolvedConcepts };
        });

        return { ...unit, name: resolvedUnitName, lessons: resolvedLessons };
      });

      const payload = {
        title: parsedPackage.textbookKey,
        units: finalUnits,
      };

      return textbookAdministrationApi.importPackage(payload, {
        dryRun,
        targetTextbookKey: targetKey || undefined,
        includeResources,
        includeMisconceptions,
        includeQuestions,
      });
    },
    onSuccess: async (data, dryRun) => {
      if (dryRun) {
        setDryRunResult(data);
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
        await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
        onClose();
      }
    },
  });

  const handleDownloadExcelTemplate = () => {
    downloadText('curriculum-import-template.csv', EXCEL_TEMPLATE_CSV, 'text/csv;charset=utf-8');
  };

  const handleDownloadJsonTemplate = () => {
    const jsonSample = {
      textbookKey: targetKey || 'tb_g07_sci_t1',
      units: [
        {
          name: 'الوحدة الأولى: بنية المادة وخواصها',
          lessons: [
            {
              name: 'الدرس الأول: المادة وحالاتها',
              concepts: [
                {
                  name: 'مفهوم حالات المادة الثلاث',
                  reading: 'توجد المادة في حالات صلبة وسائلة وغازية.',
                },
              ],
            },
          ],
        },
      ],
    };
    downloadJson('curriculum-template.json', jsonSample);
  };

  const handleLoadSample = () => {
    if (activeTab === 'EXCEL') {
      handleTextChange(EXCEL_TEMPLATE_CSV);
    } else {
      const sample = {
        units: [
          {
            name: 'الوحدة الأولى: الطبيعة والمادة',
            lessons: [
              {
                name: 'الدرس الأول: خواص المادة وحالاتها',
                concepts: [{ name: 'مفهوم الكتلة والحجم' }, { name: 'التغيرات الفيزيائية' }],
              },
            ],
          },
        ],
      };
      handleTextChange(JSON.stringify(sample, null, 2));
    }
  };

  if (!open) return null;

  return (
    <ActionModal
      kind="ministerial"
      icon={<FileSpreadsheet className="size-5" />}
      title={t('content.importPackageTitle')}
      subtitle={t('contentImport.excelHint')}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={importMutation.isPending || !parsedPackage}
              onClick={() => {
                if (parsedPackage) runComparison(parsedPackage);
                importMutation.mutate(true);
              }}
            >
              {importMutation.isPending ? t('common.working') : t('contentImport.previewAndDiff')}
            </Button>
            <Button
              variant="primary"
              disabled={importMutation.isPending || !parsedPackage}
              onClick={() => importMutation.mutate(false)}
            >
              {t('content.importApplyBtn')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Textbook Key input (pre-filled or manual) */}
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1.5">
          <label className="text-xs font-semibold text-text">
            {t('content.textbook')} (Textbook Key) <span className="text-danger">*</span>
          </label>
          <Input
            type="text"
            dir="ltr"
            placeholder="tb_g07_sci_t1"
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
          />
          <p className="text-2xs text-text-muted">{t('contentImport.excelHint')}</p>
        </div>

        {/* Format Selector Tabs */}
        <div className="flex rounded-xl border border-border bg-surface-subtle p-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('EXCEL')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors ${
              activeTab === 'EXCEL' ? 'bg-surface text-text shadow-xs' : 'text-text-muted hover:text-text'
            }`}
          >
            <FileSpreadsheet className="size-4" />
            <span>{t('contentImport.tabExcel')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('JSON')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors ${
              activeTab === 'JSON' ? 'bg-surface text-text shadow-xs' : 'text-text-muted hover:text-text'
            }`}
          >
            <Code className="size-4" />
            <span>{t('contentImport.tabJson')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('TEXT')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors ${
              activeTab === 'TEXT' ? 'bg-surface text-text shadow-xs' : 'text-text-muted hover:text-text'
            }`}
          >
            <FileText className="size-4" />
            <span>{t('contentImport.tabText')}</span>
          </button>
        </div>

        {/* Template Downloads & Samples */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-xs">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={activeTab === 'EXCEL' ? handleDownloadExcelTemplate : handleDownloadJsonTemplate}
            >
              <Download className="size-3.5" />
              <span>
                {activeTab === 'EXCEL'
                  ? t('contentImport.downloadTemplateExcel')
                  : t('contentImport.downloadTemplateJson')}
              </span>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleLoadSample}>
              {t('contentImport.loadSampleData')}
            </Button>
          </div>

          <label className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-subtle">
            <span>{fileName || t('content.importSelectFile')}</span>
            <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        {/* Input Area */}
        <div className="space-y-1.5">
          <Textarea
            rows={7}
            dir={activeTab === 'JSON' ? 'ltr' : 'rtl'}
            placeholder={
              activeTab === 'EXCEL'
                ? t('contentImport.pasteCsvOrDrop')
                : activeTab === 'JSON'
                  ? t('content.importPasteJson')
                  : t('contentImport.pasteTextOutline')
            }
            value={rawInputText}
            onChange={(e) => handleTextChange(e.target.value)}
            className="font-mono text-xs"
          />
          {parseError && <p className="text-2xs text-danger">{parseError}</p>}
        </div>

        {/* Conflict Resolution Component */}
        {conflicts.length > 0 && (
          <ContentConflictResolver
            conflicts={conflicts}
            identicalCount={identicalCount}
            newCount={newCount}
            onUpdateChoice={(id, choice) => {
              setConflicts((prev) =>
                prev.map((c) => (c.id === id ? { ...c, choice } : c)),
              );
            }}
            onSetAllChoices={(choice) => {
              setConflicts((prev) => prev.map((c) => ({ ...c, choice })));
            }}
          />
        )}

        {/* Dry Run Results */}
        {dryRunResult && (
          <div className="rounded-xl border border-success/30 bg-surface p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-success">
              <CheckCircle2 className="size-4" />
              <span>{t('content.importSuccess')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-2xs text-text-muted sm:grid-cols-4">
              <div>الوحدات: {dryRunResult.created?.units ?? 0}</div>
              <div>الدروس: {dryRunResult.created?.lessons ?? 0}</div>
              <div>المفاهيم: {dryRunResult.created?.concepts ?? 0}</div>
              <div>متطابقة: {dryRunResult.unchanged?.concepts ?? 0}</div>
            </div>
          </div>
        )}
      </div>
    </ActionModal>
  );
}
