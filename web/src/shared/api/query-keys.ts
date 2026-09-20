/**
 * Query keys, in one place.
 *
 * Centralised so that invalidation is provable. The rule from §12 — "a
 * mutation invalidates the owning capability" — is only enforceable if the
 * capability prefix is a single value both the query and the mutation refer
 * to. Keys spelled inline at each call site drift, and then answering a
 * question leaves a stale mastery number on screen.
 *
 * Shape: `[capability, resource, ...parameters]`.
 */

export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
    /** Server-owned policy: which roles may be self-registered. */
    selfServiceRoles: () => ['auth', 'self-service-roles'] as const,
  },

  learning: {
    /** Invalidated after any answer: the whole capability is downstream of evidence. */
    all: ['learning'] as const,
    /** Gap G2 — a guardian's verified children. */
    children: () => ['learning', 'children'] as const,
    /** Gap G1 — the learner's entitled books. */
    textbooks: (scope: { learnerKey?: string }) => ['learning', 'textbooks', scope] as const,
    nextStep: (scope: { textbookKey?: string; lessonKey?: string; learnerKey?: string }) =>
      ['learning', 'next-step', scope] as const,
    mastery: (scope: { learnerKey?: string; conceptKeys?: readonly string[] }) =>
      ['learning', 'mastery', scope] as const,
    path: (scope: { textbookKey: string; learnerKey?: string }) =>
      ['learning', 'path', scope] as const,
    /** One lesson opened — reading, options, gate. */
    lesson: (scope: { lessonKey: string; learnerKey?: string }) =>
      ['learning', 'lesson', scope] as const,
    /** The shelf by subject. */
    subjects: (scope: { learnerKey?: string }) => ['learning', 'subjects', scope] as const,
    completion: (scope: { lessonKey: string; learnerKey?: string }) =>
      ['learning', 'completion', scope] as const,
    flashcards: (scope: { lessonKey?: string; conceptKey?: string; learnerKey?: string }) =>
      ['learning', 'flashcards', scope] as const,
    diagnosticPlacement: (scope: { textbookKey: string; learnerKey?: string }) =>
      ['learning', 'diagnostic-placement', scope] as const,
  },

  assessment: {
    all: ['assessment'] as const,
    exams: () => ['assessment', 'exams'] as const,
    /** Gap G4 — a learner's finished attempts. */
    history: (scope: { learnerKey?: string; kind?: string; limit?: number } = {}) =>
      ['assessment', 'history', scope] as const,
    nextItem: (attemptKey: string, conceptKeys: readonly string[], step = 0) =>
      ['assessment', 'next-item', attemptKey, conceptKeys, step] as const,
    manualReviews: (scope: { learnerKey?: string; limit?: number; offset?: number } = {}) =>
      ['assessment', 'manual-reviews', scope] as const,
  },

  instruction: {
    all: ['instruction'] as const,
    dueWork: (scope: { learnerKey?: string }) => ['instruction', 'due-work', scope] as const,
    obligations: (scope: { learnerKey?: string }) =>
      ['instruction', 'obligations', scope] as const,
    parentTasks: (scope: { learnerKey: string }) =>
      ['instruction', 'parent-tasks', scope] as const,
    plan: (planKey: string) => ['instruction', 'plan', planKey] as const,
  },

  engagement: {
    all: ['engagement'] as const,
    xp: (scope: { learnerKey?: string }) => ['engagement', 'xp', scope] as const,
    leaderboard: (scope: { schoolId: string }) =>
      ['engagement', 'leaderboard', scope] as const,
  },

  remediation: {
    all: ['remediation'] as const,
    episodes: (scope: { learnerKey?: string }) => ['remediation', 'episodes', scope] as const,
    tracker: (scope: { schoolId: string }) => ['remediation', 'tracker', scope] as const,
  },

  analytics: {
    all: ['analytics'] as const,
    learner: (scope: { learnerKey?: string; textbookKey?: string }) =>
      ['analytics', 'learner', scope] as const,
    cohort: (scope: { schoolId: string; textbookKey?: string }) =>
      ['analytics', 'cohort', scope] as const,
    /** Gap G3 — a teacher's roster. A scope, not a stored class. */
    roster: (scope: { schoolId: string; gradeId?: string; termId?: string }) =>
      ['analytics', 'roster', scope] as const,
    examResults: (scope: { examKey: string; schoolId: string }) =>
      ['analytics', 'exam-results', scope] as const,
  },

  provisioning: {
    all: ['provisioning'] as const,
    /** Gap G6 — the user directory. Keyed by the whole query, so paging and
        filtering each get their own cache entry. */
    users: (query: Record<string, unknown>) => ['provisioning', 'users', query] as const,
    user: (userKey: string) => ['provisioning', 'user', userKey] as const,
    /** The teacher directory: person, staff profile, school scope. */
    educators: (query: Record<string, unknown>) => ['provisioning', 'educators', query] as const,
    /** The enrolment browser, server-filtered and paged. */
    enrollments: (query: Record<string, unknown>) =>
      ['provisioning', 'enrollments', query] as const,
    /** One learner's enrolment history, read beside their drawer. */
    learnerEnrollments: (learnerKey: string) =>
      ['provisioning', 'learner-enrollments', learnerKey] as const,
    /** Cohorts at a school: current enrolments grouped by grade. */
    cohorts: (schoolKey: string, academicYearKey?: string) =>
      ['provisioning', 'cohorts', schoolKey, academicYearKey ?? ''] as const,
    /** Guardians of a learner — verified links are what open a record. */
    guardians: (learnerKey: string) => ['provisioning', 'guardians', learnerKey] as const,
  },

  content: {
    all: ['content'] as const,
    readiness: (textbookKey: string) => ['content', 'readiness', textbookKey] as const,
    questions: (query: Record<string, unknown>) => ['content', 'questions', query] as const,
    exams: (query: Record<string, unknown>) => ['content', 'exams', query] as const,
    examBlueprint: (examKey: string) => ['content', 'exam-blueprint', examKey] as const,
    outline: (textbookKey: string) => ['content', 'outline', textbookKey] as const,
    lessonMaterials: (lessonKey: string) => ['content', 'lesson-materials', lessonKey] as const,
    /** The book-wide shelf — resources attached to the textbook itself. */
    textbookMaterials: (textbookKey: string) => ['content', 'textbook-materials', textbookKey] as const,
    /** Every question filed under a lesson, for the re-linking screen. */
    lessonQuestions: (lessonKey: string) => ['content', 'lesson-questions', lessonKey] as const,
    /** A concept's misconceptions and prerequisite graph — the detail drawer. */
    conceptDetail: (conceptKey: string) => ['content', 'concept-detail', conceptKey] as const,
  },

  /**
   * Textbook administration: the textbook catalogue and its deployment to
   * schools. Own prefix, not `content`'s, because adoption writes must not
   * invalidate the learner-facing content cache — entitlement is derived at
   * read time.
   */
  textbookAdministration: {
    all: ['textbookAdministration'] as const,
    textbooks: (query: Record<string, unknown>) =>
      ['textbookAdministration', 'textbooks', query] as const,
    adoptions: (query: Record<string, unknown>) =>
      ['textbookAdministration', 'adoptions', query] as const,
    outline: (textbookKey: string) =>
      ['textbookAdministration', 'outline', textbookKey] as const,
  },

  /**
   * Platform administration.
   *
   * `catalogue` sits under this prefix rather than its own because every
   * catalogue write is made from an administration screen, and invalidating
   * one capability after such a write must also refresh the overview counts
   * that summarise it.
   */
  administration: {
    all: ['administration'] as const,
    overview: () => ['administration', 'overview'] as const,
    /** The audit trail, newest first. */
    activity: (limit = 12) => ['administration', 'activity', limit] as const,
    catalogue: (collection: string) => ['administration', 'catalogue', collection] as const,
    /** The grade × subject matrix. Invalidated with `all` like the rest. */
    matrix: () => ['administration', 'catalogue', 'grade-subjects'] as const,
    /** Schools left the catalogue tabs for a surface of their own. */
    schools: () => ['administration', 'schools'] as const,
  },
} as const;

/**
 * What a graded answer invalidates.
 *
 * Submitting an answer produces evidence, and evidence is the input to mastery,
 * the next-step decision, path state, completion, remediation and XP. Rather
 * than let each screen guess, the list is declared once.
 *
 * Note what is absent: nothing here *computes* the new values. The client
 * discards what it has and asks again — the backend recomputes. Writing a
 * predicted mastery into the cache to avoid a refetch is precisely the
 * "frontend owns educational meaning" failure §3 forbids.
 */
export const INVALIDATED_BY_ANSWER = [
  queryKeys.learning.all,
  queryKeys.assessment.all,
  queryKeys.remediation.all,
  queryKeys.engagement.all,
  queryKeys.analytics.all,
] as const;
