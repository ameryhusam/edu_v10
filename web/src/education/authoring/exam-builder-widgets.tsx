/** Presentational pieces for the criteria-led exam builder. */

import type { ReactNode } from 'react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import type { ExamRecord, QuestionRecord } from './question-bank.api';
import type { Mode, QuestionStats } from './exam-builder-utils';

export function BuilderHeader({
  mode,
  onModeChange,
}: {
  readonly mode: Mode;
  readonly onModeChange: (mode: Mode) => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold text-text">{t('teacherAssignments.examAuthoringTitle')}</h2>
        <p className="mt-1 max-w-3xl text-2xs leading-relaxed text-text-muted">
          {t('examBuilder.criteriaHint')}
        </p>
      </div>
      <div className="flex rounded-lg border border-border bg-surface-raised p-1">
        {(['fixed', 'adaptive'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={candidate === mode}
            onClick={() => onModeChange(candidate)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              candidate === mode ? 'bg-accent text-on-accent' : 'text-text-muted hover:text-text'
            }`}
          >
            {t(candidate === 'fixed' ? 'teacherAssignments.examModeFixed' : 'teacherAssignments.examModeAdaptive')}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
  required = false,
  allowAll = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { key: string; name: string }[];
  readonly required?: boolean;
  readonly allowAll?: boolean;
}): ReactNode {
  const { t } = useI18n();
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
      >
        {allowAll ? <option value="">{t('common.all')}</option> : null}
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  min,
  max,
  step,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly type?: string;
  readonly min?: string;
  readonly max?: string;
  readonly step?: string;
}): ReactNode {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}

export function ConceptPicker({
  concepts,
  selected,
  onToggle,
}: {
  readonly concepts: readonly { key: string; name: string }[];
  readonly selected: readonly string[];
  readonly onToggle: (key: string) => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold text-text-muted">{t('examBuilder.conceptCoverage')}</p>
      <div className="flex flex-wrap gap-2">
        {concepts.map((concept) => (
          <button
            key={concept.key}
            type="button"
            onClick={() => onToggle(concept.key)}
            className={`rounded-full border px-3 py-1 text-2xs font-semibold ${
              selected.includes(concept.key)
                ? 'border-accent-border bg-accent-subtle text-accent'
                : 'border-border bg-surface text-text-muted'
            }`}
          >
            {concept.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuestionPicker({
  questions,
  selected,
  onToggle,
  lessonName,
}: {
  readonly questions: readonly QuestionRecord[];
  readonly selected: readonly string[];
  readonly onToggle: (key: string) => void;
  readonly lessonName: ReadonlyMap<string, string>;
}): ReactNode {
  const { t } = useI18n();
  if (questions.length === 0) return <p className="text-xs text-text-muted">{t('examBuilder.noPoolQuestions')}</p>;
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
      {questions.map((question) => (
        <label key={question.key} className="flex gap-2 rounded-lg border border-border bg-surface-raised p-3">
          <input
            type="checkbox"
            checked={selected.includes(question.key)}
            onChange={() => onToggle(question.key)}
            className="mt-1 size-4"
          />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm font-semibold text-text">{question.text}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{t(`question.type.${question.type}` as MessageKey)}</Badge>
              <Badge tone={question.origin === 'MINISTERIAL' ? 'info' : 'neutral'}>
                {t(`question.origin.${question.origin}` as MessageKey)}
              </Badge>
              {question.concepts.length === 0 ? (
                <Badge tone="warning">{t('examBuilder.unlinked')}</Badge>
              ) : (
                <Badge tone="neutral">{t('examBuilder.conceptsCount', { count: question.concepts.length })}</Badge>
              )}
              <span className="text-2xs text-text-muted">{lessonName.get(question.lessonKey) ?? t('questionBank.unlinkedLesson')}</span>
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function StatsRibbon({
  stats,
  compact = false,
}: {
  readonly stats: QuestionStats;
  readonly compact?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const entries = [
    ['examBuilder.totalItems', stats.total],
    ['examBuilder.autoGradable', stats.autoGradable],
    ['examBuilder.manualItems', stats.manual],
    ['examBuilder.coveredConcepts', stats.concepts],
    ['examBuilder.easy', stats.easy],
    ['examBuilder.medium', stats.medium],
    ['examBuilder.hard', stats.hard],
  ] as const;
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-border bg-surface px-2.5 py-2">
          <p className="text-2xs text-text-muted">{t(key as MessageKey)}</p>
          <p className="text-sm font-bold text-text">{value}</p>
        </div>
      ))}
    </div>
  );
}

export function CreatedExamPanel({
  exam,
  pending,
  onAction,
}: {
  readonly exam: ExamRecord;
  readonly pending: boolean;
  readonly onAction: (action: 'SUBMIT' | 'APPROVE' | 'ARCHIVE' | 'RESTORE') => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-text">{exam.title}</p>
          <p className="text-2xs text-text-muted">
            {exam.isAdaptive ? t('exams.adaptive') : t('teacherAssignments.examModeFixed')} · {exam.items.length}{' '}
            {t('collection.questions')}
          </p>
        </div>
        <Badge tone={exam.status === 'PUBLISHED' ? 'success' : 'neutral'}>
          {t(`publication.${exam.status}` as MessageKey)}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {exam.status === 'DRAFT' ? <ActionButton label={t('teacherAssignments.submitExam')} pending={pending} onClick={() => onAction('SUBMIT')} /> : null}
        {exam.status === 'IN_REVIEW' ? <ActionButton label={t('teacherAssignments.publishExam')} pending={pending} onClick={() => onAction('APPROVE')} primary /> : null}
        {exam.status === 'PUBLISHED' ? <ActionButton label={t('teacherAssignments.archiveExam')} pending={pending} onClick={() => onAction('ARCHIVE')} danger /> : null}
        {exam.status === 'ARCHIVED' ? <ActionButton label={t('question.action.RESTORE')} pending={pending} onClick={() => onAction('RESTORE')} /> : null}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  pending,
  onClick,
  primary = false,
  danger = false,
}: {
  readonly label: string;
  readonly pending: boolean;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly danger?: boolean;
}): ReactNode {
  return (
    <Button variant={danger ? 'danger' : primary ? 'primary' : 'secondary'} size="sm" disabled={pending} onClick={onClick}>
      {label}
    </Button>
  );
}
