import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileText, UploadCloud, X } from 'lucide-react';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { Badge } from '../../design-system/ui/badge';
import { textbookAdministrationApi, type ResourceRecord, type TextbookSummary } from './content.api';
import { TextbookPdfAttachedList } from './textbook-pdf-attached-list';

export interface TextbookPdfModalProps {
  readonly open: boolean;
  readonly textbook: TextbookSummary | null;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}

export function TextbookPdfModal({ open, textbook, onClose, onSaved }: TextbookPdfModalProps): ReactNode {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'FILE' | 'URL'>('FILE');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [pages, setPages] = useState('');
  const [notes, setNotes] = useState('');
  const [conflict, setConflict] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [retire, setRetire] = useState<ResourceRecord | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const resources = useQuery({
    queryKey: ['admin-textbook-resources', textbook?.key],
    queryFn: () => textbook ? textbookAdministrationApi.textbookResources(textbook.key) : Promise.resolve([]),
    enabled: open && Boolean(textbook),
  });
  const pdfs = (resources.data ?? []).filter((r) => r.kind === 'TEXTBOOK_PAGE' || r.url?.toLowerCase().endsWith('.pdf'));

  const prepare = async (confirmDetectedIdentity: boolean): Promise<any> => {
    if (!textbook || !file) throw new Error('يرجى اختيار ملف PDF.');
    setUploadProgress(0);
    const result = await textbookAdministrationApi.workspacePrepareUpload({
      file,
      part: textbook.part,
      grade: textbook.gradeKey,
      subject: textbook.subjectKey,
      edition: textbook.edition,
      title: textbook.title,
      autoSegment: true,
      confirmDetectedIdentity,
      onUploadProgress: progress => setUploadProgress(progress.percent),
    });
    if (result?.status === 'CONFIRM_REQUIRED' || result?.status === 'NEEDS_REVIEW') return result;
    if (result?.status !== 'PREPARED') throw new Error('تعذر تجهيز ملف الكتاب.');
    return result;
  };

  const save = useMutation({
    mutationFn: async () => {
      setError(null); setSuccess(null);
      if (!textbook) throw new Error('لم يتم اختيار كتاب.');
      if (mode === 'FILE') {
        const result = await prepare(false);
        if (result?.status === 'CONFIRM_REQUIRED' || result?.status === 'NEEDS_REVIEW') return result;
      } else {
        if (!url.trim()) throw new Error('أدخل رابط PDF صالحاً.');
        await textbookAdministrationApi.createLearningResource({
          textbookKey: textbook.key, kind: 'TEXTBOOK_PAGE',
          title: title.trim() || textbook.title, url: url.trim(), body: notes.trim() || null, orderIndex: 1,
        });
      }
      // PDF preparation is intentionally staged. Canonical metadata/content is not mutated here;
      // the Workspace review → dry-run → explicit final import flow owns the apply step.
      if (mode === 'URL') {
        const pageCount = Number(pages);
        if (Number.isInteger(pageCount) && pageCount > 0) {
          await textbookAdministrationApi.updateNode({ kind: 'textbook', key: textbook.key, patch: { totalPages: pageCount } });
        }
      }
      return null;
    },
    onSuccess: async (result) => {
      if (result?.status === 'CONFIRM_REQUIRED') { setConflict(result); return; }
      if (result?.status === 'NEEDS_REVIEW') {
        const identity = result?.proposal?.identity ?? {};
        const missing = ['subjectKey', 'gradeKey', 'part', 'edition'].filter(key => !identity?.[key]);
        setError(missing.length ? `لم تكتمل هوية الكتاب: ${missing.join('، ')}.` : 'توجد أدلة متعارضة أو غير كافية في المصدر؛ راجع الهوية ثم أعد التجهيز.');
        return;
      }
      setSuccess(mode === 'FILE' ? 'تم تجهيز PDF للمراجعة. لم يتم استيراد المحتوى بعد.' : 'تم حفظ مصدر الكتاب بنجاح.');
      setFile(null); setUrl(''); setTitle(''); setPages(''); setNotes('');
      await resources.refetch(); await queryClient.invalidateQueries({ queryKey: queryKeysCompat() }); onSaved?.();
    },
    onError: (e: unknown) => { setUploadProgress(null); setError(e instanceof Error ? e.message : 'فشل حفظ ملف الكتاب.'); },
  });

  const retireMutation = useMutation({
    mutationFn: (key: string) => textbookAdministrationApi.retireResource(key),
    onSuccess: async () => { setRetire(null); await resources.refetch(); onSaved?.(); },
  });

  if (!open || !textbook) return null;
  const chooseFile = (next: File | null) => {
    if (!next) return;
    if (next.type !== 'application/pdf' && !next.name.toLowerCase().endsWith('.pdf')) { setError('الملف يجب أن يكون PDF.'); return; }
    setFile(next); setError(null); if (!title) setTitle(next.name.replace(/\\.[^/.]+$/, ''));
  };

  return <>
    <ActionModal kind="textbook" icon={<FileText className="size-5" />} title="ملف الكتاب ومصدره"
      subtitle={`${textbook.title} · ${textbook.gradeName} · ${textbook.subjectName}`} onClose={onClose}
      footer={<div className="flex w-full items-center justify-between gap-2"><Button variant="ghost" onClick={onClose}>إغلاق</Button><Button variant="primary" disabled={save.isPending || (mode === 'FILE' ? !file : !url.trim())} loading={save.isPending} onClick={() => save.mutate()}>حفظ وتجهيز</Button></div>}>
      <div className="space-y-5">
        {success ? <Notice tone="success" icon={<CheckCircle2 className="size-4" />}>{success}</Notice> : null}
        {error ? <Notice tone="danger" icon={<AlertCircle className="size-4" />}>{error}</Notice> : null}
        {conflict ? <section className="rounded-2xl border border-warning/30 bg-warning-subtle p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-black text-text">تعارض في هوية الملف</h3><p className="mt-1 text-xs text-text-muted">الملف يحتوي على هوية مختلفة. لن يتم اعتمادها إلا بعد تأكيدك.</p></div><button type="button" onClick={() => setConflict(null)} aria-label="إغلاق"><X className="size-4 text-text-muted"/></button></div>
          <div className="mt-3 space-y-2">{(conflict.conflicts ?? []).map((c: any) => <div key={c.field} className="rounded-xl border border-border bg-surface p-3 text-xs"><span className="font-bold">{c.field}</span><span className="mx-2 text-text-muted">{c.declared ?? '—'} ← {c.detected ?? '—'}</span></div>)}</div>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="primary" size="sm" onClick={async () => { try { const result = await prepare(true); if (result?.status === 'PREPARED') { setConflict(null); setSuccess('تم اعتماد الهوية المكتشفة وتجهيز Workspace.'); await resources.refetch(); onSaved?.(); } } catch (e) { setError(e instanceof Error ? e.message : 'فشل التأكيد.'); } }}>متابعة بالهوية المكتشفة</Button><Button variant="ghost" size="sm" onClick={() => setConflict(null)}>إلغاء</Button></div>
        </section> : null}

        <TextbookPdfAttachedList textbook={textbook} pdfResources={pdfs} isLoading={resources.isPending} onRetire={setRetire} />

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-black text-text">إضافة مصدر</h3><p className="mt-1 text-xs text-text-muted">يمكن رفع PDF ليُحلل ويُجهز في Workspace، أو حفظ رابط مصدر خارجي.</p></div>
          <div className="inline-flex rounded-xl border border-border bg-surface-subtle p-1"><button type="button" onClick={() => setMode('FILE')} className={tab(mode === 'FILE')}>رفع PDF</button><button type="button" onClick={() => setMode('URL')} className={tab(mode === 'URL')}>رابط</button></div></div>
          {mode === 'FILE' ? <div className="mt-4"><input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={e => chooseFile(e.target.files?.[0] ?? null)} /><button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-border bg-surface-subtle/40 p-8 text-center hover:border-accent/50"><UploadCloud className="mx-auto size-8 text-accent"/><p className="mt-2 text-sm font-black text-text">{file ? file.name : 'اختر ملف PDF'}</p><p className="mt-1 text-xs text-text-muted">سيتم استخراج الهوية والفهرس وبنية الصفحات آلياً، مع Gemini عند توفره.</p>{file ? <Badge tone="neutral" className="mt-3">{(file.size / 1048576).toFixed(2)} MB</Badge> : null}</button></div>
          : <div className="mt-4 space-y-3"><label className="block text-xs font-bold text-text">رابط PDF<input value={url} onChange={e => setUrl(e.target.value)} dir="ltr" className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-accent"/></label><p className="text-2xs text-text-muted">المعالجة الآلية الكاملة متاحة عند رفع الملف مباشرة.</p></div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-text">اسم المصدر<Input value={title} onChange={e => setTitle(e.target.value)} placeholder={textbook.title}/></label><label className="text-xs font-bold text-text">عدد الصفحات<Input type="number" min="1" value={pages} onChange={e => setPages(e.target.value)} placeholder={String(textbook.totalPages ?? '')}/></label></div>
          {mode === 'FILE' && save.isPending && uploadProgress !== null ? <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-3" aria-live="polite"><div className="flex items-center justify-between gap-3 text-xs font-bold text-text"><span>{uploadProgress < 100 ? 'رفع PDF إلى المحرك' : 'اكتمل الرفع — جارٍ تجهيز Workspace'}</span><span>{uploadProgress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} /></div>{uploadProgress === 100 ? <p className="mt-2 text-2xs text-text-muted">تم إرسال الملف بالكامل. سيبقى الحفظ مقفلاً حتى يؤكد المحرك اكتمال التجهيز.</p> : null}</div> : null}

          <label className="mt-3 block text-xs font-bold text-text">ملاحظات<Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        </section>
      </div>
    </ActionModal>
    {retire ? <ConfirmDialog title="إزالة مصدر PDF" body="سيتم إخفاء المصدر من قائمة المصادر الحالية دون حذف التاريخ." confirmLabel="إزالة" destructive pending={retireMutation.isPending} onConfirm={() => retireMutation.mutate(retire.key)} onCancel={() => setRetire(null)} /> : null}
  </>;

  function tab(active: boolean): string { return `rounded-lg px-3 py-1.5 text-xs font-bold ${active ? 'bg-surface text-text shadow-xs' : 'text-text-muted hover:text-text'}`; }
}
function Notice({ tone, icon, children }: { readonly tone: 'success' | 'danger'; readonly icon: ReactNode; readonly children: ReactNode }): ReactNode {
  return <div className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${tone === 'success' ? 'border-success/30 bg-success-subtle text-success' : 'border-danger/30 bg-danger-subtle text-danger'}`}>{icon}{children}</div>;
}
function queryKeysCompat(): readonly string[] { return ['admin-textbooks']; }
