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
  FolderTree,
  CheckCircle2,
  AlertCircle,
  Database,
} from 'lucide-react';
import { ActionModal } from '../../design-system/patterns/action-modal';
import { textbookAdministrationApi } from './content.api';
import { TextbookWorkspaceUploadStep } from './textbook-workspace-upload-step';
import { TextbookWorkspaceSliceView } from './textbook-workspace-slice-view';
import { TextbookWorkspaceSyncView } from './textbook-workspace-sync-view';

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
      if (!selectedFile) throw new Error('يرجى اختيار ملف PDF للكتاب');
      const validPart: 'PART_1' | 'PART_2' = part === 'BOTH' ? 'PART_1' : part;
      const res = await textbookAdministrationApi.workspacePrepareUpload({
        file: selectedFile,
        part: validPart,
        grade: grade.trim(),
        subject: subject.trim(),
        edition: edition.trim() ? edition.trim() : undefined,
        title: title.trim() ? title.trim() : `كتاب ${subject.trim()}`,
        autoSegment: true,
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
          <TextbookWorkspaceUploadStep
            workspacesList={workspacesList}
            refetchWorkspaces={refetchWorkspaces}
            selectedWorkspaceDir={selectedWorkspaceDir}
            onSelectWorkspace={(ws) => {
              setSelectedWorkspaceDir(ws.workspaceDir);
              setPart(ws.manifest?.part || 'PART_1');
              setGrade(ws.manifest?.grade || 'G07');
              setSubject(ws.manifest?.subject || 'MATH');
              setEdition(ws.manifest?.edition || '');
              setTitle(ws.manifest?.title || '');
              setCurrentStep(2);
            }}
            part={part}
            onPartChange={setPart}
            grade={grade}
            onGradeChange={setGrade}
            subject={subject}
            onSubjectChange={setSubject}
            edition={edition}
            onEditionChange={setEdition}
            title={title}
            onTitleChange={setTitle}
            selectedFile={selectedFile}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            isPreparePending={prepareMutation.isPending}
            onPrepare={() => prepareMutation.mutate()}
          />
        )}

        {/* STEP 2: Slicing Structure & Assets Preview */}
        {currentStep === 2 && (
          <TextbookWorkspaceSliceView
            isInspecting={isInspecting}
            inspectedWorkspace={inspectedWorkspace}
            segmentPending={segmentMutation.isPending}
            onSegment={() => segmentMutation.mutate()}
            onBack={() => setCurrentStep(1)}
            onVerifyAndDryRun={() => dryRunMutation.mutate()}
            dryRunPending={dryRunMutation.isPending}
          />
        )}

        {/* STEP 3: Dry-Run Verification & Final Database Sync */}
        {currentStep === 3 && (
          <TextbookWorkspaceSyncView
            dryRunResult={dryRunResult}
            importResult={importResult}
            syncPending={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            onBack={() => setCurrentStep(2)}
          />
        )}
      </div>
    </ActionModal>
  );
}
