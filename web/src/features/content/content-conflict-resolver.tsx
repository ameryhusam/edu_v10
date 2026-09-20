/**
 * content-conflict-resolver.tsx
 *
 * Conflict resolution and diff preview component for curriculum imports.
 * Allows users to review discrepancies between existing system records
 * and imported file records, choosing between versions per item or in bulk.
 */

import { type ReactNode } from 'react';
import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import type { ConflictItem } from './csv-curriculum-parser';

export interface ContentConflictResolverProps {
  readonly conflicts: ConflictItem[];
  readonly identicalCount: number;
  readonly newCount: number;
  readonly onUpdateChoice: (conflictId: string, choice: 'FILE' | 'SYSTEM') => void;
  readonly onSetAllChoices: (choice: 'FILE' | 'SYSTEM') => void;
}

export function ContentConflictResolver({
  conflicts,
  identicalCount,
  newCount,
  onUpdateChoice,
  onSetAllChoices,
}: ContentConflictResolverProps): ReactNode {
  const { t } = useI18n();

  return (
    <div className="space-y-4 rounded-xl border border-warning/30 bg-surface p-4">
      {/* Header and Stats */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-warning-subtle text-warning">
            <AlertTriangle className="size-4" />
          </span>
          <div>
            <h4 className="text-xs font-bold text-text">
              {t('contentImport.conflictsFound', { count: conflicts.length })}
            </h4>
            <p className="text-2xs text-text-muted">{t('contentImport.conflictsGuidance')}</p>
          </div>
        </div>

        {/* Bulk Action Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onSetAllChoices('FILE')}
            className="text-xs"
          >
            <Check className="size-3.5" />
            <span>{t('contentImport.chooseAllFile')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSetAllChoices('SYSTEM')}
            className="text-xs"
          >
            <RotateCcw className="size-3.5" />
            <span>{t('contentImport.chooseAllSystem')}</span>
          </Button>
        </div>
      </div>

      {/* Identical / New Badges */}
      <div className="flex flex-wrap gap-2 text-2xs">
        {identicalCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-subtle px-2.5 py-1 text-text-muted border border-border">
            <span>✓</span>
            <span>{t('contentImport.skippedIdentical', { count: identicalCount })}</span>
          </span>
        )}
        {newCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-subtle px-2.5 py-1 text-accent border border-accent/20">
            <span>+</span>
            <span>{t('contentImport.newItemsToCreate', { count: newCount })}</span>
          </span>
        )}
      </div>

      {/* Conflicts List */}
      <div className="space-y-3">
        {conflicts.map((conflict) => (
          <div
            key={conflict.id}
            className="space-y-2 rounded-xl border border-border bg-surface-subtle p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={conflict.type === 'unit' ? 'accent' : 'neutral'}>
                  {conflict.type === 'unit'
                    ? t('content.unit')
                    : conflict.type === 'lesson'
                      ? t('content.lesson')
                      : t('content.concept')}
                </Badge>
                <span className="text-2xs font-semibold text-text">{conflict.path}</span>
              </div>
              <span className="text-2xs text-text-muted">{conflict.field}</span>
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* System Version */}
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-colors ${
                  conflict.choice === 'SYSTEM'
                    ? 'border-accent bg-accent-subtle/30 ring-1 ring-accent'
                    : 'border-border bg-surface hover:bg-surface-subtle'
                }`}
              >
                <div className="flex items-center justify-between text-2xs">
                  <span className="font-semibold text-text-muted">{t('contentImport.systemValue')}</span>
                  <input
                    type="radio"
                    name={`conflict-${conflict.id}`}
                    checked={conflict.choice === 'SYSTEM'}
                    onChange={() => onUpdateChoice(conflict.id, 'SYSTEM')}
                    className="accent-accent"
                  />
                </div>
                <p className="text-xs text-text">{conflict.systemValue}</p>
              </label>

              {/* File Version */}
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-colors ${
                  conflict.choice === 'FILE'
                    ? 'border-accent bg-accent-subtle/30 ring-1 ring-accent'
                    : 'border-border bg-surface hover:bg-surface-subtle'
                }`}
              >
                <div className="flex items-center justify-between text-2xs">
                  <span className="font-semibold text-accent">{t('contentImport.fileValue')}</span>
                  <input
                    type="radio"
                    name={`conflict-${conflict.id}`}
                    checked={conflict.choice === 'FILE'}
                    onChange={() => onUpdateChoice(conflict.id, 'FILE')}
                    className="accent-accent"
                  />
                </div>
                <p className="text-xs font-medium text-text">{conflict.fileValue}</p>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
