import { createFileRoute } from '@tanstack/react-router';
import { todayInIndia } from '@shared/accounts.ts';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { ATTENDANCE_WINDOW_DAYS } from '@/features/attendance/attendance-api';
import { AttendancePage } from '@/features/attendance/attendance-page';
import { addDays, isCalendarDate } from '@/features/attendance/dates';

interface AttendanceSearch {
  date?: string;
}

export const Route = createFileRoute('/app/attendance/$classId')({
  validateSearch: (search: Record<string, unknown>): AttendanceSearch =>
    isCalendarDate(search.date) ? { date: search.date } : {},
  component: AttendanceRoute,
});

function AttendanceRoute() {
  const { classId } = Route.useParams();
  const { date } = Route.useSearch();
  const today = todayInIndia();
  // Dates outside the days that can be marked open today instead.
  const shown =
    date && date <= today && date >= addDays(today, -ATTENDANCE_WINDOW_DAYS) ? date : today;
  return (
    <RequireWorkspace workspace="teacher">
      <AttendancePage classSectionId={classId} date={shown} />
    </RequireWorkspace>
  );
}
