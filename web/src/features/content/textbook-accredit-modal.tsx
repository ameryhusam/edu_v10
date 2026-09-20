/**
 * Modal dialog for accrediting textbooks to a school.
 *
 * Supports single textbook accreditation and whole-grade accreditation.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { ErrorState } from '../../design-system/patterns/data-states';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { schoolsApi, type SchoolRecord } from '../schools/schools.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';

export function TextbookAccreditModal({
  open,
  onClose,
  initialTextbookKey,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialTextbookKey?: string | null;
}): ReactNode {
  const { t } = useI18n();
  const { schoolIds } = useSession();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'single' | 'grade'>('single');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(schoolIds[0] ?? '');
  const [selectedAcademicYearKey, setSelectedAcademicYearKey] = useState('');
  const [selectedTextbookKey, setSelectedTextbookKey] = useState(initialTextbookKey ?? '');
  const [selectedGradeKey, setSelectedGradeKey] = useState('');
  const [selectedTermKey, setSelectedTermKey] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });

  const academicYears = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: async () => {
      const data = await administrationApi.academicYears.list();
      const current = data.find((y) => y.isCurrent);
      if (current && !selectedAcademicYearKey) {
        setSelectedAcademicYearKey(current.key);
      }
      return data;
    },
  });

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ limit: 100 }),
    queryFn: () => textbookAdministrationApi.listTextbooks({ limit: 100 }),
  });

  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });

  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(),
  });

  const adoptMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'single') {
        await textbookAdministrationApi.adopt({
          schoolKey: selectedSchoolKey,
          academicYearKey: selectedAcademicYearKey,
          textbookKey: selectedTextbookKey,
        });
        return { message: t('textbookAdmin.accreditSuccess') };
      } else {
        const result = await textbookAdministrationApi.adoptGrade({
          schoolKey: selectedSchoolKey,
          academicYearKey: selectedAcademicYearKey,
          gradeKey: selectedGradeKey,
          termKey: selectedTermKey ? selectedTermKey : undefined,
        });
        return {
          message: t('textbookAdmin.accreditGradeSummary', {
            adopted: result.adopted,
            already: result.alreadyAdopted,
          }),
        };
      }
    },
    onSuccess: async (data) => {
      setStatusMessage(data.message);
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
    },
  });

  if (!open) return null;

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    adoptMutation.mutate();
  }

  const isValid =
    selectedSchoolKey &&
    selectedAcademicYearKey &&
    (mode === 'single' ? selectedTextbookKey : selectedGradeKey);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('textbookAdmin.accreditBooks')}
    >
      <form
        className="max-h-[min(44rem,92vh)] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-bold text-text">{t('textbookAdmin.accreditBooks')}</h2>
            <p className="text-xs text-text-muted">{t('textbookAdmin.selectSchoolHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>

        {/* Mode selector pills */}
        <div className="flex rounded-xl bg-surface-sunken p-1 border border-border">
          <button
            type="button"
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
              mode === 'single'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
            onClick={() => setMode('single')}
          >
            {t('textbookAdmin.modeSingleBook')}
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
              mode === 'grade'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
            onClick={() => setMode('grade')}
          >
            {t('textbookAdmin.modeAllGrade')}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectSchool')} *</span>
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

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectAcademicYear')} *</span>
            <select
              value={selectedAcademicYearKey}
              onChange={(e) => setSelectedAcademicYearKey(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {(academicYears.data ?? []).map((year) => (
                <option key={year.key} value={year.key}>
                  {year.startsOn} – {year.endsOn} {year.isCurrent ? '(الحالي)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mode === 'single' ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.selectTextbook')} *</span>
            <select
              value={selectedTextbookKey}
              onChange={(e) => setSelectedTextbookKey(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {(textbooks.data?.rows ?? []).map((tb) => (
                <option key={tb.key} value={tb.key}>
                  {tb.title} ({tb.gradeName || tb.gradeKey} - {tb.subjectName || tb.subjectKey}) [{tb.status}]
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span>
              <select
                value={selectedGradeKey}
                onChange={(e) => setSelectedGradeKey(e.target.value)}
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
              <span className="text-xs font-medium text-text-muted">{t('collection.terms')} (اختياري)</span>
              <select
                value={selectedTermKey}
                onChange={(e) => setSelectedTermKey(e.target.value)}
                className={selectClass}
              >
                <option value="">كل الفصول</option>
                {(terms.data ?? []).map((term) => (
                  <option key={term.key} value={term.key}>
                    {term.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="rounded-xl border border-warning/30 bg-warning-subtle/50 p-3 text-2xs text-text-muted">
          💡 {t('textbookAdmin.publishedOnlyNote')}
        </div>

        {statusMessage ? (
          <div className="rounded-xl bg-success-subtle p-3 text-xs font-medium text-success border border-success/30">
            {statusMessage}
          </div>
        ) : null}

        {adoptMutation.isError ? <ErrorState error={adoptMutation.error} /> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" type="button" disabled={adoptMutation.isPending} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={adoptMutation.isPending || !isValid}
          >
            {adoptMutation.isPending ? t('common.working') : t('textbookAdmin.adopt')}
          </Button>
        </div>
      </form>
    </div>
  );
}
