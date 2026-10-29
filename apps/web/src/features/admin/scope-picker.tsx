import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StaffRole } from '@/features/auth/access';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { searchScopes, type ScopeOption } from './admin-api';

interface ScopePickerProps {
  role: StaffRole;
  value: ScopeOption | null;
  onChange: (option: ScopeOption | null) => void;
  disabled?: boolean;
  /** Also offer schools that have been switched off (for looking after their records). */
  includeInactiveSchools?: boolean;
}

/** Searchable choice of the school, cluster, block or district a role applies to. */
export function ScopePicker({
  role,
  value,
  onChange,
  disabled = false,
  includeInactiveSchools = false,
}: ScopePickerProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const results = useQuery({
    queryKey: ['scope-search', role, debounced, includeInactiveSchools],
    queryFn: () => searchScopes(role, debounced, { includeInactiveSchools }),
    enabled: role !== 'super_admin' && value === null,
  });

  if (role === 'super_admin') {
    return <p className="text-sm text-fg-muted">{t('admin.staff.noScopeNeeded')}</p>;
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[0.625rem] border border-primary/40 bg-primary-soft px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{value.name}</p>
          <p className="truncate text-sm text-fg-muted">
            {value.code}
            {value.context ? ` · ${value.context}` : ''}
            {value.isActive === false ? ` · ${t('admin.inactive')}` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={t('admin.staff.changeScope')}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t(`admin.staff.scopeSearch.${role}`)}
        aria-controls={listId}
        disabled={disabled}
      />
      <ul
        id={listId}
        className="max-h-56 overflow-y-auto rounded-[0.625rem] border border-border"
        aria-busy={results.isFetching}
      >
        {results.isError ? (
          <li className="px-3.5 py-3 text-sm text-danger">{t('app.loadError.title')}</li>
        ) : (results.data ?? []).length === 0 && !results.isFetching ? (
          <li className="px-3.5 py-3 text-sm text-fg-muted">{t('admin.staff.noScopeMatches')}</li>
        ) : (
          (results.data ?? []).map((option) => (
            <li key={option.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onChange(option)}
                disabled={disabled}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-sunken"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-fg">{option.name}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {option.code}
                    {option.context ? ` · ${option.context}` : ''}
                    {option.isActive === false ? ` · ${t('admin.inactive')}` : ''}
                  </span>
                </span>
                <Check className="size-4 shrink-0 text-transparent" aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
