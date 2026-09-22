/**
 * Modal dialog for bulk preparing textbooks for an entire grade.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { schoolsApi, type SchoolRecord } from '../schools/schools.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';

export function TextbookBulkGradeModal({
  open,
  onClose,
  initialGradeKey,
  initialPart,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGradeKey?: string | null | undefined;
  readonly initialPart?: 'PART_1' | 'PART_2' | null | undefined;
}): ReactNode {
  const { t } = useI18n();
  const { schoolIds } = useSession();
  const queryClient = useQueryClient();

  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const academicYears = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
  });
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });

  const [bulkGradeKey, setBulkGradeKey] = useState(initialGradeKey ?? '');
  const [bulkPart, setBulkPart] = useState<'PART_1' | 'PART_2' | 'BOTH' | ''>(initialPart ?? '');
  const [bulkEdition, setBulkEdition] = useState(String(new Date().getFullYear()));
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(schoolIds[0] ?? '');
  const [adoptBulk, setAdoptBulk] = useState(false);
  const [summaryResult, setSummaryResult] = useState<string | null>(null);

  const currentAcademicYear = (academicYears.data ?? []).find((year) => year.isCurrent);
  const currentAcademicYearKey = currentAcademicYear?.key ?? null;

  const ensure = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.ensureForGrade({
        gradeKey: bulkGradeKey,
        part: bulkPart,
        edition: bulkEdition,
        adopt:
          adoptBulk && selectedSchoolKey && currentAcademicYearKey
            ? { schoolKey: selectedSchoolKey, academicYearKey: currentAcademicYearKey }
            : null,
      }),
    onSuccess: async (result) => {
      setSummaryResult(
        t('textbookAdmin.ensureSummary', {
          created: result.created,
          unchanged: result.unchanged,
          adopted: result.adopted,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
    },
  });

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    ensure.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('textbookAdmin.bulkSetupButton')}
    >
      <form
        className="max-h-[min(42rem,92vh)] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-bold text-text">{t('textbookAdmin.bulkSetupButton')}</h2>
            <p className="text-xs text-text-muted">{t('textbookAdmin.creationHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span>
            <select
              value={bulkGradeKey}
              onChange={(e) => setBulkGradeKey(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {(grades.data ?? []).map((grade) => (
                <option key={grade.key} value={grade.key}>
                  {grade.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')} *</span>
            <select
              value={bulkPart}
              onChange={(e) => setBulkPart(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {<option value="PART_1">الجزء الأول</option>
              <option value="PART_2">الجزء الثاني</option>
              }
            </select>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')} *</span>
          <Input value={bulkEdition} onChange={(e) => setBulkEdition(e.target.value)} required />
        </label>

        <div className="rounded-xl border border-border bg-surface-sunken p-3.5 space-y-3">
          <label className="flex items-center gap-2 text-xs font-medium text-text">
            <input
              type="checkbox"
              checked={adoptBulk}
              onChange={(e) => setAdoptBulk(e.target.checked)}
              className="size-4 rounded border-border text-accent focus:ring-accent"
            />
            <span>{t('textbookAdmin.adoptCurrentYear')}</span>
          </label>

          {adoptBulk ? (
            <div className="space-y-2 pt-1">
              <label className="block space-y-1">
                <span className="text-2xs font-medium text-text-muted">{t('textbookAdmin.selectSchool')}</span>
                <select
                  value={selectedSchoolKey}
                  onChange={(e) => setSelectedSchoolKey(e.target.value)}
                  className={selectClass}
                  required
                >
                  <option value="">—</option>
                  {(schools.data ?? []).map((school: SchoolRecord) => (
                    <option key={school.key} value={school.key}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
              {currentAcademicYear ? (
                <p className="text-2xs text-text-muted">
                  {t('textbookAdmin.selectAcademicYear')}:{' '}
                  <span className="font-semibold text-text">
                    {currentAcademicYear.startsOn} – {currentAcademicYear.endsOn}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {summaryResult ? (
          <div className="rounded-xl bg-success-subtle p-3 text-xs font-medium text-success border border-success/30">
            {summaryResult}
          </div>
        ) : null}

        {ensure.isError ? <ErrorState error={ensure.error} /> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" type="button" disabled={ensure.isPending} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={ensure.isPending || !bulkGradeKey || !bulkPart}
          >
            {ensure.isPending ? t('common.working') : t('textbookAdmin.ensureForGrade')}
          </Button>
        </div>
      </form>
    </div>
  );
}
