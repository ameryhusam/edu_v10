import { type ReactNode } from 'react';
import { Database, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';

export interface TextbookWorkspaceSyncViewProps {
  readonly dryRunResult: any;
  readonly importResult: any;
  readonly syncPending: boolean;
  readonly onSync: () => void;
  readonly onBack: () => void;
}

export function TextbookWorkspaceSyncView({
  dryRunResult,
  importResult,
  syncPending,
  onSync,
  onBack,
}: TextbookWorkspaceSyncViewProps): ReactNode {
  return (
    <div className="space-y-4">
      {/* Dry Run Outcome Summary */}
      {dryRunResult && (
        <div className="p-4 bg-success-subtle/30 border border-success/20 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-success flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>تقرير الفحص التجريبي للمزامنة (Dry-Run Verification)</span>
            </h4>
            <Badge tone="neutral">
              الكتاب: {dryRunResult.textbookKey}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-surface-raised rounded border text-center">
              <span className="text-text-muted block text-[10px]">العناصر الجديدة</span>
              <span className="text-base font-bold text-success">{dryRunResult.importSummary?.created?.length ?? 0}</span>
            </div>
            <div className="p-2 bg-surface-raised rounded border text-center">
              <span className="text-text-muted block text-[10px]">العناصر المطابقة</span>
              <span className="text-base font-bold text-text">{dryRunResult.importSummary?.identical?.length ?? 0}</span>
            </div>
            <div className="p-2 bg-surface-raised rounded border text-center">
              <span className="text-text-muted block text-[10px]">الأصول الموثقة</span>
              <span className="text-base font-bold text-accent">{dryRunResult.assetsVerified ?? 0}</span>
            </div>
            <div className="p-2 bg-surface-raised rounded border text-center">
              <span className="text-text-muted block text-[10px]">التعارضات</span>
              <span className="text-base font-bold text-warning">{dryRunResult.importSummary?.conflicts?.length ?? 0}</span>
            </div>
          </div>

          {dryRunResult.missingAssets && dryRunResult.missingAssets.length > 0 && (
            <div className="p-2 bg-warning-subtle text-warning text-xs rounded">
              تنبيه: يوجد {dryRunResult.missingAssets.length} ملف أصل غير مكتمل في مساحة العمل.
            </div>
          )}
        </div>
      )}

      {/* Final Sync Confirmation */}
      <div className="p-5 border border-border/60 rounded-xl text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-surface-subtle text-accent flex items-center justify-center mx-auto">
          <Database className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-text">حفظ ومزامنة محتويات الكتاب في قاعدة البيانات</h4>
          <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
            سيتم إنشاء وتحديث سجلات الكتاب، الوحدات، الدروس، المفاهيم، الأسئلة، وملفات الأصول بصورة آمنة وغير قابلة لفقدان البيانات السابقة.
          </p>
        </div>

        <div className="pt-2 flex justify-center gap-3">
          <Button variant="secondary" size="sm" onClick={onBack}>
            <span>رجوع للمعاينة</span>
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSync}
            disabled={syncPending || !!importResult}
            className="gap-2"
          >
            {syncPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>
              {importResult ? 'تم الحفظ والمزامنة بنجاح' : 'تأكيد الحفظ النهائي في قاعدة البيانات'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
