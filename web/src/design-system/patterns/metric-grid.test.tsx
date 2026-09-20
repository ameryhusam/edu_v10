/**
 * The metric card — the previous system's dashboard stat, rebuilt on this
 * system's rules.
 *
 * The properties under test are the ones that made the original worth cloning
 * and the ones a refactor would silently break:
 *
 *   - the VALUE is rendered as given (a stat card that formats or computes is
 *     a stat card that can lie — FE8's rule, restated where it is enforced);
 *   - the icon is decorative (aria-hidden) — the number and its label carry
 *     the meaning, the tinted box carries the recognition;
 *   - every tone resolves to real classes, so no card ships unstyled because
 *     a class name was built by concatenation Tailwind cannot see.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Award } from 'lucide-react';
import { MetricCard, MetricGrid, type MetricTone } from './metric-grid';

describe('MetricCard', () => {
  it('renders the value exactly as it was given', () => {
    // A pre-formatted percent and a pre-formatted count both arrive as
    // strings and must leave as the same strings: no rounding, no suffixing,
    // no "helpful" formatting that disagrees with the rest of the page.
    render(<MetricCard title="metric.title" value="12" subtitle="metric.subtitle" />);
    const value = screen.getByText('12');
    expect(value.tagName).toBe('DIV');
    expect(screen.getByText('metric.subtitle')).toBeTruthy();
    expect(screen.getByText('metric.title')).toBeTruthy();
  });

  it('marks its icon decorative — the label carries the meaning', () => {
    const { container } = render(
      <MetricCard title="metric.title" value="12" icon={<Award className="size-5" />} />,
    );
    // The icon box is a DIV marked aria-hidden (the glyph inside carries its
    // own), so a screen reader walks title → value → subtitle and never
    // announces "image". The meaningful text must sit OUTSIDE it.
    const box = container.querySelector('div[aria-hidden="true"]');
    expect(box).not.toBeNull();
    expect(box?.querySelector('svg')).not.toBeNull();
    expect(box?.textContent).toBe('');
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('metric.title')).toBeTruthy();
  });

  it('resolves every tone to its own tint classes', () => {
    const tones: readonly MetricTone[] = [
      'accent',
      'success',
      'warning',
      'info',
      'danger',
      'advisory',
    ];
    for (const tone of tones) {
      const { container } = render(
        <MetricCard title="t" value="1" icon={<Award className="size-5" />} tone={tone} />,
      );
      const box = container.querySelector('[aria-hidden="true"]');
      // Not a bare ring-1 box: the tone's text colour reached the icon.
      expect(box?.className, `tone ${tone} produced no tint`).toMatch(/text-(accent|success|warning|info|danger|advisory)\b/);
    }
  });
});

describe('MetricGrid', () => {
  it('holds the four-card row the dashboards open with', () => {
    const { container } = render(
      <MetricGrid>
        <MetricCard title="a" value="1" />
        <MetricCard title="b" value="2" />
        <MetricCard title="c" value="3" />
        <MetricCard title="d" value="4" />
      </MetricGrid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    // One column on a phone, two on a small tablet, four from lg up — the
    // «Nebula» row, collapsing honestly instead of shrinking into illegibility.
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-4');
    expect(screen.getByText('d')).toBeTruthy();
  });
});
