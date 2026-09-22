/**
 * The composition root.
 *
 * This is the ONE place where interfaces meet implementations. Every `new`
 * that wires a port to an adapter happens here and nowhere else. That is what
 * makes the dependency arrows in this codebase real rather than aspirational:
 * a use case cannot secretly reach for Prisma, because it has never been given
 * anything except its ports.
 *
 * Reading this file top to bottom tells you the entire architecture.
 */

import type { Clock } from '../shared/kernel/clock.js';
import { systemClock } from '../shared/kernel/clock.js';
import type { Env } from '../shared/config/env.js';

import { createPrismaClient, type Db } from '../infrastructure/database/prisma.client.js';
import {
  PrismaConceptMasteryPolicy,
  PrismaEvidenceReader,
  PrismaMasteryRepository,
} from '../infrastructure/database/mastery.repository.js';
import {
  PrismaAttemptHistoryReader,
  PrismaAttemptRepository,
  PrismaEvidenceWriter,
  PrismaQuestionRepository,
} from '../infrastructure/database/assessment.repository.js';
import { PrismaLearnerExamCatalog } from '../infrastructure/database/exam-catalog.repository.js';
import {
  PrismaContentReader,
  PrismaFlashcardReader,
  PrismaMasteryReader,
  PrismaMisconceptionReader,
  PrismaDecisionLogWriter,
  PrismaResourceReader,
  PrismaLearnerEntitlementReader,
} from '../infrastructure/database/learning.repository.js';
import {
  PrismaContentAuditWriter,
  PrismaContentRepository,
} from '../infrastructure/database/content.repository.js';
import {
  PrismaGapEvidenceReader,
  PrismaRemediationRepository,
} from '../infrastructure/database/remediation.repository.js';
import {
  PrismaAnalyticsReader,
  PrismaExamResultsReader,
  PrismaItemAnalyticsReader,
  PrismaItemStatisticsWriter,
} from '../infrastructure/database/analytics.repository.js';
import {
  PrismaExamRepository,
  PrismaQuestionAuthoringRepository,
  PrismaResourceRepository,
  PrismaFlashcardRepository,
} from '../infrastructure/database/item-bank.repository.js';
import {
  PrismaActivityReader,
  PrismaCompletionReader,
  PrismaPlanRepository,
  PrismaRosterReader,
} from '../infrastructure/database/instruction.repository.js';
import { GeminiProvider } from '../infrastructure/ai/gemini.provider.js';
import { OpenAiProvider } from '../infrastructure/ai/openai.provider.js';
import { DeterministicProvider } from '../infrastructure/ai/deterministic.provider.js';
import { PostgresContextRetriever } from '../infrastructure/ai/retrieval.adapter.js';
import {
  LogBackedAiQuota,
  PrismaAiInteractionLog,
} from '../infrastructure/ai/ai-governance.adapter.js';

