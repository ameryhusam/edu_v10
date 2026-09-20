/**
 * Teacher assignments.
 *
 * This is the instruction channel the owner explicitly kept separate from
 * Learning.next-step. Publishing creates obligations; completion still comes
 * from evidence, not from a teacher toggling a mastered flag.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { EmptyState, ErrorState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import {
  assignmentsApi,
  INSTRUCTIONAL_ACTIVITY_TYPES,
  type InstructionalActivityType,
  type PlanRecord,
} from '../../education/instruction/assignments.api';
import { ExamCreateCard } from '../../education/authoring/exam-create-card';
import { questionBankApi, type ExamRecord } from '../../education/authoring/question-bank.api';
import { administrationApi } from '../../features/administration/administration.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { rosterApi } from '../../education/roster/roster.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export function TeacherAssignmentsPage(): ReactNode {
  const { t } = useI18n();
  const { schoolIds } = useSession();
  const queryClient = useQueryClient();
  const [lastPlan, setLastPlan] = useState<PlanRecord | null>(null);

  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [activityType, setActivityType] = useState<InstructionalActivityType>('LESSON');
  const [activityKey, setActivityKey] = useState('');
  const [targetLearnerKey, setTargetLearnerKey] = useState('');
  const [schoolId, setSchoolId] = useState(schoolIds[0] ?? '');
  const [gradeId, setGradeId] = useState('');
  const [termId, setTermId] = useState('');
  const [dueAt, setDueAt] = useState('');

  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(),
  });
  // Every scoped role carries a school id, not a school name — resolving it
  // to a name here is the only alternative to showing a raw UUID in the
  // school picker (G1, §2.1 of the production plan).
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });
  const schoolName = new Map((schools.data ?? []).map((school) => [school.key, school.name]));
  const rosterScope = {
    schoolId,
    ...(gradeId ? { gradeId } : {}),
    ...(termId ? { termId } : {}),
  };
  const roster = useQuery({
    queryKey: queryKeys.analytics.roster(rosterScope),
    queryFn: () => rosterApi.list(rosterScope),
    enabled: Boolean(schoolId),
  });
  const exams = useQuery({
    queryKey: queryKeys.content.exams({ status: 'PUBLISHED', limit: 100 }),
    queryFn: () => questionBankApi.exams({ status: 'PUBLISHED', limit: 100 }),
    enabled: activityType === 'EXAM',
  });

  const create = useMutation({
    mutationFn: () =>
      assignmentsApi.createPlan({
        title,
        instructions: instructions.trim() ? instructions.trim() : null,
        activityType,
        activityKey,
        scope: {
          schoolId,
          gradeId: gradeId || null,
          termId: termId || null,
        },
        targetLearnerKey: targetLearnerKey.trim() ? targetLearnerKey.trim() : null,
        availableAt: null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      }),
    onSuccess: (plan) => {
      setLastPlan(plan);
      setTitle('');
      setInstructions('');
      setActivityKey('');
      setTargetLearnerKey('');
      setDueAt('');
      queryClient.invalidateQueries({ queryKey: queryKeys.instruction.all });
    },
  });

  const transition = useMutation({
    mutationFn: (input: { planKey: string; action: 'PUBLISH' | 'CANCEL' }) =>
      assignmentsApi.transition(input.planKey, input.action),
    onSuccess: (result) => {
      setLastPlan((current) =>
        current && current.key === result.planKey ? { ...current, status: result.status } : current,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.instruction.all });
    },
  });

  const materialise = useMutation({
    mutationFn: (planKey: string) => assignmentsApi.materialise(planKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.instruction.all }),
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  if (schoolIds.length === 0) {
    return <EmptyState title={t('teacher.noSchool')} body={t('teacher.noSchoolHint')} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('teacherAssignments.title')} subtitle={t('teacherAssignments.subtitle')} />

      <p className="rounded-xl border border-info-border bg-info-subtle px-3.5 py-2.5 text-2xs leading-relaxed text-info">
        {t('teacherAssignments.separateFlowNote')}
      </p>

      <Card elevation="raised">
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.titleLabel')}</span>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.activityType')}</span>
                <select
                  value={activityType}
                  onChange={(event) => {
                    setActivityType(event.target.value as InstructionalActivityType);
                    setActivityKey('');
                  }}
                  className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                >
                  {INSTRUCTIONAL_ACTIVITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`teacherAssignments.activity.${type}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">
                  {activityType === 'EXAM' ? t('teacherAssignments.examPicker') : t('teacherAssignments.activityKey')}
                </span>
                {activityType === 'EXAM' ? (
                  <select
                    value={activityKey}
                    onChange={(event) => setActivityKey(event.target.value)}
                    className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                    required
                  >
                    <option value="">—</option>
                    {(exams.data?.rows ?? []).map((exam: ExamRecord) => (
                      <option key={exam.key} value={exam.key}>
                        {exam.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input value={activityKey} onChange={(event) => setActivityKey(event.target.value)} required />
                )}
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.schoolScope')}</span>
                <select
                  value={schoolId}
                  onChange={(event) => {
                    setSchoolId(event.target.value);
                    setTargetLearnerKey('');
                  }}
                  className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                >
                  {schoolIds.map((id) => (
                    <option key={id} value={id}>
                      {schoolName.get(id) ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('collection.grades')}</span>
                <select
                  value={gradeId}
                  onChange={(event) => {
                    setGradeId(event.target.value);
                    setTargetLearnerKey('');
                  }}
                  className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                >
                  <option value="">{t('common.all')}</option>
                  {(grades.data ?? []).map((grade) => (
                    <option key={grade.key} value={grade.key}>
                      {grade.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('collection.terms')}</span>
                <select
                  value={termId}
                  onChange={(event) => {
                    setTermId(event.target.value);
                    setTargetLearnerKey('');
                  }}
                  className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                >
                  <option value="">{t('common.all')}</option>
                  {(terms.data ?? []).map((term) => (
                    <option key={term.key} value={term.key}>
                      {term.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.targetLearner')}</span>
                <select
                  value={targetLearnerKey}
                  onChange={(event) => setTargetLearnerKey(event.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
                >
                  <option value="">{t('teacherAssignments.wholeScope')}</option>
                  {(roster.data?.learners ?? []).map((learner) => (
                    <option key={learner.learnerKey} value={learner.learnerKey}>
                      {learner.fullName} · {learner.gradeName}
                    </option>
                  ))}
                </select>
                <span className="block text-2xs text-text-muted">{t('teacherAssignments.targetLearnerHint')}</span>
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.instructions')}</span>
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text"
              />
            </label>

            <label className="block max-w-xs space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.dueAt')}</span>
              <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>

            {create.isError ? <ErrorState error={create.error} /> : null}
            <Button variant="primary" type="submit" disabled={create.isPending || !schoolId}>
              {create.isPending ? t('common.working') : t('teacherAssignments.createDraft')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ExamCreateCard />

      {lastPlan ? (
        <Card elevation="default">
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-text">{lastPlan.title}</h2>
                <p className="text-2xs text-text-muted">{lastPlan.key}</p>
              </div>
              <Badge tone={lastPlan.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                {t(`plan.status.${lastPlan.status}` as MessageKey)}
              </Badge>
            </div>
            <p className="text-xs text-text-muted">
              {lastPlan.activityType} · {lastPlan.activityKey}
              {lastPlan.targetLearnerKey ? ` · ${lastPlan.targetLearnerKey}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {lastPlan.status === 'DRAFT' ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={transition.isPending}
                  onClick={() => transition.mutate({ planKey: lastPlan.key, action: 'PUBLISH' })}
                >
                  {t('teacherAssignments.publish')}
                </Button>
              ) : null}
              {lastPlan.status === 'PUBLISHED' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={materialise.isPending}
                  onClick={() => materialise.mutate(lastPlan.key)}
                >
                  {t('teacherAssignments.materialise')}
                </Button>
              ) : null}
              {lastPlan.status !== 'CANCELLED' ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={transition.isPending}
                  onClick={() => transition.mutate({ planKey: lastPlan.key, action: 'CANCEL' })}
                >
                  {t('teacherAssignments.cancel')}
                </Button>
              ) : null}
            </div>
            {transition.isError ? <ErrorState error={transition.error} /> : null}
            {materialise.isError ? <ErrorState error={materialise.error} /> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
