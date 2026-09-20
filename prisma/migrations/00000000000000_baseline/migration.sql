-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'CONTENT_AUTHOR');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentNodeType" AS ENUM ('UNIT', 'BRANCH', 'SECTION');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'NUMERIC', 'SHORT_TEXT', 'FILL_BLANK', 'MATCHING', 'ORDERING', 'ESSAY');

-- CreateEnum
CREATE TYPE "QuestionOrigin" AS ENUM ('TEXTBOOK', 'TEACHER', 'AI', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TextbookQuestionRole" AS ENUM ('EXERCISE', 'SELF_TEST', 'REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('PRACTICE', 'LESSON_CHECK', 'EXAM', 'REVIEW', 'DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT', 'SKIPPED', 'INVALID', 'UNGRADABLE', 'REQUIRES_MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('REMEDIATE', 'REVIEW', 'UNBLOCK', 'LEARN', 'PRACTISE', 'ASSESS', 'ADVANCE');

-- CreateEnum
CREATE TYPE "RemediationTrigger" AS ENUM ('MISCONCEPTION', 'MASTERY_GAP');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AssignmentOrigin" AS ENUM ('TEACHER', 'PARENT', 'REMEDIAL', 'ADAPTIVE', 'SELF');

-- CreateEnum
CREATE TYPE "InstructionalActivityType" AS ENUM ('LESSON', 'CONCEPT', 'EXAM', 'REVIEW_SET', 'REMEDIATION_PLAN');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('READING', 'VIDEO', 'WORKED_EXAMPLE', 'FLASHCARD_DECK', 'REMEDIAL', 'TEXTBOOK_PAGE');

-- CreateEnum
CREATE TYPE "AiTask" AS ENUM ('EXPLAIN_CONCEPT', 'ANSWER_QUESTION', 'GENERATE_HINT', 'GENERATE_QUESTIONS', 'GRADE_ESSAY', 'SUMMARISE_PROGRESS');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedToId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RoleName" NOT NULL,
    "schoolId" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "xpTotal" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educator_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" TEXT,
    "specialty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "educator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_links" (
    "id" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "relation" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "academicYearId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "learnerId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textbooks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "termId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "issuer" TEXT,
    "edition" TEXT NOT NULL,
    "isbn" TEXT,
    "publishYear" INTEGER,
    "totalPages" INTEGER,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "textbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textbook_adoptions" (
    "id" UUID NOT NULL,
    "textbookId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "textbook_adoptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "textbookId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "type" "ContentNodeType" NOT NULL DEFAULT 'UNIT',
    "orderIndex" INTEGER NOT NULL,
    "startPage" INTEGER,
    "endPage" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "unitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "estimatedMins" INTEGER,
    "startPage" INTEGER,
    "endPage" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lessonId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "masteryThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pageNumber" INTEGER,
    "sourceRef" TEXT,
    "nameEn" TEXT,
    "bloomsLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_prerequisites" (
    "id" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "prerequisiteId" UUID NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "requiredMastery" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_prerequisites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "misconceptions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "conceptId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "remediation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "misconceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textbook_pages" (
    "id" UUID NOT NULL,
    "textbookId" UUID NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,

    CONSTRAINT "textbook_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_chunks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "pageId" UUID,
    "lessonKey" TEXT,
    "conceptKey" TEXT,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_resources" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT,
    "kind" "ResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "body" TEXT,
    "textbookId" UUID,
    "conceptId" UUID,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "estimatedMins" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcards" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "conceptId" UUID NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "reviewPriority" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "lessonId" UUID NOT NULL,
    "hint" TEXT,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "origin" "QuestionOrigin" NOT NULL DEFAULT 'UNKNOWN',
    "textbookRole" "TextbookQuestionRole",
    "sourceRef" TEXT,
    "irtDiscrimination" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "irtDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "irtGuessing" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "difficulty01" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "timesAdministered" INTEGER NOT NULL DEFAULT 0,
    "correctRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSecondsToAnswer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_choices" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "misconceptionId" UUID,
    "feedback" TEXT,

    CONSTRAINT "question_choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_keys" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "correctChoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numericMin" DOUBLE PRECISION,
    "numericMax" DOUBLE PRECISION,
    "expectedOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedPairs" JSONB,
    "caseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "allowPartialCredit" BOOLEAN NOT NULL DEFAULT true,
    "rubric" JSONB,

    CONSTRAINT "answer_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_concepts" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "question_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "textbookId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isAdaptive" BOOLEAN NOT NULL DEFAULT false,
    "timeLimitMins" INTEGER,
    "passingScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "minItems" INTEGER NOT NULL DEFAULT 5,
    "maxItems" INTEGER NOT NULL DEFAULT 25,
    "targetStandardError" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_items" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "exam_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "learnerId" UUID NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "lessonKey" TEXT,
    "lessonId" UUID,
    "examId" UUID,
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "correctCount" INTEGER,
    "incorrectCount" INTEGER,
    "pendingReviewCount" INTEGER,
    "thetaFinal" DOUBLE PRECISION,
    "standardError" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_items" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "rawAnswer" JSONB NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "scoreEarned" DOUBLE PRECISION,
    "scorePossible" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "normalizedAnswer" TEXT,
    "normalizationApplied" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evaluatorVersion" TEXT NOT NULL,
    "evaluationNote" TEXT,
    "timeSpentSeconds" INTEGER,
    "answeredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_evidence" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "questionKey" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verdict" "Verdict" NOT NULL,
    "misconceptionKey" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastery_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_mastery" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stabilityDays" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "lastObservedAt" TIMESTAMP(3),
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_misconceptions" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "misconceptionId" UUID,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_misconceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_decision_log" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "activity" "ActivityType" NOT NULL,
    "conceptKey" TEXT,
    "rule" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_decision_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_ledger" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructional_plans" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "origin" "AssignmentOrigin" NOT NULL DEFAULT 'TEACHER',
    "activityType" "InstructionalActivityType" NOT NULL,
    "activityKey" TEXT NOT NULL,
    "schoolId" UUID NOT NULL,
    "gradeId" UUID,
    "termId" UUID,
    "assignedById" UUID,
    "availableAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructional_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_obligations" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "planId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
    "evaluatedAt" TIMESTAMP(3),
    "blockedByGate" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "waivedById" UUID,
    "waivedAt" TIMESTAMP(3),
    "waiverReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_episodes" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "learnerId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "trigger" "RemediationTrigger" NOT NULL,
    "status" "RemediationStatus" NOT NULL DEFAULT 'OPEN',
    "misconceptionId" UUID,
    "openedReason" TEXT NOT NULL,
    "resolvedReason" TEXT,
    "openedEvidence" JSONB NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remediation_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "task" "AiTask" NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "grounded" BOOLEAN NOT NULL,
    "chunkKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "refusalReason" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityKey" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_key_key" ON "users"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_role_schoolId_key" ON "user_roles"("userId", "role", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "learner_profiles_key_key" ON "learner_profiles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "learner_profiles_userId_key" ON "learner_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "educator_profiles_key_key" ON "educator_profiles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "educator_profiles_userId_key" ON "educator_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_profiles_key_key" ON "guardian_profiles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_profiles_userId_key" ON "guardian_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_links_guardianId_learnerId_key" ON "guardian_links"("guardianId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "schools_key_key" ON "schools"("key");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_key_key" ON "academic_years"("key");

-- CreateIndex
CREATE UNIQUE INDEX "terms_key_key" ON "terms"("key");

-- CreateIndex
CREATE UNIQUE INDEX "terms_academicYearId_ordinal_key" ON "terms"("academicYearId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "grades_key_key" ON "grades"("key");

-- CreateIndex
CREATE UNIQUE INDEX "grades_ordinal_key" ON "grades"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_key_key" ON "subjects"("key");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_key_key" ON "enrollments"("key");

-- CreateIndex
CREATE INDEX "enrollments_schoolId_academicYearId_idx" ON "enrollments"("schoolId", "academicYearId");

-- CreateIndex
CREATE INDEX "enrollments_learnerId_isCurrent_idx" ON "enrollments"("learnerId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_learnerId_academicYearId_termId_key" ON "enrollments"("learnerId", "academicYearId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "textbooks_key_key" ON "textbooks"("key");

-- CreateIndex
CREATE INDEX "textbooks_status_idx" ON "textbooks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "textbooks_subjectId_gradeId_termId_edition_key" ON "textbooks"("subjectId", "gradeId", "termId", "edition");

-- CreateIndex
CREATE INDEX "textbook_adoptions_academicYearId_idx" ON "textbook_adoptions"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "textbook_adoptions_textbookId_schoolId_academicYearId_key" ON "textbook_adoptions"("textbookId", "schoolId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "units_key_key" ON "units"("key");

-- CreateIndex
CREATE INDEX "units_textbookId_idx" ON "units"("textbookId");

-- CreateIndex
CREATE UNIQUE INDEX "units_textbookId_parentId_slug_key" ON "units"("textbookId", "parentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "units_textbookId_orderIndex_parentId_key" ON "units"("textbookId", "orderIndex", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_key_key" ON "lessons"("key");

-- CreateIndex
CREATE INDEX "lessons_unitId_idx" ON "lessons"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_unitId_slug_key" ON "lessons"("unitId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_unitId_orderIndex_key" ON "lessons"("unitId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_key_key" ON "concepts"("key");

-- CreateIndex
CREATE INDEX "concepts_lessonId_idx" ON "concepts"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_lessonId_slug_key" ON "concepts"("lessonId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_lessonId_orderIndex_key" ON "concepts"("lessonId", "orderIndex");

-- CreateIndex
CREATE INDEX "concept_prerequisites_conceptId_idx" ON "concept_prerequisites"("conceptId");

-- CreateIndex
CREATE INDEX "concept_prerequisites_prerequisiteId_idx" ON "concept_prerequisites"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_prerequisites_conceptId_prerequisiteId_key" ON "concept_prerequisites"("conceptId", "prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "misconceptions_key_key" ON "misconceptions"("key");

-- CreateIndex
CREATE INDEX "misconceptions_conceptId_idx" ON "misconceptions"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "misconceptions_conceptId_slug_key" ON "misconceptions"("conceptId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "textbook_pages_textbookId_pageNumber_key" ON "textbook_pages"("textbookId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "content_chunks_key_key" ON "content_chunks"("key");

-- CreateIndex
CREATE INDEX "content_chunks_lessonKey_idx" ON "content_chunks"("lessonKey");

-- CreateIndex
CREATE INDEX "content_chunks_conceptKey_idx" ON "content_chunks"("conceptKey");

-- CreateIndex
CREATE UNIQUE INDEX "learning_resources_key_key" ON "learning_resources"("key");

-- CreateIndex
CREATE INDEX "learning_resources_conceptId_kind_idx" ON "learning_resources"("conceptId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "learning_resources_conceptId_slug_key" ON "learning_resources"("conceptId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "flashcards_key_key" ON "flashcards"("key");

-- CreateIndex
CREATE INDEX "flashcards_conceptId_isActive_idx" ON "flashcards"("conceptId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "questions_key_key" ON "questions"("key");

-- CreateIndex
CREATE INDEX "questions_status_idx" ON "questions"("status");

-- CreateIndex
CREATE INDEX "questions_origin_textbookRole_idx" ON "questions"("origin", "textbookRole");

-- CreateIndex
CREATE INDEX "questions_lessonId_idx" ON "questions"("lessonId");

-- CreateIndex
CREATE INDEX "question_choices_questionId_idx" ON "question_choices"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "question_choices_questionId_orderIndex_key" ON "question_choices"("questionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "answer_keys_questionId_key" ON "answer_keys"("questionId");

-- CreateIndex
CREATE INDEX "question_concepts_conceptId_idx" ON "question_concepts"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "question_concepts_questionId_conceptId_key" ON "question_concepts"("questionId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "exams_key_key" ON "exams"("key");

-- CreateIndex
CREATE UNIQUE INDEX "exam_items_examId_questionId_key" ON "exam_items"("examId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_key_key" ON "attempts"("key");

-- CreateIndex
CREATE INDEX "attempts_learnerId_status_idx" ON "attempts"("learnerId", "status");

-- CreateIndex
CREATE INDEX "attempts_learnerId_kind_idx" ON "attempts"("learnerId", "kind");

-- CreateIndex
CREATE INDEX "attempt_items_answeredAt_idx" ON "attempt_items"("answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_items_attemptId_questionId_key" ON "attempt_items"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "mastery_evidence_learnerId_conceptId_observedAt_idx" ON "mastery_evidence"("learnerId", "conceptId", "observedAt");

-- CreateIndex
CREATE INDEX "mastery_evidence_observedAt_idx" ON "mastery_evidence"("observedAt");

-- CreateIndex
CREATE INDEX "concept_mastery_learnerId_idx" ON "concept_mastery"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_mastery_learnerId_conceptId_key" ON "concept_mastery"("learnerId", "conceptId");

-- CreateIndex
CREATE INDEX "learner_misconceptions_learnerId_isResolved_idx" ON "learner_misconceptions"("learnerId", "isResolved");

-- CreateIndex
CREATE UNIQUE INDEX "learner_misconceptions_learnerId_conceptId_misconceptionId_key" ON "learner_misconceptions"("learnerId", "conceptId", "misconceptionId");

-- CreateIndex
CREATE INDEX "learning_decision_log_learnerId_decidedAt_idx" ON "learning_decision_log"("learnerId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "xp_ledger_idempotencyKey_key" ON "xp_ledger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "xp_ledger_learnerId_awardedAt_idx" ON "xp_ledger"("learnerId", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "instructional_plans_key_key" ON "instructional_plans"("key");

-- CreateIndex
CREATE INDEX "instructional_plans_schoolId_gradeId_termId_idx" ON "instructional_plans"("schoolId", "gradeId", "termId");

-- CreateIndex
CREATE INDEX "instructional_plans_status_idx" ON "instructional_plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "learner_obligations_key_key" ON "learner_obligations"("key");

-- CreateIndex
CREATE INDEX "learner_obligations_learnerId_status_idx" ON "learner_obligations"("learnerId", "status");

-- CreateIndex
CREATE INDEX "learner_obligations_planId_status_idx" ON "learner_obligations"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "learner_obligations_planId_learnerId_key" ON "learner_obligations"("planId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "remediation_episodes_key_key" ON "remediation_episodes"("key");

-- CreateIndex
CREATE INDEX "remediation_episodes_learnerId_status_idx" ON "remediation_episodes"("learnerId", "status");

-- CreateIndex
CREATE INDEX "remediation_episodes_conceptId_status_idx" ON "remediation_episodes"("conceptId", "status");

-- CreateIndex
CREATE INDEX "ai_interactions_userId_createdAt_idx" ON "ai_interactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_interactions_task_createdAt_idx" ON "ai_interactions"("task", "createdAt");

-- CreateIndex
CREATE INDEX "audit_entries_entity_entityKey_idx" ON "audit_entries"("entity", "entityKey");

-- CreateIndex
CREATE INDEX "audit_entries_createdAt_idx" ON "audit_entries"("createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educator_profiles" ADD CONSTRAINT "educator_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_profiles" ADD CONSTRAINT "guardian_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardian_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbooks" ADD CONSTRAINT "textbooks_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbooks" ADD CONSTRAINT "textbooks_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbooks" ADD CONSTRAINT "textbooks_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_adoptions" ADD CONSTRAINT "textbook_adoptions_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_adoptions" ADD CONSTRAINT "textbook_adoptions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_adoptions" ADD CONSTRAINT "textbook_adoptions_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "misconceptions" ADD CONSTRAINT "misconceptions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_pages" ADD CONSTRAINT "textbook_pages_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "textbook_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_choices" ADD CONSTRAINT "question_choices_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_choices" ADD CONSTRAINT "question_choices_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "misconceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_keys" ADD CONSTRAINT "answer_keys_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_evidence" ADD CONSTRAINT "mastery_evidence_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_evidence" ADD CONSTRAINT "mastery_evidence_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_misconceptions" ADD CONSTRAINT "learner_misconceptions_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_misconceptions" ADD CONSTRAINT "learner_misconceptions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_misconceptions" ADD CONSTRAINT "learner_misconceptions_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "misconceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_decision_log" ADD CONSTRAINT "learning_decision_log_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructional_plans" ADD CONSTRAINT "instructional_plans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructional_plans" ADD CONSTRAINT "instructional_plans_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructional_plans" ADD CONSTRAINT "instructional_plans_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructional_plans" ADD CONSTRAINT "instructional_plans_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_obligations" ADD CONSTRAINT "learner_obligations_planId_fkey" FOREIGN KEY ("planId") REFERENCES "instructional_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_obligations" ADD CONSTRAINT "learner_obligations_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_obligations" ADD CONSTRAINT "learner_obligations_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_episodes" ADD CONSTRAINT "remediation_episodes_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_episodes" ADD CONSTRAINT "remediation_episodes_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_episodes" ADD CONSTRAINT "remediation_episodes_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "misconceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Partial indexes: not expressible in the Prisma schema language.
-- ─────────────────────────────────────────────────────────────────────────────

-- One OPEN remediation episode per (learner, concept, trigger, misconception).
--
-- Deliberately NOT a plain @@unique on those columns: that would forbid the
-- re-opening the design requires, because a RESOLVED episode would block a
-- genuine new gap from ever being recorded. Scoping uniqueness to OPEN rows
-- gives idempotent detection at the database level rather than trusting
-- application logic alone — the lesson from the obligation work, where an
-- application de-dupe needed a real constraint behind it.
--
-- COALESCE because NULL never equals NULL in a unique index, so without it two
-- open MASTERY_GAP episodes (misconceptionId IS NULL) would both be accepted.
CREATE UNIQUE INDEX "remediation_one_open_per_gap"
  ON "remediation_episodes" (
    "learnerId",
    "conceptId",
    "trigger",
    COALESCE("misconceptionId", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" = 'OPEN';
