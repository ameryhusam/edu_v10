/**
 * Schools, as the UI sees them.
 *
 * Split out of `administration.api.ts` when schools stopped being one catalogue
 * tab among five and became their own management surface: list, lifecycle,
 * and a detail page whose tabs are scoped directories.
 */

import { api } from '../../shared/api/client';

export interface SchoolRecord {
  readonly key: string;
  readonly name: string;
  readonly city: string | null;
  readonly isActive: boolean;
  readonly enrollmentCount: number;
  readonly roleGrantCount: number;
}

export const schoolsApi = {
  list: () => api.get<readonly SchoolRecord[]>('/catalogue/schools'),

  save: (input: { key: string; name: string; city?: string | null }) =>
    api.post<SchoolRecord>('/catalogue/schools', input),

  update: (key: string, input: { name?: string; city?: string | null; isActive?: boolean }) =>
    api.patch<SchoolRecord>(`/catalogue/schools/${encodeURIComponent(key)}`, input),

  remove: (key: string) => api.delete<unknown>(`/catalogue/schools/${encodeURIComponent(key)}`),
};
