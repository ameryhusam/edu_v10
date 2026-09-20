/**
 * The brand panel beside the auth form.
 *
 * The sign-in screen is the only screen in the product with nothing for the
 * user to do, so it is the one place a brand may take up room. Everywhere
 * else, decoration competes with work.
 *
 * The effects are deliberately restrained to three: two soft colour fields, a
 * fine grid, and a slow drift on the fields. Each is cheap — transform and
 * opacity only, so they run on the compositor and never touch layout — and all
 * of them stop dead under `prefers-reduced-motion`, which is handled globally
 * in styles.css rather than per-component.
 *
 * What is deliberately absent: particle canvases, mouse-tracking parallax,
 * animated gradients on text. They look impressive in a screenshot, cost real
 * battery on the mid-range Android phones this product's users actually carry,
 * and make the first paint later on the one screen where speed is felt.
 */

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { LogoMark } from '../../design-system/brand/logo';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

interface Highlight {
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}

const HIGHLIGHTS: readonly Highlight[] = [
  { titleKey: 'signIn.feature.adaptive.title', bodyKey: 'signIn.feature.adaptive.body' },
  { titleKey: 'signIn.feature.mastery.title', bodyKey: 'signIn.feature.mastery.body' },
  { titleKey: 'signIn.feature.remediation.title', bodyKey: 'signIn.feature.remediation.body' },
];

export function AuthShowcase(): ReactNode {
  const { t } = useI18n();

  return (
    <section
      // Decorative by nature: everything here is repeated in the form panel's
      // heading, so a screen reader gains nothing by walking it.
      aria-hidden="true"
      className="relative hidden overflow-hidden rounded-3xl bg-brand-deep p-10 text-brand-on lg:flex lg:flex-col lg:justify-between"
    >
      {/* Two colour fields. `blur-3xl` on a plain div is far cheaper than a
          real gradient mesh and indistinguishable at this scale. */}
      <div
        className="pointer-events-none absolute -top-24 -end-24 size-80 rounded-full bg-brand-glow opacity-25 blur-3xl motion-safe:animate-drift-slow"
      />
      <div
        className="pointer-events-none absolute -bottom-32 -start-20 size-96 rounded-full bg-brand-mid opacity-40 blur-3xl motion-safe:animate-drift-slower"
      />

      {/* A fine grid, masked so it fades out rather than ending on a hard
          line. Pure CSS — no image request. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-brand-hairline) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand-hairline) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 30% 20%, black 20%, transparent 75%)',
        }}
      />

      <div className="relative space-y-8">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-veil ring-1 ring-brand-hairline backdrop-blur-sm">
            <LogoMark className="size-7" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">{t('app.wordmark')}</p>
            <p className="text-xs text-brand-on-muted">{t('app.name')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-veil px-3 py-1 text-2xs font-semibold ring-1 ring-brand-hairline">
            <Sparkles className="size-3" />
            {t('signIn.badge')}
          </span>
          <h2 className="max-w-sm text-3xl font-extrabold leading-tight">
            {t('signIn.pitch.title')}
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-brand-on-muted">
            {t('signIn.pitch.body')}
          </p>
        </div>
      </div>

      <ul className="relative mt-10 space-y-3">
        {HIGHLIGHTS.map((highlight) => (
          <li
            key={highlight.titleKey}
            className="rounded-2xl bg-brand-veil p-4 ring-1 ring-brand-hairline backdrop-blur-sm"
          >
            <h3 className="text-sm font-bold">{t(highlight.titleKey)}</h3>
            <p className="mt-1 text-2xs leading-relaxed text-brand-on-muted">
              {t(highlight.bodyKey)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
