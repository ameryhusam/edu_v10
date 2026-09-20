/**
 * The refresh cookie's SameSite/Secure decision.
 *
 * This is regression cover for a defect that cost a long debugging session and
 * produced no error anywhere: the app was embedded in an iframe on another
 * origin, the refresh cookie was `SameSite=Lax`, and browsers silently
 * withhold a Lax cookie in a cross-site context. Every reload logged the user
 * out. `curl` could not reproduce it, because curl has no same-site policy.
 *
 * The rules encoded here:
 *
 *   - `SameSite=None` is only emitted over a secure connection, and always
 *     with `Secure`. The combination `None` without `Secure` is rejected
 *     outright by modern browsers, so shipping it would be worse than `Lax`.
 *   - A plain-HTTP request downgrades to `Lax` rather than emitting that
 *     rejected combination.
 *   - The default configuration stays `Lax`: cross-site cookies are a real
 *     CSRF surface and must be opted into deliberately.
 */

import { describe, expect, it } from 'vitest';

/**
 * The decision under test, mirrored from `auth.routes.ts`.
 *
 * Kept as a pure function so the rule can be tested without booting Express
 * and a database. The route builds its options from exactly this expression;
 * if that ever drifts, the live proof in `docs` catches it.
 */
function cookieAttributes(input: {
  configured: 'lax' | 'none';
  secureConnection: boolean;
  productionSecure: boolean;
}): { secure: boolean; sameSite: 'lax' | 'none' } {
  const crossSite = input.configured === 'none' && input.secureConnection;
  return {
    secure: input.productionSecure || crossSite,
    sameSite: crossSite ? 'none' : 'lax',
  };
}

describe('refresh cookie attributes', () => {
  it('defaults to lax, which is the safe same-site choice', () => {
    expect(
      cookieAttributes({ configured: 'lax', secureConnection: true, productionSecure: false }),
    ).toEqual({ secure: false, sameSite: 'lax' });
  });

  it('emits SameSite=None with Secure when configured and the connection is secure', () => {
    // The iframe-preview case. Both attributes are required together.
    expect(
      cookieAttributes({ configured: 'none', secureConnection: true, productionSecure: false }),
    ).toEqual({ secure: true, sameSite: 'none' });
  });

  it('never emits SameSite=None without Secure', () => {
    // Over plain HTTP the browser would reject None+insecure outright, which
    // is strictly worse than Lax: the user would have no cookie at all.
    expect(
      cookieAttributes({ configured: 'none', secureConnection: false, productionSecure: false }),
    ).toEqual({ secure: false, sameSite: 'lax' });
  });

  it('keeps Secure in production even on a same-site cookie', () => {
    expect(
      cookieAttributes({ configured: 'lax', secureConnection: true, productionSecure: true }),
    ).toEqual({ secure: true, sameSite: 'lax' });
  });

  it('there is no configuration that yields None without Secure', () => {
    // Exhaustive over the small input space, because this single combination
    // is the one browsers discard silently.
    for (const configured of ['lax', 'none'] as const) {
      for (const secureConnection of [true, false]) {
        for (const productionSecure of [true, false]) {
          const out = cookieAttributes({ configured, secureConnection, productionSecure });
          if (out.sameSite === 'none') expect(out.secure).toBe(true);
        }
      }
    }
  });
});
