/** Staff and guardian remediation reads. */

import { api } from '../../shared/api/client';

export type RemediationTrigger = 'MISCONCEPTION' | 'MASTERY_GAP';
export type RemediationStatus = 'OPEN' | 'RESOLVED' | 'SUPERSEDED';

export interface RemediationRecommendation {
  readonly resourceKey: string;
  readonly kind: string;
  readonly title: string;
  readonly estimatedMins: number | null;
  readonly reason: string;
}

export interface EpisodeView {
  readonly episodeKey: string;
  readonly learnerKey: string;
  readonly conceptKey: string;
  readonly trigger: RemediationTrigger;
  readonly status: RemediationStatus;
  readonly misconceptionKey: string | null;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly recommendations: readonly RemediationRecommendation[];
  readonly ageDays: number;
  readonly durationDays: number | null;
  readonly evidence: Record<string, unknown>;
}

export interface TrackerRow {
  readonly learnerKey: string;
  readonly openCount: number;
  readonly episodes: readonly EpisodeView[];
}

export interface RemediationSummary {
  readonly open: number;
  readonly resolved: number;
  readonly byTrigger: Record<RemediationTrigger, number>;
  readonly medianDaysToResolve: number | null;
  readonly stale: readonly string[];
}

export const remediationApi = {
  openEpisodes: (learnerKey?: string) =>
    api.get<readonly EpisodeView[]>('remediation/episodes', {
      query: learnerKey ? { learnerKey } : {},
    }),
  history: (learnerKey?: string) =>
    api.get<readonly EpisodeView[]>('remediation/episodes/history', {
      query: learnerKey ? { learnerKey } : {},
    }),
  refresh: (params?: { learnerKey?: string; textbookKey?: string }) =>
    api.post<readonly EpisodeView[]>('remediation/refresh', params ?? {}),
  tracker: (scope: { schoolId: string; gradeId?: string; termId?: string; staleAfterDays?: number }) =>
    api.get<{ learners: readonly TrackerRow[]; summary: RemediationSummary }>('remediation/tracker', {
      query: scope,
    }),
};
