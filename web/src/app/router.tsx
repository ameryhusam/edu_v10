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
import { LoadingState } from '../design-system/patterns/data-states';
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
                  <Route path="/path" element={<LearningPath />} />
                  <Route path="/lesson" element={<LessonView />} />
                  <Route path="/junior" element={<JuniorDashboard />} />
                  <Route path="/review" element={<Review />} />
                  <Route path="/diagnostic" element={<Diagnostic />} />
                  <Route path="/exams" element={<Exams />} />
                  <Route path="/progress" element={<Progress />} />
                  <Route path="/subjects" element={<Subjects />} />

                  <Route path="/teacher" element={<TeacherHome />} />
                  <Route path="/teacher/classes" element={<PlaceholderRoute area="teacher" />} />
                  <Route path="/teacher/assignments" element={<TeacherAssignments />} />
                  <Route path="/teacher/results" element={<TeacherResults />} />
                  <Route path="/teacher/interventions" element={<TeacherInterventions />} />
                  <Route path="/teacher/grading" element={<ManualGrading />} />
                  <Route path="/teacher/content" element={<TeacherMaterials />} />
                  <Route path="/teacher/reports" element={<PlaceholderRoute area="teacher" />} />
                  <Route path="/teacher/*" element={<PlaceholderRoute area="teacher" />} />
                  <Route path="/parent" element={<ParentHome />} />
                  <Route path="/parent/learning" element={<PlaceholderRoute area="parent" />} />
                  <Route path="/parent/progress" element={<PlaceholderRoute area="parent" />} />
                  <Route path="/parent/work" element={<ParentWork />} />
                  <Route path="/parent/support" element={<PlaceholderRoute area="parent" />} />
                  <Route path="/parent/*" element={<PlaceholderRoute area="parent" />} />
                  <Route path="/author" element={<Navigate to="/author/questions" replace />} />
                  <Route path="/author/textbooks" element={<PlaceholderRoute area="author" />} />
                  <Route path="/author/questions" element={<AuthorQuestionBank />} />
                  <Route path="/author/*" element={<PlaceholderRoute area="author" />} />
                  <Route path="/admin" element={<AdminOverview />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/structure" element={<AcademicStructure />} />
                  <Route path="/admin/schools" element={<Schools />} />
                  <Route path="/admin/schools/:schoolKey" element={<SchoolDetail />} />
                  <Route path="/admin/enrollments" element={<Enrollments />} />
                  <Route path="/admin/teachers" element={<Teachers />} />
                  <Route path="/admin/textbooks" element={<TextbooksAdmin />} />
                  <Route path="/admin/content" element={<ContentSetup />} />
                  <Route path="/admin/import" element={<ProjectImport />} />
                  <Route path="/admin/settings" element={<Settings />} />
                  <Route path="/admin/*" element={<PlaceholderRoute area="admin" />} />

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
