import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Brain, HelpCircle, CheckCircle2, AlertCircle } from 'lucide-react';
import { MaterialsList } from './content-materials-panel';
import { LessonPageViewer } from './lesson-page-viewer';
import { Button } from '../../design-system/ui/button';
import { textbookAdministrationApi } from './content.api';
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
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const enrichConcepts = useMutation({
    mutationFn: () => textbookAdministrationApi.enrichLessonConcepts(lessonKey),
    onSuccess: (data) => {
      const count = data.concepts?.length || 0;
      setFeedback({
        message: `تم توليد وإضافة ${count} مفهوم(مفاهيم) بنجاح عبر الذكاء الاصطناعي.`,
        type: 'success',
      });
      qc.invalidateQueries({ queryKey: ['content-outline'] });
      qc.invalidateQueries({ queryKey: ['concepts'] });
      qc.invalidateQueries({ queryKey: ['admin-textbook-materials'] });
    },
    onError: (err: any) => {
      setFeedback({
        message: err?.message || 'تعذر توليد المفاهيم عبر الذكاء الاصطناعي.',
        type: 'error',
      });
    },
  });

  const enrichQuestions = useMutation({
    mutationFn: () => textbookAdministrationApi.enrichLessonQuestions(lessonKey, 4),
    onSuccess: (data) => {
      const count = data.questions?.length || 0;
      setFeedback({
        message: `تم توليد وإضافة ${count} سؤال تقييمي بنجاح في بنك الأسئلة.`,
        type: 'success',
      });
      qc.invalidateQueries({ queryKey: ['questions'] });
      qc.invalidateQueries({ queryKey: ['admin-textbook-materials'] });
    },
    onError: (err: any) => {
      setFeedback({
        message: err?.message || 'تعذر توليد الأسئلة عبر الذكاء الاصطناعي.',
        type: 'error',
      });
    },
  });

  return (
    <div
      className="fixed inset-0 z-modal flex justify-start bg-scrim"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-inline-end border-border bg-surface p-5 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-black text-text">{t('content.lessonMaterials')}</h2>
            <div className="text-2xs text-text-muted mt-0.5 truncate max-w-xs">{lessonKey}</div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-xs text-text-muted hover:bg-surface-subtle hover:text-text"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>

        {/* AI Lesson Enrichment Card (Phase 2) */}
        <div className="rounded-2xl border border-accent/20 bg-accent-subtle/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-contrast">
              <Sparkles className="size-4" />
            </span>
            <div className="text-xs font-black text-text">إثراء الدرس بالذكاء الاصطناعي</div>
          </div>
          <p className="text-2xs leading-4 text-text-muted">
            توليد المفاهيم والأهداف التعليمية والأسئلة التقييمية وإضافتها مباشرة إلى قاعدة البيانات:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={enrichConcepts.isPending}
              disabled={enrichConcepts.isPending || enrichQuestions.isPending}
              onClick={() => enrichConcepts.mutate()}
              className="w-full gap-1.5 text-xs font-bold"
            >
              <Brain className="size-3.5 text-accent" />
              توليد المفاهيم
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={enrichQuestions.isPending}
              disabled={enrichConcepts.isPending || enrichQuestions.isPending}
              onClick={() => enrichQuestions.mutate()}
              className="w-full gap-1.5 text-xs font-bold"
            >
              <HelpCircle className="size-3.5 text-accent" />
              توليد 4 أسئلة
            </Button>
          </div>

          {feedback ? (
            <div
              className={`flex items-start gap-2 rounded-xl p-2.5 text-xs ${
                feedback.type === 'success'
                  ? 'bg-success-subtle/50 text-success'
                  : 'bg-danger-subtle/50 text-danger'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-tight">{feedback.message}</span>
            </div>
          ) : null}
        </div>

        <LessonPageViewer lessonKey={lessonKey} />
        <MaterialsList lessonKey={lessonKey} />
      </div>
    </div>
  );
}
