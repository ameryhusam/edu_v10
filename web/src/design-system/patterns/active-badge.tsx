import type { ReactNode } from 'react';
import { Badge } from '../ui/badge';
import { useI18n } from '../../shared/i18n/i18n';

export function ActiveBadge({ isActive }: { readonly isActive: boolean }): ReactNode {
  const { t } = useI18n();
  return (
    <Badge tone={isActive ? 'success' : 'neutral'}>
      {t(isActive ? 'catalogue.active' : 'catalogue.inactive')}
    </Badge>
  );
}
