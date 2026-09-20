import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import {
  textbookAdministrationApi,
  type GradeAdoptionResult,
} from '../../features/content/content.api';
import { administrationApi } from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

const selectClass = 'h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';

/**
 * Accreditation entry point for one school: one book by its coordinates, or
 * every book a grade has, both for a chosen academic year. This is the
 * canonical home for "اعتماد الكتاب المدرسي" — the per-textbook drawer only
 * shows what is already accredited and links here to add more.
 */
export function AccreditTextbookForm({
  schoolKey,
  onDone,
}: {
  readonly schoolKey: string;
  readonly onDone: () => Promise<void>;
}): ReactNode {
  const { t, locale } = useI18n();

  const [mode, setMode] = useState<'one' | 'grade'>('one');
  const [subjectKey, setSubjectKey] = useState('');
  const [gradeKey, setGradeKey] = useState('');
  const [termKey, setTermKey] = useState('');
  const [yearKey, setYearKey] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<GradeAdoptionResult | null>(null);

  const subjects = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(),
  });
  const years = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
  });
  // Only textbooks that actually exist for the chosen coordinates — an
  // administrator accredits a book that was authored, not a guess at a key.
  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ subjectKey, gradeKey, termKey }),
    queryFn: () => textbookAdministrationApi.textbooks({ subjectKey, gradeKey, termKey, limit: 5 }),
    enabled: mode === 'one' && subjectKey !== '' && gradeKey !== '' && termKey !== '',
  });
  const matchedTextbook = textbooks.data?.rows[0] ?? null;

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const accreditOne = useMutation({
    mutationFn: () => {
      if (!matchedTextbook) throw new Error('no textbook matched');
      return textbookAdministrationApi.adopt({
        textbookKey: matchedTextbook.key,
        schoolKey,
        academicYearKey: yearKey,
      });
    },
    onSuccess: async () => {
      setFailure(null);
      setSummary(null);
      await onDone();
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const accreditGrade = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.adoptGrade({
        gradeKey,
        termKey: termKey || undefined,
        schoolKey,
        academicYearKey: yearKey,
      }),
    onSuccess: async (result) => {
      setFailure(null);
      setSummary(result);
      await onDone();
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const pending = accreditOne.isPending || accreditGrade.isPending;
  const canSubmitOne = matchedTextbook !== null && yearKey !== '';
  const canSubmitGrade = gradeKey !== '' && yearKey !== '';

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-sunken p-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'one' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode('one')}
        >
          {t('textbookAdmin.accreditOne')}
        </Button>
        <Button
          type="button"
          variant={mode === 'grade' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setMode('grade')}
        >
          {t('textbookAdmin.accreditGrade')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {mode === 'one' ? (
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-text-muted">{t('collection.subjects')}</span>
            <select value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} className={selectClass}>
              <option value="">—</option>
              {(subjects.data ?? []).map((subject) => (
                <option key={subject.key} value={subject.key}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('collection.grades')}</span>
          <select value={gradeKey} onChange={(e) => setGradeKey(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {(grades.data ?? []).map((grade) => (
              <option key={grade.key} value={grade.key}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">
            {t('collection.terms')}
            {mode === 'grade' ? ` (${t('common.all')})` : ''}
          </span>
          <select value={termKey} onChange={(e) => setTermKey(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {(terms.data ?? []).map((term) => (
              <option key={term.key} value={term.key}>
                {term.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('enrollments.year')}</span>
          <select value={yearKey} onChange={(e) => setYearKey(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {(years.data ?? []).map((year) => (
              <option key={year.key} value={year.key}>
                {year.key}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === 'one' && subjectKey && gradeKey && termKey && !matchedTextbook && textbooks.isSuccess ? (
        <p className="text-xs text-danger">{t('textbookAdmin.noMatchingTextbook')}</p>
      ) : null}
      {mode === 'one' && matchedTextbook ? (
        <p className="text-xs text-text-muted">{matchedTextbook.title}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending || (mode === 'one' ? !canSubmitOne : !canSubmitGrade)}
          onClick={() => (mode === 'one' ? accreditOne.mutate() : accreditGrade.mutate())}
        >
          {pending
            ? t('common.working')
            : t(mode === 'one' ? 'textbookAdmin.accreditOne' : 'textbookAdmin.accreditGrade')}
        </Button>
      </div>

      {summary ? (
        <p className="text-xs font-medium text-success">
          {t('textbookAdmin.accreditGradeSummary', {
            adopted: summary.adopted,
            already: summary.alreadyAdopted,
          })}
        </p>
      ) : null}
      {failure ? <p className="text-xs text-danger">{failure}</p> : null}
    </div>
  );
}

