import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { textbookAdministrationApi, type ContentAssetRecord } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';

function assetUrl(asset: ContentAssetRecord): string {
  return `/api/v1/content/assets/${encodeURIComponent(asset.key)}/stream`;
}

export function LessonPageViewer({ lessonKey }: { readonly lessonKey: string }): ReactNode {
  const [pageIndex, setPageIndex] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);
  const assets = useQuery({
    queryKey: queryKeys.content.lessonAssets(lessonKey),
    queryFn: () => textbookAdministrationApi.lessonAssets(lessonKey),
  });

  const pages = useMemo(
    () => (assets.data ?? []).filter((a) => a.assetType === 'PAGE_IMAGE').sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0)),
    [assets.data],
  );
  const aiPages = useMemo(
    () => new Map((assets.data ?? []).filter((a) => a.assetType === 'IMAGE_SUMMARY').map((a) => [a.pageStart ?? -1, a])),
    [assets.data],
  );
  const current = pages[pageIndex];
  const explanation = current ? aiPages.get(current.pageStart ?? -1) : undefined;

  if (assets.isLoading) return <div className="rounded-xl border border-border p-4 text-sm text-text-muted">جاري تحميل صفحات الدرس…</div>;
  if (!current) return <div className="rounded-xl border border-border p-4 text-sm text-text-muted">لا توجد صور صفحات محفوظة لهذا الدرس.</div>;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text">صفحة الكتاب</div>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-lg border border-border px-2.5 py-1 text-xs" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0}>السابق</button>
          <span className="px-2 text-xs text-text-muted">{current.pageStart ?? pageIndex + 1} / {pages.length}</span>
          <button type="button" className="rounded-lg border border-border px-2.5 py-1 text-xs" onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIndex === pages.length - 1}>التالي</button>
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border p-1">
        <button type="button" className={`flex-1 rounded-md px-3 py-1.5 text-xs ${!showExplanation ? 'bg-surface-subtle font-semibold' : ''}`} onClick={() => setShowExplanation(false)}>صفحة الكتاب</button>
        <button type="button" className={`flex-1 rounded-md px-3 py-1.5 text-xs ${showExplanation ? 'bg-surface-subtle font-semibold' : ''}`} onClick={() => setShowExplanation(true)} disabled={!explanation}>شرح الذكاء الصناعي</button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-subtle">
        <img src={assetUrl(showExplanation && explanation ? explanation : current)} alt={showExplanation && explanation ? (explanation.title ?? 'شرح الصفحة') : (current.title ?? `صفحة ${current.pageStart ?? pageIndex + 1}`)} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" />
      </div>
    </section>
  );
}
