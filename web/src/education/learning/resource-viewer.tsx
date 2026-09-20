/** Inline media for learning resources. */

import type { ReactNode } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';

export interface ResourceMedia {
  readonly title: string;
  readonly url: string | null;
}

export function LearningResourceMedia({ resource }: { readonly resource: ResourceMedia }): ReactNode {
  const { t } = useI18n();
  if (!resource.url) return null;

  if (isImageUrl(resource.url)) {
    return (
      <figure className="overflow-hidden rounded-xl border border-border bg-surface-sunken">
        <img src={resource.url} alt={resource.title} className="max-h-96 w-full object-contain" loading="lazy" />
      </figure>
    );
  }

  if (isPdfUrl(resource.url)) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-2">
        <div className="flex items-center gap-2 text-xs font-bold text-text-muted">
          <FileText className="size-4" aria-hidden="true" />
          {t('lesson.pdfPreview')}
        </div>
        <iframe
          title={resource.title}
          src={resource.url}
          className="h-96 w-full rounded-lg border border-border bg-surface"
        />
      </div>
    );
  }

  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-bold text-accent hover:underline"
    >
      {t('lesson.openResource')}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </a>
  );
}

function normalisedPath(url: string): string {
  return (url.split('?')[0] ?? url).toLowerCase();
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/.test(normalisedPath(url));
}

function isPdfUrl(url: string): boolean {
  return /\.pdf$/.test(normalisedPath(url));
}
