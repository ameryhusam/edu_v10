/**
 * A table of catalogue records with administrator affordances.
 *
 * It now carries the competitive table basics every academic-structure screen
 * needs: local search, lifecycle filters, sortable headers, density control
 * and row actions.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export interface Column<T> {
  readonly id: string;
  readonly label: string;
  readonly render: (record: T) => ReactNode;
  readonly numeric?: boolean;
  readonly sortBy?: (record: T) => string | number;
}

export interface RecordTableProps<T> {
  readonly records: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly keyOf: (record: T) => string;
  readonly nameOf?: ((record: T) => string) | undefined;
  readonly searchTextOf?: ((record: T) => string) | undefined;
  readonly referencesOf?: ((record: T) => number) | undefined;
  readonly activeOf?: ((record: T) => boolean) | undefined;
  readonly onToggleActive?: ((record: T, next: boolean) => void) | undefined;
  readonly isCurrentOf?: ((record: T) => boolean) | undefined;
  readonly onMakeCurrent?: ((record: T) => void) | undefined;
  readonly onEdit: (record: T) => void;
  readonly onDelete?: ((record: T) => void) | undefined;
  readonly canWrite: boolean;
  readonly busy?: boolean;
}

export function RecordTable<T>({
  records,
  columns,
  keyOf,
  nameOf,
  searchTextOf,
  referencesOf,
  activeOf,
  onToggleActive,
  isCurrentOf,
  onMakeCurrent,
  onEdit,
  onDelete,
  canWrite,
  busy = false,
}: RecordTableProps<T>): ReactNode {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [dense, setDense] = useState(false);

  const filtered = useMemo(() => {
    let result = records.slice();

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) => {
        const text = searchTextOf ? searchTextOf(r) : nameOf ? nameOf(r) : keyOf(r);
        return text.toLowerCase().includes(q) || keyOf(r).toLowerCase().includes(q);
      });
    }

    if (activeOf && activeFilter !== 'all') {
      result = result.filter((r) => (activeFilter === 'active' ? activeOf(r) : !activeOf(r)));
    }

    if (sortKey) {
      const col = columns.find((c) => c.id === sortKey);
      if (col && col.sortBy) {
        result.sort((a, b) => {
          const va = col.sortBy!(a);
          const vb = col.sortBy!(b);
          if (typeof va === 'number' && typeof vb === 'number') {
            return sortDirection === 'asc' ? va - vb : vb - va;
          }
          return sortDirection === 'asc'
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
        });
      }
    }

    return result;
  }, [records, search, activeFilter, sortKey, sortDirection, columns, keyOf, nameOf, searchTextOf, activeOf]);

  const handleSort = (colId: string): void => {
    const col = columns.find((c) => c.id === colId);
    if (!col || !col.sortBy) return;

    if (sortKey === colId) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else {
        setSortKey(null);
        setSortDirection('asc');
      }
    } else {
      setSortKey(colId);
      setSortDirection('asc');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search' as MessageKey)}
              className="ps-9 h-8 text-sm"
            />
          </div>

          {activeOf && (
            <div className="flex rounded-md border border-border p-0.5">
              {(['all', 'active', 'inactive'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    activeFilter === filter
                      ? 'bg-surface-raised text-text font-semibold shadow-xs'
                      : 'text-text-subtle hover:text-text',
                  )}
                >
                  {t(`catalogue.filter.${filter}` as MessageKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-text-subtle">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={dense}
              onChange={(e) => setDense(e.target.checked)}
              className="size-3.5 rounded border-border"
            />
            {t('common.compactView' as MessageKey)}
          </label>
          <span>•</span>
          <span>{t('catalogue.countTotal' as MessageKey, { count: filtered.length })}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-border bg-surface-sunken text-xs font-medium text-text-subtle">
            <tr>
              {columns.map((col) => {
                const isSortable = !!col.sortBy;
                const isSorted = sortKey === col.id;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn(
                      'px-3 py-2.5 text-start font-medium select-none',
                      col.numeric && 'text-end',
                      isSortable && 'cursor-pointer hover:text-text',
                      dense ? 'py-1.5' : 'py-2.5',
                    )}
                    onClick={() => isSortable && handleSort(col.id)}
                  >
                    <div
                      className={cn(
                        'inline-flex items-center gap-1',
                        col.numeric && 'justify-end w-full',
                      )}
                    >
                      <span>{col.label}</span>
                      {isSortable && (
                        <span className="text-text-subtle">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
              <th scope="col" className={cn('px-3 text-end', dense ? 'py-1.5' : 'py-2.5')}>
                {t('common.actions' as MessageKey)}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-8 text-center text-sm text-text-subtle"
                >
                  {t('common.empty' as MessageKey)}
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const key = keyOf(record);
                const refs = referencesOf ? referencesOf(record) : 0;
                const isCurrent = isCurrentOf ? isCurrentOf(record) : false;
                const isActive = activeOf ? activeOf(record) : true;

                return (
                  <tr key={key} className="hover:bg-surface-sunken/40 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          'px-3 text-start align-middle',
                          col.numeric && 'text-end',
                          dense ? 'py-1.5 text-xs' : 'py-2.5 text-sm',
                        )}
                      >
                        {col.render(record)}
                      </td>
                    ))}
                    <td className={cn('px-3 text-end align-middle', dense ? 'py-1.5' : 'py-2.5')}>
                      <div className="flex items-center justify-end gap-1.5">
                        {isCurrentOf && onMakeCurrent && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isCurrent || busy || !canWrite}
                            onClick={() => onMakeCurrent(record)}
                            className="h-7 px-2 text-xs"
                          >
                            {isCurrent ? (
                              <Badge tone="success" className="text-xs">
                                {t('catalogue.isCurrent' as MessageKey)}
                              </Badge>
                            ) : (
                              t('catalogue.makeCurrent' as MessageKey)
                            )}
                          </Button>
                        )}

                        {activeOf && onToggleActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || !canWrite}
                            onClick={() => onToggleActive(record, !isActive)}
                            className="h-7 px-2 text-xs"
                          >
                            {isActive
                              ? t('catalogue.deactivate' as MessageKey)
                              : t('catalogue.activate' as MessageKey)}
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || !canWrite}
                          onClick={() => onEdit(record)}
                          className="h-7 px-2 text-xs"
                        >
                          {t('common.edit' as MessageKey)}
                        </Button>

                        {refs > 0 ? (
                          <span className="text-2xs text-text-muted">
                            {t('catalogue.inUse' as MessageKey, { count: refs })}
                          </span>
                        ) : null}

                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={refs > 0 || busy || !canWrite}
                            onClick={() => onDelete(record)}
                            className="h-7 px-2 text-xs text-danger hover:text-danger hover:bg-danger-subtle"
                            title={
                              refs > 0
                                ? t('catalogue.inUse' as MessageKey, { count: refs })
                                : undefined
                            }
                          >
                            {t('common.delete' as MessageKey)}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
