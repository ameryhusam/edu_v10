/**
 * Routes.
 *
 * Phase 1 ships the shell and the authenticated boundary. The role landing
 * pages are placeholders that state honestly what they are waiting for — they
 * render no invented data, because a screen full of plausible fake numbers is
 * indistinguishable from a working one and gets signed off as done (§53).
 *
 * Route-level code splitting is deliberately absent for now: with this few
 * routes it would add indirection without shortening anything measurable.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '../design-system/layout/app-shell';
import { ForbiddenState, LoadingState } from '../design-system/patterns/data-states';
import { useSession } from '../shared/auth/session';
import { useI18n } from '../shared/i18n/i18n';
import { SignInPage } from '../pages/sign-in';

const PhaseTwoPlaceholder = lazy(() => import('../pages/placeholder'));

// Phase 2 student screens. Lazily loaded: a teacher or admin never downloads
// the learner journey, and the learner's first paint is the thing that matters.
const StudentDashboard = lazy(() =>
  import('../pages/student/dashboard').then((m) => ({ default: m.StudentDashboardPage })),
);
const LearningPath = lazy(() =>
  import('../pages/student/learning-path').then((m) => ({ default: m.LearningPathPage })),
);
const JuniorDashboard = lazy(() =>
  import('../pages/student/junior-dashboard').then((m) => ({ default: m.JuniorDashboardPage })),
);
const Exams = lazy(() =>
  import('../pages/student/exams').then((m) => ({ default: m.ExamsPage })),
);
const LessonView = lazy(() =>
  import('../pages/student/lesson').then((m) => ({ default: m.LessonPage })),
);
const Review = lazy(() =>
  import('../pages/student/review').then((m) => ({ default: m.ReviewPage })),
);
const Diagnostic = lazy(() =>
  import('../pages/student/diagnostic').then((m) => ({ default: m.DiagnosticPage })),
);
const Progress = lazy(() =>
  import('../pages/student/progress').then((m) => ({ default: m.ProgressPage })),
);
const Subjects = lazy(() =>
  import('../pages/student/subjects').then((m) => ({ default: m.SubjectsPage })),
);
const ParentHome = lazy(() =>
  import('../pages/parent/parent-home').then((m) => ({ default: m.ParentHomePage })),
);
const ParentWork = lazy(() =>
  import('../pages/parent/work').then((m) => ({ default: m.ParentWorkPage })),
);
const TeacherMaterials = lazy(() =>
  import('../pages/teacher/materials').then((m) => ({ default: m.TeacherMaterialsPage })),
);
const ContentSetup = lazy(() =>
  import('../pages/admin/content-setup').then((m) => ({ default: m.ContentSetupPage })),
);
const TeacherHome = lazy(() =>
  import('../pages/teacher/teacher-home').then((m) => ({ default: m.TeacherHomePage })),
);
const TeacherAssignments = lazy(() =>
  import('../pages/teacher/assignments').then((m) => ({ default: m.TeacherAssignmentsPage })),
);
const TeacherResults = lazy(() =>
  import('../pages/teacher/results').then((m) => ({ default: m.TeacherResultsPage })),
);
const TeacherInterventions = lazy(() =>
  import('../pages/teacher/interventions').then((m) => ({ default: m.TeacherInterventionsPage })),
);
const ManualGrading = lazy(() =>
  import('../pages/teacher/manual-grading').then((m) => ({ default: m.ManualGradingPage })),
);
const AdminOverview = lazy(() =>
  import('../pages/admin/admin-overview').then((m) => ({ default: m.AdminOverviewPage })),
);
const AcademicStructure = lazy(() =>
  import('../pages/admin/academic-structure').then((m) => ({ default: m.AcademicStructurePage })),
);
const AdminUsers = lazy(() =>
  import('../pages/admin/user-directory').then((m) => ({ default: m.UserDirectoryPage })),
);
const Schools = lazy(() =>
  import('../pages/admin/schools').then((m) => ({ default: m.SchoolsPage })),
);
const SchoolDetail = lazy(() =>
  import('../pages/admin/school-detail').then((m) => ({ default: m.SchoolDetailPage })),
);
const Enrollments = lazy(() =>
  import('../pages/admin/enrollments').then((m) => ({ default: m.EnrollmentsPage })),
);
const Teachers = lazy(() =>
  import('../pages/admin/teachers').then((m) => ({ default: m.TeachersPage })),
);
const TextbooksAdmin = lazy(() =>
  import('../pages/admin/textbooks-admin').then((m) => ({ default: m.TextbooksAdminPage })),
);
const ProjectImport = lazy(() =>
  import('../pages/admin/project-import').then((m) => ({ default: m.ProjectImportPage })),
);
const Settings = lazy(() =>
  import('../pages/admin/settings').then((m) => ({ default: m.SettingsPage })),
);
const AuthorQuestionBank = lazy(() =>
  import('../pages/author/question-bank').then((m) => ({ default: m.AuthorQuestionBankPage })),
);

/**
 * Everything inside requires a session.
 *
 * A *presentation* guard. It decides what to render, never what is permitted —
 * the backend rejects an unauthenticated request whatever this component does.
 */
