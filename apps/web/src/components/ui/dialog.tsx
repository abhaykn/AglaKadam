import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const contentVariants = cva(
  'ak-dialog-content fixed z-50 flex flex-col bg-surface-solid text-fg shadow-2xl shadow-black/40 outline-none',
  {
    variants: {
      placement: {
        center:
          'top-1/2 left-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border p-6',
        right:
          'inset-y-0 right-0 h-dvh w-full max-w-md border-l border-border p-6 pt-[max(1.5rem,env(safe-area-inset-top))]',
        bottom:
          'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t border-border p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
      },
    },
    defaultVariants: { placement: 'center' },
  },
);

export interface DialogContentProps
  extends
    Omit<ComponentPropsWithRef<typeof DialogPrimitive.Content>, 'title'>,
    VariantProps<typeof contentVariants> {
  title: ReactNode;
  description?: ReactNode;
  hideCloseButton?: boolean;
}

/**
 * Accessible modal surface. `placement` turns the same component into a centred dialog, a side
 * drawer or a bottom sheet so that every overlay in the product shares one behaviour.
 */
export function DialogContent({
  className,
  placement,
  title,
  description,
  hideCloseButton = false,
  children,
  ...props
}: DialogContentProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ak-dialog-overlay fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
      <DialogPrimitive.Content
        data-placement={placement ?? 'center'}
        className={cn(contentVariants({ placement }), className)}
        // Without a description, the generated aria-describedby would point at nothing.
        {...(description ? null : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <DialogPrimitive.Title className="text-lg font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideCloseButton ? null : (
            <DialogPrimitive.Close
              className="-mt-1 -mr-2 inline-flex size-10 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
              aria-label={t('common.close')}
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
