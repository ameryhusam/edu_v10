import type { ReactNode } from 'react';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import type { PublicationStatus } from './content.api';

const PUBLICATION_TONE: Record<PublicationStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

export function PublicationBadge({ status }: { readonly status: PublicationStatus }): ReactNode {
  const { t } = useI18n();
  return <Badge tone={PUBLICATION_TONE[status]}>{t(`publication.${status}` as MessageKey)}</Badge>;
}