function RequireSession({ children }: { children: ReactNode }): ReactNode {
  const { status } = useSession();
  const { t } = useI18n();
  const location = useLocation();

  // The refresh cookie may still yield a session, so "restoring" must not be
  // treated as signed out — that would bounce a returning user to sign-in on
  // every reload.
  if (status === 'restoring') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState label={t('auth.restoring')} />
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/**
 * Send each role to its own landing route.
 *
 * Learner first: a user who is a learner is, on balance, here to learn, even
 * if they also hold a staff role in another school.
 */
function RoleLanding(): ReactNode {
  const { user, hasRole } = useSession();

  if (user?.learnerKey) return <StudentDashboard />;
  if (hasRole('TEACHER')) return <Navigate to="/teacher" replace />;
  if (hasRole('PARENT')) return <Navigate to="/parent" replace />;
  if (hasRole('CONTENT_AUTHOR')) return <Navigate to="/author" replace />;
  if (hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN')) return <Navigate to="/admin" replace />;

  return <PlaceholderRoute area="student" />;
}

function PlaceholderRoute({ area }: { area: string }): ReactNode {
  return (
    <Suspense fallback={<LoadingState />}>
      <PhaseTwoPlaceholder area={area} />
    </Suspense>
  );
}

/**
 * Presentation boundary for role-specific surfaces.
 *
 * This does not authorize anything; the backend remains the security boundary.
 * It prevents a signed-in user from navigating into another role's screen by
 * URL and keeps the route contract aligned with the role-specific navigation.
 */
function RequireRole({
  roles,
  learnerOnly = false,
  children,
}: {
  readonly roles?: readonly import('../shared/types/roles').RoleName[];
  readonly learnerOnly?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { user, hasRole } = useSession();

  if (learnerOnly && !user?.learnerKey) return <PlaceholderRoute area="student" />;
  if (roles && !hasRole(...roles)) return <ForbiddenState />;

  return <>{children}</>;
}

export function AppRouter(): ReactNode {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />

        <Route
          path="*"
          element={
            <RequireSession>
              <AppShell>
                <Routes>
                  <Route path="/" element={<RoleLanding />} />
                  <Route path="/path" element={<RequireRole learnerOnly><LearningPath /></RequireRole>} />
                  <Route path="/lesson" element={<RequireRole learnerOnly><LessonView /></RequireRole>} />
                  <Route path="/junior" element={<RequireRole learnerOnly><JuniorDashboard /></RequireRole>} />
                  <Route path="/review" element={<RequireRole learnerOnly><Review /></RequireRole>} />
                  <Route path="/diagnostic" element={<RequireRole learnerOnly><Diagnostic /></RequireRole>} />
                  <Route path="/exams" element={<RequireRole learnerOnly><Exams /></RequireRole>} />
                  <Route path="/progress" element={<RequireRole learnerOnly><Progress /></RequireRole>} />
                  <Route path="/subjects" element={<RequireRole learnerOnly><Subjects /></RequireRole>} />

                  <Route path="/teacher" element={<RequireRole roles={['TEACHER']}><TeacherHome /></RequireRole>} />
                  <Route path="/teacher/classes" element={<RequireRole roles={['TEACHER']}><PlaceholderRoute area="teacher" /></RequireRole>} />
                  <Route path="/teacher/assignments" element={<RequireRole roles={['TEACHER']}><TeacherAssignments /></RequireRole>} />
                  <Route path="/teacher/results" element={<RequireRole roles={['TEACHER']}><TeacherResults /></RequireRole>} />
                  <Route path="/teacher/interventions" element={<RequireRole roles={['TEACHER']}><TeacherInterventions /></RequireRole>} />
                  <Route path="/teacher/grading" element={<RequireRole roles={['TEACHER']}><ManualGrading /></RequireRole>} />
                  <Route path="/teacher/content" element={<RequireRole roles={['TEACHER']}><TeacherMaterials /></RequireRole>} />
                  <Route path="/teacher/reports" element={<RequireRole roles={['TEACHER']}><PlaceholderRoute area="teacher" /></RequireRole>} />
                  <Route path="/teacher/*" element={<RequireRole roles={['TEACHER']}><PlaceholderRoute area="teacher" /></RequireRole>} />
                  <Route path="/parent" element={<RequireRole roles={['PARENT']}><ParentHome /></RequireRole>} />
                  <Route path="/parent/learning" element={<RequireRole roles={['PARENT']}><PlaceholderRoute area="parent" /></RequireRole>} />
                  <Route path="/parent/progress" element={<RequireRole roles={['PARENT']}><PlaceholderRoute area="parent" /></RequireRole>} />
                  <Route path="/parent/work" element={<RequireRole roles={['PARENT']}><ParentWork /></RequireRole>} />
                  <Route path="/parent/support" element={<RequireRole roles={['PARENT']}><PlaceholderRoute area="parent" /></RequireRole>} />
                  <Route path="/parent/*" element={<RequireRole roles={['PARENT']}><PlaceholderRoute area="parent" /></RequireRole>} />
                  <Route path="/author" element={<RequireRole roles={['CONTENT_AUTHOR']}><Navigate to="/author/questions" replace /></RequireRole>} />
                  <Route path="/author/textbooks" element={<RequireRole roles={['CONTENT_AUTHOR']}><PlaceholderRoute area="author" /></RequireRole>} />
                  <Route path="/author/questions" element={<RequireRole roles={['CONTENT_AUTHOR']}><AuthorQuestionBank /></RequireRole>} />
                  <Route path="/author/*" element={<RequireRole roles={['CONTENT_AUTHOR']}><PlaceholderRoute area="author" /></RequireRole>} />
                  <Route path="/admin" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><AdminOverview /></RequireRole>} />
                  <Route path="/admin/users" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><AdminUsers /></RequireRole>} />
                  <Route path="/admin/structure" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><AcademicStructure /></RequireRole>} />
                  <Route path="/admin/schools" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><Schools /></RequireRole>} />
                  <Route path="/admin/schools/:schoolKey" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><SchoolDetail /></RequireRole>} />
                  <Route path="/admin/enrollments" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><Enrollments /></RequireRole>} />
                  <Route path="/admin/teachers" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><Teachers /></RequireRole>} />
                  <Route path="/admin/textbooks" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><TextbooksAdmin /></RequireRole>} />
                  <Route path="/admin/content" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR']}><ContentSetup /></RequireRole>} />
                  <Route path="/admin/import" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><ProjectImport /></RequireRole>} />
                  <Route path="/admin/settings" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><Settings /></RequireRole>} />
                  <Route path="/admin/*" element={<RequireRole roles={['SYSTEM_ADMIN', 'SCHOOL_ADMIN']}><PlaceholderRoute area="admin" /></RequireRole>} />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </RequireSession>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
