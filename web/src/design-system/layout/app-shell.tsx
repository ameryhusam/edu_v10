/**
 * The Edu7 application shell.
 *
 * One shell for every role (§40): the destinations change, the structure does
 * not. Building a separate teacher shell is how a product ends up with two
 * design systems and a sign-out button in two different places.
 *
 * Layout responsibilities only — it renders navigation and an outlet. It
 * fetches nothing and knows no educational vocabulary.
 *
 * Responsive behaviour is a *change of interaction model*, not a resize:
 *
 *   >= lg   persistent sidebar, header with actions
 *   <  lg   top bar + bottom tab bar, sidebar becomes a focus-trapped drawer
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { useSession } from '../../shared/auth/session';
import { useIsExpanded } from '../../shared/hooks/use-breakpoint';
import { destinationsFor, primaryDestinations, type NavDestination } from './navigation';
import { navIcon } from './nav-icon';
import { Sidebar } from './sidebar';
import { NavigationDrawer } from './navigation-drawer';
import { UserMenu } from './user-menu';
import { Aurora } from './aurora';

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const { t } = useI18n();
  const { user } = useSession();
  const expanded = useIsExpanded();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const destinations = destinationsFor((user?.roles ?? []).map((grant) => grant.role));
  const bottomBar = primaryDestinations(destinations);

  // Navigating must close the drawer, or a tap appears to do nothing on a
  // phone: the route changes behind an overlay that is still covering it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-canvas">
      {/* «Nebula's» quiet backdrop, behind everything and touching nothing. */}
      <Aurora />
      {/* First focusable element on the page. Keyboard users should not have
          to tab through the whole navigation on every route. */}
      <a
        href="#main"
        className={cn(
          'sr-only focus:not-sr-only',
          'focus:fixed focus:inset-block-start-3 focus:inset-inline-start-3 focus:z-(--z-index-toast)',
          'focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg',
        )}
      >
        {t('a11y.skipToContent')}
      </a>

      {expanded ? (
        <Sidebar destinations={destinations} />
      ) : (
        <NavigationDrawer
          destinations={destinations}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Logical inset, not margin-left: in RTL the sidebar is on the right,
          and a physical property would put the content underneath it. */}
      <div className={cn('flex min-h-dvh flex-col', expanded && 'ps-64')}>
        <header
          className={cn(
            'sticky top-0 z-(--z-index-sticky)',
            'flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur',
          )}
        >
          {!expanded && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('nav.openMenu')}
              aria-expanded={drawerOpen}
            >
              <Menu aria-hidden="true" />
            </Button>
          )}

          {!expanded && (
            <span className="font-display text-lg font-semibold text-text">{t('app.name')}</span>
          )}

          <div className="ms-auto flex items-center gap-2">
            <UserMenu />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'flex-1 px-4 py-6 lg:px-8',
            // Room for the bottom bar so the last card is never trapped
            // underneath it, plus the iOS home indicator.
            !expanded && bottomBar.length > 0 && 'pb-[calc(5rem+env(safe-area-inset-bottom))]',
          )}
        >
          {children}
        </main>
      </div>

      {!expanded && bottomBar.length > 0 && <BottomBar destinations={bottomBar} />}
    </div>
  );
}

/**
 * The mobile tab bar.
 *
 * At most five destinations, each a full-height target so the tap area is the
 * whole cell rather than the label.
 */
function BottomBar({ destinations }: { destinations: readonly NavDestination[] }): ReactNode {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t('nav.primary')}
      className={cn(
        'fixed inset-inline-0 bottom-0 z-(--z-index-sticky)',
        'border-t border-border bg-surface/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${destinations.length}, 1fr)` }}>
        {destinations.map((destination) => {
          const Icon = navIcon(destination.icon);
          return (
            <li key={destination.to}>
              <NavLink
                to={destination.to}
                end={destination.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2',
                    'text-2xs font-medium transition-colors duration-(--duration-fast)',
                    isActive ? 'text-accent' : 'text-text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className="size-5"
                      aria-hidden="true"
                      // The active tab is not signalled by colour alone.
                      strokeWidth={isActive ? 2.5 : 1.75}
                    />
                    <span className="truncate">{t(destination.labelKey)}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
