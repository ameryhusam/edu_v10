/**
 * Textbook Administration Page
 *
 * Implements the requested two-tier navigation workflow:
 * - Screen 1: Active Grades list with Term 1 / Term 2 selector (auto-selected active term).
 * - Screen 2: Materials of the selected Grade & Term with control buttons:
 *   - Direct activation / publishing (DRAFT -> PUBLISHED).
 *   - Content Management navigation tab / button.
 *   - Digital PDF Textbook attachment modal.
 *   - Outline inspection, granular import, and export.
 */

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
import { GradesActiveView } from '../../features/content/grades-active-view';
import { GradeMaterialsView } from '../../features/content/grade-materials-view';
import {
  textbookAdministrationApi,
  type TextbookSummary,
  type TextbookAdminSummary,
} from '../../features/content/content.api';
import {
  administrationApi,
  type GradeRecord,
  type TermRecord,
} from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';

/** Auto-determine current active term ordinal (1 or 2) based on current month */
function getAutoActiveTermOrdinal(): 1 | 2 {
  const currentMonth = new Date().getMonth() + 1; // 1-12
  // Term 1 typically runs from September (9) through January (1)
  // Term 2 runs from February (2) through June (6)
  if (currentMonth >= 2 && currentMonth <= 6) {
    return 2;
  }
  return 1;
}

export function TextbooksAdminPage(): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Navigation State
  const [selectedTermOrdinal, setSelectedTermOrdinal] = useState<1 | 2>(getAutoActiveTermOrdinal());
  const [selectedGradeKey, setSelectedGradeKey] = useState<string | null>(null);

  // Modal Dialog States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [accreditModalOpen, setAccreditModalOpen] = useState(false);
  const [pdfModalTextbook, setPdfModalTextbook] = useState<TextbookSummary | null>(null);
  const [importModalTextbookKey, setImportModalTextbookKey] = useState<string | null>(null);
  const [outlineModalTextbook, setOutlineModalTextbook] = useState<TextbookSummary | null>(null);
  const [editModalTextbook, setEditModalTextbook] = useState<TextbookSummary | null>(null);

  // Primary Queries
  const gradesQuery = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });

  const termsQuery = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(),
  });

  const subjectsQuery = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });

  const textbooksQuery = useQuery({
    queryKey: queryKeys.textbookAdministration.all,
    queryFn: () => textbookAdministrationApi.textbooks({ pageSize: 100 }),
  });

  // Direct publish mutation (Draft -> Published)
  const publishMutation = useMutation({
    mutationFn: async (textbookKey: string) => {
      await textbookAdministrationApi.updateTextbookStatus(textbookKey, 'PUBLISHED');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    },
  });

  const grades = gradesQuery.data ?? [];
  const terms = termsQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const textbooks = textbooksQuery.data?.rows ?? [];

  // Selected Grade Record
  const selectedGrade = useMemo(() => {
    if (!selectedGradeKey) return null;
    return grades.find((g: GradeRecord) => g.key === selectedGradeKey) || null;
  }, [grades, selectedGradeKey]);

  // Handle loading and error states
  if (gradesQuery.isLoading || termsQuery.isLoading || subjectsQuery.isLoading || textbooksQuery.isLoading) {
    return <LoadingState />;
  }

  if (gradesQuery.isError || termsQuery.isError || subjectsQuery.isError || textbooksQuery.isError) {
    return (
      <ErrorState
        error={
          gradesQuery.error ||
          termsQuery.error ||
          subjectsQuery.error ||
          textbooksQuery.error ||
          new Error('Failed to load textbook administration data')
        }
      />
    );
  }

  // Determine active term key for modals
  const activeTerm = terms.find((t: TermRecord) => {
    const ord = t.ordinal ?? (t.key.includes('2') ? 2 : 1);
    return ord === selectedTermOrdinal;
  });

  return (
    <div className="space-y-6">
      {/* Screen 1: Active Grades List OR Screen 2: Selected Grade Materials */}
      {!selectedGrade ? (
        <GradesActiveView
          grades={grades}
          textbooks={textbooks}
          selectedTermOrdinal={selectedTermOrdinal}
          onSelectTermOrdinal={setSelectedTermOrdinal}
          onSelectGrade={(gradeKey) => setSelectedGradeKey(gradeKey)}
          onOpenCreateModal={() => setCreateModalOpen(true)}
          onOpenBulkModal={() => setBulkModalOpen(true)}
          onOpenAccreditModal={() => setAccreditModalOpen(true)}
        />
      ) : (
        <GradeMaterialsView
          grade={selectedGrade}
          terms={terms}
          subjects={subjects}
          textbooks={textbooks}
          selectedTermOrdinal={selectedTermOrdinal}
          onSelectTermOrdinal={setSelectedTermOrdinal}
          onBackToGrades={() => setSelectedGradeKey(null)}
          onPublishTextbook={async (key) => {
            await publishMutation.mutateAsync(key);
          }}
          onOpenPdfModal={(book) => setPdfModalTextbook(book)}
          onOpenImportModal={(key) => setImportModalTextbookKey(key)}
          onOpenOutlineModal={(book) => setOutlineModalTextbook(book)}
          onOpenEditModal={(book) => setEditModalTextbook(book)}
          onOpenCreateModal={() => setCreateModalOpen(true)}
          onOpenBulkModal={() => setBulkModalOpen(true)}
          onNavigateToContentManager={(key) => {
            navigate(`/admin/content?textbook=${encodeURIComponent(key)}`);
          }}
        />
      )}

      {/* PDF Management Modal */}
      <TextbookPdfModal
        open={!!pdfModalTextbook}
        textbook={pdfModalTextbook}
        onClose={() => setPdfModalTextbook(null)}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
        }}
      />

      {/* Multi-Format Content Import Modal (Excel/CSV, JSON, Text) */}
      <ContentImportModal
        open={!!importModalTextbookKey}
        textbookKey={importModalTextbookKey}
        onClose={() => setImportModalTextbookKey(null)}
      />

      {/* Curriculum Outline Inspection Modal */}
      <TextbookOutlineModal
        open={!!outlineModalTextbook}
        textbook={outlineModalTextbook}
        onClose={() => setOutlineModalTextbook(null)}
      />

      {/* Textbook Metadata Edit Modal */}
      <TextbookEditModal
        open={!!editModalTextbook}
        textbook={editModalTextbook as TextbookAdminSummary | null}
        onClose={() => setEditModalTextbook(null)}
      />

      {/* New Textbook Creation Modal */}
      <TextbookCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        initialGradeKey={selectedGradeKey || undefined}
        initialTermKey={activeTerm?.key || undefined}
      />

      {/* Bulk Grade Textbooks Preparation Modal */}
      <TextbookBulkGradeModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        initialGradeKey={selectedGradeKey || undefined}
        initialTermKey={activeTerm?.key || undefined}
      />

      {/* School Accreditation Modal */}
      <TextbookAccreditModal
        open={accreditModalOpen}
        onClose={() => setAccreditModalOpen(false)}
      />
    </div>
  );
}
