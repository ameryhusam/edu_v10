/** Admin data import page. */

import type { ReactNode } from 'react';
import { PageHeader } from '../../design-system/patterns/page-header';
import { ProjectImportPanel } from '../../features/administration/project-import-panel';
import { useI18n } from '../../shared/i18n/i18n';

export function ProjectImportPage(): ReactNode {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader title={t('projectImport.title')} subtitle={t('projectImport.subtitle')} />
      <ProjectImportPanel />
    </div>
  );
}
