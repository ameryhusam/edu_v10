import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, CheckCircle2, Database, FolderTree, Sparkles } from 'lucide-react';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { textbookAdministrationApi } from './content.api';
import { TextbookWorkspaceUploadStep } from './textbook-workspace-upload-step';
import { TextbookWorkspaceSliceView } from './textbook-workspace-slice-view';
import { TextbookWorkspaceSyncView } from './textbook-workspace-sync-view';

export interface TextbookWorkspaceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialCoordinates?: { part?: 'PART_1'|'PART_2'|'BOTH'; grade?: string; subject?: string; edition?: string; title?: string };
  readonly onImportSuccess?: (textbookKey: string) => void;
}

type Step = 1 | 2 | 3;

export function TextbookWorkspaceModal({ open, onClose, initialCoordinates, onImportSuccess }: TextbookWorkspaceModalProps): ReactNode {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [grade, setGrade] = useState(initialCoordinates?.grade ?? '');
  const [subject, setSubject] = useState(initialCoordinates?.subject ?? '');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [identity, setIdentity] = useState<any | null>(null);
  const [dryRun, setDryRun] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useQuery({ queryKey: ['admin-workspaces-list'], queryFn: () => textbookAdministrationApi.workspaceList(), enabled: open });
  const inspected = useQuery({ queryKey: ['admin-workspace-inspect', workspace], queryFn: () => workspace ? textbookAdministrationApi.workspaceInspect(workspace) : Promise.resolve(null), enabled: open && Boolean(workspace) });

  const prepare = useMutation({
    mutationFn: async (confirm = false) => {
      if (!file) throw new Error('اختر ملف PDF أولاً.');
      return textbookAdministrationApi.workspacePrepareUpload({
        file,
        part: initialCoordinates?.part === 'PART_1' || initialCoordinates?.part === 'PART_2' ? initialCoordinates.part : undefined,
        grade: grade.trim(),
        subject: subject.trim(),
        edition: initialCoordinates?.edition,
        title: initialCoordinates?.title,
        autoSegment: true,
        confirmDetectedIdentity: confirm,
      });
    },
    onSuccess: data => {
      if (data?.status === 'CONFIRM_REQUIRED') { setIdentity(data); setStep(1); return; }
      if (data?.status === 'NEEDS_REVIEW') {
        const detected = data?.proposal?.identity ?? {};
        const missing = ['subjectKey', 'gradeKey', 'part', 'edition'].filter(key => !detected?.[key]);
        const detail = missing.length ? `البيانات غير المحسومة: ${missing.join('، ')}.` : 'توجد أدلة متعارضة أو غير كافية في المصدر.';
        setError(`لم تكتمل هوية الكتاب، لذلك أوقف المحرك إنشاء Workspace للمراجعة الآلية. ${detail}`);
        setIdentity(data);
        setStep(1);
        return;
      }
      const candidates = [
        ...(data?.workspaceDir ? [{ workspaceDir: data.workspaceDir, part: data?.proposal?.identity?.part }] : []),
        ...((data?.workspaces ?? []).filter((item: any) => item?.workspaceDir)),
      ];
      const unique = Array.from(new Map(candidates.map((item: any) => [item.workspaceDir, item])).values());
      if (unique.length === 0) {
        setError('اكتمل التحليل دون إنتاج Workspace قابلة للمراجعة. أعد المحاولة بعد التأكد من الهوية والفهرس، أو راجع سجل التحليل.');
        return;
      }
      setIdentity(null); setWorkspace(unique[0].workspaceDir); setStep(2); setError(null); void workspaces.refetch();
    },
    onError: e => setError(e instanceof Error ? e.message : 'فشل تجهيز Workspace.'),
  });

  const reconcile = useMutation({
    mutationFn: () => workspace ? textbookAdministrationApi.workspaceReconcile({ workspaceDir: workspace }) : Promise.reject(new Error('لم يتم تحديد Workspace.')),
    onSuccess: () => void inspected.refetch(),
    onError: e => setError(e instanceof Error ? e.message : 'فشل التحقق من Workspace.'),
  });
  const verify = useMutation({
    mutationFn: () => workspace ? textbookAdministrationApi.workspaceImport({ workspaceDir: workspace, dryRun: true, syncAssets: true }) : Promise.reject(new Error('لم يتم تحديد Workspace.')),
    onSuccess: data => { setDryRun(data); setStep(3); setError(null); },
    onError: e => setError(e instanceof Error ? e.message : 'فشل الفحص التجريبي.'),
  });
  const apply = useMutation({
    mutationFn: () => workspace ? textbookAdministrationApi.workspaceImport({ workspaceDir: workspace, dryRun: false, syncAssets: true }) : Promise.reject(new Error('لم يتم تحديد Workspace.')),
    onSuccess: data => { setResult(data); setError(null); void qc.invalidateQueries({ queryKey: ['admin-textbooks'] }); if (data?.textbookKey) onImportSuccess?.(data.textbookKey); },
    onError: e => setError(e instanceof Error ? e.message : 'فشل الاستيراد.'),
  });

  const reset = () => { setStep(1); setFile(null); setWorkspace(null); setIdentity(null); setDryRun(null); setResult(null); setError(null); };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const next = e.target.files?.[0] ?? null; if (next && !next.name.toLowerCase().endsWith('.pdf')) { setError('الملف يجب أن يكون PDF.'); return; } setFile(next); setError(null); };

  if (!open) return null;
  const steps = [
    { n: 1, label: 'المصدر والهوية', icon: <BookOpen className="size-4" /> },
    { n: 2, label: 'Workspace والتقسيم', icon: <FolderTree className="size-4" /> },
    { n: 3, label: 'التحقق والاستيراد', icon: <Database className="size-4" /> },
  ] as const;

  return <ActionModal kind="textbook" icon={<Sparkles className="size-5" />} title="تجهيز الكتاب والمحتوى" subtitle="PDF → تحليل الهوية والفهرس → Workspace → تحقق → استيراد" onClose={onClose}
    footer={<div className="flex w-full items-center justify-between gap-2"><Button variant="ghost" onClick={onClose}>إغلاق</Button><div className="flex gap-2">{step === 2 ? <Button variant="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending || !workspace}>إعادة التحقق</Button> : null}{step === 2 ? <Button variant="primary" onClick={() => verify.mutate()} loading={verify.isPending} disabled={!workspace}>فحص الاستيراد</Button> : null}{step === 3 && !result ? <><Button variant="secondary" onClick={() => setStep(2)}>رجوع</Button><Button variant="primary" onClick={() => apply.mutate()} loading={apply.isPending} disabled={!dryRun}>استيراد نهائي</Button></> : null}{result ? <Button variant="primary" onClick={reset}>تجهيز كتاب آخر</Button> : null}</div></div>}>
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">{steps.map(s => <button key={s.n} type="button" onClick={() => s.n === 1 || workspace ? setStep(s.n) : undefined} disabled={s.n > 1 && !workspace} className={`rounded-xl border p-3 text-start transition ${step === s.n ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface'}`}><div className="flex items-center gap-2 text-xs font-black text-text">{s.icon}<span>{s.label}</span></div><div className="mt-1 text-2xs text-text-muted">{s.n === 1 ? 'اختيار الصف والمادة ورفع PDF' : s.n === 2 ? 'معاينة البنية والصفحات' : 'Dry Run ثم الحفظ'}</div></button>)}</div>
      {error ? <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs font-semibold text-danger"><AlertCircle className="size-4"/>{error}</div> : null}
      {identity ? <section className="rounded-2xl border border-warning/30 bg-warning-subtle p-4"><h3 className="text-sm font-black text-text">تأكيد الهوية المكتشفة</h3><p className="mt-1 text-xs text-text-muted">هناك اختلاف بين ما حددته والهوية التي استخرجها المحرك. اختر المتابعة فقط إذا كانت الهوية المكتشفة صحيحة.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{(identity.conflicts ?? []).map((c: any) => <div key={c.field} className="rounded-xl border border-border bg-surface p-3 text-xs"><b>{c.field}</b><div className="mt-1 text-text-muted">{c.declared ?? '—'} ← {c.detected ?? '—'}</div></div>)}</div><div className="mt-3 flex gap-2"><Button variant="primary" size="sm" loading={prepare.isPending} onClick={() => prepare.mutate(true)}>تأكيد والمتابعة</Button><Button variant="ghost" size="sm" onClick={() => setIdentity(null)}>إلغاء</Button></div></section> : null}
      {step === 1 ? <TextbookWorkspaceUploadStep grade={grade} onGradeChange={setGrade} subject={subject} onSubjectChange={setSubject} selectedFile={file} fileInputRef={fileRef} onFileChange={onFile} isPreparePending={prepare.isPending} onPrepare={() => prepare.mutate(false)} /> : null}
      {step === 2 ? <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Badge tone="info">Workspace جاهزة</Badge>{workspace ? <span className="text-2xs text-text-muted break-all">{workspace}</span> : null}</div><TextbookWorkspaceSliceView isInspecting={inspected.isPending} inspectedWorkspace={inspected.data} segmentPending={reconcile.isPending} onSegment={() => reconcile.mutate()} onBack={() => setStep(1)} onVerifyAndDryRun={() => verify.mutate()} dryRunPending={verify.isPending} /></div> : null}
      {step === 3 ? <TextbookWorkspaceSyncView dryRunResult={dryRun} importResult={result} syncPending={apply.isPending} onSync={() => apply.mutate()} onBack={() => setStep(2)} /> : null}
      {result ? <div className="rounded-2xl border border-success/30 bg-success-subtle p-4"><div className="flex items-center gap-2 text-sm font-black text-success"><CheckCircle2 className="size-5"/>اكتمل الاستيراد</div><p className="mt-1 text-xs text-text-muted">تم تطبيق Workspace عبر المسار القانوني للاستيراد.</p></div> : null}
    </div>
  </ActionModal>;
}
