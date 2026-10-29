import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ChoiceGroupProps<Value extends string> {
  label: ReactNode;
  options: readonly { value: Value; label: ReactNode }[];
  value: Value | null;
  onChange: (value: Value) => void;
  /** Shown below the options and announced, for example when nothing was chosen. */
  error?: ReactNode;
  className?: string;
}

/**
 * Large tap targets that behave as one radio group: a single tab stop, and the arrow keys move the
 * choice, as with native radio buttons.
 */
export function ChoiceGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
  error,
  className,
}: ChoiceGroupProps<Value>) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusable = selectedIndex === -1 ? 0 : selectedIndex;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option) {
      onChange(option.value);
      const sibling = event.currentTarget.parentElement?.children[next];
      if (sibling instanceof HTMLElement) {
        sibling.focus();
      }
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <p id={labelId} className="text-sm font-medium text-fg">
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        className="grid gap-2 sm:auto-cols-fr sm:grid-flow-col"
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              value === option.value
                ? 'border-primary bg-primary-soft text-primary-soft-fg'
                : 'border-border bg-surface text-fg hover:bg-surface-muted',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
