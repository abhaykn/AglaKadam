import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface StatusPageProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actions?: ReactNode;
}

/** Centred full-page message used for not-found and unexpected error states. */
export function StatusPage({ icon: Icon, title, body, actions }: StatusPageProps) {
  return (
    <div className="container-page flex min-h-[60dvh] flex-col items-center justify-center py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-surface-sunken text-fg-muted">
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-2xl font-bold text-fg sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-md text-fg-muted">{body}</p>
      {actions ? <div className="mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
    </div>
  );
}