import { RecomputeMasteryUseCase } from '../contexts/mastery/application/recompute-mastery.use-case.js';
import { GetMasteryProfileUseCase } from '../contexts/mastery/application/get-mastery-profile.use-case.js';
import { LoginUseCase } from '../contexts/identity/application/login.use-case.js';
import { LogoutUseCase } from '../contexts/identity/application/logout.use-case.js';
import { RefreshSessionUseCase } from '../contexts/identity/application/refresh-session.use-case.js';
import {
  PrismaAuditWriter,
  PrismaGuardianLinkReader,
  PrismaSessionRepository,
  PrismaProvisioningRepository,
  PrismaUserRepository,
} from '../infrastructure/database/identity.repository.js';
import { PrismaCatalogueRepository } from '../infrastructure/database/catalogue.repository.js';
import { BcryptPasswordHasher, JwtTokenService } from '../infrastructure/security/tokens.js';
import { StartAttemptUseCase } from '../contexts/assessment/application/start-attempt.use-case.js';
import { SubmitAnswerUseCase } from '../contexts/assessment/application/submit-answer.use-case.js';
import { SubmitAttemptUseCase } from '../contexts/assessment/application/submit-attempt.use-case.js';
import { RunAdaptiveExamUseCase } from '../contexts/assessment/application/run-adaptive-exam.use-case.js';
import { ListManualReviewsUseCase } from '../contexts/assessment/application/list-manual-reviews.use-case.js';
import { GradeManualAnswerUseCase } from '../contexts/assessment/application/grade-manual-answer.use-case.js';
import { GetNextStepUseCase } from '../contexts/learning/application/get-next-step.use-case.js';
import { GetDiagnosticPlacementUseCase } from '../contexts/learning/application/get-diagnostic-placement.use-case.js';
import { ContentAuthoringService } from '../contexts/content/application/authoring.service.js';
import { ContentExportService } from '../contexts/content/application/content-export.service.js';
import { ContentImportService } from '../contexts/content/application/content-import.service.js';
import { ContentAssetService } from '../contexts/content/application/content-asset.service.js';
import { WorkspaceImporterService } from '../contexts/content/application/workspace-importer.service.js';
import { WorkspaceArchiveService } from '../contexts/content/application/workspace-archive.service.js';
import { PublishingService } from '../contexts/content/application/publishing.service.js';
import { TextbookAdministrationService } from '../contexts/content/application/textbook-administration.service.js';
import { LocalContentStorage } from '../infrastructure/storage/local-content-storage.js';
import { WorkspaceManager } from '../infrastructure/storage/workspace-manager.js';
import { ContentEngineService } from '../infrastructure/content/content-engine.service.js';
import { PrismaContentAssetRepository } from '../infrastructure/database/content-asset.repository.js';
import { AssignmentService } from '../contexts/instruction/application/assignment.service.js';
import { DueWorkService } from '../contexts/instruction/application/due-work.service.js';
import { ParentTaskService } from '../contexts/instruction/application/parent-task.service.js';
import { ItemBankService } from '../contexts/content/application/item-bank.service.js';
import { ProvisioningService } from '../contexts/identity/application/provisioning.service.js';
import { CatalogueService } from '../contexts/catalogue/application/catalogue.service.js';
import { RegisterAccountUseCase } from '../contexts/identity/application/register-account.use-case.js';
import { AnalyticsService } from '../contexts/analytics/application/analytics.service.js';
import { RemediationService } from '../contexts/learning/application/remediation.service.js';
import { JourneyService } from '../contexts/learning/application/journey.service.js';
import { SubjectsOverviewUseCase } from '../contexts/learning/application/subjects-overview.use-case.js';
import type { ContentReader } from '../contexts/learning/application/ports.js';
import { FlashcardService } from '../contexts/learning/application/flashcard.service.js';
import type { RewardTrigger } from '../contexts/assessment/application/ports.js';
import { EngagementService } from '../contexts/engagement/application/engagement.service.js';
import { AdministrationService } from '../contexts/administration/application/administration.service.js';
import { PrismaAdministrationRepository } from '../infrastructure/database/administration.repository.js';
import { PrismaTextbookAdministrationRepository } from '../infrastructure/database/textbook-administration.repository.js';
import {
  PrismaAnswerHistoryReader,
  PrismaXpLedger,
} from '../infrastructure/database/engagement.repository.js';
import { AskTutorUseCase } from '../contexts/tutoring/application/ask-tutor.use-case.js';
import type { MasteryRecomputeTrigger } from '../contexts/assessment/application/ports.js';
import type { AiProvider } from '../contexts/tutoring/application/ports.js';

