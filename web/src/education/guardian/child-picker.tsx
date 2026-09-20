/**
 * Which child am I looking at?
 *
 * Rendered only when a guardian has more than one. The same reasoning as the
 * textbook picker: a control offering a single option is a decision the
 * interface is pretending to offer.
 *
 * Shows the name and grade together, because two siblings may share a first
 * name in the way the school records it, and the grade is what distinguishes
 * them at a glance.
 */

import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { cn } from '../../design-system/ui/cn';
import type { GuardianChild } from '../learning/learning.api';

export interface ChildPickerProps {
  readonly options: readonly GuardianChild[];
  readonly selected: string | null;
  readonly onSelect: (learnerKey: string) => void;
}

export function ChildPicker({ options, selected, onSelect }: ChildPickerProps): ReactNode {
  const { t } = useI18n();

  return (
    <div role="radiogroup" aria-label={t('parent.chooseChild')} className="flex flex-wrap gap-2">
      {options.map((child) => {
        const isSelected = child.learnerKey === selected;
        return (
          <button
            key={child.learnerKey}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(child.learnerKey)}
            className={cn(
              'min-h-11 rounded-xl border px-3.5 py-2 text-start transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
              isSelected
                ? 'border-accent bg-accent-subtle text-text'
                : 'border-border bg-surface text-text-muted hover:border-border-strong',
            )}
          >
            <span className="block text-sm font-bold">{child.fullName}</span>
            <span className="block text-2xs text-text-muted">
              {child.gradeName ?? t('parent.notEnrolled')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
