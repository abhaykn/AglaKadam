import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import type { MyDemo } from './demo-api';
import { DEMO_ROLE_ICONS, GUIDE_STEPS } from './demo-roles';

/** What to try in the role the visitor is in, with the people and places of their district. */
export function DemoGuide({
  demo,
  open,
  onOpenChange,
}: {
  demo: MyDemo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const Icon = DEMO_ROLE_ICONS[demo.role];
  const names = {
    teacher: demo.people.teacher ?? '',
    crp: demo.people.crp ?? '',
    officer: demo.people.officer ?? '',
    child: demo.people.family ?? '',
    school: i18n.language === 'hi' && demo.schoolHi ? demo.schoolHi : demo.school,
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          <span className="inline-flex items-center gap-2">
            <Icon className="size-5 text-primary" aria-hidden="true" />
            {t('demo.guide.title', { role: t(`demo.roleName.${demo.role}`) })}
          </span>
        }
        description={t(`demo.guide.${demo.role}.intro`, names)}
      >
        <ol className="mt-4 space-y-3">
          {GUIDE_STEPS[demo.role].map((key, index) => (
            <li key={key} className="flex gap-3 text-sm text-fg">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span>{t(key, names)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm text-fg-muted">{t('demo.guide.simulated')}</p>
        <div className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button leadingIcon={<CircleCheck aria-hidden="true" />}>
              {t('demo.guide.close')}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
