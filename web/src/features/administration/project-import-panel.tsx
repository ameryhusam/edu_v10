/**
 * Project-wide importer.
 *
 * Strategy: accept one JSON manifest, preview by default, and apply each
 * section through the same API that the normal screens use. This keeps import
 * as orchestration over canonical use cases rather than a hidden Prisma writer.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { administrationApi } from './administration.api';
import { schoolsApi } from '../schools/schools.api';
import { peopleApi as adminApi } from '../people/people.api';
import { contentApi as textbookAdministrationApi } from '../content/content.api';
import { questionBankApi, type QuestionOrigin } from '../../education/authoring/question-bank.api';
import { parseMinisterialRows } from '../../education/authoring/question-form-utils';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

interface ProjectManifest {
  readonly schools?: readonly { key: string; name: string; city?: string | null }[];
  readonly subjects?: readonly { key: string; name: string; nameEn?: string | null }[];
  readonly grades?: readonly { key: string; ordinal: number; name: string; stage?: string | null }[];
  readonly academicYears?: readonly { key: string; startsOn: string; endsOn: string; isCurrent?: boolean }[];
  readonly terms?: readonly { key: string; academicYearKey: string; ordinal: number; name: string }[];
  readonly gradeSubjects?: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[];
  readonly users?: readonly Parameters<typeof adminApi.createUser>[0][];
  readonly educators?: readonly Parameters<typeof administrationApi.educators.create>[0][];
  readonly enrollments?: readonly Parameters<typeof adminApi.enroll>[0][];
  readonly guardianLinks?: readonly { guardianKey: string; learnerKey: string; relation?: string | null }[];
  readonly textbooks?: readonly Parameters<typeof textbookAdministrationApi.createTextbook>[0][];
  readonly textbookAdoptions?: readonly Parameters<typeof textbookAdministrationApi.adopt>[0][];
  readonly contentPackages?: readonly unknown[];
  readonly units?: readonly Parameters<typeof textbookAdministrationApi.createUnit>[0][];
  readonly lessons?: readonly Parameters<typeof textbookAdministrationApi.createLesson>[0][];
  readonly concepts?: readonly Parameters<typeof textbookAdministrationApi.createConcept>[0][];
  readonly resources?: readonly Parameters<typeof textbookAdministrationApi.createLearningResource>[0][];
  readonly quickQuestions?: readonly QuickQuestionBatch[];
}

interface QuickQuestionBatch {
  readonly lessonKey: string;
  readonly conceptKey: string;
  readonly raw: string;
  readonly origin?: QuestionOrigin;
  readonly sourceRefPrefix?: string | null;
}

interface ImportStep {
  readonly key: ManifestSection;
  readonly count: number;
  readonly state: 'pending' | 'done' | 'failed';
}

type ManifestSection =
  | 'schools'
  | 'subjects'
  | 'grades'
  | 'academicYears'
  | 'terms'
  | 'gradeSubjects'
  | 'users'
  | 'educators'
  | 'enrollments'
  | 'guardianLinks'
  | 'textbooks'
  | 'textbookAdoptions'
  | 'contentPackages'
  | 'units'
  | 'lessons'
  | 'concepts'
  | 'resources'
  | 'quickQuestions';

const SECTIONS: readonly ManifestSection[] = [
  'schools',
  'subjects',
  'grades',
  'academicYears',
  'terms',
  'gradeSubjects',
  'users',
  'educators',
  'enrollments',
  'guardianLinks',
  'textbooks',
  'textbookAdoptions',
  'contentPackages',
  'units',
  'lessons',
  'concepts',
  'resources',
  'quickQuestions',
];

const EMPTY_MANIFEST = `{
  "profile": "edu7.project-import",
  "version": "1.0",
  "schools": [],
  "subjects": [],
  "grades": [],
  "academicYears": [],
  "terms": [],
  "gradeSubjects": [],
  "textbooks": [],
  "contentPackages": [],
  "resources": [],
  "quickQuestions": []
}`;

export function ProjectImportPanel(): ReactNode {
  const { t } = useI18n();
  const [raw, setRaw] = useState(EMPTY_MANIFEST);
  const [dryRun, setDryRun] = useState(true);
  const [steps, setSteps] = useState<readonly ImportStep[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseManifest(raw), [raw]);
  const counts = parsed.ok ? manifestCounts(parsed.value) : [];

  async function apply(): Promise<void> {
    if (!parsed.ok) {
      setError(t('projectImport.invalidJson'));
      return;
    }
    setError(null);
    setRunning(true);
    const nextSteps = counts.map((entry) => ({ ...entry, state: 'pending' as const }));
    if (dryRun) {
      setSteps(nextSteps.map((entry) => ({ ...entry, state: 'done' as const })));
      setRunning(false);
      return;
    }
    setSteps(nextSteps);

    try {
      const done: ImportStep[] = [];
      for (const step of nextSteps) {
        await runSection(parsed.value, step.key);
        done.push({ ...step, state: 'done' });
        setSteps([...done, ...nextSteps.slice(done.length)]);
      }
      setRunning(false);
    } catch (cause) {
      setRunning(false);
      setError(cause instanceof Error ? cause.message : t('projectImport.failed'));
      setSteps((current) => current.map((step) => (step.state === 'pending' ? { ...step, state: 'failed' } : step)));
    }
  }

  return (
    <Card elevation="raised">
      <CardContent className="space-y-5">
        <div>
          <h2 className="text-base font-extrabold text-text">{t('projectImport.strategyTitle')}</h2>
          <p className="text-sm leading-relaxed text-text-muted">{t('projectImport.strategyBody')}</p>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm text-text-muted">
          <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          <span>{t('projectImport.dryRun')}</span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('projectImport.manifestLabel')}</span>
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={14}
            className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-text"
          />
          <span className="text-2xs text-text-muted">{t('projectImport.manifestHint')}</span>
        </label>

        {counts.length > 0 ? <SectionPreview counts={counts} /> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!parsed.ok || running} onClick={() => void apply()}>
            {running ? t('common.working') : dryRun ? t('projectImport.preview') : t('projectImport.apply')}
          </Button>
          <Button variant="secondary" onClick={() => setRaw(EMPTY_MANIFEST)}>
            {t('projectImport.sample')}
          </Button>
        </div>

        {steps.length > 0 ? <StepResults steps={steps} /> : null}
      </CardContent>
    </Card>
  );
}

function parseManifest(raw: string): { ok: true; value: ProjectManifest } | { ok: false } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return { ok: false };
    return { ok: true, value: value as ProjectManifest };
  } catch {
    return { ok: false };
  }
}

function manifestCounts(manifest: ProjectManifest): ImportStep[] {
  return SECTIONS.flatMap((key) => {
    const value = manifest[key];
    return Array.isArray(value) && value.length > 0 ? [{ key, count: value.length, state: 'pending' as const }] : [];
  });
}

async function runSection(manifest: ProjectManifest, section: ManifestSection): Promise<void> {
  if (section === 'schools') {
    for (const row of manifest.schools ?? []) await schoolsApi.save(row);
  } else if (section === 'subjects') {
    for (const row of manifest.subjects ?? []) await administrationApi.subjects.save(row);
  } else if (section === 'grades') {
    for (const row of manifest.grades ?? []) await administrationApi.grades.save(row);
  } else if (section === 'academicYears') {
    for (const row of manifest.academicYears ?? []) {
      await administrationApi.academicYears.save(row);
      if (row.isCurrent) await administrationApi.academicYears.makeCurrent(row.key);
    }
  } else if (section === 'terms') {
    for (const row of manifest.terms ?? []) await administrationApi.terms.save(row);
  } else if (section === 'gradeSubjects') {
    await administrationApi.matrix.save(manifest.gradeSubjects ?? []);
  } else if (section === 'users') {
    for (const row of manifest.users ?? []) await adminApi.createUser(row);
  } else if (section === 'educators') {
    for (const row of manifest.educators ?? []) await administrationApi.educators.create(row);
  } else if (section === 'enrollments') {
    for (const row of manifest.enrollments ?? []) await adminApi.enroll(row);
  } else if (section === 'guardianLinks') {
    for (const row of manifest.guardianLinks ?? []) await adminApi.linkGuardian(row);
  } else if (section === 'textbooks') {
    for (const row of manifest.textbooks ?? []) await textbookAdministrationApi.createTextbook(row);
  } else if (section === 'textbookAdoptions') {
    for (const row of manifest.textbookAdoptions ?? []) await textbookAdministrationApi.adopt(row);
  } else if (section === 'contentPackages') {
    for (const row of manifest.contentPackages ?? []) await textbookAdministrationApi.importPackage(row, false);
  } else if (section === 'units') {
    for (const row of manifest.units ?? []) await textbookAdministrationApi.createUnit(row);
  } else if (section === 'lessons') {
    for (const row of manifest.lessons ?? []) await textbookAdministrationApi.createLesson(row);
  } else if (section === 'concepts') {
    for (const row of manifest.concepts ?? []) await textbookAdministrationApi.createConcept(row);
  } else if (section === 'resources') {
    for (const row of manifest.resources ?? []) await textbookAdministrationApi.createLearningResource(row);
  } else {
    await importQuickQuestions(manifest.quickQuestions ?? []);
  }
}

async function importQuickQuestions(batches: readonly QuickQuestionBatch[]): Promise<void> {
  for (const batch of batches) {
    const rows = parseMinisterialRows(batch.raw);
    for (const [index, row] of rows.entries()) {
      await questionBankApi.create({
        type: 'MCQ_SINGLE',
        lessonKey: batch.lessonKey,
        origin: batch.origin ?? 'TEXTBOOK',
        visibility: batch.origin === 'TEACHER' ? 'SCHOOL' : 'GLOBAL',
        sourceRef: batch.sourceRefPrefix ? `${batch.sourceRefPrefix}-Q${row.number ?? index + 1}` : null,
        text: row.text,
        choices: row.choices,
        answerKey: { correctChoiceIds: [row.correctChoiceId] },
        concepts: [{ conceptKey: batch.conceptKey, weight: 1, isPrimary: true }],
      });
    }
  }
}

function SectionPreview({ counts }: { readonly counts: readonly ImportStep[] }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs font-bold text-text-muted">{t('projectImport.sectionsTitle')}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map((entry) => (
          <li key={entry.key} className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
            <span className="font-medium text-text">{t(`projectImport.section.${entry.key}` as MessageKey)}</span>
            <span className="block text-2xs text-text-muted">
              {t('projectImport.sectionCount', { count: entry.count })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepResults({ steps }: { readonly steps: readonly ImportStep[] }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs font-bold text-text-muted">{t('projectImport.resultTitle')}</p>
      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-text">{t(`projectImport.section.${step.key}` as MessageKey)}</span>
            <span className="text-xs text-text-muted">{t(`projectImport.state.${step.state}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
