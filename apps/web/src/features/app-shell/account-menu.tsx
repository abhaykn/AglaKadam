import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { myDemoQuery } from '@/features/demo/demo-api';
import { getEnv } from '@/lib/env';
import { useCurrentAccess } from './access-context';
import { useSignOut } from './use-sign-out';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function AccountMenu() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const handleSignOut = useSignOut();
  // The accounts of a demonstration district keep the passwords they were given.
  const demo = useQuery({ ...myDemoQuery(), enabled: getEnv().demoWorkspaceEnabled }).data ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('app.accountMenu')}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg">
            {initialsOf(access.full_name)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <span className="block font-semibold text-fg">{access.full_name}</span>
          {access.phone ? (
            <span className="block text-xs text-fg-muted">{access.phone}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/account">
            <UserRound aria-hidden="true" />
            {t('app.account')}
          </Link>
        </DropdownMenuItem>
        {access.account_kind === 'staff' && demo === null ? (
          <DropdownMenuItem asChild>
            <Link to="/app/change-password">
              <KeyRound aria-hidden="true" />
              {t('app.changePassword')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOut aria-hidden="true" />
          {t('app.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
