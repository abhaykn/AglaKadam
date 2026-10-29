import { useLocation } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Access } from '@/features/auth/access';
import { cn } from '@/lib/cn';
import { DishaAvatar } from './disha-avatar';
import { workspaceInUse } from './tutor-persona';
import { TutorPanel } from './tutor-panel';

/**
 * The button that opens Disha, on every page of the application: just the mark, which turns once
 * as the conversation opens. While it is open the same button sits beside the drawer and closes
 * it, so one tap opens and one tap closes. Disha answers in the manner of the workspace in use, so
 * a teacher, a CRP, an officer and a family each get help of their kind.
 */
export function TutorLauncher({ access }: { access: Access }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const persona = workspaceInUse(pathname, access);
  // An account that must first choose a new password may not use the services yet.
  if (!persona || access.password_change_required) {
    return null;
  }
  const label = t(open ? 'tutor.closeChat' : 'tutor.ask');
  return (
    <>
      <button
        type="button"
        data-tutor-toggle=""
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Above the drawer's backdrop, and still reachable while the page behind it is locked. On a
        // wide screen it moves to the drawer's edge; on a phone the drawer covers the screen and
        // closes with its own button.
        className={cn(
          'group pointer-events-auto fixed bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] inline-flex size-10 items-center justify-center rounded-full shadow-xl shadow-black/40 transition-[right,transform] duration-300 ease-out outline-none hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:scale-95 sm:bottom-6',
          open ? 'right-4 max-sm:hidden sm:right-[calc(28rem+1.5rem)]' : 'right-4 sm:right-6',
        )}
      >
        {open ? null : (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping rounded-full bg-primary/35 [animation-duration:2.6s] [animation-iteration-count:3]"
          />
        )}
        <span
          aria-hidden="true"
          className="absolute -inset-1 rounded-full bg-primary/40 opacity-0 blur-md transition-opacity group-hover:opacity-100"
        />
        <span
          className={cn(
            'relative inline-flex transition-transform duration-700 ease-[cubic-bezier(0.34,1.2,0.64,1)]',
            open && 'rotate-[360deg]',
          )}
        >
          <DishaAvatar className="size-10" />
        </span>
        {open ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex size-5 items-center justify-center rounded-full border border-white/30 bg-[hsl(201_100%_9%)] text-white shadow-md"
          >
            <X className="size-3" />
          </span>
        ) : null}
        <span className="pointer-events-none absolute right-full mr-3 hidden rounded-lg bg-[hsl(201_100%_9%/0.95)] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
          {label}
        </span>
      </button>
      <TutorPanel open={open} onOpenChange={setOpen} userId={access.user_id} persona={persona} />
    </>
  );
}
