/**
 * DataTable — the one table shape every admin screen renders.
 *
 * Generic over the row so subjects, users, enrolments and textbooks share a
 * single implementation of: sortable columns, an empty state that says WHICH
 * emptiness it is, and a per-row actions slot. What each row MEANS stays with
 * the caller — the column specs — because a grade's "order" and a term's
 * "order" are different facts that happen to share a type.
 *
 * Sorting is presentation-only and client-side, for lists the server returns
 * whole (reference data, a drawer's rows). Server-paged lists (the directory,
 * enrolments, textbooks) sort on the server and pass no sortable columns —
 * sorting a single page client-side would silently mislead.
 */

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';

export interface Column<T> {
  readonly id: string;
  readonly label: string;
  readonly render: (record: T) => ReactNode;
  /** Right-aligned numerics read better as a column of digits. */
  readonly numeric?: boolean;
  /** Present only when the list is complete in memory. */
  readonly sortBy?: (record: T) => string | number;
}

export interface DataTableProps<T> {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly keyOf: (record: T) => string;
  /** The whole-row affordance: opens the detail drawer. */
  readonly onRowClick?: ((record: T) => void) | undefined;
  /** Row-level actions, rendered in a trailing cell. */
  readonly rowActions?: ((record: T) => ReactNode) | undefined;
  /**
   * Shown when there are no rows at all — "nothing exists yet". Optional for
   * callers that render their own empty state instead of the table (server-
   * paged screens, which want the filters' wording, not the table's).
   */
  readonly emptyTitle?: string | undefined;
  readonly emptyBody?: string | undefined;
  readonly caption?: string | undefined;
}

export function DataTable<T>({
  rows,
  columns,
  keyOf,
  onRowClick,
  rowActions,
  emptyTitle,
  emptyBody,
  caption,
}: DataTableProps<T>): ReactNode {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = (() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column?.sortBy) return rows;
    const keyed = [...rows].sort((a, b) => {
      const av = column.sortBy!(a);
      const bv = column.sortBy!(b);
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv), 'ar');
    });
    return sort.dir === 'asc' ? keyed : keyed.reverse();
  })();

  if (rows.length === 0) {
    if (!emptyTitle) return null;
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="font-medium text-text">{emptyTitle}</p>
        {emptyBody ? <p className="mt-1 text-sm text-text-muted">{emptyBody}</p> : null}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((column) => {
              const sortable = column.sortBy !== undefined;
              const active = sort?.id === column.id;
              const Icon = !sortable ? null : active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('px-3 py-2.5 text-xs font-semibold text-text-muted', column.numeric ? 'text-end' : 'text-start')}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) =>
                          current?.id === column.id
                            ? { id: column.id, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                            : { id: column.id, dir: 'asc' },
                        )
                      }
                      className={cn(
                        'inline-flex items-center gap-1 rounded font-semibold transition-colors',
                        'hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        active && 'text-text',
                        column.numeric && 'flex-row-reverse',
                      )}
                    >
                      {column.label}
                      {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            {rowActions ? (
              <th scope="col" className="px-3 py-2.5 text-end text-xs font-semibold text-text-muted">
                {t('common.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((record) => (
            <tr
              key={keyOf(record)}
              onClick={onRowClick ? () => onRowClick(record) : undefined}
              className={cn(
                'border-t border-border transition-colors',
                onRowClick && 'cursor-pointer hover:bg-surface-hover',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn('px-3 py-2.5 align-middle', column.numeric ? 'text-end tabular-nums' : 'text-start')}
                >
                  {column.render(record)}
                </td>
              ))}
              {rowActions ? (
                <td className="px-3 py-2.5 text-end">
                  <div className="flex items-center justify-end gap-1.5">{rowActions(record)}</div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
