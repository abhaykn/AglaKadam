import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AudioLines,
  BookOpen,
  ClipboardCheck,
  HandHeart,
  Megaphone,
  NotebookPen,
  School,
  TrendingUp,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import {
  attendanceDaysQuery,
  attendanceDedupeKey,
  classDetailsQuery,
  classRosterQuery,
} from '@/features/attendance/attendance-api';
import { scopesFor } from '@/features/auth/access';
import { classNotesQuery } from '@/features/class-notes/note-api';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { audioConsentQuery } from '@/features/consent/consent-api';
import { classExamsQuery, prepareOpenPapers } from '@/features/exams/exam-api';
import { pulseCycleQuery } from '@/features/pulse/pulse-api';
import { classVisitsQuery, openRequestQuery } from '@/features/visits/visit-api';
import { getSupabase } from '@/lib/supabase';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { classLabel } from './grade-label';
import { PageHeader } from './page-header';
import { QueryState } from './query-state';

interface TeacherClass {
  id: string;
  grade: number;
  section: string;
  schoolId: string;
  students: number;
  isClassTeacher: boolean;
}

function useTeacherClasses(schoolIds: string[], userId: string) {
  return useQuery({
    // Not keyed by date, so the list kept on the device is found again on later days offline.
    queryKey: ['teacher-classes', schoolIds],
    meta: { persist: true },
    queryFn: async (): Promise<TeacherClass[]> => {
      const today = todayInIndia();
      const { data, error } = await getSupabase()
        .from('class_sections')
        .select(
          'id, grade, section, school_id, academic_years!inner(starts_on, ends_on), class_teachers(teacher_id), enrolments(count)',
        )
        .in('school_id', schoolIds)
        .eq('is_active', true)
        .lte('academic_years.starts_on', today)
        .gte('academic_years.ends_on', today)
        .is('enrolments.ended_on', null)
        .order('grade')
        .order('section');
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        grade: row.grade,
        section: row.section,
        schoolId: row.school_id,
        students: row.enrolments[0]?.count ?? 0,
        isClassTeacher: row.class_teachers.some((entry) => entry.teacher_id === userId),
      }));
    },
  });
}

/** Whether today's attendance of a class is uploaded, waiting on the device, or not taken. */
function TodayAttendance({ classSectionId }: { classSectionId: string }) {
  const { t } = useTranslation();
  const today = todayInIndia();
  const days = useQuery(attendanceDaysQuery(classSectionId));
  const waiting = useWaitingChange(attendanceDedupeKey(classSectionId, today));
  if (!waiting.isLoaded) {
    return null;
  }
  if (waiting.state === 'failed') {
    return <Badge tone="danger">{t('attendance.todayStatus.failed')}</Badge>;
  }
  if (waiting.state === 'pending') {
    return <Badge tone="warning">{t('attendance.todayStatus.waiting')}</Badge>;
  }
  if (days.data?.[today]) {
    return <Badge tone="success">{t('attendance.todayStatus.marked')}</Badge>;
  }
  return days.data ? <Badge>{t('attendance.todayStatus.notMarked')}</Badge> : null;
}

export function TeacherHome() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const schools = scopesFor(access, 'teacher');
  const classes = useTeacherClasses(
    schools.map((school) => school.id),
    access.user_id,
  );
  useDocumentTitle(t('workspaces.teacher'));
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  // Keeps every class list, and the Pulse children due, on the device while a network is available,
  // so attendance and checks can be taken offline even for a class that was not opened before.
  useEffect(() => {
    if (!isOnline || !classes.data) {
      return;
    }
    for (const entry of classes.data) {
      // Failures do not matter here; the attendance page loads the list itself when opened.
      queryClient.query(classRosterQuery(entry.id)).catch(() => undefined);
      queryClient.query(classDetailsQuery(entry.id)).catch(() => undefined);
      queryClient.query(classVisitsQuery(entry.id)).catch(() => undefined);
      queryClient.query(openRequestQuery(entry.id)).catch(() => undefined);
      queryClient.query(classNotesQuery(entry.id)).catch(() => undefined);
      queryClient
        .query(classExamsQuery(entry.id))
        .then((papers) => prepareOpenPapers(queryClient, papers, todayInIndia()))
        .catch(() => undefined);
      if (entry.grade >= 1 && entry.grade <= 3) {
        queryClient.query(pulseCycleQuery(entry.id)).catch(() => undefined);
        queryClient.query(audioConsentQuery(entry.id)).catch(() => undefined);
      }
    }
  }, [isOnline, classes.data, queryClient]);

  return (
    <div className="container-page space-y-6 py-8">
      <PageHeader
        title={t('home.greeting', { name: access.full_name })}
        description={t('home.teacherDescription')}
      />
      {schools.map((school) => {
        const schoolClasses = (classes.data ?? []).filter((entry) => entry.schoolId === school.id);
        return (
          <Card key={school.id} aria-labelledby={`school-${school.id}`}>
            <CardHeader
              titleId={`school-${school.id}`}
              title={
                <span className="inline-flex items-center gap-2">
                  <School className="size-5 text-primary" aria-hidden="true" />
                  {localise(school)}
                </span>
              }
              description={t('home.udise', { code: school.code })}
            />
            <QueryState
              isPending={classes.isPending}
              isError={classes.isError}
              onRetry={() => void classes.refetch()}
            >
              {schoolClasses.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title={t('home.noClasses.title')}
                  description={t('home.noClasses.body')}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {schoolClasses.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-fg">
                          {classLabel(t, entry.grade, entry.section)}
                        </p>
                        <p className="text-sm text-fg-muted">
                          {t('home.studentCount', { count: entry.students })}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {entry.isClassTeacher ? (
                            <Badge tone="brand">{t('home.yourClass')}</Badge>
                          ) : null}
                          <TodayAttendance classSectionId={entry.id} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="secondary">
                          <Link to="/app/exams/$classId" params={{ classId: entry.id }}>
                            <NotebookPen aria-hidden="true" />
                            {t('exams.open')}
                          </Link>
                        </Button>
                        <Button asChild variant="secondary">
                          <Link to="/app/progress/$classId" params={{ classId: entry.id }}>
                            <TrendingUp aria-hidden="true" />
                            {t('progress.open')}
                          </Link>
                        </Button>
                        <Button asChild variant="secondary">
                          <Link to="/app/notes/$classId" params={{ classId: entry.id }}>
                            <Megaphone aria-hidden="true" />
                            {t('notes.open')}
                          </Link>
                        </Button>
                        <Button asChild variant="secondary">
                          <Link to="/app/visits/$classId" params={{ classId: entry.id }}>
                            <HandHeart aria-hidden="true" />
                            {t('visits.teacher.open')}
                          </Link>
                        </Button>
                        {entry.grade >= 1 && entry.grade <= 3 ? (
                          <Button asChild variant="secondary">
                            <Link to="/app/pulse/$classId" params={{ classId: entry.id }}>
                              <AudioLines aria-hidden="true" />
                              {t('pulse.open')}
                            </Link>
                          </Button>
                        ) : null}
                        <Button asChild>
                          <Link to="/app/attendance/$classId" params={{ classId: entry.id }}>
                            <ClipboardCheck aria-hidden="true" />
                            {t('attendance.open')}
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </QueryState>
          </Card>
        );
      })}
    </div>
  );
}
