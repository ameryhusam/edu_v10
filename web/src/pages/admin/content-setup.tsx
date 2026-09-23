import { type ReactNode } from 'react';
import { ContentOutlineBrowser } from '../../features/content/content-outline-browser';

export function ContentSetupPage(): ReactNode {
  return <ContentOutlineBrowser titleKey="contentSetup.title" subtitleKey="contentSetup.subtitle" />;
}
