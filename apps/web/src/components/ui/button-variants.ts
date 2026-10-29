import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-[0.625rem] font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    '[&_svg]:size-[1.15em] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'btn-shine bg-primary text-primary-fg shadow-md shadow-primary/20 hover:bg-primary-hover',
        secondary:
          'border border-border bg-surface text-fg shadow-xs hover:border-border-strong hover:bg-surface-muted',
        soft: 'bg-primary-soft text-primary-soft-fg hover:bg-primary/25',
        ghost: 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
        danger: 'bg-danger text-white shadow-xs hover:opacity-90 dark:text-neutral-950',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[0.9375rem]',
        lg: 'h-12 px-5 text-base',
        icon: 'size-11',
        'icon-sm': 'size-9',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);
