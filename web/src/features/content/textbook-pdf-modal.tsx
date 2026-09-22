/**
 * TextbookPdfModal — modal for attaching, managing, and inspecting
 * digital PDF copies of textbooks.
 */

import { useState, useRef, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  Link2,
} from 'lucide-react';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { useI18n } from '../../shared/i18n/i18n';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type ResourceRecord,
} from './content.api';
import { TextbookPdfAttachedList } from './textbook-pdf-attached-list';

export interface TextbookPdfModalProps {
  readonly open: boolean;
  readonly textbook: TextbookSummary | null;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}

export function TextbookPdfModal({
  open,
  textbook,
  onClose,
  onSaved,
}: TextbookPdfModalProps): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [inputMode, setInputMode] = useState<'URL' | 'FILE'>('URL');
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [totalPages, setTotalPages] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileSize, setSelectedFileSize] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<ResourceRecord | null>(null);
  const [identityConfirmation, setIdentityConfirmation] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current resources for this textbook
  const {
    data: resources = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin-textbook-resources', textbook?.key],
    queryFn: () => (textbook ? textbookAdministrationApi.textbookResources(textbook.key) : Promise.resolve([])),
    enabled: open && !!textbook?.key,
  });

  // Identify existing PDF resources
  const pdfResources = resources.filter(
    (r) =>
      r.kind === 'TEXTBOOK_PAGE' ||
      r.url?.toLowerCase().endsWith('.pdf') ||
      r.title.toLowerCase().includes('pdf') ||
      r.title.includes('كتاب') ||
      r.title.includes('نسخة'),
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!textbook) throw new Error('No textbook selected');
      const finalTitle = pdfTitle.trim() || textbook.title;

      if (inputMode === 'FILE') {
        if (!selectedFile) throw new Error('يرجى اختيار ملف PDF');
        const prepared = await textbookAdministrationApi.workspacePrepareUpload({
          file: selectedFile,
          part: textbook.part,
          grade: textbook.gradeKey,
          subject: textbook.subjectKey,
          edition: textbook.edition,
          title: finalTitle,
          autoSegment: true,
          confirmDetectedIdentity: false,
        });
        if (prepared?.status === 'CONFIRM_REQUIRED') {
          return { state: 'CONFIRM_REQUIRED', result: prepared };
        }
        if (prepared?.status === 'NEEDS_REVIEW') {
          throw new Error('تعذر التحقق من هوية الكتاب. راجع بيانات الصف والمادة والجزء والطبعة قبل الاستيراد.');
        }
        await textbookAdministrationApi.workspaceImport({
          workspaceDir: prepared.workspaceDir,
          dryRun: true,
          syncAssets: true,
        });
        await textbookAdministrationApi.workspaceImport({
          workspaceDir: prepared.workspaceDir,
          dryRun: false,
          syncAssets: true,
        });
      } else {
        const finalUrl = pdfUrl.trim();
        if (!finalUrl) throw new Error(t('textbookAdmin.pdfSourceUrlHint'));
        await textbookAdministrationApi.createLearningResource({
          textbookKey: textbook.key,
          kind: 'TEXTBOOK_PAGE',
          title: finalTitle,
          url: finalUrl,
          body: notes.trim() || null,
          orderIndex: 1,
        });
      }

      const pagesNum = parseInt(totalPages, 10);
      if (!Number.isNaN(pagesNum) && pagesNum > 0) {
        await textbookAdministrationApi.updateNode({
          kind: 'textbook',
          key: textbook.key,
          patch: { totalPages: pagesNum },
        });
      }
    },
    onSuccess: async () => {
      if (result?.state === 'CONFIRM_REQUIRED') return;
      setSuccessMsg(t('textbookAdmin.pdfSaveSuccess'));
      setErrorMsg(null);
      setPdfUrl('');
      setPdfTitle('');
      setSelectedFile(null);
      setSelectedFileName(null);
      setSelectedFileSize(null);
      await refetch();
      if (result?.state === 'CONFIRM_REQUIRED') {
        setIdentityConfirmation(result.result);
        setErrorMsg(null);
        setSuccessMsg(null);
        return;
      }
      setIdentityConfirmation(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-textbooks'] });
      onSaved?.();
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : t('catalogue.saveFailed'));
      setSuccessMsg(null);
    },
  });

  const retireMutation = useMutation({
    mutationFn: async (resourceKey: string) => {
      await textbookAdministrationApi.retireResource(resourceKey);
    },
    onSuccess: async () => {
      setRetireTarget(null);
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['admin-textbooks'] });
    },
  });

  if (!open || !textbook) return null;

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setSelectedFileName(file.name);
    const sizeKb = Math.round(file.size / 1024);
    setSelectedFileSize(sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`);
    if (!pdfTitle) {
      setPdfTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    // In a browser environment without a dedicated multipart server route,
    // we generate an object URL or simulate cloud path for instant preview
    const objectUrl = URL.createObjectURL(file);
    setPdfUrl(objectUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  return (
    <>
      <ActionModal
        kind="textbook"
        icon={<FileText className="size-5" />}
        title={t('textbookAdmin.pdfModalTitle')}
        subtitle={`${textbook.title} (${textbook.key})`}
        onClose={onClose}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button
              variant="primary"
              disabled={saveMutation.isPending || (inputMode === 'URL' ? !pdfUrl.trim() : !selectedFile)}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? t('common.working') : t('catalogue.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Notifications */}
          {successMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-subtle p-3 text-xs font-semibold text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs font-semibold text-danger">
              <AlertCircle className="size-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {identityConfirmation && (
            <div className="space-y-3 rounded-xl border border-warning/30 bg-warning-subtle p-4 text-sm">
              <div className="font-semibold text-text">بيانات PDF مختلفة عن الكتاب المحدد</div>
              <div className="text-xs text-text-muted">
                تم التعرف على هوية مختلفة. لن يتم تعديل هوية الكتاب الحالية؛ سيُستخدم الكتاب المكتشف فقط بعد تأكيدك.
              </div>
              <div className="grid gap-2 text-xs">
                {(identityConfirmation.conflicts ?? []).map((item: any) => (
                  <div key={item.field} className="rounded-lg border border-border bg-surface p-2">
                    <span className="font-semibold">{item.field}: </span>
                    <span>{item.declared ?? '—'} → {item.detected ?? '—'}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!selectedFile || !textbook) return;
                    const prepared = await textbookAdministrationApi.workspacePrepareUpload({
                      file: selectedFile,
                      part: textbook.part,
                      grade: textbook.gradeKey,
                      subject: textbook.subjectKey,
                      edition: textbook.edition,
                      title: pdfTitle.trim() || textbook.title,
                      autoSegment: true,
                      confirmDetectedIdentity: true,
                    });
                    if (prepared?.status !== 'PREPARED') throw new Error('تعذر تجهيز الكتاب بعد التأكيد.');
                    await textbookAdministrationApi.workspaceImport({ workspaceDir: prepared.workspaceDir, dryRun: true, syncAssets: true });
                    await textbookAdministrationApi.workspaceImport({ workspaceDir: prepared.workspaceDir, dryRun: false, syncAssets: true });
                    setIdentityConfirmation(null);
                    setSuccessMsg(t('textbookAdmin.pdfSaveSuccess'));
                    await refetch();
                    await queryClient.invalidateQueries({ queryKey: ['admin-textbooks'] });
                    onSaved?.();
                  }}
                >
                  متابعة بالبيانات المكتشفة
                </Button>
                <Button variant="ghost" onClick={() => setIdentityConfirmation(null)}>
                  إلغاء الاستيراد
                </Button>
              </div>
            </div>
          )}

          {/* Current Attached PDFs */}
          <TextbookPdfAttachedList
            textbook={textbook}
            pdfResources={pdfResources}
            isLoading={isLoading}
            onRetire={(res) => setRetireTarget(res)}
          />

          {/* Form to Attach or Replace PDF */}
          <ActionStepCard step={2} title={t('textbookAdmin.pdfAttachNew')}>
            {/* Input Mode Selector */}
            <div className="flex gap-2 rounded-lg bg-surface-subtle p-1 border border-border">
              <button
                type="button"
                onClick={() => setInputMode('URL')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  inputMode === 'URL'
                    ? 'bg-surface text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <Link2 className="size-3.5" />
                <span>{t('textbookAdmin.pdfSourceUrl')}</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('FILE')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  inputMode === 'FILE'
                    ? 'bg-surface text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <UploadCloud className="size-3.5" />
                <span>{t('textbookAdmin.pdfFileUpload')}</span>
              </button>
            </div>

            {inputMode === 'URL' ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text">
                  {t('textbookAdmin.pdfSourceUrl')} <span className="text-danger">*</span>
                </label>
                <Input
                  type="url"
                  dir="ltr"
                  placeholder="https://moe.gov.ye/textbooks/g07-math-t1.pdf"
                  value={pdfUrl}
                  onChange={(e) => setPdfUrl(e.target.value)}
                />
                <p className="text-2xs text-text-muted">{t('textbookAdmin.pdfSourceUrlHint')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded-xl border-2 border-dashed border-border bg-surface p-6 text-center hover:border-accent hover:bg-surface-subtle"
                >
                  <UploadCloud className="mx-auto size-8 text-accent" />
                  <p className="mt-2 text-xs font-medium text-text">
                    {t('textbookAdmin.pdfFileDragDrop')}
                  </p>
                  <p className="text-2xs text-text-muted">PDF (*.pdf)</p>
                  {selectedFileName ? (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-subtle px-3 py-1.5 text-xs font-semibold text-accent">
                      <FileText className="size-4" />
                      <span>{selectedFileName}</span>
                      {selectedFileSize ? <span className="opacity-70">({selectedFileSize})</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Additional Fields: Title & Total Pages */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text">{t('textbookAdmin.pdfTitle')}</label>
                <Input
                  type="text"
                  placeholder="كتاب الطالب — النسخة الرسمية"
                  value={pdfTitle}
                  onChange={(e) => setPdfTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text">
                  {t('textbookAdmin.pdfTotalPages')}
                </label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  placeholder={String(textbook.totalPages || 120)}
                  value={totalPages}
                  onChange={(e) => setTotalPages(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text">{t('catalogue.description')}</label>
              <Textarea
                rows={2}
                placeholder="ملاحظات حول هذه النسخة أو رقم الطبعة..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </ActionStepCard>
        </div>
      </ActionModal>

      {/* Confirmation to remove / retire PDF */}
      {retireTarget && (
        <ConfirmDialog
          title={t('textbookAdmin.pdfRetire')}
          body={t('textbookAdmin.pdfRetireConfirm')}
          confirmLabel={t('catalogue.delete')}
          destructive
          pending={retireMutation.isPending}
          onConfirm={() => {
            if (retireTarget) retireMutation.mutate(retireTarget.key);
          }}
          onCancel={() => setRetireTarget(null)}
        />
      )}
    </>
  );
}
