/**
 * Seeded demo accounts — DEVELOPMENT ONLY.
 *
 * Carried over from the previous system, including the rule that made it safe
 * there: **clicking a demo account fills the form and stops.** It does not call
 * signIn, it does not create a session, and it does not select a role. The
 * credentials still travel to POST /auth/login and the server still decides.
 *
 * That distinction is the whole design. A demo button that logs you in is a
 * client-side impersonation path, and the moment one exists someone reaches for
 * it in a demo against production data. A button that types the password for
 * you is a convenience with no authority at all.
 *
 * This module is imported **lazily**, and only when the flag is statically
 * true, so the bundler drops the entire chunk from a production build. The
 * passwords below are seed values from prisma/seed/data/demo-users.json — they
 * exist in the repository already and unlock nothing that is not demo data.
 */

import type { MessageKey } from '../../shared/i18n/messages';

export interface DemoAccount {
  /** Sent as `identifier` — the backend accepts username or email. */
  readonly login: string;
  readonly password: string;
  readonly labelKey: MessageKey;
  /** Which workspace this account lands in, shown as a hint under the label. */
  readonly roleKey: MessageKey;
}

/**
 * Every account in prisma/seed/data/demo-users.json, all with `demo1234`.
 *
 * All nine are listed, not a chosen five. The four that were missing —
 * superadmin, reviewer, ahmed, sara — are the ones that exist precisely
 * because they differ from the obvious case, and leaving them out meant
 * typing a username by hand exactly when the scenario was unusual enough to
 * be worth testing:
 *
 *   superadmin  platform-wide, sees every school; admin sees only sch_demo.
 *               The distinction between them is the authorization boundary.
 *   reviewer    a second CONTENT_AUTHOR, so SUBMIT and APPROVE can be two
 *               different people. Review by one person is not review.
 *   ahmed       a second grade-7 learner, for anything involving more than
 *               one student in the same class.
 *   sara        grade 3 while the others are grade 7, so grade scoping is
 *               visible rather than assumed.
 *
 * `login` must match `username` in the seed data exactly — it is the string
 * sent as `identifier`. The button shows that username underneath the role
 * label, so what you click and what reaches the server are the same thing,
 * and a drift between this list and the seed is visible on screen instead of
 * appearing as a mysterious 401.
 *
 * Ordered by how often they are used when developing, not alphabetically and
 * not by privilege: the student journey is the product.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { login: 'student', password: 'demo1234', labelKey: 'demo.student', roleKey: 'role.STUDENT' },
  { login: 'ahmed', password: 'demo1234', labelKey: 'demo.student2', roleKey: 'role.STUDENT' },
  { login: 'sara', password: 'demo1234', labelKey: 'demo.student3', roleKey: 'role.STUDENT' },
  { login: 'teacher', password: 'demo1234', labelKey: 'demo.teacher', roleKey: 'role.TEACHER' },
  { login: 'parent', password: 'demo1234', labelKey: 'demo.parent', roleKey: 'role.PARENT' },
  { login: 'author', password: 'demo1234', labelKey: 'demo.author', roleKey: 'role.CONTENT_AUTHOR' },
  {
    login: 'reviewer',
    password: 'demo1234',
    labelKey: 'demo.reviewer',
    roleKey: 'role.CONTENT_AUTHOR',
  },
  { login: 'admin', password: 'demo1234', labelKey: 'demo.admin', roleKey: 'role.SCHOOL_ADMIN' },
  {
    login: 'superadmin',
    password: 'demo1234',
    labelKey: 'demo.superadmin',
    roleKey: 'role.SYSTEM_ADMIN',
  },
];
