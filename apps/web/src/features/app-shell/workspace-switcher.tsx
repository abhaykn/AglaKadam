import { Link, useLocation } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { workspacesOf, type Access } from '@/features/auth/access';
import { cn } from '@/lib/cn';
import { workspacePaths } from './workspaces';

/** Lets a person with several roles (for example a CRP who also teaches) move between workspaces. */
export function WorkspaceSwitcher({ access }: { access: Access }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const workspaces = workspacesOf(access);
  const current = workspaces.find((workspace) => pathname.startsWith(workspacePaths[workspace]));

  if (workspaces.length < 2) {
    return current ? (
      <span className="hidden text-sm font-medium text-fg-muted sm:inline">
        {t(`workspaces.${current}`)}
      </span>
    ) : null;
  }

  return (
    <>
      <nav aria-label={t('app.workspaces')} className="hidden items-center gap-1 md:flex">
        {workspaces.map((workspace) => (
          <Link
            key={workspace}
            to={workspacePaths[workspace]}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              workspace === current
                ? 'bg-primary-soft text-primary-soft-fg'
                : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
            )}
          >
            {t(`workspaces.${workspace}`)}
          </Link>
        ))}
      </nav>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={t('app.workspaces')}>
              {current ? t(`workspaces.${current}`) : t('app.workspaces')}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {workspaces.map((workspace) => (
              <DropdownMenuItem key={workspace} asChild>
                <Link to={workspacePaths[workspace]}>{t(`workspaces.${workspace}`)}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
