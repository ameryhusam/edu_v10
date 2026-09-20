/**
 * Content setup — the tables behind the curriculum.
 *
 * The audit's deferred question ("content-setup admin visibility") answered:
 * the units, lessons and materials an author writes are browsable here, by the
 * administrator who owns the platform and the author who owns the book. The
 * write path stays where it was (authoring endpoints under their own gate);
 * this is the read that lets both of them see what exists without opening a
 * database console.
 */

import { type ReactNode } from 'react';
import { ContentOutlineBrowser } from '../../features/content/content-outline-browser';

export function ContentSetupPage(): ReactNode {
  return <ContentOutlineBrowser titleKey="contentSetup.title" subtitleKey="contentSetup.subtitle" />;
}
