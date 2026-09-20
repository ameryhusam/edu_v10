import type { ReactNode } from 'react';
import { Input } from '../../design-system/ui/input';
import { useI18n } from '../../shared/i18n/i18n';

export function SelectFilter<T extends string>({
  label,
  value,
  onChange,
  options,
  labelFor,
  includeAll = true,
}: {
  readonly label: string;
  readonly value: T | '';
  readonly onChange: (value: T | '') => void;
  readonly options: readonly T[];
  readonly labelFor: (value: T) => string;
  readonly includeAll?: boolean;
}): ReactNode {
  const { t } = useI18n();
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
      >
        {includeAll ? <option value="">{t('common.all')}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function InputField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <Input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
