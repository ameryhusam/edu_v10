/**
 * AI tutoring routes.
 *
 * Asking the tutor spends the learner's daily quota and is recorded against
 * their history, so it resolves through `requireSelfLearner`: nobody asks on
 * a learner's behalf.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireSelfLearner } from './learner-access.js';
import type { AskTutorUseCase } from '../../contexts/tutoring/application/ask-tutor.use-case.js';
import { handle } from './handler.js';

export interface TutoringRouteDeps {
  readonly askTutor: AskTutorUseCase;
}

const askInput = z.object({
  question: z.string().min(3).max(2000),
  textbookKey: z.string().optional(),
  lessonKey: z.string().optional(),
  conceptKey: z.string().optional(),
  language: z.enum(['ar', 'en']).optional(),
});

export function tutoringRoutes(deps: TutoringRouteDeps): Router {
  const router = Router();

  router.post(
    '/ask',
    handle({
      input: askInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        return deps.askTutor.execute({
          learnerKey: learner.value,
          question: input.question,
          ...(input.textbookKey ? { textbookKey: input.textbookKey } : {}),
          ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
          ...(input.conceptKey ? { conceptKey: input.conceptKey } : {}),
          ...(input.language ? { language: input.language } : {}),
        });
      },
    }),
  );

  return router;
}
