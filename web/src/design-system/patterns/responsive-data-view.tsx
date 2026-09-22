import type { ReactNode } from 'react';
import { DataTable, type Column } from './data-table';

export interface ResponsiveDataViewProps<T> {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly keyOf: (row: T) => string;
  readonly renderCompactRow: (row: T) => ReactNode;
  readonly caption?: string;
  readonly emptyTitle?: string;
  readonly onRowClick?: (row: T) => void;
  readonly rowActions?: (row: T) => ReactNode;
}

/** One data surface: table on larger screens, stacked cards on phones. */
export function ResponsiveDataView<T>({
  rows,
  columns,
  keyOf,
  renderCompactRow,
  caption,
  emptyTitle,
  onRowClick,
  rowActions,
}: ResponsiveDataViewProps<T>): ReactNode {
  return (
    <>
      <div className="hidden md:block">
        <DataTable
          rows={rows}
          columns={columns}
          keyOf={keyOf}
          caption={caption}
          emptyTitle={emptyTitle}
          onRowClick={onRowClick}
          rowActions={rowActions}
        />
      </div>
      <div className="grid gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <article
            key={keyOf(row)}
            className="rounded-xl border border-border bg-surface p-4"
            onClick={() => onRowClick?.(row)}
          >
            {renderCompactRow(row)}
            {rowActions ? <div className="mt-3 border-t border-border pt-3">{rowActions(row)}</div> : null}
          </article>
        ))}
      </div>
    </>
  );
}
