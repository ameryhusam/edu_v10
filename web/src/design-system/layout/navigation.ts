/**
 * What each role sees in the navigation.
 *
 * Declared as data, not as JSX scattered through a shell component, so the
 * role→destination matrix is reviewable in one place and testable without
 * rendering anything.
 *
 * **This is presentation, not authorization.** Hiding a destination is a
 * convenience; the backend refuses the request regardless, and every screen
 * still handles a 403 (§13). A user holding two roles sees the union.
 *
 * `primary` marks the ≤5 destinations that appear in the mobile bottom bar
 * (§40). Everything else moves into the drawer on compact viewports.
 */

import type { MessageKey } from '../../shared/i18n/messages';
import type { RoleName } from '../../shared/types/roles';

export interface NavDestination {
  readonly to: string;
  readonly labelKey: MessageKey;
  /** Lucide icon name, resolved by the shell so this file stays JSX-free. */
  readonly icon: NavIcon;
  /** Shown in the mobile bottom bar. At most five per role. */
  readonly primary: boolean;
  /**
   * The section a destination belongs to. Grouped destinations render under
   * their section's header in the sidebar; ungrouped ones (the learner,
   * teacher and parent surfaces) render as before, headerless.
   */
  readonly group?: NavGroup;
}

/** Sidebar sections, in display order. */
export type NavGroup = 'overview' | 'academic' | 'people' | 'content' | 'settings';

export type NavIcon =
  | 'home'
  | 'route'
  | 'library'
  | 'repeat'
  | 'clipboard'
  | 'trending'
  | 'users'
  | 'gauge'
  | 'listChecks'
  | 'lifeBuoy'
  | 'bookOpen'
  | 'database'
  | 'settings'
  | 'school'
  | 'userPlus'
  | 'graduationCap'
  | 'upload';

const STUDENT: readonly NavDestination[] = [
  { to: '/', labelKey: 'nav.home', icon: 'home', primary: true },
  { to: '/path', labelKey: 'nav.learningPath', icon: 'route', primary: true },
  { to: '/review', labelKey: 'nav.review', icon: 'repeat', primary: true },
  { to: '/exams', labelKey: 'nav.exams', icon: 'clipboard', primary: true },
  { to: '/progress', labelKey: 'nav.progress', icon: 'trending', primary: true },
  { to: '/subjects', labelKey: 'nav.subjects', icon: 'library', primary: false },
  // The junior board — the legacy "البراعم" home for grades 1-4.
  { to: '/junior', labelKey: 'nav.junior', icon: 'graduationCap', primary: false },
];

const TEACHER: readonly NavDestination[] = [
  { to: '/teacher', labelKey: 'nav.dashboard', icon: 'gauge', primary: true },
  { to: '/teacher/classes', labelKey: 'nav.classes', icon: 'users', primary: true },
  { to: '/teacher/assignments', labelKey: 'nav.assignments', icon: 'listChecks', primary: true },
  { to: '/teacher/results', labelKey: 'nav.results', icon: 'clipboard', primary: true },
  { to: '/teacher/interventions', labelKey: 'nav.interventions', icon: 'lifeBuoy', primary: true },
  { to: '/teacher/grading', labelKey: 'nav.manualGrading', icon: 'clipboard', primary: false },
  { to: '/teacher/content', labelKey: 'nav.content', icon: 'bookOpen', primary: false },
  { to: '/teacher/reports', labelKey: 'nav.reports', icon: 'trending', primary: false },
];

const PARENT: readonly NavDestination[] = [
  { to: '/parent', labelKey: 'nav.home', icon: 'home', primary: true },
  { to: '/parent/learning', labelKey: 'nav.childLearning', icon: 'route', primary: true },
  { to: '/parent/progress', labelKey: 'nav.progress', icon: 'trending', primary: true },
  { to: '/parent/work', labelKey: 'nav.academicWork', icon: 'listChecks', primary: true },
  { to: '/parent/support', labelKey: 'nav.support', icon: 'lifeBuoy', primary: true },
];

const CONTENT_AUTHOR: readonly NavDestination[] = [
  { to: '/author', labelKey: 'nav.content', icon: 'bookOpen', primary: true },
  { to: '/author/textbooks', labelKey: 'nav.textbooks', icon: 'library', primary: true },
  { to: '/author/questions', labelKey: 'nav.questionBank', icon: 'database', primary: true },
  // The content-setup tables: the same curriculum the author prepares,
  // browsable as data. Reads are staff-gated at the API; this is the way in.
  { to: '/admin/content', labelKey: 'nav.contentSetup', icon: 'library', primary: false },
];

/**
 * The admin surface. Primary (bottom-bar) keeps the four acts an
 * administrator returns to hourly; the rest are one tap further, in the
 * drawer — depth, not clutter.
 */
const ADMIN: readonly NavDestination[] = [
  { to: '/admin', labelKey: 'nav.dashboard', icon: 'gauge', primary: true, group: 'overview' },
  { to: '/admin/structure', labelKey: 'nav.structure', icon: 'database', primary: true, group: 'academic' },
  { to: '/admin/schools', labelKey: 'nav.schools', icon: 'school', primary: true, group: 'academic' },
  { to: '/admin/enrollments', labelKey: 'nav.enrollments', icon: 'userPlus', primary: false, group: 'academic' },
  { to: '/admin/users', labelKey: 'nav.users', icon: 'users', primary: true, group: 'people' },
  { to: '/admin/teachers', labelKey: 'nav.teachers', icon: 'graduationCap', primary: false, group: 'people' },
  { to: '/admin/textbooks', labelKey: 'nav.textbookAdmin', icon: 'bookOpen', primary: false, group: 'content' },
  { to: '/admin/content', labelKey: 'nav.contentSetup', icon: 'library', primary: false, group: 'content' },
  { to: '/admin/import', labelKey: 'nav.imports', icon: 'upload', primary: false, group: 'content' },
  { to: '/admin/settings', labelKey: 'nav.settings', icon: 'settings', primary: true, group: 'settings' },
];

const BY_ROLE: Record<RoleName, readonly NavDestination[]> = {
  STUDENT: STUDENT,
  TEACHER: TEACHER,
  PARENT: PARENT,
  CONTENT_AUTHOR: CONTENT_AUTHOR,
  SCHOOL_ADMIN: ADMIN,
  SYSTEM_ADMIN: ADMIN,
};

/**
 * The destinations for a set of roles, de-duplicated, in a stable order.
 *
 * A teacher who is also a parent sees both sets rather than one chosen by
 * precedence: guessing which role someone "really" is produces a UI that hides
 * a destination they need.
 */
export function destinationsFor(roles: readonly RoleName[]): readonly NavDestination[] {
  const seen = new Set<string>();
  const result: NavDestination[] = [];

  for (const role of roles) {
    for (const destination of BY_ROLE[role] ?? []) {
      if (seen.has(destination.to)) continue;
      seen.add(destination.to);
      result.push(destination);
    }
  }

  return result;
}

/**
 * The bottom-bar destinations.
 *
 * Capped at five. Beyond that the targets get too narrow to hit reliably on a
 * phone, which is the whole reason for the cap.
 */
export function primaryDestinations(
  destinations: readonly NavDestination[],
): readonly NavDestination[] {
  return destinations.filter((destination) => destination.primary).slice(0, 5);
}
