/**
 * Criteria-led exam authoring.
 *
 * The form never asks an author to paste opaque question keys. A key only
 * appears as provenance under a human-readable stem; selection is driven by
 * book, lesson, concepts, type, source, lifecycle and difficulty distribution.
 * Assignment remains a separate Instruction capability: this card creates the
 * exam and publishes/archives it, but never creates learner obligations.
 *
 * Rendered inside an `ActionModal` (EdTech Modal Design) behind a trigger
 * button, matching the question-authoring flows: the builder itself keeps its
 * pool/blueprint two-column layout, since that split is the point of the
 * criteria-led design, not a step sequence to collapse into step-cards.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { textbookLabelParts } from '../../design-system/patterns/textbook-label';
import { textbookAdministrationApi } from '../../features/content/content.api';
import { questionLinkingApi } from './question-linking.api';
import {
  PUBLICATION_STATUSES,
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  questionBankApi,
  type ExamRecord,
  type PublicationStatus,
  type QuestionOrigin,
  type QuestionType,
} from './question-bank.api';
import {
  AUTO_GRADABLE,
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  DEFAULT_TARGETS,
  assembleByTargets,
  numberOrUndefined,
  summarizeQuestions,
  uniqueOptions,
  type Filters,
  type Mode,
  type Settings,
  type Targets,
} from './exam-builder-utils';
import {
  BuilderHeader,
  ConceptPicker,
  CreatedExamPanel,
  QuestionPicker,
  SelectInput,
  StatsRibbon,
  TextInput,
} from './exam-builder-widgets';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export function ExamCreateCard(): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CalendarCheck aria-hidden="true" />
        {t('examBuilder.openCreate')}
      </Button>
      {open ? <ExamCreateModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExamCreateModal({ onClose }: { readonly onClose: () => void }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('fixed');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [textbookKey, setTextbookKey] = useState('');
  const [lessonKey, setLessonKey] = useState('');
  const [conceptKeys, setConceptKeys] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
  const [selectedQuestionKeys, setSelectedQuestionKeys] = useState<string[]>([]);
  const [lastExam, setLastExam] = useState<ExamRecord | null>(null);

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 200 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 200 }),
  });
  const outline = useQuery({
    queryKey: queryKeys.content.outline(textbookKey),
    queryFn: () => textbookAdministrationApi.outline(textbookKey),
    enabled: Boolean(textbookKey),
  });
  const lessonBank = useQuery({
    queryKey: queryKeys.content.lessonQuestions(lessonKey || 'none'),
    queryFn: () => questionLinkingApi.bank(lessonKey),
    enabled: Boolean(lessonKey),
  });

  const books = textbooks.data?.rows ?? [];
  const filteredBooks = books.filter(
    (book) =>
      (!filters.subjectKey || book.subjectKey === filters.subjectKey) &&
      (!filters.gradeKey || book.gradeKey === filters.gradeKey) &&
      (!filters.termKey || book.part === filters.termKey),
  );
  const scopeOptions = useMemo(
    () => ({
      subjects: uniqueOptions(books.map((book) => ({ key: book.subjectKey, name: book.subjectName }))),
      grades: uniqueOptions(books.map((book) => ({ key: book.gradeKey, name: book.gradeName }))),
      terms: uniqueOptions(
        books.map((book) => ({
          key: book.part,
          name: book.part === 'PART_1' ? t('textbookAdmin.part1') : t('textbookAdmin.part2'),
        })),
      ),
    }),
    [books, t],
  );
  const lessons = (outline.data ?? []).flatMap((unit) =>
    unit.lessons.map((lesson) => ({ ...lesson, unitName: unit.name })),
  );
  const difficultyMin = numberOrUndefined(filters.difficultyMin);
  const difficultyMax = numberOrUndefined(filters.difficultyMax);
  const questionQuery = {
    ...(textbookKey ? { textbookKey } : {}),
    ...(!textbookKey && filters.subjectKey ? { subjectKey: filters.subjectKey } : {}),
    ...(!textbookKey && filters.gradeKey ? { gradeKey: filters.gradeKey } : {}),
    ...(lessonKey ? { lessonKey } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.origin ? { origin: filters.origin } : {}),
    status: filters.status,
    ...(difficultyMin !== undefined ? { difficultyMin } : {}),
    ...(difficultyMax !== undefined ? { difficultyMax } : {}),
    limit: 100,
    offset: 0,
  };
  const questions = useQuery({
    queryKey: queryKeys.content.questions(questionQuery),
    queryFn: () => questionBankApi.list(questionQuery),
    enabled: Boolean(textbookKey || filters.subjectKey || filters.gradeKey),
  });

  const pool = useMemo(() => {
    const selectedConcepts = new Set(conceptKeys);
    return (questions.data?.rows ?? []).filter(
      (question) =>
        selectedConcepts.size === 0 ||
        question.concepts.some((link) => selectedConcepts.has(link.conceptKey)),
    );
  }, [conceptKeys, questions.data?.rows]);
  const selectedQuestions = pool.filter((question) => selectedQuestionKeys.includes(question.key));
  const lessonName = new Map(lessons.map((lesson) => [lesson.key, `${lesson.unitName} · ${lesson.name}`]));
  const poolStats = summarizeQuestions(pool);
  const selectedStats = summarizeQuestions(selectedQuestions);
  const adaptiveReady =
    mode === 'adaptive' &&
    textbookKey &&
    AUTO_GRADABLE.has((filters.type || 'MCQ_SINGLE') as QuestionType) &&
    poolStats.autoGradable >= Math.max(3, numberOrUndefined(settings.minItems) ?? 5);
  const canCreate =
    title.trim() && textbookKey && (mode === 'adaptive' ? adaptiveReady : selectedQuestions.length > 0);

  const createExam = useMutation({
    mutationFn: async () => {
      const common = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        textbookKey,
        passingScore: numberOrUndefined(settings.passingScore) ?? 0.6,
        timeLimitMins: numberOrUndefined(settings.timeLimit) ?? null,
        minItems: numberOrUndefined(settings.minItems) ?? 5,
        maxItems: numberOrUndefined(settings.maxItems) ?? 20,
        targetStandardError: numberOrUndefined(settings.targetStandardError) ?? 0.3,
      };
      if (mode === 'adaptive') {
        return questionBankApi.createAdaptiveExam({
          ...common,
          lessonKey: lessonKey || null,
          conceptKeys,
          ...(filters.type ? { type: filters.type } : {}),
          ...(filters.origin ? { origin: filters.origin } : {}),
          ...(difficultyMin !== undefined ? { difficultyMin } : {}),
          ...(difficultyMax !== undefined ? { difficultyMax } : {}),
        });
      }

      const created = await questionBankApi.createExam({ ...common, isAdaptive: false });
      return questionBankApi.setExamItems(
        created.key,
        selectedQuestions.map((question) => ({ questionKey: question.key, points: question.points })),
      );
    },
    onSuccess: (exam) => {
      setLastExam(exam);
      setTitle('');
      setDescription('');
      setSelectedQuestionKeys([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
    },
  });

  const transitionExam = useMutation({
    mutationFn: async (action: 'SUBMIT' | 'APPROVE' | 'ARCHIVE' | 'RESTORE') => {
      if (!lastExam) throw new Error('Missing exam');
      const result = await questionBankApi.transitionExam(lastExam.key, action);
      return { ...lastExam, status: result.status };
    },
    onSuccess: (exam) => {
      setLastExam(exam);
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canCreate) createExam.mutate();
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedQuestionKeys([]);
    if (key === 'subjectKey' || key === 'gradeKey' || key === 'termKey') setTextbookKey('');
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function toggleConcept(key: string): void {
    setConceptKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
    setSelectedQuestionKeys([]);
  }

  function toggleQuestion(key: string): void {
    setSelectedQuestionKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <ActionModal
      kind="exam"
      icon={<CalendarCheck aria-hidden="true" />}
      title={t('examBuilder.title')}
      subtitle={t('examBuilder.criteriaHint')}
      onClose={onClose}
      footer={
        <>
          {createExam.isError ? <ErrorState error={createExam.error} /> : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" type="submit" form="exam-create-form" disabled={createExam.isPending || !canCreate}>
            {createExam.isPending ? t('common.working') : t('teacherAssignments.createExam')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <form id="exam-create-form" className="space-y-5" onSubmit={submit}>
          <BuilderHeader mode={mode} onModeChange={setMode} />
          <div className="grid gap-3 lg:grid-cols-3">
            <TextInput label={t('teacherAssignments.titleLabel')} value={title} onChange={setTitle} required />
            <SelectInput label={t('examBuilder.subject')} value={filters.subjectKey} onChange={(v) => updateFilter('subjectKey', v)} options={scopeOptions.subjects} />
            <SelectInput label={t('examBuilder.grade')} value={filters.gradeKey} onChange={(v) => updateFilter('gradeKey', v)} options={scopeOptions.grades} />
            <SelectInput label={t('examBuilder.term')} value={filters.termKey} onChange={(v) => updateFilter('termKey', v)} options={scopeOptions.terms} />
            <SelectInput
              label={t('teacherAssignments.textbookScope')}
              value={textbookKey}
              onChange={(value) => {
                setTextbookKey(value);
                setLessonKey('');
                setConceptKeys([]);
                setSelectedQuestionKeys([]);
              }}
              options={filteredBooks.map((book) => ({
                key: book.key,
                name: textbookLabelParts({
                  title: book.title,
                  subjectName: book.subjectName,
                  gradeName: book.gradeName,
                  extra: [book.part === 'PART_1' ? t('textbookAdmin.part1') : t('textbookAdmin.part2')],
                }).join(' · '),
              }))}
              required
            />
            <SelectInput
              label={t('teacherAssignments.lessonScope')}
              value={lessonKey}
              onChange={(value) => {
                setLessonKey(value);
                setConceptKeys([]);
                setSelectedQuestionKeys([]);
              }}
              options={lessons.map((lesson) => ({ key: lesson.key, name: `${lesson.unitName} · ${lesson.name}` }))}
            />
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('examBuilder.description')}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text"
            />
          </label>

          <div className="grid gap-3 lg:grid-cols-5">
            <SelectInput label={t('questionBank.type')} value={filters.type} onChange={(v) => updateFilter('type', v as QuestionType | '')} options={QUESTION_TYPES.map((type) => ({ key: type, name: t(`question.type.${type}` as MessageKey) }))} />
            <SelectInput label={t('questionBank.origin')} value={filters.origin} onChange={(v) => updateFilter('origin', v as QuestionOrigin | '')} options={QUESTION_ORIGINS.map((origin) => ({ key: origin, name: t(`question.origin.${origin}` as MessageKey) }))} />
            <SelectInput label={t('catalogue.state')} value={filters.status} onChange={(v) => updateFilter('status', v as PublicationStatus)} options={PUBLICATION_STATUSES.map((status) => ({ key: status, name: t(`publication.${status}` as MessageKey) }))} allowAll={false} />
            <TextInput label={t('examBuilder.minDifficulty')} value={filters.difficultyMin} onChange={(v) => updateFilter('difficultyMin', v)} type="number" min="0" max="1" step="0.1" />
            <TextInput label={t('examBuilder.maxDifficulty')} value={filters.difficultyMax} onChange={(v) => updateFilter('difficultyMax', v)} type="number" min="0" max="1" step="0.1" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <section className="space-y-3 rounded-xl border border-border bg-surface-subtle p-3">
              <h3 className="text-sm font-bold text-text">{t('examBuilder.poolPreview')}</h3>
              {questions.isPending ? <LoadingState /> : null}
              {questions.isError ? <ErrorState error={questions.error} onRetry={() => void questions.refetch()} /> : null}
              {lessonKey && lessonBank.data?.concepts.length ? <ConceptPicker concepts={lessonBank.data.concepts} selected={conceptKeys} onToggle={toggleConcept} /> : null}
              <StatsRibbon stats={poolStats} />
              {mode === 'fixed' ? (
                <QuestionPicker questions={pool.slice(0, 40)} selected={selectedQuestionKeys} onToggle={toggleQuestion} lessonName={lessonName} />
              ) : (
                <p className="rounded-lg border border-info-border bg-info-subtle p-3 text-xs leading-relaxed text-info">
                  {t('examBuilder.adaptivePoolNote')}
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface-raised p-3">
              <h3 className="text-sm font-bold text-text">{t('examBuilder.blueprint')}</h3>
              <div className="grid grid-cols-3 gap-2">
                <TextInput label={t('examBuilder.easy')} value={targets.easy} onChange={(v) => setTargets((c) => ({ ...c, easy: v }))} type="number" min="0" />
                <TextInput label={t('examBuilder.medium')} value={targets.medium} onChange={(v) => setTargets((c) => ({ ...c, medium: v }))} type="number" min="0" />
                <TextInput label={t('examBuilder.hard')} value={targets.hard} onChange={(v) => setTargets((c) => ({ ...c, hard: v }))} type="number" min="0" />
              </div>
              {mode === 'fixed' ? (
                <Button variant="secondary" type="button" onClick={() => setSelectedQuestionKeys(assembleByTargets(pool, targets, conceptKeys).map((question) => question.key))} disabled={pool.length === 0}>
                  {t('examBuilder.suggestSelection')}
                </Button>
              ) : null}
              <StatsRibbon stats={mode === 'fixed' ? selectedStats : poolStats} compact />
              <div className="grid grid-cols-2 gap-2">
                <TextInput label={t('examBuilder.passingScore')} value={settings.passingScore} onChange={(v) => updateSetting('passingScore', v)} type="number" min="0.1" max="1" step="0.05" />
                <TextInput label={t('examBuilder.timeLimit')} value={settings.timeLimit} onChange={(v) => updateSetting('timeLimit', v)} type="number" min="1" />
                {mode === 'adaptive' ? (
                  <>
                    <TextInput label={t('examBuilder.minItems')} value={settings.minItems} onChange={(v) => updateSetting('minItems', v)} type="number" min="3" />
                    <TextInput label={t('examBuilder.maxItems')} value={settings.maxItems} onChange={(v) => updateSetting('maxItems', v)} type="number" min="3" />
                    <TextInput label={t('examBuilder.targetSe')} value={settings.targetStandardError} onChange={(v) => updateSetting('targetStandardError', v)} type="number" min="0.15" max="1" step="0.05" />
                  </>
                ) : null}
              </div>
              {mode === 'adaptive' && filters.type === 'ESSAY' ? <p className="text-2xs text-warning">{t('examBuilder.essayAdaptiveBlocked')}</p> : null}
            </section>
          </div>
        </form>

        {lastExam ? <CreatedExamPanel exam={lastExam} pending={transitionExam.isPending} onAction={transitionExam.mutate} /> : null}
        {transitionExam.isError ? <ErrorState error={transitionExam.error} /> : null}
      </div>
    </ActionModal>
  );
}
