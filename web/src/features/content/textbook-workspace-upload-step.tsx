import { type ReactNode, type ChangeEvent, type RefObject } from 'react';
import { BookOpen, FolderTree, RefreshCw, UploadCloud, Play } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';

export interface TextbookWorkspaceUploadStepProps {
  readonly workspacesList: readonly any[];
  readonly refetchWorkspaces: () => void;
  readonly selectedWorkspaceDir: string | null;
  readonly onSelectWorkspace: (ws: any) => void;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly onPartChange: (val: 'PART_1' | 'PART_2' | 'BOTH') => void;
  readonly grade: string;
  readonly onGradeChange: (val: string) => void;
  readonly subject: string;
  readonly onSubjectChange: (val: string) => void;
  readonly edition: string;
  readonly onEditionChange: (val: string) => void;
  readonly title: string;
  readonly onTitleChange: (val: string) => void;
  readonly selectedFile: File | null;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly isPreparePending: boolean;
  readonly onPrepare: () => void;
}

export function TextbookWorkspaceUploadStep({
  workspacesList,
  refetchWorkspaces,
  selectedWorkspaceDir,
  onSelectWorkspace,
  part,
  onPartChange,
  grade,
  onGradeChange,
  subject,
  onSubjectChange,
  edition,
  onEditionChange,
  title,
  onTitleChange,
  selectedFile,
  fileInputRef,
  onFileChange,
  isPreparePending,
  onPrepare,
}: TextbookWorkspaceUploadStepProps): ReactNode {
  return (
    <div className="space-y-5">
      {/* Quick Workspace Selection if available */}
      {workspacesList.length > 0 && (
        <div className="p-4 bg-surface-subtle border border-border/60 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-accent" />
              <span>مساحات العمل الموجودة مسبقاً على الخادم:</span>
            </h4>
            <Button variant="ghost" size="sm" onClick={() => refetchWorkspaces()}>
              <RefreshCw className="w-3.5 h-3.5 me-1" />
              <span>تحديث</span>
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pe-1">
            {workspacesList.map((ws: any) => (
              <button
                key={ws.workspaceDir}
                type="button"
                onClick={() => onSelectWorkspace(ws)}
                className={`text-end p-2.5 rounded-lg border text-xs transition-all flex flex-col gap-1 ${
                  selectedWorkspaceDir === ws.workspaceDir
                    ? 'border-accent bg-surface-raised text-text font-medium shadow-sm'
                    : 'border-border/60 hover:bg-surface text-text-muted'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-text">
                  <span>{ws.manifest?.title || ws.relativePath}</span>
                  <Badge tone="accent">
                    {ws.manifest?.workspaceId || ws.manifest?.part}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span>الوحدات: {ws.manifest?.counts?.units ?? 0}</span>
                  <span>الدروس: {ws.manifest?.counts?.lessons ?? 0}</span>
                  <span>الأصول: {ws.manifest?.counts?.assets ?? 0}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Coordinates Form */}
      <div className="p-4 border border-border/60 rounded-xl space-y-4">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          <span>إحداثيات الكتاب الأكاديمية (Coordinates)</span>
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">الجزء الفيزيائي (Part)</label>
            <Input
              value={part}
              onChange={(e) => onPartChange(e.target.value.toUpperCase() as 'PART_1' | 'PART_2' | 'BOTH')}
              placeholder="PART_1"
              className="h-9 text-xs uppercase"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">الصف (Grade)</label>
            <Input
              value={grade}
              onChange={(e) => onGradeChange(e.target.value.toUpperCase())}
              placeholder="G07"
              className="h-9 text-xs uppercase"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">المادة (Subject)</label>
            <Input
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value.toUpperCase())}
              placeholder="MATH"
              className="h-9 text-xs uppercase"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">الطبعة المطبوعة (Edition)</label>
            <Input
              value={edition}
              onChange={(e) => onEditionChange(e.target.value)}
              placeholder="يُستخرج من الغلاف تلقائياً"
              className="h-9 text-xs"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted">عنوان الكتاب الكامل</label>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="كتاب الرياضيات - الصف السابع - الجزء الأول"
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* PDF File Upload Zone */}
      <div className="p-5 border-2 border-dashed border-border/80 hover:border-accent rounded-xl text-center space-y-3 transition-colors">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={onFileChange}
          className="hidden"
        />
        <div className="w-12 h-12 rounded-full bg-surface-subtle text-accent flex items-center justify-center mx-auto">
          <UploadCloud className="w-6 h-6" />
        </div>
        <div>
          <h5 className="text-sm font-semibold text-text">
            {selectedFile ? selectedFile.name : 'رفع ملف PDF للكتاب المدرسي'}
          </h5>
          <p className="text-xs text-text-muted mt-1">
            {selectedFile
              ? `الحجم: ${(selectedFile.size / (1024 * 1024)).toFixed(2)} ميجابايت`
              : 'سيُرسل الكتاب إلى الخادم مؤقتاً ثم يعالجه محرك المحتوى؛ الحفظ الدائم يكون لملفات الدروس فقط'}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          {selectedFile ? 'تغيير الملف' : 'اختيار ملف PDF'}
        </Button>
      </div>

      {/* Prepare Button */}
      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="primary"
          onClick={onPrepare}
          disabled={isPreparePending || !subject || !grade || !part}
          className="gap-2"
        >
          {isPreparePending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          <span>تجهيز وتقطيع مساحة العمل (Prepare & Slice)</span>
        </Button>
      </div>
    </div>
  );
}
