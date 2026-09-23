import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { TextbookCreateModal } from './textbook-create-modal';
import { TextbookBulkGradeModal } from './textbook-bulk-grade-modal';
import { TextbookAccreditModal } from './textbook-accredit-modal';
import { TextbookEditModal } from './textbook-edit-modal';
import { TextbookOutlineModal } from './textbook-outline-modal';
import { TextbookPdfModal } from './textbook-pdf-modal';
import { ContentImportModal } from './content-import-modal';
import { TextbookWorkspaceModal } from './textbook-workspace-modal';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type PublicationAction,
} from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export interface TextbookModalsState {
  readonly createOpen: boolean;
  readonly setCreateOpen: (open: boolean) => void;
  readonly bulkOpen: boolean;
  readonly setBulkOpen: (open: boolean) => void;
  readonly accreditOpen: boolean;
  readonly setAccreditOpen: (open: boolean) => void;
  readonly workspaceOpen: boolean;
  readonly setWorkspaceOpen: (open: boolean) => void;
  readonly editBook: TextbookSummary | null;
  readonly setEditBook: (book: TextbookSummary | null) => void;
  readonly pdfBook: TextbookSummary | null;
  readonly setPdfBook: (book: TextbookSummary | null) => void;
  readonly outlineBook: TextbookSummary | null;
  readonly setOutlineBook: (book: TextbookSummary | null) => void;
  readonly importBookKey: string | null;
  readonly setImportBookKey: (key: string | null) => void;
  readonly transitionTarget: { book: TextbookSummary; action: PublicationAction } | null;
  readonly setTransitionTarget: (target: { book: TextbookSummary; action: PublicationAction } | null) => void;
}

export function useTextbookAdminModals(): TextbookModalsState {
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [accreditOpen, setAccreditOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [editBook, setEditBook] = useState<TextbookSummary | null>(null);
  const [pdfBook, setPdfBook] = useState<TextbookSummary | null>(null);
  const [outlineBook, setOutlineBook] = useState<TextbookSummary | null>(null);
  const [importBookKey, setImportBookKey] = useState<string | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<{ book: TextbookSummary; action: PublicationAction } | null>(null);

  return {
    createOpen, setCreateOpen,
    bulkOpen, setBulkOpen,
    accreditOpen, setAccreditOpen,
    workspaceOpen, setWorkspaceOpen,
    editBook, setEditBook,
    pdfBook, setPdfBook,
    outlineBook, setOutlineBook,
    importBookKey, setImportBookKey,
    transitionTarget, setTransitionTarget,
  };
}

export function TextbookAdminModals({
  modals,
  selectedPart,
  selectedGradeKey,
}: {
  readonly modals: TextbookModalsState;
  readonly selectedPart: 'PART_1' | 'PART_2';
  readonly selectedGradeKey: string | null;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const transitionMutation = useMutation({
    mutationFn: ({ key, action }: { key: string; action: PublicationAction }) =>
      textbookAdministrationApi.transition(key, action),
    onSuccess: async () => {
      modals.setTransitionTarget(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    },
  });

  return (
    <>
      {modals.transitionTarget ? (
        <ConfirmDialog
          title={t(`textbookAdmin.${modals.transitionTarget.action === 'SUBMIT' ? 'submit' : modals.transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never)}
          body={t('textbookAdmin.confirmTransition', {
            action: t(`textbookAdmin.${modals.transitionTarget.action === 'SUBMIT' ? 'submit' : modals.transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never),
            name: modals.transitionTarget.book.title,
          })}
          confirmLabel={t(`textbookAdmin.${modals.transitionTarget.action === 'SUBMIT' ? 'submit' : modals.transitionTarget.action === 'APPROVE' ? 'approve' : 'archive'}` as never)}
          pending={transitionMutation.isPending}
          destructive={modals.transitionTarget.action === 'ARCHIVE'}
          onConfirm={() => transitionMutation.mutate({ key: modals.transitionTarget!.book.key, action: modals.transitionTarget!.action })}
          onCancel={() => modals.setTransitionTarget(null)}
        />
      ) : null}

      <TextbookWorkspaceModal
        open={modals.workspaceOpen}
        onClose={() => modals.setWorkspaceOpen(false)}
        initialCoordinates={{
          part: selectedPart,
          ...(selectedGradeKey ? { grade: selectedGradeKey } : {}),
        }}
      />
      <TextbookCreateModal
        open={modals.createOpen}
        onClose={() => modals.setCreateOpen(false)}
        initialGradeKey={selectedGradeKey ?? null}
        initialPart={selectedPart}
      />
      <TextbookBulkGradeModal
        open={modals.bulkOpen}
        onClose={() => modals.setBulkOpen(false)}
        initialGradeKey={selectedGradeKey ?? null}
        initialPart={selectedPart}
      />
      <TextbookAccreditModal
        open={modals.accreditOpen}
        onClose={() => modals.setAccreditOpen(false)}
      />
      <TextbookEditModal
        open={modals.editBook !== null}
        textbook={modals.editBook}
        onClose={() => modals.setEditBook(null)}
      />
      <TextbookPdfModal
        open={modals.pdfBook !== null}
        textbook={modals.pdfBook}
        onClose={() => modals.setPdfBook(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all })}
      />
      <TextbookOutlineModal
        open={modals.outlineBook !== null}
        textbook={modals.outlineBook}
        onClose={() => modals.setOutlineBook(null)}
      />
      <ContentImportModal
        open={modals.importBookKey !== null}
        textbookKey={modals.importBookKey}
        onClose={() => modals.setImportBookKey(null)}
      />
    </>
  );
}

export function SummaryCard({
  label,
  value,
  icon,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: ReactNode;
  readonly tone?: 'default' | 'success' | 'warning' | 'info';
}): ReactNode {
  const toneClass = {
    default: 'bg-surface-subtle text-accent',
    success: 'bg-success-subtle text-success',
    warning: 'bg-warning-subtle text-warning',
    info: 'bg-info-subtle text-info',
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-bold uppercase tracking-wide text-text-muted">{label}</span>
        <span className={`grid size-8 place-items-center rounded-xl ${toneClass}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-black text-text">{value}</p>
    </div>
  );
}

export function Metric({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle px-2.5 py-1 text-2xs font-semibold text-text-muted">
      <span>{label}</span>
      <span className="font-black text-text">{value}</span>
    </span>
  );
}

