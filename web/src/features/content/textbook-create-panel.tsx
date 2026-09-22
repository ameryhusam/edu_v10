/**
 * Textbook creation and bulk setup.
 *
 * The form collects textbook coordinates; the server derives the key. The bulk
 * action uses the grade-subject matrix and the same authoring service, so it is
 * setup automation rather than a second content write path.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass = 'h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';

export function TextbookCreatePanel(): ReactNode {
  const { t } = useI18n();
  const { schoolIds } = useSession();
  const queryClient = useQueryClient();
  const subjects = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const academicYears = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
  });

  const [subjectKey, setSubjectKey] = useState('');
  const [gradeKey, setGradeKey] = useState('');
  const [part, setPart] = useState<'PART_1' | 'PART_2' | 'BOTH' | ''>('');
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState(String(new Date().getFullYear()));
  const [bulkGradeKey, setBulkGradeKey] = useState('');
  const [bulkPart, setBulkPart] = useState<'PART_1' | 'PART_2' | 'BOTH' | ''>('');
  const [bulkEdition, setBulkEdition] = useState(String(new Date().getFullYear()));
  const [adoptBulk, setAdoptBulk] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const currentAcademicYearKey = (academicYears.data ?? []).find((year) => year.isCurrent)?.key ?? null;
  const adoptableSchoolKey = schoolIds[0] ?? null;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const create = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.createTextbook({ subjectKey, gradeKey, part, title, edition }),
    onSuccess: async (result) => {
      setLastResult(result.key);
      setTitle('');
      await refresh();
    },
  });

  const ensure = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.ensureForGrade({
        gradeKey: bulkGradeKey,
        part: bulkPart,
        edition: bulkEdition,
        adopt:
          adoptBulk && adoptableSchoolKey && currentAcademicYearKey
            ? { schoolKey: adoptableSchoolKey, academicYearKey: currentAcademicYearKey }
            : null,
      }),
    onSuccess: async (result) => {
      setLastResult(
        t('textbookAdmin.ensureSummary', {
          created: result.created,
          unchanged: result.unchanged,
          adopted: result.adopted,
        }),
      );
      await refresh();
    },
  });

  // The suggested title is computed once, server-side, from the subject name
  // (see `defaultTextbookTitle` on `SubjectRecord`) rather than recomputed
  // here — this screen used to carry its own byte-for-byte copy of the naming
  // rule, which is exactly the duplication §2.2 of the production plan flags.
  const defaultTitle = useMemo(() => {
    return (subjects.data ?? []).find((row) => row.key === subjectKey)?.defaultTextbookTitle ?? '';
  }, [subjectKey, subjects.data]);

  function submitCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  function submitEnsure(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    ensure.mutate();
  }

  return (
    <Card elevation="raised">
      <CardContent className="space-y-5">
        <div>
          <h2 className="text-sm font-bold text-text">{t('textbookAdmin.creationTitle')}</h2>
          <p className="text-xs text-text-muted">{t('textbookAdmin.creationHint')}</p>
        </div>

        <form className="grid gap-3 md:grid-cols-5" onSubmit={submitCreate}>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('collection.subjects')}</span>
            <select value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} className={selectClass} required>
              <option value="">—</option>
              {(subjects.data ?? []).map((subject) => (
                <option key={subject.key} value={subject.key}>{subject.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('collection.grades')}</span>
            <select value={gradeKey} onChange={(e) => setGradeKey(e.target.value)} className={selectClass} required>
              <option value="">—</option>
              {(grades.data ?? []).map((grade) => (
                <option key={grade.key} value={grade.key}>{grade.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')}</span>
            <select value={part} onChange={(e) => setPart(e.target.value)} className={selectClass} required>
              <option value="">—</option>
              {<option value="PART_1">الجزء الأول</option><option value="PART_2">الجزء الثاني</option><option value="BOTH">الجزآن</option>}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')}</span>
            <Input value={edition} onChange={(e) => setEdition(e.target.value)} required />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.titleLabel')}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} required />
          </label>
          <div className="md:col-span-5 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? t('common.working') : t('textbookAdmin.createOne')}
            </Button>
            {create.isError ? <ErrorState error={create.error} /> : null}
          </div>
        </form>

        <form className="grid gap-3 border-t border-border pt-4 md:grid-cols-4" onSubmit={submitEnsure}>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.bulkGrade')}</span>
            <select value={bulkGradeKey} onChange={(e) => setBulkGradeKey(e.target.value)} className={selectClass} required>
              <option value="">—</option>
              {(grades.data ?? []).map((grade) => (
                <option key={grade.key} value={grade.key}>{grade.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')}</span>
            <select value={bulkPart} onChange={(e) => setBulkPart(e.target.value)} className={selectClass} required>
              <option value="">—</option>
              {<option value="PART_1">الجزء الأول</option><option value="PART_2">الجزء الثاني</option><option value="BOTH">الجزآن</option>}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')}</span>
            <Input value={bulkEdition} onChange={(e) => setBulkEdition(e.target.value)} required />
          </label>
          <label className="flex items-end gap-2 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={adoptBulk}
              onChange={(e) => setAdoptBulk(e.target.checked)}
              disabled={!adoptableSchoolKey || !currentAcademicYearKey}
            />
            <span>{t('textbookAdmin.adoptCurrentYear')}</span>
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" disabled={ensure.isPending}>
              {ensure.isPending ? t('common.working') : t('textbookAdmin.ensureForGrade')}
            </Button>
          </div>
          {ensure.isError ? <ErrorState error={ensure.error} /> : null}
        </form>

        {lastResult ? <p className="text-xs font-medium text-success">{lastResult}</p> : null}
      </CardContent>
    </Card>
  );
}

