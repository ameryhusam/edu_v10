/**
 * TextbookWorkspaceModal — Unified Workspace Slicing, Inspection, and Syncing Modal
 *
 * Implements the unified book addition and segmentation workflow:
 * 1. Uploads the book PDF to the backend; the Python content engine prepares the lesson-only workspace
 * 2. Automated slicing into logical Units and canonical Lesson PDFs with manifests
 * 3. Inspects and previews extraction outputs and structure
 * 4. Executes Dry-Run verification & conflict detection
 * 5. Synchronizes and saves extraction results into PostgreSQL via ContentImportService
 */

import { useState, useRef, type ReactNode, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  UploadCloud,
  FileText,
  FolderTree,
  CheckCircle2,
  AlertCircle,
  Play,
  Layers,
  Database,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { textbookAdministrationApi } from './content.api';

export interface TextbookWorkspaceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialCoordinates?: {
    part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;
    grade?: string | undefined;
    subject?: string | undefined;
    edition?: string | undefined;
    title?: string | undefined;
  } | undefined;
  readonly onImportSuccess?: (textbookKey: string) => void;
}

export function TextbookWorkspaceModal({
  open,
  onClose,
  initialCoordinates,
  onImportSuccess,
}: TextbookWorkspaceModalProps): ReactNode {
  const queryClient = useQueryClient();

  // Wizard Step: 1 = Setup/Upload, 2 = Slicing/Structure, 3 = Dry-Run & Sync
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form coordinates
  const [part, setPart] = useState<'PART_1' | 'PART_2' | 'BOTH'>(initialCoordinates?.part || 'PART_1');
  const [grade, setGrade] = useState(initialCoordinates?.grade || 'G07');
  const [subject, setSubject] = useState(initialCoordinates?.subject || 'MATH');
  const [edition, setEdition] = useState(initialCoordinates?.edition || '');
  const [title, setTitle] = useState(initialCoordinates?.title || '');

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active Workspace Selection
  const [selectedWorkspaceDir, setSelectedWorkspaceDir] = useState<string | null>(null);

  // Execution & Feedback States
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);

  // Query: Existing Workspaces
  const { data: workspacesList = [], refetch: refetchWorkspaces } = useQuery({
    queryKey: ['admin-workspaces-list'],
    queryFn: () => textbookAdministrationApi.workspaceList(),
    enabled: open,
  });

  // Query: Inspect Active Workspace
  const { data: inspectedWorkspace, isLoading: isInspecting, refetch: refetchInspect } = useQuery({
    queryKey: ['admin-workspace-inspect', selectedWorkspaceDir],
    queryFn: () => (selectedWorkspaceDir ? textbookAdministrationApi.workspaceInspect(selectedWorkspaceDir) : Promise.resolve(null)),
    enabled: open && !!selectedWorkspaceDir,
  });

  // Handle File Selection
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setActionError('يرجى اختيار ملف PDF صالح لكتاب المنهج');
      return;
    }
    setSelectedFile(file);
    setActionError(null);


  };

  // Mutation: Prepare & Segment Workspace
  const prepareMutation = useMutation({
    mutationFn: async () => {
      setActionError(null);
      setActionSuccess(null);
      const payload: {
        part: 'PART_1' | 'PART_2' | 'BOTH';
        grade: string;
        subject: string;
        edition?: string;
        title?: string;
        autoSegment?: boolean;
      } = {
        part,
        grade: grade.trim(),
        subject: subject.trim(),
        edition: edition.trim() || undefined,
        title: title.trim() || `كتاب ${subject.trim()}`,
        autoSegment: true,
      };
      if (!selectedFile) throw new Error('يرجى اختيار ملف PDF للكتاب');
      const res = await textbookAdministrationApi.workspacePrepareUpload({
        file: selectedFile,
        part: payload.part,
        grade: payload.grade,
        subject: payload.subject,
        edition: payload.edition,
        title: payload.title,
        autoSegment: payload.autoSegment,
      });
      return res;
    },
    onSuccess: (data: any) => {
      setSelectedWorkspaceDir(data.workspaceDir);
      setActionSuccess('تم تجهيز الكتاب عبر محرك المحتوى وحفظ شرائح الدروس المعيارية بنجاح!');
      refetchWorkspaces();
      setCurrentStep(2);
    },
    onError: (err: any) => {
      setActionError(err?.message || 'فشل تجهيز مساحة العمل للكتاب');
    },
  });

  // Mutation: Re-Segment Workspace
  const segmentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkspaceDir) throw new Error('يرجى اختيار مساحة عمل أولاً');
      return textbookAdministrationApi.workspaceReconcile({
        workspaceDir: selectedWorkspaceDir,
      });
    },
    onSuccess: () => {
      setActionSuccess('تم التحقق من مساحة العمل والأصول والتقسيم الموجود بنجاح.');
      refetchInspect();
    },
    onError: (err: any) => {
      setActionError(err?.message || 'فشل تحديث التقطيع');
    },
  });

  // Mutation: Dry-Run Verification
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkspaceDir) throw new Error('لم يتم تحديد مساحة العمل');
      return textbookAdministrationApi.workspaceImport({
        workspaceDir: selectedWorkspaceDir,
        dryRun: true,
        syncAssets: true,
      });
    },
    onSuccess: (data: any) => {
      setDryRunResult(data);
      setActionSuccess('تم اجتياز الفحص التجريبي بنجاح! البيانات جاهزة للحفظ في قاعدة البيانات.');
      setCurrentStep(3);
    },
    onError: (err: any) => {
      setActionError(err?.message || 'فشل الفحص التجريبي للاستيراد');
    },
  });

  // Mutation: Synchronize to Database
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkspaceDir) throw new Error('لم يتم تحديد مساحة العمل');
      return textbookAdministrationApi.workspaceImport({
        workspaceDir: selectedWorkspaceDir,
        dryRun: false,
        syncAssets: true,
      });
    },
    onSuccess: (data: any) => {
      setImportResult(data);
      setActionSuccess('تمت مزامنة وحفظ محتويات الكتاب وأصوله بنجاح في قاعدة البيانات!');
      queryClient.invalidateQueries({ queryKey: ['admin-textbooks'] });
      if (onImportSuccess && data.textbookKey) {
        onImportSuccess(data.textbookKey);
      }
    },
    onError: (err: any) => {
      setActionError(err?.message || 'فشلت المزامنة مع قاعدة البيانات');
    },
  });

  if (!open) return null;

  const manifest = inspectedWorkspace?.indexManifest;

  return (
    <ActionModal
      kind="textbook"
      icon={<BookOpen />}
      onClose={onClose}
      title="إدارة وتجزيئ كتب المنهج عبر مساحة العمل (Workspace)"
      subtitle="رفع الكتاب الرقمي، التقطيع الآلي للوحدات والدروس، ومعاينة النواتج قبل الحفظ في قاعدة البيانات"
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-border/60 pb-2 gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
              currentStep === 1
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>1. إحداثيات ومصدر الكتاب</span>
          </button>
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            disabled={!selectedWorkspaceDir && workspacesList.length === 0}
            className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
              currentStep === 2
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
            }`}
          >
            <FolderTree className="w-4 h-4" />
            <span>2. التقطيع والمعاينة الهيكلية</span>
          </button>
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            disabled={!selectedWorkspaceDir}
            className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
              currentStep === 3
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>3. المزامنة وقاعدة البيانات</span>
          </button>
        </div>

        {/* Feedback Alerts */}
        {actionError && (
          <div className="p-3 bg-danger-subtle border border-danger/20 text-danger text-sm rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
        {actionSuccess && (
          <div className="p-3 bg-success-subtle border border-success/20 text-success text-sm rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* STEP 1: Coordinates & PDF Upload / Workspace Select */}
        {currentStep === 1 && (
          <div className="space-y-5">
            {/* Quick Workspace Selection if available */}
            {workspacesList.length > 0 && (
              <div className="p-4 bg-surface-subtle border border-border/60 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <FolderTree className="w-4 h-4 text-accent" />
                    <span>مساحات العمل الموجودة مسبقاً على الخادم:</span>
                  </h4>
                  <Button variant="ghost" size="sm" onClick={() => refetchWorkspaces()}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    <span>تحديث</span>
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                  {workspacesList.map((ws: any) => (
                    <button
                      key={ws.workspaceDir}
                      type="button"
                      onClick={() => {
                        setSelectedWorkspaceDir(ws.workspaceDir);
                        setPart(ws.manifest?.part || 'PART_1');
                        setGrade(ws.manifest?.grade || 'G07');
                        setSubject(ws.manifest?.subject || 'MATH');
                        setEdition(ws.manifest?.edition || '');
                        setTitle(ws.manifest?.title || '');
                        setCurrentStep(2);
                      }}
                      className={`text-right p-2.5 rounded-lg border text-xs transition-all flex flex-col gap-1 ${
                        selectedWorkspaceDir === ws.workspaceDir
                          ? 'border-accent bg-surface-raised text-text font-medium shadow-sm'
                          : 'border-border/60 hover:bg-surface text-text-muted'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-text">
                        <span>{ws.manifest?.title || ws.relativePath}</span>
                        <Badge tone="accent">
                          {ws.manifest?.workspaceId || ws.manifest?.part}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-text-muted">
                        <span>الوحدات: {ws.manifest?.counts?.units ?? 0}</span>
                        <span>الدروس: {ws.manifest?.counts?.lessons ?? 0}</span>
                        <span>الأصول: {ws.manifest?.counts?.assets ?? 0}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Coordinates Form */}
            <div className="p-4 border border-border/60 rounded-xl space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-accent" />
                <span>إحداثيات الكتاب الأكاديمية (Coordinates)</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted">الجزء الفيزيائي (Part)</label>
                  <Input
                    value={part}
                    onChange={(e) => setPart(e.target.value.toUpperCase() as 'PART_1' | 'PART_2' | 'BOTH')}
                    placeholder="PART_1"
                    className="h-9 text-xs uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted">الصف (Grade)</label>
                  <Input
                    value={grade}
                    onChange={(e) => setGrade(e.target.value.toUpperCase())}
                    placeholder="G07"
                    className="h-9 text-xs uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted">المادة (Subject)</label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value.toUpperCase())}
                    placeholder="MATH"
                    className="h-9 text-xs uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted">الطبعة المطبوعة (Edition)</label>
                  <Input
                    value={edition}
                    onChange={(e) => setEdition(e.target.value)}
                    placeholder="يُستخرج من الغلاف تلقائياً"
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted">عنوان الكتاب الكامل</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="كتاب الرياضيات - الصف السابع - الجزء الأول"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* PDF File Upload Zone */}
            <div className="p-5 border-2 border-dashed border-border/80 hover:border-accent rounded-xl text-center space-y-3 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-full bg-surface-subtle text-accent flex items-center justify-center mx-auto">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <h5 className="text-sm font-semibold text-text">
                  {selectedFile ? selectedFile.name : 'رفع ملف PDF للكتاب المدرسي'}
                </h5>
                <p className="text-xs text-text-muted mt-1">
                  {selectedFile
                    ? `الحجم: ${(selectedFile.size / (1024 * 1024)).toFixed(2)} ميجابايت`
                    : 'سيُرسل الكتاب إلى الخادم مؤقتاً ثم يعالجه محرك المحتوى؛ الحفظ الدائم يكون لملفات الدروس فقط'}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFile ? 'تغيير الملف' : 'اختيار ملف PDF'}
              </Button>
            </div>

            {/* Prepare Button */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => prepareMutation.mutate()}
                disabled={prepareMutation.isPending || !subject || !grade || !part}
                className="gap-2"
              >
                {prepareMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                <span>تجهيز وتقطيع مساحة العمل (Prepare & Slice)</span>
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Slicing Structure & Assets Preview */}
        {currentStep === 2 && (
          <div className="space-y-4">
            {isInspecting ? (
              <div className="p-8 text-center text-text-muted flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-accent" />
                <span>جاري قراءة وتحليل مساحة العمل...</span>
              </div>
            ) : manifest ? (
              <div className="space-y-4">
                {/* Stats Header */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-surface-subtle border rounded-xl text-center">
                    <span className="text-xs text-text-muted block">الوحدات</span>
                    <span className="text-xl font-bold text-text">{manifest.counts?.units ?? 0}</span>
                  </div>
                  <div className="p-3 bg-surface-subtle border rounded-xl text-center">
                    <span className="text-xs text-text-muted block">الدروس</span>
                    <span className="text-xl font-bold text-text">{manifest.counts?.lessons ?? 0}</span>
                  </div>
                  <div className="p-3 bg-surface-subtle border rounded-xl text-center">
                    <span className="text-xs text-text-muted block">الأصول الرقمية</span>
                    <span className="text-xl font-bold text-text">{manifest.counts?.assets ?? inspectedWorkspace?.assets?.length ?? 0}</span>
                  </div>
                  <div className="p-3 bg-surface-subtle border rounded-xl text-center">
                    <span className="text-xs text-text-muted block">حالة الحزمة</span>
                    <Badge tone={inspectedWorkspace?.contentPackage ? 'success' : 'neutral'} className="mt-1">
                      {inspectedWorkspace?.contentPackage ? 'جاهزة للاستيراد' : 'غير مكتملة'}
                    </Badge>
                  </div>
                </div>

                {/* Sliced Units & Lessons Tree */}
                <div className="border border-border/60 rounded-xl overflow-hidden">
                  <div className="p-3 bg-surface-subtle border-b font-semibold text-xs flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FolderTree className="w-4 h-4 text-accent" />
                      <span>الهيكل والشرائح المستخرجة (Units & Lessons Slices)</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => segmentMutation.mutate()}
                      disabled={segmentMutation.isPending}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 mr-1 ${segmentMutation.isPending ? 'animate-spin' : ''}`} />
                      <span>التحقق من التقطيع</span>
                    </Button>
                  </div>

                  <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
                    {manifest.units?.map((u: any) => (
                      <div key={u.slug} className="p-2.5 bg-surface-raised border border-border/60 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-accent" />
                            <span>الوحدة {u.unitNumber}: {u.name || u.slug}</span>
                          </span>
                          <span className="text-[11px] text-text-muted font-mono">
                            {u.pdf}
                          </span>
                        </div>

                        {/* Lessons */}
                        <div className="pr-4 space-y-1.5 border-r-2 border-accent/20 mr-1.5">
                          {u.lessons?.map((l: any) => (
                            <div
                              key={l.slug}
                              className="flex items-center justify-between text-xs p-1.5 bg-surface-subtle rounded border border-border/40"
                            >
                              <span className="flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-text-muted" />
                                <span>الدرس {l.lessonNumber}: {l.name || l.slug}</span>
                              </span>
                              <span className="text-[10px] text-text-muted font-mono">
                                {l.pdf}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Next Step Actions */}
                <div className="flex justify-between items-center pt-2">
                  <Button variant="secondary" size="sm" onClick={() => setCurrentStep(1)}>
                    <span>السابق</span>
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => dryRunMutation.mutate()}
                    disabled={dryRunMutation.isPending}
                    className="gap-2"
                  >
                    {dryRunMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    <span>بدء الفحص التجريبي والمزامنة (Verify & Dry-Run)</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-text-muted">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-warning" />
                <p className="text-sm">لم يتم العثور على ملف index.json في مساحة العمل المحددة.</p>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Dry-Run Verification & Final Database Sync */}
        {currentStep === 3 && (
          <div className="space-y-4">
            {/* Dry Run Outcome Summary */}
            {dryRunResult && (
              <div className="p-4 bg-success-subtle/30 border border-success/20 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-success flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تقرير الفحص التجريبي للمزامنة (Dry-Run Verification)</span>
                  </h4>
                  <Badge tone="neutral">
                    الكتاب: {dryRunResult.textbookKey}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 bg-surface-raised rounded border text-center">
                    <span className="text-text-muted block text-[10px]">العناصر الجديدة</span>
                    <span className="text-base font-bold text-success">{dryRunResult.importSummary?.created?.length ?? 0}</span>
                  </div>
                  <div className="p-2 bg-surface-raised rounded border text-center">
                    <span className="text-text-muted block text-[10px]">العناصر المطابقة</span>
                    <span className="text-base font-bold text-text">{dryRunResult.importSummary?.identical?.length ?? 0}</span>
                  </div>
                  <div className="p-2 bg-surface-raised rounded border text-center">
                    <span className="text-text-muted block text-[10px]">الأصول الموثقة</span>
                    <span className="text-base font-bold text-accent">{dryRunResult.assetsVerified ?? 0}</span>
                  </div>
                  <div className="p-2 bg-surface-raised rounded border text-center">
                    <span className="text-text-muted block text-[10px]">التعارضات</span>
                    <span className="text-base font-bold text-warning">{dryRunResult.importSummary?.conflicts?.length ?? 0}</span>
                  </div>
                </div>

                {dryRunResult.missingAssets && dryRunResult.missingAssets.length > 0 && (
                  <div className="p-2 bg-warning-subtle text-warning text-xs rounded">
                    تنبيه: يوجد {dryRunResult.missingAssets.length} ملف أصل غير مكتمل في مساحة العمل.
                  </div>
                )}
              </div>
            )}

            {/* Final Sync Confirmation */}
            <div className="p-5 border border-border/60 rounded-xl text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-surface-subtle text-accent flex items-center justify-center mx-auto">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-text">حفظ ومزامنة محتويات الكتاب في قاعدة البيانات</h4>
                <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
                  سيتم إنشاء وتحديث سجلات الكتاب، الوحدات، الدروس، المفاهيم، الأسئلة، وملفات الأصول بصورة آمنة وغير قابلة لفقدان البيانات السابقة.
                </p>
              </div>

              <div className="pt-2 flex justify-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setCurrentStep(2)}>
                  <span>رجوع للمعاينة</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || !!importResult}
                  className="gap-2"
                >
                  {syncMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {importResult ? 'تم الحفظ والمزامنة بنجاح' : 'تأكيد الحفظ النهائي في قاعدة البيانات'}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ActionModal>
  );
}
