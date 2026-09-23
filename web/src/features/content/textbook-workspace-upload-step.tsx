import { type ReactNode, type ChangeEvent, type RefObject } from 'react';
import { BookOpen, FileUp, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { administrationApi } from '../administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export interface TextbookWorkspaceUploadStepProps {
  readonly grade: string;
  readonly onGradeChange: (value: string) => void;
  readonly subject: string;
  readonly onSubjectChange: (value: string) => void;
  readonly selectedFile: File | null;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly isPreparePending: boolean;
  readonly onPrepare: () => void;
}

export function TextbookWorkspaceUploadStep({
  grade,
  onGradeChange,
  subject,
  onSubjectChange,
  selectedFile,
  fileInputRef,
  onFileChange,
  isPreparePending,
  onPrepare,
}: TextbookWorkspaceUploadStepProps): ReactNode {
  const { t } = useI18n();
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const subjects = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });

  const activeGrades = (grades.data ?? []).filter((item) => item.isActive);
  const activeSubjects = (subjects.data ?? []).filter((item) => item.isActive);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface-subtle/35 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent">
            <BookOpen className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-black text-text">اختيار موقع الكتاب</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              اختر الصف والمادة فقط. لا تختار الجزء أو الفصل الدراسي أو الطبعة؛ محرك المحتوى يستخرج هذه الهوية من ملف PDF.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-text">{t('catalogue.tab.grades')}</span>
            <select
              value={grade}
              onChange={(event) => onGradeChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-accent"
            >
              <option value="">اختر الصف</option>
              {activeGrades.map((item) => (
                <option key={item.key} value={item.key}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-text">{t('catalogue.tab.subjects')}</span>
            <select
              value={subject}
              onChange={(event) => onSubjectChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-accent"
            >
              <option value="">اختر المادة</option>
              {activeSubjects.map((item) => (
                <option key={item.key} value={item.key}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center transition hover:border-accent/50">
        <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onFileChange} className="hidden" />
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-subtle text-accent">
          <FileUp className="size-7" />
        </span>
        <h3 className="mt-3 text-sm font-black text-text">
          {selectedFile ? selectedFile.name : 'رفع ملف PDF للكتاب المدرسي'}
        </h3>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-text-muted">
          بعد الرفع سيحلل المحرك الغلاف والفهرس وبنية الصفحات، ويستعين بـ Gemini عند الحاجة لاستخراج الهوية والفهرس وتجهيز المحتوى وفق خوارزمية Workspace.
        </p>
        {selectedFile ? (
          <div className="mt-3 flex justify-center">
            <Badge tone="neutral">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</Badge>
          </div>
        ) : null}
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>
          {selectedFile ? 'تغيير ملف PDF' : 'اختيار ملف PDF'}
        </Button>
      </section>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          disabled={!selectedFile || !grade || !subject || isPreparePending}
          loading={isPreparePending}
          onClick={onPrepare}
          className="gap-2"
        >
          <Sparkles className="size-4" />
          تحليل الكتاب وتجهيز Workspace
        </Button>
      </div>
    </div>
  );
}
