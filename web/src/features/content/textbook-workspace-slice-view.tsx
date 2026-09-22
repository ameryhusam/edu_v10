import { type ReactNode } from 'react';
import {
  FolderTree,
  RefreshCw,
  Layers,
  FileText,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';

export interface TextbookWorkspaceSliceViewProps {
  readonly isInspecting: boolean;
  readonly inspectedWorkspace: any;
  readonly segmentPending: boolean;
  readonly onSegment: () => void;
  readonly onBack: () => void;
  readonly onVerifyAndDryRun: () => void;
  readonly dryRunPending: boolean;
}

export function TextbookWorkspaceSliceView({
  isInspecting,
  inspectedWorkspace,
  segmentPending,
  onSegment,
  onBack,
  onVerifyAndDryRun,
  dryRunPending,
}: TextbookWorkspaceSliceViewProps): ReactNode {
  const manifest = inspectedWorkspace?.indexManifest;

  if (isInspecting) {
    return (
      <div className="p-8 text-center text-text-muted flex items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-accent" />
        <span>جاري قراءة وتحليل مساحة العمل...</span>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="p-8 text-center text-text-muted">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-warning" />
        <p className="text-sm">لم يتم العثور على ملف index.json في مساحة العمل المحددة.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-subtle border rounded-xl text-center">
          <span className="text-xs text-text-muted block">الوحدات</span>
          <span className="text-xl font-bold text-text">{manifest.counts?.units ?? 0}</span>
        </div>
        <div className="p-3 bg-surface-subtle border rounded-xl text-center">
          <span className="text-xs text-text-muted block">الدروس</span>
          <span className="text-xl font-bold text-text">{manifest.counts?.lessons ?? 0}</span>
        </div>
        <div className="p-3 bg-surface-subtle border rounded-xl text-center">
          <span className="text-xs text-text-muted block">الأصول الرقمية</span>
          <span className="text-xl font-bold text-text">
            {manifest.counts?.assets ?? inspectedWorkspace?.assets?.length ?? 0}
          </span>
        </div>
        <div className="p-3 bg-surface-subtle border rounded-xl text-center">
          <span className="text-xs text-text-muted block">حالة الحزمة</span>
          <Badge tone={inspectedWorkspace?.contentPackage ? 'success' : 'neutral'} className="mt-1">
            {inspectedWorkspace?.contentPackage ? 'جاهزة للاستيراد' : 'غير مكتملة'}
          </Badge>
        </div>
      </div>

      {/* Sliced Units & Lessons Tree */}
      <div className="border border-border/60 rounded-xl overflow-hidden">
        <div className="p-3 bg-surface-subtle border-b font-semibold text-xs flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-accent" />
            <span>الهيكل والشرائح المستخرجة (Units & Lessons Slices)</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSegment}
            disabled={segmentPending}
          >
            <RefreshCw className={`w-3.5 h-3.5 me-1 ${segmentPending ? 'animate-spin' : ''}`} />
            <span>التحقق من التقطيع</span>
          </Button>
        </div>

        <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
          {manifest.units?.map((u: any) => (
            <div key={u.slug} className="p-2.5 bg-surface-raised border border-border/60 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-accent" />
                  <span>الوحدة {u.unitNumber}: {u.name || u.slug}</span>
                </span>
                <span className="text-[11px] text-text-muted font-mono">
                  {u.pdf}
                </span>
              </div>

              {/* Lessons */}
              <div className="pe-4 space-y-1.5 border-e-2 border-accent/20 me-1.5">
                {u.lessons?.map((l: any) => (
                  <div
                    key={l.slug}
                    className="flex items-center justify-between text-xs p-1.5 bg-surface-subtle rounded border border-border/40"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-text-muted" />
                      <span>الدرس {l.lessonNumber}: {l.name || l.slug}</span>
                    </span>
                    <span className="text-[10px] text-text-muted font-mono">
                      {l.pdf}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Next Step Actions */}
      <div className="flex justify-between items-center pt-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <span>السابق</span>
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onVerifyAndDryRun}
          disabled={dryRunPending}
          className="gap-2"
        >
          {dryRunPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          <span>بدء الفحص التجريبي والمزامنة (Verify & Dry-Run)</span>
        </Button>
      </div>
    </div>
  );
}
