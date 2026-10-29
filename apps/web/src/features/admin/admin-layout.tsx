import { Link, Outlet } from '@tanstack/react-router';
import {
  CalendarRange,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  School,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';

type SectionKey = 'overview' | 'schools' | 'staff' | 'students' | 'academicYears' | 'audit';

const sections: { to: string; key: SectionKey; icon: LucideIcon; exact?: boolean }[] = [
  { to: '/app/admin', key: 'overview', icon: LayoutDashboard, exact: true },
  { to: '/app/admin/schools', key: 'schools', icon: School },
  { to: '/app/admin/staff', key: 'staff', icon: UsersRound },
  { to: '/app/admin/students', key: 'students', icon: GraduationCap },
  { to: '/app/admin/academic-years', key: 'academicYears', icon: CalendarRange },
  { to: '/app/admin/audit', key: 'audit', icon: ScrollText },
];

export function AdminLayout() {
  const { t } = useTranslation();
  return (
    <RequireWorkspace workspace="admin">
      <div className="container-page grid gap-6 py-6 lg:grid-cols-[14rem_1fr] lg:py-8">
        <nav
          aria-label={t('admin.navigation')}
          className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"
        >
          <ul className="flex gap-1 lg:sticky lg:top-24 lg:flex-col">
            {sections.map(({ to, key, icon: Icon, exact }) => (
              <li key={key}>
                <Link
                  to={to}
                  activeOptions={{ exact: exact ?? false }}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg data-[status=active]:bg-primary-soft data-[status=active]:text-primary-soft-fg"
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {t(`admin.sections.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </RequireWorkspace>
  );
}
