import { Toaster as SonnerToaster } from 'sonner';

/** Application-wide toast outlet, styled with the design tokens and following the active theme. */
export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-center"
      offset={20}
      gap={10}
      toastOptions={{
        classNames: {
          toast:
            'rounded-xl! border! border-border! bg-surface-solid! text-fg! shadow-lg! backdrop-blur-xl! font-sans! text-sm!',
          description: 'text-fg-muted!',
          actionButton: 'bg-primary! text-primary-fg! rounded-lg! font-medium!',
        },
      }}
    />
  );
}
