import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../shared/api/query-keys';
import { remediationApi, type EpisodeView } from './remediation.api';

export function useRemediationEpisodes(learnerKey?: string) {
  return useQuery<readonly EpisodeView[]>({
    queryKey: queryKeys.remediation.episodes(learnerKey ? { learnerKey } : {}),
    queryFn: async () => {
      const res = await remediationApi.openEpisodes(learnerKey);
      // Backend returns either an array of EpisodeView or wrapped
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object' && 'episodes' in res) {
        return (res as { episodes: readonly EpisodeView[] }).episodes;
      }
      return [];
    },
  });
}
