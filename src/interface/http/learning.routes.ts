/**
 * Learning routes — use-case endpoints, not table endpoints.
 *
 * `/learning/next-step` is a question a learner actually has. There is no
 * `/concepts?filter=...` CRUD surface here, because the client should never be
 * assembling pedagogy out of raw rows — that is exactly how business rules leak
 * into the UI and then diverge between web and mobile.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import { resolveLearnerKey } from './learner-access.js';
import type { GetNextStepUseCase } from '../../contexts/learning/application/get-next-step.use-case.js';
import type { GetDiagnosticPlacementUseCase } from '../../contexts/learning/application/get-diagnostic-placement.use-case.js';
import type { JourneyService } from '../../contexts/learning/application/journey.service.js';
import type { FlashcardService } from '../../contexts/learning/application/flashcard.service.js';
import type { GetMasteryProfileUseCase } from '../../contexts/mastery/application/get-mastery-profile.use-case.js';
import type { LearnerEntitlementReader, ContentReader } from '../../contexts/learning/application/ports.js';
import type { SubjectsOverviewUseCase } from '../../contexts/learning/application/subjects-overview.use-case.js';
import { Err } from '../../shared/kernel/result.js';
import { Errors } from '../../shared/kernel/errors.js';
import { Ok } from '../../shared/kernel/result.js';
import { handle } from './handler.js';

export interface LearningRouteDeps {
  readonly getNextStep: GetNextStepUseCase;
  readonly diagnosticPlacement: GetDiagnosticPlacementUseCase;
  readonly getMasteryProfile: GetMasteryProfileUseCase;
  readonly journey: JourneyService;
  readonly subjectsOverview: SubjectsOverviewUseCase;
  readonly content: ContentReader;
  readonly flashcards: FlashcardService;
  /** Guardian access is verified per request, never inferred from a token. */
  readonly learnerEntitlements: LearnerEntitlementReader;
  readonly guardianLinks: GuardianLinkReader;
}

const nextStepInput = z
  .object({
    lessonKey: z.string().min(1).optional(),
    textbookKey: z.string().min(1).optional(),
    /** Parents and staff may name a learner; learners may only omit it. */
    learnerKey: z.string().min(1).optional(),
  })
  .refine((v) => v.lessonKey || v.textbookKey, {
    message: 'Provide either lessonKey or textbookKey.',
  });

const pathInput = z.object({
  textbookKey: z.string().min(1),
  learnerKey: z.string().min(1).optional(),
});

const diagnosticPlacementInput = z.object({
  textbookKey: z.string().min(1),
  learnerKey: z.string().min(1).optional(),
});

const lessonInput = z.object({
  lessonKey: z.string().min(1),
  learnerKey: z.string().min(1).optional(),
});

const completionInput = z.object({
  lessonKey: z.string().min(1),
  learnerKey: z.string().min(1).optional(),
});

const deckInput = z
  .object({
    lessonKey: z.string().min(1).optional(),
    conceptKey: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    learnerKey: z.string().min(1).optional(),
  })
  .refine((v) => v.lessonKey || v.conceptKey, {
    message: 'Provide either lessonKey or conceptKey.',
  });

const masteryInput = z.object({
  learnerKey: z.string().min(1).optional(),
  conceptKeys: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v)),
});

