import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentPropsWithRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const inputClassName =
  'h-11 w-full rounded-[0.625rem] border border-border bg-surface px-3.5 text-[0.9375rem] text-fg shadow-xs ' +
  'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger';

export function Input({ className, type = 'text', ...props }: ComponentPropsWithRef<'input'>) {
  return <input type={type} className={cn(inputClassName, className)} {...props} />;
}

/** Password input with a control to show or hide what has been typed. */
export function PasswordInput({
  className,
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className={cn(inputClassName, 'pr-12', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? t('form.hidePassword') : t('form.showPassword')}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[0.625rem] text-fg-muted transition-colors hover:text-fg"
      >
        {visible ? (
          <EyeOff className="size-5" aria-hidden="true" />
        ) : (
          <Eye className="size-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function Select({ className, children, ...props }: ComponentPropsWithRef<'select'>) {
  return (
    <select className={cn(inputClassName, 'appearance-auto pr-8', className)} {...props}>
      {children}
    </select>
  );
}

/** Several lines of text, growing from three rows; the same look as the single-line input. */
export function Textarea({ className, rows = 3, ...props }: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      rows={rows}
      className={cn(inputClassName, 'h-auto min-h-24 py-2.5 leading-relaxed', className)}
      {...props}
    />
  );
}
