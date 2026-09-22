/**
 * Textbook administration, as the UI sees it.
 *
 * One capability — the textbook catalogue and its deployment to schools —
 * against the content routes the authoring screens already use. Publication
 * transitions go through the same `/content/transitions` the author surface
 * uses; adoption is the deployment fact that decides what a school's learners
 * are entitled to.
 *
 * Named for the schema's own terms — Textbook and TextbookAdoption — and
 * nothing else: "curriculum" is the legacy system's word for the content root
 * and does not appear here (see the V1 rule in check-architecture.ts).
 */

import { api } from '../../shared/api/client';

export type PublicationStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  'DRAFT',
  'IN_REVIEW',
  'PUBLISHED',
  'ARCHIVED',
];

export type PublicationAction = 'SUBMIT' | 'REJECT' | 'APPROVE' | 'ARCHIVE' | 'RESTORE';

export interface TextbookAdminSummary {
  readonly key: string;
  readonly title: string;
  readonly description?: string | null;
  readonly issuer?: string | null;
  readonly isbn?: string | null;
  readonly publishYear?: number | null;
  readonly totalPages?: number | null;
  readonly status?: PublicationStatus;
}

export interface TextbookSummary {
  readonly key: string;
  readonly title: string;
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly termKey: string;
  readonly termName: string;
  readonly edition: string;
  readonly status: PublicationStatus;
  readonly adoptionCount: number;
  readonly unitCount: number;
  readonly questionCount: number;
  readonly updatedAt: string;
  readonly coverUrl: string | null;
  readonly description?: string | null;
  readonly issuer?: string | null;
  readonly isbn?: string | null;
  readonly publishYear?: number | null;
  readonly totalPages?: number | null;
}

export interface TextbookPage {
  readonly rows: readonly TextbookSummary[];
  readonly total: number;
}

export interface CreatedTextbook {
  readonly key: string;
  readonly title: string;
  readonly edition: string;
  readonly status: PublicationStatus;
}

export interface CreatedContentNode {
  readonly key: string;
  readonly kind: string;
  readonly name: string;
}

export interface CreateTextbookInput {
  readonly subjectKey: string;
  readonly gradeKey: string;
  readonly termKey: string;
  readonly title: string;
  readonly edition: string;
  readonly isbn?: string | null;
  readonly description?: string | null;
  readonly issuer?: string | null;
  readonly publishYear?: number | null;
  readonly totalPages?: number | null;
}

export interface EnsureTextbooksResult {
  readonly gradeKey: string;
  readonly termKey: string;
  readonly edition: string;
  readonly created: number;
  readonly unchanged: number;
  readonly adopted: number;
  readonly rows: readonly { subjectKey: string; textbookKey: string; title: string; created: boolean; adopted: boolean }[];
}

export interface TextbookQuery {
  readonly search?: string | undefined;
  readonly subjectKey?: string | undefined;
  readonly gradeKey?: string | undefined;
  readonly termKey?: string | undefined;
  readonly status?: PublicationStatus | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly [key: string]: string | number | boolean | null | undefined;
}

/** An adoption: identity is the (textbook, school, year) triple. */
export interface AdoptionRow {
  readonly textbookKey: string;
  readonly textbookTitle: string;
  readonly textbookStatus: PublicationStatus;
  readonly schoolKey: string;
  readonly schoolName: string;
  readonly academicYearKey: string;
  readonly adoptedAt: string;
}

export interface AdoptionPage {
  readonly rows: readonly AdoptionRow[];
  readonly total: number;
}