export function learningRoutes(deps: LearningRouteDeps): Router {
  const router = Router();

  /**
   * My children (gap G2).
   *
   * A guardian could not previously discover who their children are: the only
   * listing was admin-scoped and keyed by guardianKey, which a parent's token
   * does not carry. Every parent-facing screen needs this first — it is the
   * parent's equivalent of the learner's textbook list.
   *
   * The guardian is taken from the SESSION, never from a parameter. An
   * endpoint that accepted a guardianKey would have to prove the caller owns
   * it, which is the same check done the hard way; deriving it from the token
   * makes the wrong request impossible to express.
   *
   * Returns verified links only, because that is what `childrenFor` selects —
   * an unverified claim of guardianship grants nothing, and showing an
   * unverified child here would imply access the learner routes then refuse.
   */
  router.get(
    '/children',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ actor }) => {
        const children = await deps.guardianLinks.childrenFor(actor!.userId);
        return Ok({ children });
      },
    }),
  );

  /**
   * Which textbooks may this learner study? (gap G1)
   *
   * The entry point to every other learning route: they all take a textbook
   * key, and before this existed there was no way to obtain one except to know
   * it in advance. Scoped by the same learner-access boundary as the rest, so
   * a guardian may read a linked child's list and nobody else can.
   */
  router.get(
    '/textbooks',
    handle({
      input: z.object({ learnerKey: z.string().min(1).optional() }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;

        const textbooks = await deps.learnerEntitlements.textbooksFor(learner.value);
        return Ok({ learnerKey: learner.value, textbooks });
      },
    }),
  );

  /** What should I do next? The core adaptive endpoint. */
  router.get(
    '/next-step',
    handle({
      input: nextStepInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.getNextStep.execute({
          learnerKey: learner.value,
          ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
          ...(input.textbookKey ? { textbookKey: input.textbookKey } : {}),
        });
      },
    }),
  );

  /** Diagnostic placement: where evidence says this learner should start. */
  router.get(
    '/diagnostic-placement',
    handle({
      input: diagnosticPlacementInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.diagnosticPlacement.execute({
          learnerKey: learner.value,
          textbookKey: input.textbookKey,
        });
      },
    }),
  );

  /** Current mastery profile, with forgetting already applied. */
  router.get(
    '/mastery',
    handle({
      input: masteryInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.getMasteryProfile.execute({
          learnerKey: learner.value,
          ...(input.conceptKeys?.length ? { conceptKeys: input.conceptKeys } : {}),
        });
      },
    }),
  );

  /**
   * Where am I? The map of the book with the learner's position on it.
   *
   * READ-delegable: this is the screen a parent or teacher most wants, and
   * nothing here produces evidence, so it resolves through the same canonical
   * boundary as every other learner-scoped read.
   */
  router.get(
    '/path',
    handle({
      input: pathInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.journey.path({
          learnerKey: learner.value,
          textbookKey: input.textbookKey,
        });
      },
    }),
  );

  /**
   * May I move on from this lesson?
   *
   * A GET, deliberately. Completion is a reading of evidence, not a thing to
   * be declared — there is no POST that marks a lesson done, which is the
   * correction of legacy's PATCHable `masteryAchieved`.
   */
  router.get(
    '/completion',
    handle({
      input: completionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.journey.lessonCompletion({
          learnerKey: learner.value,
          lessonKey: input.lessonKey,
        });
      },
    }),
  );

  /**
   * One lesson, opened: shelf data, the reading, additional options, the
   * concepts with the learner's states, and the completion gate.
   *
   * READ-delegable like /path: nothing here produces evidence. The states and
   * the gate come from the same journey reads the path screen uses, so a
   * lesson screen and a path screen can never disagree about a concept.
   */
  router.get(
    '/lesson',
    handle({
      input: lessonInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;

        const view = await deps.content.lessonView(input.lessonKey);
        if (!view) {
          return Err(
            Errors.notFound('learning.lesson_not_available', 'No published lesson with this key.', {
              lessonKey: input.lessonKey,
            }),
          );
        }

        // Entitlement: the lesson's book must be on this learner's shelf.
        // A lesson key is knowledge, not permission.
        const shelf = await deps.learnerEntitlements.textbooksFor(learner.value);
        if (!shelf.some((b) => b.key === view.textbookKey)) {
          return Err(
            Errors.forbidden('learning.textbook_not_entitled', 'This textbook is not on your shelf.', {
              textbookKey: view.textbookKey,
            }),
          );
        }

        const [journey, completion] = await Promise.all([
          deps.journey.path({ learnerKey: learner.value, textbookKey: view.textbookKey }),
          deps.journey.lessonCompletion({ learnerKey: learner.value, lessonKey: view.key }),
        ]);
        if (!journey.ok) return journey;
        if (!completion.ok) return completion;

        // Only this lesson's stations, in book order.
        const concepts = journey.value.path.filter((n) => n.lessonKey === view.key);
        const lessonRollup = journey.value.progress.lessons.find((l) => l.key === view.key) ?? null;

        return Ok({
          lesson: {
            key: view.key,
            name: view.name,
            startPage: view.startPage,
            endPage: view.endPage,
            estimatedMins: view.estimatedMins,
            unitKey: view.unitKey,
            unitName: view.unitName,
            textbookKey: view.textbookKey,
            textbookTitle: view.textbookTitle,
          },
          resources: view.resources,
          concepts,
          progress: lessonRollup,
          completion: completion.value,
          currentConceptKey: journey.value.currentConceptKey,
        });
      },
    }),
  );

  /**
   * The shelf by subject: how am I doing in science, in maths?
   *
   * Every number is the journey's own per-book roll-up, summed by concept
   * counts — never an average of percentages. See the use-case header.
   */
  router.get(
    '/subjects',
    handle({
      input: z.object({ learnerKey: z.string().min(1).optional() }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.subjectsOverview.execute({ learnerKey: learner.value });
      },
    }),
  );

  /**
   * A flashcard deck, ordered hardest-trouble-first.
   *
   * A GET, and there is no companion POST to record a review: flipping a card
   * is not evidence. Legacy treated "I knew that one" as a correct answer and
   * inflated mastery without a single graded question.
   */
  router.get(
    '/flashcards',
    handle({
      input: deckInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.flashcards.deck({
          learnerKey: learner.value,
          lessonKey: input.lessonKey,
          conceptKey: input.conceptKey,
          limit: input.limit,
        });
      },
    }),
  );

  return router;
}
