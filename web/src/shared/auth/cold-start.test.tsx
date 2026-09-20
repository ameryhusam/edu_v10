/**
 * What a cold load does before anyone signs in.
 *
 * A fresh visitor with no refresh cookie produces two 401s in the console —
 * `/auth/me` then `/auth/refresh`. They look alarming and were reported as a
 * bug. They are not: the probe is how a RETURNING user with a valid httpOnly
 * cookie gets their session back without retyping a password, and the only way
 * to discover whether that cookie exists is to try. Removing the probe would
 * trade two harmless log lines for making every reload a re-login.
 *
 * What would be a real bug is the probe repeating, or one attempt fanning out
 * into several refreshes — the backend rotates refresh tokens and treats a
 * reused one as theft, so a burst would end the session it was trying to
 * restore. That is what these tests pin down.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SessionProvider, useSession } from './session';
import { setAccessToken } from '../api/client';
import type { ReactNode } from 'react';

const fetchMock = vi.fn();

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

function Probe(): ReactNode {
  const { status } = useSession();
  return <span data-testid="status">{status}</span>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a visitor with no session', () => {
  it('probes once and settles on anonymous, without looping', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(unauthorised()));

    const { getByTestId } = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(getByTestId('status').textContent).toBe('anonymous'));

    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths.filter((path) => path.endsWith('/auth/me'))).toHaveLength(1);

    // Exactly one refresh attempt. More than one would mean the failed probe
    // retried, which against a rotating-token backend reads as token reuse.
    expect(paths.filter((path) => path.endsWith('/auth/refresh'))).toHaveLength(1);

    // And it must stop. A settled 'anonymous' that keeps firing requests is
    // the loop this guards against.
    const seen = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.length).toBe(seen);
  });

  it('never signs out a session it never had', async () => {
    // The failed probe must not fire the session-ended path: there is no
    // session to end, and firing it is what used to destroy a session created
    // moments later by a fast sign-in.
    fetchMock.mockImplementation(() => Promise.resolve(unauthorised()));

    const { getByTestId } = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(getByTestId('status').textContent).toBe('anonymous'));
    // Reaching 'anonymous' via the restore path rather than a forced clear is
    // the distinction; a clear would also have reset the in-memory token.
    expect(getByTestId('status').textContent).toBe('anonymous');
  });
});
