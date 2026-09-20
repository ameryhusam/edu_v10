/**
 * TextbookPdfModal — modal for attaching, managing, and inspecting
 * digital PDF copies of textbooks.
 */

import { useState, useRef, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  Link2,
} from 'lucide-react';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { Badge } from '../../design-system/ui/badge';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { useI18n } from '../../shared/i18n/i18n';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type ResourceRecord,
} from './content.api';

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
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileSize, setSelectedFileSize] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<ResourceRecord | null>(null);
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
      const finalUrl = pdfUrl.trim();
      const finalTitle = pdfTitle.trim() || t('textbookAdmin.pdfCurrentAttached');
      if (!finalUrl) {
        throw new Error(t('textbookAdmin.pdfSourceUrlHint'));
      }

      // 1. Create or attach learning resource as TEXTBOOK_PAGE
      await textbookAdministrationApi.createLearningResource({
        textbookKey: textbook.key,
        kind: 'TEXTBOOK_PAGE',
        title: finalTitle,
        url: finalUrl,
        body: notes.trim() || null,
        orderIndex: 1,
      });

      // 2. If total pages is provided, update textbook metadata
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
      setSuccessMsg(t('textbookAdmin.pdfSaveSuccess'));
      setErrorMsg(null);
      setPdfUrl('');
      setPdfTitle('');
      setSelectedFileName(null);
      setSelectedFileSize(null);
      await refetch();
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
              disabled={saveMutation.isPending || !pdfUrl.trim()}
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

          {/* Current Attached PDFs */}
          <ActionStepCard step={1} title={t('textbookAdmin.pdfCurrentAttached')}>
            {isLoading ? (
              <div className="py-4 text-center text-xs text-text-muted">{t('common.working')}</div>
            ) : pdfResources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center">
                <FileText className="mx-auto size-8 text-text-muted/40" />
                <p className="mt-2 text-xs text-text-muted">{t('textbookAdmin.pdfNoneAttached')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pdfResources.map((res) => (
                  <div
                    key={res.key}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent">
                        <FileText className="size-5" />
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-xs font-bold text-text">{res.title}</h4>
                          <Badge tone="neutral">PDF</Badge>
                          {textbook.totalPages ? (
                            <Badge tone="accent">{`${textbook.totalPages} ${t('textbookAdmin.totalPages')}`}</Badge>
                          ) : null}
                        </div>
                        {res.url ? (
                          <p className="truncate text-2xs text-text-muted" dir="ltr">
                            {res.url}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {res.url ? (
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-subtle"
                        >
                          <ExternalLink className="size-3.5" />
                          <span>{t('textbookAdmin.pdfOpen')}</span>
                        </a>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => setRetireTarget(res)}
                        aria-label={t('textbookAdmin.pdfRetire')}
                        className="text-danger hover:bg-danger-subtle"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ActionStepCard>

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
