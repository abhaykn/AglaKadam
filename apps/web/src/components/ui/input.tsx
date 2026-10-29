import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const inputClassName =
  'h-11 w-full rounded-[0.625rem] border border-border bg-surface px-3.5 text-[0.9375rem] text-fg shadow-xs ' +
  'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger';

/** A small decorative icon inside the left edge of a field; it never takes the pointer. */
function LeadingIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-fg-subtle transition-colors duration-150 group-focus-within:text-primary [&>svg]:size-[1.125rem]"
    >
      {children}
    </span>
  );
}

interface LeadingIconProps {
  /** Shown inside the left edge of the field. */
  leadingIcon?: ReactNode;
}

export function Input({
  className,
  type = 'text',
  leadingIcon,
  ...props
}: ComponentPropsWithRef<'input'> & LeadingIconProps) {
  if (!leadingIcon) {
    return <input type={type} className={cn(inputClassName, className)} {...props} />;
  }
  return (
    <div className="group relative">
      <LeadingIcon>{leadingIcon}</LeadingIcon>
      <input type={type} className={cn(inputClassName, 'pl-11', className)} {...props} />
    </div>
  );
}

/** Password input with a control to show or hide what has been typed. */
export function PasswordInput({
  className,
  leadingIcon,
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'type'> & LeadingIconProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="group relative">
      {leadingIcon ? <LeadingIcon>{leadingIcon}</LeadingIcon> : null}
      <input
        type={visible ? 'text' : 'password'}
        className={cn(inputClassName, 'pr-12', leadingIcon && 'pl-11', className)}
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
