import { type ReactNode, type ChangeEvent, type RefObject } from 'react';
import { BookOpen, FileUp, Sparkles } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';

export interface TextbookWorkspaceUploadStepProps {
  readonly selectedFile: File | null;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly isPreparePending: boolean;
  readonly uploadProgress: number | null;
  readonly onPrepare: () => void;
}

export function TextbookWorkspaceUploadStep({
  selectedFile,
  fileInputRef,
  onFileChange,
  isPreparePending,
  uploadProgress,
  onPrepare,
}: TextbookWorkspaceUploadStepProps): ReactNode {
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

        <div className="mt-5 rounded-xl border border-border bg-surface p-3 text-xs leading-5 text-text-muted">
          لا تحتاج إلى إدخال اسم الكتاب أو الصف أو المادة أو الجزء أو الطبعة أو عدد الصفحات. ارفع ملف PDF فقط؛ سيحاول محرك المحتوى اكتشاف هوية الكتاب وبنيته، ثم يعرض أي تعارض يحتاج إلى مراجعة قبل الاستيراد.
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
        {isPreparePending && uploadProgress !== null ? (
          <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-3 text-start" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs font-bold text-text">
              <span>{uploadProgress < 100 ? 'رفع الملف إلى المحرك' : 'اكتمل رفع الملف — جارٍ تجهيز الكتاب'}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
            </div>
            {uploadProgress === 100 ? <p className="mt-2 text-2xs text-text-muted">تم إرسال ملف PDF بالكامل. انتظر تأكيد المحرك قبل الانتقال إلى Workspace.</p> : null}
          </div>
        ) : null}

        <Button
          type="button"
          variant="primary"
          disabled={!selectedFile || isPreparePending}
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