export interface Container {
  readonly db: Db;
  /** A learner's finished attempts (G4). A read model, separate from the write aggregate. */
  readonly attemptHistory: PrismaAttemptHistoryReader;
  /** The learner's published exams, with their concept scopes. */
  readonly examCatalog: PrismaLearnerExamCatalog;
  /** Guardian verification, needed by routes that read a child's data. */
  readonly guardianLinks: PrismaGuardianLinkReader;
  /** Cohort resolution ("class is a query"), shared by analytics and remediation. */
  readonly analyticsReader: PrismaAnalyticsReader;
  /** Exposed for GET /auth/me, which reads the account behind the token. */
  readonly userRepository: PrismaUserRepository;
  /** Binary file and asset storage adapter. */
  readonly contentStorage: LocalContentStorage;
  /** Workspace filesystem and manifest manager. */
  readonly workspaceManager: WorkspaceManager;
  /** Asset metadata repository. */
  readonly contentAssetRepository: PrismaContentAssetRepository;
  /** Cookies are Secure outside development; over plain HTTP they would not be sent. */
  readonly secureCookies: boolean;
  readonly cookieSameSite: 'lax' | 'none';
  readonly clock: Clock;
  readonly useCases: {
    readonly recomputeMastery: RecomputeMasteryUseCase;
    readonly getMasteryProfile: GetMasteryProfileUseCase;
    readonly submitAnswer: SubmitAnswerUseCase;
    readonly runAdaptiveExam: RunAdaptiveExamUseCase;
    readonly login: LoginUseCase;
    readonly refreshSession: RefreshSessionUseCase;
    readonly logout: LogoutUseCase;
    readonly startAttempt: StartAttemptUseCase;
    readonly submitAttempt: SubmitAttemptUseCase;
    readonly manualReviews: ListManualReviewsUseCase;
    readonly gradeManualAnswer: GradeManualAnswerUseCase;
    readonly learnerEntitlements: PrismaLearnerEntitlementReader;
    readonly getNextStep: GetNextStepUseCase;
    readonly diagnosticPlacement: GetDiagnosticPlacementUseCase;
    readonly askTutor: AskTutorUseCase;
    /** Content authoring. The only write path into the content tree. */
    readonly contentAuthoring: ContentAuthoringService;
    readonly provisioning: ProvisioningService;
    /**
     * The academic structure: subjects, grades, years, terms, schools.
     * Its own context because content, identity and analytics all read it and
     * none of them owns it.
     */
    readonly catalogue: CatalogueService;
    readonly registerAccount: RegisterAccountUseCase;
    readonly contentExport: ContentExportService;
    readonly contentImport: ContentImportService;
    readonly contentAsset: ContentAssetService;
    readonly workspaceImporter: WorkspaceImporterService;
  /** Safe ZIP import/export over the canonical workspace. */
  readonly workspaceArchive: WorkspaceArchiveService;
    readonly contentUploadMaxBytes: number;
    readonly publishing: PublishingService;
    /** The admin surface over the textbook catalogue and its deployment. */
    readonly textbookAdministration: TextbookAdministrationService;
    /** Assignments. Records what was asked, never how well it was done. */
    /** Questions, exams and learning resources. */
    readonly itemBank: ItemBankService;
    readonly assignments: AssignmentService;
    readonly dueWork: DueWorkService;
    readonly parentTasks: ParentTaskService;
    /** Reporting over evidence other contexts own. Decides nothing. */
    readonly analytics: AnalyticsService;
    /** Tracks learner gaps from open to close. Never closes one on request. */
    readonly remediation: RemediationService;
    /** Path, progress and completion — all derived, never stored. */
    readonly journey: JourneyService;
    readonly subjectsOverview: SubjectsOverviewUseCase;
    readonly content: ContentReader;
    /** Decks: stored by Content, ordered by Learning, presented by the client. */
    readonly flashcards: FlashcardService;
    /** XP, streaks and levels. Never writes mastery. */
    readonly engagement: EngagementService;
    /** The administrator's overview. Counts what other contexts own. */
    readonly administration: AdministrationService;
  };
  shutdown(): Promise<void>;
}

type AiProviderId = 'gemini' | 'openai' | 'deterministic';

function isAiProviderId(value: string): value is AiProviderId {
  return value === 'gemini' || value === 'openai' || value === 'deterministic';
}

function buildAiProviders(env: Env): readonly AiProvider[] {
  const registry: Record<AiProviderId, () => AiProvider> = {
    gemini: () => new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    openai: () =>
      new OpenAiProvider({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
      }),
    deterministic: () => new DeterministicProvider(),
  };

  const ids = env.AI_PROVIDER_ORDER.split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(isAiProviderId);

  if (!ids.includes('deterministic')) ids.push('deterministic');

  return ids.map((id) => registry[id]());
}

