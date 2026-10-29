import type { ReactNode } from 'react';
import { EducationBackdrop } from './education-backdrop';
import { PublicFooter } from './public-footer';
import { PublicHeader } from './public-header';

/** Page frame shared by every page that is reachable without signing in, in the night theme. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-theme="dark"
      className="theme-night night-backdrop relative flex min-h-dvh flex-col overflow-x-clip"
    >
      <EducationBackdrop />
      <PublicHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="page-enter relative z-10 flex-1 outline-none"
      >
        {children}
      </main>
      <div className="relative z-10">
        <PublicFooter />
      </div>
    </div>
  );
}
