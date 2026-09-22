import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState } from '../../design-system/patterns/data-states';
import { TextbookCreateModal } from '../../features/content/textbook-create-modal';
import { TextbookBulkGradeModal } from '../../features/content/textbook-bulk-grade-modal';
import { TextbookAccreditModal } from '../../features/content/textbook-accredit-modal';
import { TextbookEditModal } from '../../features/content/textbook-edit-modal';
import { TextbookOutlineModal } from '../../features/content/textbook-outline-modal';
import { TextbookPdfModal } from '../../features/content/textbook-pdf-modal';
import { ContentImportModal } from '../../features/content/content-import-modal';
import { TextbookWorkspaceModal } from '../../features/content/textbook-workspace-modal';
import { GradesActiveView } from '../../features/content/grades-active-view';
import { GradeMaterialsView } from '../../features/content/grade-materials-view';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type TextbookAdminSummary,
  type PublicationStatus,
  type PublicationAction,
} from '../../features/content/content.api';
import {
  administrationApi,
  type GradeRecord,
} from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';

function getAutoActiveTermOrdinal(): 1 | 2 {
  const currentMonth = new Date().getMonth() + 1;
  return currentMonth >= 2 && currentMonth <= 6 ? 2 : 1;
}

export function TextbooksAdminPage(): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedPartOrdinal, setSelectedPartOrdinal] = useState<1 | 2>(1);
  const [selectedGradeKey, setSelectedGradeKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PublicationStatus | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [accreditModalOpen, setAccreditModalOpen] = useState(false);
  const [pdfModalTextbook, setPdfModalTextbook] = useState<TextbookSummary | null>(null);
  const [importModalTextbookKey, setImportModalTextbookKey] = useState<string | null>(null);
  const [outlineModalTextbook, setOutlineModalTextbook] = useState<TextbookSummary | null>(null);
  const [editModalTextbook, setEditModalTextbook] = useState<TextbookSummary | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);

  const gradesQuery = useQuery({ queryKey: queryKeys.administration.catalogue('grades'), queryFn: () => administrationApi.grades.list() });
  const subjectsQuery = useQuery({ queryKey: queryKeys.administration.catalogue('subjects'), queryFn: () => administrationApi.subjects.list() });
  const textbooksQuery = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: statusFilter ?? 'ALL', limit: 100 }),
    queryFn: () => textbookAdministrationApi.textbooks({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ textbookKey, action }: { textbookKey: string; action: PublicationAction }) =>
      textbookAdministrationApi.transition(textbookKey, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    },
  });

  const grades = gradesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const textbooks = textbooksQuery.data?.rows ?? [];
  const selectedGrade = useMemo(
    () => (selectedGradeKey ? grades.find((g: GradeRecord) => g.key === selectedGradeKey) ?? null : null),
    [grades, selectedGradeKey],
  );

  if (gradesQuery.isLoading || subjectsQuery.isLoading || textbooksQuery.isLoading) return <LoadingState />;
  if (gradesQuery.isError || subjectsQuery.isError || textbooksQuery.isError) {
    return <ErrorState error={gradesQuery.error || termsQuery.error || subjectsQuery.error || textbooksQuery.error || new Error('Failed to load textbook administration data')} />;
  }

  const activePart = selectedPartOrdinal === 1 ? 'PART_1' : 'PART_2';
  const commonViewProps = {
    statusFilter,
    onSelectStatus: setStatusFilter,
  };

  return (
    <div className="space-y-6">
      {!selectedGrade ? (
        <GradesActiveView
          {...commonViewProps}
          grades={grades}
          textbooks={textbooks}
          selectedPartOrdinal={selectedPartOrdinal}
          onSelectPartOrdinal={setSelectedPartOrdinal}
          onSelectGrade={setSelectedGradeKey}
          onOpenCreateModal={() => setCreateModalOpen(true)}
          onOpenBulkModal={() => setBulkModalOpen(true)}
          onOpenAccreditModal={() => setAccreditModalOpen(true)}
          onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
        />
      ) : (
        <GradeMaterialsView
          grade={selectedGrade}
          subjects={subjects}
          textbooks={textbooks}
          selectedPartOrdinal={selectedPartOrdinal}
          onSelectPartOrdinal={setSelectedPartOrdinal}
          onBackToGrades={() => setSelectedGradeKey(null)}
          onTransitionTextbook={async (tb, action) => {
            await transitionMutation.mutateAsync({ textbookKey: tb.key, action });
          }}
          onOpenPdfModal={setPdfModalTextbook}
          onOpenImportModal={setImportModalTextbookKey}
          onOpenOutlineModal={setOutlineModalTextbook}
          onOpenEditModal={setEditModalTextbook}
          onOpenCreateModal={() => setCreateModalOpen(true)}
          onOpenBulkModal={() => setBulkModalOpen(true)}
          onNavigateToContentManager={(key: string) => navigate(`/admin/content?textbook=${encodeURIComponent(key)}`)}
        />
      )}

      <TextbookWorkspaceModal
        open={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        initialCoordinates={{
          grade: selectedGradeKey || undefined,
          part: activePart,
        }}
      />
      <TextbookPdfModal open={!!pdfModalTextbook} textbook={pdfModalTextbook} onClose={() => setPdfModalTextbook(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all })} />
      <ContentImportModal open={!!importModalTextbookKey} textbookKey={importModalTextbookKey} onClose={() => setImportModalTextbookKey(null)} />
      <TextbookOutlineModal open={!!outlineModalTextbook} textbook={outlineModalTextbook} onClose={() => setOutlineModalTextbook(null)} />
      <TextbookEditModal open={!!editModalTextbook} textbook={editModalTextbook as TextbookAdminSummary | null} onClose={() => setEditModalTextbook(null)} />
      <TextbookCreateModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} initialGradeKey={selectedGradeKey || undefined} initialPart={activePart} />
      <TextbookBulkGradeModal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} initialGradeKey={selectedGradeKey || undefined} initialPart={activePart} />
      <TextbookAccreditModal open={accreditModalOpen} onClose={() => setAccreditModalOpen(false)} />
    </div>
  );
}