export function buildContainer(env: Env, overrides: { db?: Db; clock?: Clock } = {}): Container {
  const db =
    overrides.db ??
    createPrismaClient({
      databaseUrl: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      verbose: env.NODE_ENV !== 'production',
    });
  const clock = overrides.clock ?? systemClock;

  // ── Adapters (infrastructure implements the ports) ────────────────────────
  const masteryRepository = new PrismaMasteryRepository(db);
  const evidenceReader = new PrismaEvidenceReader(db);
  const masteryPolicy = new PrismaConceptMasteryPolicy(db);

  const questionRepository = new PrismaQuestionRepository(db);
  const attemptRepository = new PrismaAttemptRepository(db);
  const attemptHistory = new PrismaAttemptHistoryReader(db);
  const examCatalog = new PrismaLearnerExamCatalog(db);
  const evidenceWriter = new PrismaEvidenceWriter(db);

  const contentReader = new PrismaContentReader(db);
  const flashcardReader = new PrismaFlashcardReader(db);
  const flashcardRepository = new PrismaFlashcardRepository(db);
  const masteryReader = new PrismaMasteryReader(db, () => clock.now());
  const misconceptionReader = new PrismaMisconceptionReader(db);
  const resourceReader = new PrismaResourceReader(db);
  const decisionLog = new PrismaDecisionLogWriter(db);

  const contentStorage = new LocalContentStorage({
    rootDir: env.STORAGE_ROOT,
  });
  const workspaceManager = new WorkspaceManager(env.WORKSPACE_ROOT);
  const contentEngine = new ContentEngineService(env.CONTENT_ENGINE_PYTHON, env.CONTENT_ENGINE_ROOT);
  const contentAssetRepository = new PrismaContentAssetRepository(db);

  const contentRepository = new PrismaContentRepository(db);
  const contentAudit = new PrismaContentAuditWriter(db);
  const contentAuthoring = new ContentAuthoringService(contentRepository, contentAudit);
  const contentAsset = new ContentAssetService(contentAssetRepository, contentStorage);

  const analyticsReader = new PrismaAnalyticsReader(db, () => clock.now());
  const remediationRepository = new PrismaRemediationRepository(db);
  const gapEvidenceReader = new PrismaGapEvidenceReader(db, () => clock.now());
  const itemAnalyticsReader = new PrismaItemAnalyticsReader(db);
  const itemStatisticsWriter = new PrismaItemStatisticsWriter(db);

  const questionAuthoringRepository = new PrismaQuestionAuthoringRepository(db);
  const examRepository = new PrismaExamRepository(db);
  const resourceRepository = new PrismaResourceRepository(db);

  const itemBank = new ItemBankService(
    questionAuthoringRepository,
    examRepository,
    resourceRepository,
    clock,
    contentAudit,
    flashcardRepository,
  );

  const planRepository = new PrismaPlanRepository(db);
  const rosterReader = new PrismaRosterReader(db);
  const activityReader = new PrismaActivityReader(db);
  const completionReader = new PrismaCompletionReader(db);

  const userRepository = new PrismaUserRepository(db);
  const learnerEntitlements = new PrismaLearnerEntitlementReader(db);
  const journey = new JourneyService(contentReader, masteryReader);
  const sessionRepository = new PrismaSessionRepository(db);
  const auditWriter = new PrismaAuditWriter(db);
  const provisioningRepository = new PrismaProvisioningRepository(db);
  const catalogueService = new CatalogueService(new PrismaCatalogueRepository(db));
  const guardianLinks = new PrismaGuardianLinkReader(db);
  const passwordHasher = new BcryptPasswordHasher();
  const provisioningService = new ProvisioningService(
    provisioningRepository,
    passwordHasher,
    auditWriter,
  );
  const tokenService = new JwtTokenService(env.JWT_SECRET);

  const retriever = new PostgresContextRetriever(db);
  const aiLog = new PrismaAiInteractionLog(db);
  const aiQuota = new LogBackedAiQuota(db, env.AI_DAILY_QUOTA, () => clock.now());

  // Provider chain, tried in the configured order. The deterministic provider
  // is always appended by buildAiProviders, so an AI outage degrades the
  // experience instead of breaking the lesson.
  const providers = buildAiProviders(env);

  // ── Use cases ─────────────────────────────────────────────────────────────
  const recomputeMastery = new RecomputeMasteryUseCase(
    evidenceReader,
    masteryRepository,
    masteryPolicy,
    clock,
  );

  const engagement = new EngagementService(
    new PrismaXpLedger(db),
    new PrismaAnswerHistoryReader(db),
  );

  const administration = new AdministrationService(new PrismaAdministrationRepository(db));
  const textbookAdministration = new TextbookAdministrationService(
    new PrismaTextbookAdministrationRepository(db),
    contentAudit,
    contentAuthoring,
  );

  /**
   * Assessment reports a graded answer; Engagement decides the reward.
   *
   * Wired here for the same reason remediation detection is: Assessment must
   * not know that XP exists, and this is the only file allowed to know both.
   */
  const rewardTrigger: RewardTrigger = {
    async answerGraded(input) {
      const awarded = await engagement.rewardAnswer(input);
      if (!awarded.ok) {
        console.error(
          '[edu7] xp award failed',
          JSON.stringify({ learnerKey: input.learnerKey, code: awarded.error.code }),
        );
      }
    },
  };

  const remediation = new RemediationService(
    remediationRepository,
    gapEvidenceReader,
    resourceReader,
    clock,
  );

  /**
   * Assessment asks for a recompute; it never performs one. Today the trigger
   * runs inline. When throughput demands it, this becomes a queue publisher and
   * NOTHING else in the codebase changes — that is the payoff of the port.
   *
   * Remediation re-detection is chained here, at the composition root, for the
   * same reason: Assessment must not know that Learning exists, and Learning
   * must not poll. The gate says an episode is "opened by evidence" — this is
   * the line that makes that literally true rather than aspirational. Without
   * it an episode only exists if somebody remembers to POST /refresh, which is
   * exactly the legacy failure of a remedial flag nobody ever set.
   *
   * Ordering is load-bearing: detection reads mastery, so it must run AFTER the
   * recompute or it decides on yesterday's numbers.
   */
  const recomputeTrigger: MasteryRecomputeTrigger = {
    async request(learnerKey, conceptKeys) {
      await recomputeMastery.execute({ learnerKey, conceptKeys });

      // Scoped to the concepts just touched. A full-profile sweep on every
      // answer would be quadratic in a learner's history, and nothing outside
      // these concepts can have changed.
      const detected = await remediation.refresh({ learnerKey, conceptKeys });

      if (!detected.ok) {
        // Never fail the submission. The learner answered a question; losing
        // their answer because a downstream detection failed would be a far
        // worse bug than a gap noticed one attempt later. The next answer — or
        // any /refresh — re-derives it, because detection is a pure function of
        // evidence and holds no state of its own.
        console.error(
          '[edu7] remediation detection failed after recompute',
          JSON.stringify({ learnerKey, code: detected.error.code }),
        );
      }
    },
  };

  const assignmentService = new AssignmentService(
    planRepository,
    rosterReader,
    activityReader,
    completionReader,
    clock,
    contentAudit,
  );

  const workspaceImporter = new WorkspaceImporterService(
    workspaceManager,
    new ContentImportService(contentAuthoring, itemBank),
    contentAsset,
    contentEngine,
    env.CONTENT_ENGINE_TIMEOUT_MS,
  );
  const workspaceArchive = new WorkspaceArchiveService(
    workspaceManager,
    workspaceImporter,
    env.CONTENT_ENGINE_PYTHON,
    env.CONTENT_ENGINE_ROOT,
    env.CONTENT_UPLOAD_MAX_BYTES,
    env.CONTENT_ENGINE_TIMEOUT_MS,
  );

  return {
    db,
    clock,
    attemptHistory,
    examCatalog,
    guardianLinks,
    /** Cohort resolution ("class is a query"), shared by analytics and remediation. */
    analyticsReader,
    secureCookies: env.NODE_ENV === 'production',
    cookieSameSite: env.COOKIE_SAMESITE,
    userRepository,
    contentStorage,
    workspaceManager,
    contentAssetRepository,
    useCases: {
      recomputeMastery,
      getMasteryProfile: new GetMasteryProfileUseCase(masteryRepository, masteryPolicy, clock),
      submitAnswer: new SubmitAnswerUseCase(
        questionRepository,
        attemptRepository,
        evidenceWriter,
        recomputeTrigger,
        clock,
        rewardTrigger,
      ),
      runAdaptiveExam: new RunAdaptiveExamUseCase(questionRepository, attemptRepository),
      login: new LoginUseCase(
        userRepository,
        sessionRepository,
        passwordHasher,
        tokenService,
        auditWriter,
        clock,
      ),
      refreshSession: new RefreshSessionUseCase(
        userRepository,
        sessionRepository,
        tokenService,
        auditWriter,
        clock,
      ),
      logout: new LogoutUseCase(sessionRepository, tokenService, auditWriter, clock),
      startAttempt: new StartAttemptUseCase(attemptRepository, clock, examCatalog),
      submitAttempt: new SubmitAttemptUseCase(
        attemptRepository,
        questionRepository,
        recomputeTrigger,
        clock,
      ),
      manualReviews: new ListManualReviewsUseCase(attemptRepository),
      gradeManualAnswer: new GradeManualAnswerUseCase(
        attemptRepository,
        questionRepository,
        evidenceWriter,
        recomputeTrigger,
        clock,
      ),
      getNextStep: new GetNextStepUseCase(
        contentReader,
        masteryReader,
        misconceptionReader,
        resourceReader,
        decisionLog,
      ),
      diagnosticPlacement: new GetDiagnosticPlacementUseCase(contentReader, masteryReader),
      askTutor: new AskTutorUseCase(retriever, providers, aiQuota, aiLog, clock),
      contentAuthoring,
      // Provisioning shares the audit writer and hasher with authentication:
      // one record of who did what, and one definition of how a password is
      // stored.
      provisioning: provisioningService,
      catalogue: catalogueService,
      registerAccount: new RegisterAccountUseCase(provisioningService, provisioningRepository),
      contentExport: new ContentExportService(contentRepository, clock),
      // The SAME authoring and item-bank instances the HTTP API uses, not new
      // ones: import must be an adapter over the canonical write paths, and
      // duplicate instances would be more objects to keep in step.
      contentImport: new ContentImportService(contentAuthoring, itemBank),
      contentAsset,
      workspaceImporter,
      workspaceArchive,
      contentUploadMaxBytes: env.CONTENT_UPLOAD_MAX_BYTES,
      publishing: new PublishingService(
        contentRepository,
        clock,
        contentAudit,
        // Archiving a book supersedes every open gap on its concepts. Wired
        // here rather than imported by Content: the Content context has no
        // idea Learning exists, and this is the only file allowed to know
        // about both.
        {
          async conceptsRetired(conceptKeys) {
            await remediation.supersedeForConcepts(conceptKeys);
          },
        },
      ),
      itemBank,
      remediation,
      textbookAdministration,
      journey,
      subjectsOverview: new SubjectsOverviewUseCase(learnerEntitlements, journey),
      content: contentReader,
      learnerEntitlements,
      flashcards: new FlashcardService(flashcardReader, masteryReader, misconceptionReader),
      engagement,
      administration,
      analytics: new AnalyticsService(
        analyticsReader,
        itemAnalyticsReader,
        clock,
        itemStatisticsWriter,
        new PrismaExamResultsReader(db),
      ),
      assignments: assignmentService,
      dueWork: new DueWorkService(assignmentService, clock),
      parentTasks: new ParentTaskService(
        planRepository,
        guardianLinks,
        activityReader,
        rosterReader,
        clock,
      ),
    },
    async shutdown() {
      await db.$disconnect();
    },
  };
}
