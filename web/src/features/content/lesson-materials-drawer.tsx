import type { ReactNode } from 'react';
import { MaterialsList } from './content-materials-panel';
import { useI18n } from '../../shared/i18n/i18n';

export interface LessonMaterialsDrawerProps {
  readonly lessonKey: string;
  readonly onClose: () => void;
}

export function LessonMaterialsDrawer({
  lessonKey,
  onClose,
}: LessonMaterialsDrawerProps): ReactNode {
  const { t } = useI18n();

  return (
    <div
      className="fixed inset-0 z-modal flex justify-start bg-scrim"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-inline-end border-border bg-surface p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t('content.lessonMaterials')}</h2>
          <button
            type="button"
            className="text-xs text-text-muted hover:text-text"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>
        <MaterialsList lessonKey={lessonKey} />
      </div>
    </div>
  );
}
