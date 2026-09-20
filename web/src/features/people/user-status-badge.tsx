import type { ReactNode } from 'react';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import type { UserStatus } from './people.api';

const USER_STATUS_TONE: Record<UserStatus, 'success' | 'warning' | 'info' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  INVITED: 'info',
  ARCHIVED: 'neutral',
};

export function UserStatusBadge({ status }: { readonly status: UserStatus }): ReactNode {
  const { t } = useI18n();
  return <Badge tone={USER_STATUS_TONE[status]}>{t(`userStatus.${status}` as MessageKey)}</Badge>;
}
