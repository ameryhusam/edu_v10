/**
 * Create or edit one catalogue record.
 *
 * Field descriptors rather than bespoke forms: collections differ only in
 * which fields they carry.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useI18n } from '../../shared/i18n/i18n';

export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'toggle' | 'password';

export interface FieldSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required?: boolean;
  /** Only for `select`. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Only for `toggle`: the text beside the checkbox. */
  readonly toggleLabel?: string;
  readonly hint?: string;
  /**
   * Which modes the field is offered in. Defaults to `'both'`.
   */
  readonly visible?: 'create' | 'edit' | 'both';
}

export interface RecordEditorProps {
  readonly title: string;
  readonly fields: readonly FieldSpec[];
  readonly initial: Readonly<Record<string, string>>;
  /** True when creating: the key field is editable only then. */
  readonly isNew: boolean;
  readonly saving: boolean;
  readonly errorText: string | null;
  readonly onSave: (values: Record<string, string>) => void;
  readonly onClose: () => void;
  /**
   * Extra form body rendered under the declared fields
   */
  readonly children?: ReactNode;
}

export function RecordEditor({
  title,
  fields,
  initial,
  isNew,
  saving,
  errorText,
  onSave,
  onClose,
  children,
}: RecordEditorProps): ReactNode {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({ ...initial });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValues({ ...initial });
  }, [initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const doc = dialogRef.current?.ownerDocument;
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Fields offered in the current mode: what the save call can actually persist. */
  const shown = fields.filter(
    (field) => field.visible === 'both' || field.visible === undefined || field.visible === (isNew ? 'create' : 'edit'),
  );

  const missing = shown.filter((field) => {
    if (!field.required) return false;
    if (field.kind === 'multiselect') {
      return (values[field.id] ?? '').split(',').filter(Boolean).length === 0;
    }
    return !(values[field.id] ?? '').trim();
  }).length;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text">{title}</h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {shown.map((field) => {
            const frozen = field.id === 'key' && !isNew;
            const value = values[field.id] ?? '';
            const setValue = (next: string): void =>
              setValues((current) => ({ ...current, [field.id]: next }));

            if (field.kind === 'multiselect') {
              const checked = new Set(value.split(',').filter(Boolean));
              return (
                <fieldset key={field.id} className="space-y-1.5">
                  <legend className="block text-xs font-medium text-text-muted">
                    {field.label}
                  </legend>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(field.options ?? []).map((option) => {
                      const isOn = checked.has(option.value);
                      return (
                        <label
                          key={option.value}
                          className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                        >
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={() => {
                              if (isOn) checked.delete(option.value);
                              else checked.add(option.value);
                              setValue([...checked].join(','));
                            }}
                            className="size-4 accent-(--color-accent)"
                          />
                          <span className="truncate">{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {field.hint ? (
                    <span className="block text-2xs text-text-muted">{field.hint}</span>
                  ) : null}
                </fieldset>
              );
            }

            if (field.kind === 'toggle') {
              return (
                <label key={field.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value === 'true'}
                    onChange={(event) => setValue(event.target.checked ? 'true' : 'false')}
                    className="size-4 accent-(--color-accent)"
                  />
                  <span className="text-sm text-text">{field.toggleLabel ?? field.label}</span>
                </label>
              );
            }

            return (
              <label key={field.id} className="block space-y-1.5">
                <span className="block text-xs font-medium text-text-muted">{field.label}</span>

                {field.kind === 'select' ? (
                  <select
                    value={value}
                    disabled={frozen}
                    onChange={(event) => setValue(event.target.value)}
                    className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text disabled:opacity-50"
                  >
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={value}
                    disabled={frozen}
                    type={
                      field.kind === 'number'
                        ? 'number'
                        : field.kind === 'date'
                          ? 'date'
                          : field.kind === 'password'
                            ? 'password'
                            : 'text'
                    }
                    onChange={(event) => setValue(event.target.value)}
                  />
                )}

                {frozen ? (
                  <span className="block text-2xs text-text-muted">{t('catalogue.keyHint')}</span>
                ) : field.hint ? (
                  <span className="block text-2xs text-text-muted">{field.hint}</span>
                ) : null}
              </label>
            );
          })}

          {children}

          {errorText ? <p className="text-xs text-danger">{errorText}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || missing > 0}
            onClick={() => onSave(values)}
          >
            {saving ? t('catalogue.saving') : t('catalogue.save')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
