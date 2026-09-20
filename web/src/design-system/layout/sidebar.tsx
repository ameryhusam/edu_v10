/**
 * The persistent sidebar, shown at `lg` and above.
 *
 * Anchored with logical insets so it sits on the right in Arabic and the left
 * in English without a second implementation.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { navIcon } from './nav-icon';
import type { NavDestination, NavGroup } from './navigation';

export function Sidebar({
  destinations,
}: {
  destinations: readonly NavDestination[];
}): ReactNode {
  const { t } = useI18n();

  return (
    <aside
      className={cn(
        'fixed inset-block-0 inset-inline-start-0 z-(--z-index-sticky) w-64',
        'flex flex-col border-inline-end border-border bg-surface',
        'border-e',
      )}
    >
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="font-display text-xl font-bold text-accent">{t('app.name')}</span>
      </div>

      <nav aria-label={t('nav.primary')} className="flex-1 overflow-y-auto px-3 py-2">
        <NavSections destinations={destinations} />
      </nav>
    </aside>
  );
}

const GROUP_ORDER: readonly NavGroup[] = ['overview', 'academic', 'people', 'content', 'settings'];

/**
 * Sections: the admin surface is a map, not a strip. Ungrouped destinations
 * (learner, teacher, parent) render first and headerless, exactly as before —
 * grouping is a property a destination declares, not a layout forced on
 * everyone. A mixed-role user (say teacher + school admin) sees their flat
 * destinations, then the admin sections.
 */
function NavSections({ destinations }: { destinations: readonly NavDestination[] }): ReactNode {
  const { t } = useI18n();
  const ungrouped = destinations.filter((d) => d.group === undefined);
  return (
    <>
      {ungrouped.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {ungrouped.map((destination) => (
            <li key={destination.to}>
              <NavItem destination={destination} />
            </li>
          ))}
        </ul>
      ) : null}
      {GROUP_ORDER.map((group) => {
        const items = destinations.filter((d) => d.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="mt-4 first:mt-0">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t(`nav.group.${group}` as Parameters<typeof t>[0])}
            </p>
            <ul className="flex flex-col gap-1">
              {items.map((destination) => (
                <li key={destination.to}>
                  <NavItem destination={destination} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function NavItem({ destination }: { destination: NavDestination }): ReactNode {
  const { t } = useI18n();
  const Icon = navIcon(destination.icon);

  return (
    <NavLink
      to={destination.to}
      end={destination.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
          'transition-colors duration-(--duration-fast)',
          isActive
            ? 'bg-accent-subtle text-accent'
            : 'text-text-muted hover:bg-surface-sunken hover:text-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="size-5 shrink-0" aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.75} />
          <span className="truncate">{t(destination.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
