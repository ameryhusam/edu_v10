import { api } from '../../shared/api/client';

export interface TutorCitation {
  readonly chunkId: string;
  readonly label: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
}

export interface AskTutorResponse {
  readonly answer: string;
  readonly grounded: boolean;
  readonly refused: boolean;
  readonly citations: readonly TutorCitation[];
  readonly providerId: string;
  readonly degraded: boolean;
}

export const tutoringApi = {
  ask: (input: {
    readonly question: string;
    readonly textbookKey?: string;
    readonly lessonKey?: string;
    readonly conceptKey?: string;
    readonly language?: 'ar' | 'en';
  }) => api.post<AskTutorResponse>('/tutoring/ask', input),
};
