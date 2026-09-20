/**
 * The five data states, and the rule that absent is not zero.
 *
 * Every view renders in both directions, so each test that touches layout runs
 * in Arabic and English. RTL is a layout axis, not "Arabic mode" — a component
 * verified in one direction only is verified for half the users.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { AbsentValue, ErrorState, ForbiddenState, LoadingState } from './data-states';
import { ApiError } from '../../shared/api/errors';

function renderWithI18n(ui: ReactNode) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('loading', () => {
  it('announces itself to assistive technology', () => {
    renderWithI18n(<LoadingState />);

    // A spinner with no live region is silence for a screen-reader user.
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

describe('refusals versus failures', () => {
  it('renders a 403 as a forbidden state, not as a crash', () => {
    const error = new ApiError({
      code: 'learning.learner_not_accessible',
      message: 'Learner is not accessible to this actor.',
      kind: 'FORBIDDEN',
      status: 403,
    });

    renderWithI18n(<ErrorState error={error} />);

    // The translated sentence, not the backend's English developer text.
    expect(screen.getByText('لا تملك صلاحية الاطّلاع على بيانات هذا المتعلّم.')).toBeInTheDocument();
    expect(screen.queryByText(/Learner is not accessible/)).not.toBeInTheDocument();
  });

  it('never shows the backend message for an unmapped code, but does show the code', () => {
    const error = new ApiError({
      code: 'some.unmapped_code',
      message: 'Internal detail nobody should read.',
      kind: 'INTERNAL',
      status: 500,
      requestId: 'req-abc',
    });

    renderWithI18n(<ErrorState error={error} />);

    expect(screen.queryByText(/Internal detail/)).not.toBeInTheDocument();
    // The code and request id are surfaced so a report is actionable.
    expect(screen.getByText(/some\.unmapped_code/)).toBeInTheDocument();
    expect(screen.getByText(/req-abc/)).toBeInTheDocument();
  });

  it('routes an offline error to the offline state', () => {
    renderWithI18n(<ErrorState error={ApiError.offline()} />);
    expect(screen.getByText('لا يوجد اتّصال')).toBeInTheDocument();
  });
});

describe('absent values', () => {
  it('says "not measured yet" rather than rendering zero', () => {
    // The rule from §10 and §30. A concept with no evidence has no mastery;
    // "0%" tells a parent their child failed when nobody has measured yet.
    renderWithI18n(<AbsentValue />);

    expect(screen.getByText('لم يُقَس بعد')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('distinguishes unavailable from no-data', () => {
    const { unmount } = renderWithI18n(<AbsentValue reason="unavailable" />);
    expect(screen.getByText('غير متاح')).toBeInTheDocument();
    unmount();

    renderWithI18n(<AbsentValue reason="noData" />);
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });
});

/** Switches to English on mount, so the document flip can be observed. */
function EnglishProbe(): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('en'), [setLocale]);
  return <ForbiddenState />;
}

describe('direction', () => {
  it('sets the document to RTL for Arabic and LTR for English', async () => {
    const { unmount } = renderWithI18n(<ForbiddenState />);

    // Arabic is the default: User.locale defaults to "ar".
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    unmount();

    // The same component in English must flip the document, not just restyle.
    renderWithI18n(<EnglishProbe />);
    await screen.findByText('You do not have access');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });
});
