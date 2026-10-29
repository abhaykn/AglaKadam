import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, FlaskConical, LifeBuoy, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { readLocal, writeLocal } from '@/lib/local-storage';
import { DEMO_ROLES, DemoError, myDemoQuery, type DemoRole } from './demo-api';
import { DemoGuide } from './demo-guide';
import { DEMO_ROLE_ICONS } from './demo-roles';
import { useLeaveDemo } from './demo-session';

const GUIDE_SEEN_KEY = 'ak.demo.guide-seen-for';

/**
 * The strip every screen of a demonstration account carries: that the district and its data are
 * simulated, who the visitor is in it, and how to switch roles, see the guide or end the demo.
 * Real accounts never see it.
 */
export function DemoBanner({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const demo = useQuery(myDemoQuery()).data ?? null;
  const leave = useLeaveDemo();
  // The guide opens by itself the first time each role is used on this device.
  const [guideOpen, setGuideOpen] = useState(() => readLocal(GUIDE_SEEN_KEY) !== userId);
  const [busyWith, setBusyWith] = useState<DemoRole | 'end' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [endedEarly, setEndedEarly] = useState(false);

  // A district can end while it is open (its three days are up, or it made way for a new one).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!demo) {
    return null;
  }
  const ended = endedEarly || Date.parse(demo.expiresAt) <= now;

  const go = async (next: DemoRole | null) => {
    // One switch at a time: a second would sign out what the first is signing in.
    if (busyWith !== null) {
      return;
    }
    setBusyWith(next ?? 'end');
    try {
      await leave(next);
    } catch (error) {
      setBusyWith(null);
      if (error instanceof DemoError && error.reason === 'ended') {
        setEndedEarly(true);
      } else {
        toast.error(t('demo.errors.switch'));
      }
    }
  };

  return (
    <div className="border-b border-amber-300/25 bg-amber-300/10 backdrop-blur-md">
      <div className="container-page flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
        {/* Wraps on a phone rather than cutting off which role the visitor is in. */}
        <p className="flex min-w-0 items-start gap-2 text-fg">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('demo.banner.label')}</span>
            <span className="text-fg-muted"> · </span>
            {ended
              ? t('demo.banner.ended')
              : t('demo.banner.you', {
                  role: t(`demo.roleName.${demo.role}`),
                  name: demo.people[demo.role] ?? '',
                })}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-1">
          {ended ? (
            <Button size="sm" onClick={() => void go(null)} isLoading={busyWith === 'end'}>
              {t('demo.banner.startNew')}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGuideOpen(true)}
                leadingIcon={<LifeBuoy aria-hidden="true" />}
              >
                {t('demo.banner.guide')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={busyWith !== null && busyWith !== 'end'}
                    leadingIcon={<ArrowLeftRight aria-hidden="true" />}
                  >
                    {t('demo.banner.switch')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuLabel>{t('demo.banner.switchTo')}</DropdownMenuLabel>
                  {DEMO_ROLES.filter((role) => role !== demo.role).map((role) => {
                    const Icon = DEMO_ROLE_ICONS[role];
                    return (
                      <DropdownMenuItem
                        key={role}
                        disabled={busyWith !== null}
                        onSelect={() => void go(role)}
                      >
                        <Icon aria-hidden="true" />
                        <span>
                          {t(`demo.roles.${role}.title`)}
                          <span className="block text-xs text-fg-muted">
                            {demo.people[role] ?? ''}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void go(null)}
                isLoading={busyWith === 'end'}
                leadingIcon={<LogOut aria-hidden="true" />}
              >
                {t('demo.banner.end')}
              </Button>
            </>
          )}
        </div>
      </div>
      <DemoGuide
        demo={demo}
        open={guideOpen}
        onOpenChange={(open) => {
          if (!open) {
            writeLocal(GUIDE_SEEN_KEY, userId);
          }
          setGuideOpen(open);
        }}
      />
    </div>
  );
}
