/**
 * A password field with a reveal toggle.
 *
 * Extracted because both forms need it and the accessible details are easy to
 * get wrong twice: the toggle is a real button with a label that changes with
 * state, and it sits inside the field rather than beside the label so the
 * touch target does not collide with the input on a phone.
 *
 * The toggle does not submit — `type="button"` — which is the single most
 * common bug in a hand-rolled version of this.
 */

import { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '../../design-system/ui/input';
import { useI18n } from '../../shared/i18n/i18n';

export function PasswordInput(props: Omit<InputProps, 'type' | 'trailingSlot'>): ReactNode {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      trailingSlot={
        <button
          type="button"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={visible}
          className="grid size-9 place-items-center rounded-lg text-text-subtle transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}
