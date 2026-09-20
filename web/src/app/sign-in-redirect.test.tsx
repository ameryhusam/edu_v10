/**
 * Signing in must actually land you somewhere.
 *
 * Reproduces the reported fault: correct credentials, a 200 from the server,
 * and the user still staring at the login form. The flow crosses three pieces
 * — form, session, router — and each looked right in isolation, which is
 * exactly why it needs a test that exercises all three together.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '../shared/i18n/i18n';
import { SessionProvider, useSession } from '../shared/auth/session';
import { SignInForm } from '../features/auth/sign-in-form';
import { setAccessToken } from '../shared/api/client';

const fetchMock = vi.fn();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data, meta: { requestId: 'r', at: 'now' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function unauthorised(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'auth.required', message: 'Authentication is required.' },
      meta: { requestId: 'r', at: 'now' },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

const ADMIN = {
  key: 'usr_demo_sysadmin',
  username: 'superadmin',
  fullName: 'مدير النظام',
  email: 'superadmin@edu7.local',
  locale: 'ar',
  roles: ['SYSTEM_ADMIN'],
  learnerKey: null,
  scopedRoles: [{ role: 'SYSTEM_ADMIN', schoolId: null }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setAccessToken(null);

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    // Mount restore: no cookie yet, so both the probe and its refresh fail.
    if (path.endsWith('/auth/me')) {
      const headers = new Headers(init?.headers);
      return Promise.resolve(
        headers.get('authorization') ? envelope(ADMIN) : unauthorised(),
      );
    }
    if (path.endsWith('/auth/refresh')) return Promise.resolve(unauthorised());
    if (path.endsWith('/auth/login') && method === 'POST') {
      return Promise.resolve(
        envelope({
          user: {
            key: ADMIN.key,
            username: ADMIN.username,
            fullName: ADMIN.fullName,
            roles: ADMIN.roles,
            learnerKey: null,
          },
          tokens: { accessToken: 'access-token-1' },
        }),
      );
    }
    return Promise.resolve(unauthorised());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The sign-in route, wired the way the real page wires it. */
function SignInRoute(): ReactNode {
  const { status } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  return <SignInForm onSignedIn={() => navigate('/', { replace: true })} />;
}

function AdminLanding(): ReactNode {
  const { hasRole } = useSession();
  return hasRole('SYSTEM_ADMIN') ? <h1>Admin dashboard</h1> : <h1>Somewhere else</h1>;
}

function Guarded({ children }: { readonly children: ReactNode }): ReactNode {
  const { status } = useSession();
  if (status === 'restoring') return <p>restoring</p>;
  if (status === 'anonymous') return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function renderApp(): void {
  render(
    <I18nProvider>
      <SessionProvider>
        <MemoryRouter initialEntries={['/sign-in']}>
          <Routes>
            <Route path="/sign-in" element={<SignInRoute />} />
            <Route
              path="/"
              element={
                <Guarded>
                  <AdminLanding />
                </Guarded>
              }
            />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

describe('signing in', () => {
  it('survives a restore that fails AFTER the user has signed in', async () => {
    // The reported fault. On a cold load the mount probe hits /auth/me, gets
    // 401, tries a refresh, and that fails too — there is no cookie yet. If
    // the user signs in before that sequence finishes, the late failure used
    // to clear the session that had just been created, and the router bounced
    // them straight back to the login form.
    let releaseRestore = (): void => {};
    const restoreBlocked = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    let probeSeen = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const headers = new Headers(init?.headers);

      if (path.endsWith('/auth/me')) {
        if (headers.get('authorization')) return envelope(ADMIN);
        // The cold probe: hold it open until the sign-in has completed.
        probeSeen = true;
        await restoreBlocked;
        return unauthorised();
      }
      if (path.endsWith('/auth/refresh')) return unauthorised();
      if (path.endsWith('/auth/login')) {
        return envelope({
          user: {
            key: ADMIN.key,
            username: ADMIN.username,
            fullName: ADMIN.fullName,
            roles: ADMIN.roles,
            learnerKey: null,
          },
          tokens: { accessToken: 'access-token-1' },
        });
      }
      return unauthorised();
    });

    const user = userEvent.setup();
    renderApp();

    const identifier = await screen.findByRole('textbox');
    await user.type(identifier, 'superadmin');
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    await user.type(password!, 'demo1234');
    await user.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();

    // Now let the stale probe fail. A dead request must not be able to end a
    // session that started after it.
    expect(probeSeen).toBe(true);
    releaseRestore();

    await waitFor(() => expect(screen.getByText('Admin dashboard')).toBeInTheDocument());
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it('leaves the login screen and lands on the role dashboard', async () => {
    const user = userEvent.setup();
    renderApp();

    // Wait for the failed restore to settle, otherwise we type into a form
    // that is about to be re-rendered.
    const identifier = await screen.findByRole('textbox');
    await user.type(identifier, 'superadmin');

    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    await user.type(password!, 'demo1234');

    const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    await user.click(submit!);

    // The actual complaint: this never appeared.
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
  });
});