export interface AdoptionQuery {
  readonly textbookKey?: string | undefined;
  readonly schoolKey?: string | undefined;
  readonly academicYearKey?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface AdoptionInput {
  readonly textbookKey: string;
  readonly schoolKey: string;
  readonly academicYearKey: string;
}

/** Accredit one book (`textbookKey` given) or a grade's whole shelf. */
export interface GradeAdoptionInput {
  readonly gradeKey: string;
  readonly termKey?: string | undefined;
  readonly textbookKey?: string | undefined;
  readonly schoolKey: string;
  readonly academicYearKey: string;
}

export interface GradeAdoptionResult {
  readonly gradeKey: string;
  readonly schoolKey: string;
  readonly academicYearKey: string;
  readonly adopted: number;
  readonly alreadyAdopted: number;
  readonly rows: readonly { textbookKey: string; title: string; adopted: boolean }[];
}

export interface OutlineConcept {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
}

export interface OutlineLesson {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly conceptCount: number;
  readonly concepts?: readonly OutlineConcept[];
  readonly resourceCount: number;
  readonly estimatedMins: number | null;
}

/** A unit with its lessons — the content-setup browse. */
export interface OutlineUnit {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly lessons: readonly OutlineLesson[];
}

/** One lesson's materials, with their real kinds. */
export interface LessonMaterial {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly body: string | null;
  readonly estimatedMins: number | null;
  readonly scope: 'LESSON' | 'CONCEPT';
  readonly conceptKey: string | null;
  readonly conceptName: string | null;
}

export interface CreatedLearningResource {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly body: string | null;
  readonly textbookKey: string | null;
  readonly lessonKey: string | null;
  readonly conceptKey: string | null;
  readonly isActive: boolean;
}

export interface CreateLearningResourceInput {
  readonly kind: string;
  readonly title: string;
  readonly slug?: string | null;
  readonly url?: string | null;
  readonly body?: string | null;
  readonly textbookKey?: string | null;
  readonly lessonKey?: string | null;
  readonly conceptKey?: string | null;
  readonly orderIndex?: number | null;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly estimatedMins?: number | null;
}

export interface CreateUnitInput {
  readonly textbookKey: string;
  readonly parentUnitKey?: string | null;
  readonly name: string;
  readonly slug?: string | null;
  readonly startPage?: number | null;
  readonly endPage?: number | null;
}

export interface CreateLessonInput {
  readonly unitKey: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly description?: string | null;
  readonly estimatedMins?: number | null;
  readonly startPage?: number | null;
  readonly endPage?: number | null;
}

export interface CreateConceptInput {
  readonly lessonKey: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly description?: string | null;
  readonly difficulty?: number;
  readonly importance?: number;
  readonly masteryThreshold?: number;
  readonly isCore?: boolean;
  readonly pageNumber?: number | null;
}

export type ContentNodeKind = 'textbook' | 'unit' | 'lesson' | 'concept';

export interface UpdateNodeInput {
  readonly kind: ContentNodeKind;
  readonly key: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface ReorderInput {
  readonly kind: 'unit' | 'lesson' | 'concept';
  readonly parentKey: string;
  readonly orderedKeys: readonly string[];
}

export interface CreateMisconceptionInput {
  readonly conceptKey: string;
  readonly slug?: string | null;
  readonly name: string;
  readonly description: string;
  readonly correction?: string | null;
}

export interface CreatedMisconception {
  readonly key: string;
  readonly created: boolean;
}

export interface PrerequisiteInput {
  readonly conceptKey: string;
  readonly prerequisiteKey: string;
  readonly strength?: number;
  readonly requiredMastery?: number;
}

export interface UpdateResourceInput {
  readonly resourceKey: string;
  readonly title?: string;
  readonly url?: string | null;
  readonly body?: string | null;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly estimatedMins?: number | null;
}

export interface ContentAssetRecord {
  readonly key: string;
  readonly assetType: string;
  readonly originalName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly scope: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly title: string | null;
  readonly altText: string | null;
  readonly caption: string | null;
  readonly lessonKey: string | null;
}

export interface ResourceRecord {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly body: string | null;
  readonly textbookKey: string | null;
  readonly lessonKey: string | null;
  readonly conceptKey: string | null;
  readonly slug: string | null;
  readonly orderIndex: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly estimatedMins: number | null;
  readonly isActive: boolean;
}

export interface ContentImportOutcome {
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly textbookKey: string;
  readonly created: Record<string, number>;
  readonly unchanged: Record<string, number>;
  readonly problems: readonly unknown[];
}

export interface ReadinessIssue {
  readonly code: string;
  readonly message: string;
  readonly at?: string;
  readonly details?: Record<string, unknown>;
}

export interface ReadinessReport {
  readonly textbookKey: string;
  readonly status: PublicationStatus;
  readonly ready: boolean;
  readonly issues: readonly ReadinessIssue[];
}

/** One concept's misconceptions and prerequisite graph — the detail drawer. */
export interface ConceptDetail {
  readonly key: string;
  readonly name: string;
  readonly lessonKey: string;
  readonly lessonName: string;
  readonly textbookKey: string;
  readonly textbookStatus: PublicationStatus;
  readonly misconceptions: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly remediation: string | null;
  }>;
  readonly requires: ReadonlyArray<{
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly textbookKey: string;
    readonly textbookTitle: string;
    readonly strength: number;
    readonly requiredMastery: number;
  }>;
  readonly requiredBy: ReadonlyArray<{
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly strength: number;
    readonly requiredMastery: number;
  }>;
}

export const textbookAdministrationApi = {
  createTextbook: (input: CreateTextbookInput) => api.post<CreatedTextbook>('content/textbooks', input),
  createUnit: (input: CreateUnitInput) => api.post<CreatedContentNode>('content/units', input),
  createLesson: (input: CreateLessonInput) => api.post<CreatedContentNode>('content/lessons', input),
  createConcept: (input: CreateConceptInput) => api.post<CreatedContentNode>('content/concepts', input),
  importPackage: (
    contentPackage: unknown,
    options:
      | boolean
      | {
          dryRun?: boolean | undefined;
          targetTextbookKey?: string | undefined;
          selectedUnits?: string[] | undefined;
          selectedLessons?: string[] | undefined;
          selectedConcepts?: string[] | undefined;
          includeResources?: boolean | undefined;
          includeMisconceptions?: boolean | undefined;
          includeQuestions?: boolean | undefined;
        } = true,
  ) => {
    const opts = typeof options === 'boolean' ? { dryRun: options } : options;
    return api.post<ContentImportOutcome>('content/textbooks/import', {
      dryRun: opts.dryRun !== false,
      targetTextbookKey: opts.targetTextbookKey,
      selectedUnits: opts.selectedUnits,
      selectedLessons: opts.selectedLessons,
      selectedConcepts: opts.selectedConcepts,
      includeResources: opts.includeResources,
      includeMisconceptions: opts.includeMisconceptions,
      includeQuestions: opts.includeQuestions,
      package: contentPackage,
    });
  },
  ensureForGrade: (input: {
    gradeKey: string;
    termKey: string;
    edition: string;
    issuer?: string | null;
    publishYear?: number | null;
    adopt?: { schoolKey: string; academicYearKey: string } | null;
  }) => api.post<EnsureTextbooksResult>('content/textbooks/ensure-for-grade', input),
  textbooks: (query: TextbookQuery) => api.get<TextbookPage>('content/textbooks', { query }),
  listTextbooks: (query?: TextbookQuery) =>
    api.get<TextbookPage>('content/textbooks', query ? { query } : {}),
  /** The unit→lesson outline of a book. */
  outline: (textbookKey: string) =>
    api.get<readonly OutlineUnit[]>(`content/textbooks/${encodeURIComponent(textbookKey)}/outline`),
  /** One lesson's materials — the educational and remedial reading list. */
  lessonMaterials: (lessonKey: string) =>
    api.get<readonly LessonMaterial[]>(`content/lessons/${encodeURIComponent(lessonKey)}/materials`),

  /** Physical lesson pages, AI page explanations and attached media. */
  lessonAssets: (lessonKey: string) =>
    api.get<readonly ContentAssetRecord[]>(`content/lessons/${encodeURIComponent(lessonKey)}/assets`),

  /** The book-wide shelf — resources attached to the textbook itself. */
  textbookResources: (textbookKey: string) =>
    api.get<readonly ResourceRecord[]>(`content/textbooks/${encodeURIComponent(textbookKey)}/resources`),

  /** One concept's misconceptions and prerequisite graph. */
  conceptDetail: (conceptKey: string) =>
    api.get<ConceptDetail>(`content/concepts/${encodeURIComponent(conceptKey)}`),

  createLearningResource: (input: CreateLearningResourceInput) =>
    api.post<CreatedLearningResource>('content/resources', input),

  /** Edit a resource already on a lesson or concept. */
  updateResource: (input: UpdateResourceInput) => {
    const { resourceKey, ...patch } = input;
    return api.patch<ResourceRecord>(`content/resources/${encodeURIComponent(resourceKey)}`, patch);
  },

  /** DELETE retires; the row stays for decision-log integrity. */
  retireResource: (resourceKey: string) =>
    api.delete<ResourceRecord>(`content/resources/${encodeURIComponent(resourceKey)}`),

  /** Rename or edit a unit/lesson/concept/textbook after creation. */
  updateNode: (input: UpdateNodeInput) => api.patch<{ key: string; updated: readonly string[] }>('content/nodes', input),

  /** Replace a parent's whole sibling ordering in one call. */
  reorder: (input: ReorderInput) =>
    api.post<{ parentKey: string; count: number }>('content/reorder', input),

  createMisconception: (input: CreateMisconceptionInput) =>
    api.post<CreatedMisconception>('content/misconceptions', input),

  linkPrerequisite: (input: PrerequisiteInput) =>
    api.post<{ conceptKey: string; prerequisiteKey: string }>('content/prerequisites', input),

  unlinkPrerequisite: (input: PrerequisiteInput) =>
    api.delete<{ conceptKey: string; prerequisiteKey: string }>('content/prerequisites', {
      body: input,
    }),

  readiness: (textbookKey: string) =>
    api.get<ReadinessReport>('content/readiness', { query: { textbookKey } }),

  adoptions: (query: AdoptionQuery) => api.get<AdoptionPage>('content/adoptions', { query }),

  adopt: (input: AdoptionInput) => api.post<AdoptionRow>('content/adoptions', input),

  unadopt: (input: AdoptionInput) => api.delete<unknown>('content/adoptions', { body: input }),

  /** Accreditation by grade: one book across every school, or every book a grade has. */
  adoptGrade: (input: GradeAdoptionInput) =>
    api.post<GradeAdoptionResult>('content/adoptions/grade', input),

  /** Publication lifecycle: the server decides which action is legal. */
  transition: (textbookKey: string, action: PublicationAction) =>
    api.post<unknown>('content/transitions', { textbookKey, action }),

  updateTextbookStatus: (textbookKey: string, status: PublicationStatus) => {
    const action: PublicationAction = status === 'PUBLISHED' ? 'APPROVE' : status === 'IN_REVIEW' ? 'SUBMIT' : status === 'ARCHIVED' ? 'ARCHIVE' : 'REJECT';
    return api.post<unknown>('content/transitions', { textbookKey, action });
  },

  /** The full content package — a backup or an external-audit export. */
  exportTextbook: (textbookKey: string) =>
    api.get<unknown>(`content/textbooks/${encodeURIComponent(textbookKey)}/export`),

  /** Workspace operations */
  workspacePrepareUpload: (input: {
    file: File;
    term: string;
    grade: string;
    subject: string;
    edition?: string;
    title?: string;
    autoSegment?: boolean;
  }) => api.postRaw<any>('content/workspace/prepare-upload', input.file, {
    query: {
      part: input.part,
      grade: input.grade,
      subject: input.subject,
      edition: input.edition,
      title: input.title,
      autoSegment: input.autoSegment,
    },
    rawContentType: 'application/pdf',
  }),

  workspacePrepare: (input: {
    part: 'PART_1' | 'PART_2' | 'BOTH';
    grade: string;
    subject: string;
    edition?: string;
    title?: string;
    pdfBase64?: string;
    autoSegment?: boolean;
    units?: Array<any>;
  }) => api.post<any>('content/workspace/prepare', input),

  workspaceList: () => api.get<Array<{
    workspaceDir: string;
    relativePath: string;
    manifest: any;
    packageExists: boolean;
  }>>('content/workspaces'),

  workspaceInspect: (workspaceDir: string) =>
    api.get<any>('content/workspace/inspect', { query: { workspaceDir } }),

  workspaceReconcile: (input: { workspaceDir: string }) =>
    api.post<any>('content/workspace/reconcile', input),

  workspaceImport: (input: {
    workspaceDir: string;
    dryRun?: boolean;
    syncAssets?: boolean;
  }) => api.post<any>('content/workspace/import', input),
};

export const contentApi = textbookAdministrationApi;

