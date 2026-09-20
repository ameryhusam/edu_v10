/**
 * A teacher's roster (gap G3).
 *
 * Edu7 has no class or section model by decision — a class is a query over
 * current enrollments. So a roster is requested as a *scope* (school, and
 * optionally grade and term), and the server resolves it. There is no class id
 * to hold onto, and the UI must not invent one.
 */

import { api } from '../../shared/api/client';

export interface RosterLearner {
  readonly learnerKey: string;
  readonly fullName: string;
  readonly gradeName: string;
  readonly gradeId: string;
}

export const rosterApi = {
  list: (scope: { schoolId: string; gradeId?: string; termId?: string }) =>
    api.get<{ learners: readonly RosterLearner[] }>('analytics/roster', { query: scope }),
};
