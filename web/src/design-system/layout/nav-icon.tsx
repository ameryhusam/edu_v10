/**
 * Resolve a navigation icon name to a component.
 *
 * Kept apart from `navigation.ts` so that file stays data-only and testable
 * without a DOM. The mapping is explicit rather than dynamic, so the bundler
 * can tree-shake and a typo is a type error.
 */

import {
  BookOpen,
  ClipboardList,
  Database,
  Gauge,
  GraduationCap,
  Home,
  Library,
  LifeBuoy,
  ListChecks,
  Repeat,
  Route,
  School,
  Settings,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from './navigation';

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  route: Route,
  library: Library,
  repeat: Repeat,
  clipboard: ClipboardList,
  trending: TrendingUp,
  users: Users,
  gauge: Gauge,
  listChecks: ListChecks,
  lifeBuoy: LifeBuoy,
  bookOpen: BookOpen,
  database: Database,
  settings: Settings,
  school: School,
  userPlus: UserPlus,
  graduationCap: GraduationCap,
  upload: Upload,
};

export function navIcon(name: NavIcon): LucideIcon {
  return ICONS[name];
}
