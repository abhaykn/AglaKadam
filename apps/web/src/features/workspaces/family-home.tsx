import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CalendarCheck,
  ChevronDown,
  GraduationCap,
  Megaphone,
  NotebookText,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import type { Access } from '@/features/auth/access';
import { formatDay } from '@/features/attendance/dates';
import { classNotesQuery } from '@/features/class-notes/note-api';
import { NoteCard } from '@/features/class-notes/note-card';
import { examName, subjectName } from '@/features/exams/exam-change';
import { formatMarks } from '@/features/exams/marks';
import {
  monthPercent,
  summariseAttendance,
  type AttendanceSummary,
} from '@/features/family/attendance-summary';
import { familyAttendanceQuery, familyResultsQuery } from '@/features/family/family-api';
import {
  practiceSubjects,
  resultPercent,
  starsForPercent,
  starsOf,
  type ChildExam,
} from '@/features/family/results';
import { summarisePractice, usePracticeDays } from '@/features/practice/progress';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { classLabel } from './grade-label';
import { PageHeader } from './page-header';
import { QueryState } from './query-state';

type Student = NonNullable<Access['student']>;

/** Notes shown before "Show all". */
const NOTES_FIRST = 5;

/** Up to five stars, filled to `count`. */
function StarRow({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('family.results.stars', { count })}
      className="inline-flex items-center gap-0.5"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={cn(
            'size-4',
            index < count ? 'fill-warning text-warning' : 'text-border-strong',
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function monthName(month: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function Bar({ percent }: { percent: number }) {
  return (
    <span
      className="block h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      aria-hidden="true"
    >
      <span
        className={cn(
          'block h-full rounded-full',
          percent >= 75 ? 'bg-success' : percent >= 50 ? 'bg-warning' : 'bg-danger',
        )}
        style={{ width: `${String(percent)}%` }}
      />
    </span>
  );
}

function AttendanceBody({ summary }: { summary: AttendanceSummary }) {
  const { t, i18n } = useTranslation();
  const thisMonth = todayInIndia().slice(0, 7);
  const current = summary.months.find((month) => month.month === thisMonth);
  if (summary.marked === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title={t('family.attendance.none')}
        description={t('family.attendance.noneBody')}
      />
    );
  }
  return (
    <CardBody className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-fg-muted">{t('family.attendance.thisMonth')}</dt>
          <dd className="text-2xl font-bold text-fg tabular-nums">
            {current
              ? t('family.attendance.daysOf', { present: current.present, marked: current.marked })
              : t('family.attendance.notYet')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t('family.attendance.session')}</dt>
          <dd className="text-2xl font-bold text-fg tabular-nums">
            {t('family.attendance.percent', { percent: summary.percent ?? 0 })}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t('family.attendance.run')}</dt>
          <dd className="text-2xl font-bold text-fg tabular-nums">
            {t('family.attendance.runDays', { count: summary.streak })}
          </dd>
        </div>
      </dl>
      {current && current.absentDays.length > 0 ? (
        <p className="text-sm text-fg">
          {t('family.attendance.absentOn', {
            days: current.absentDays.map((day) => formatDay(day, i18n.language)).join(', '),
          })}
        </p>
      ) : null}
      <ul className="space-y-3" aria-label={t('family.attendance.byMonth')}>
        {summary.months.slice(0, 6).map((month) => (
          <li
            key={month.month}
            className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="text-fg">{monthName(month.month, i18n.language)}</span>
            <Bar percent={monthPercent(month)} />
            <span className="text-fg-muted tabular-nums">
              {t('family.attendance.daysOf', { present: month.present, marked: month.marked })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-fg-muted">{t('family.attendance.note')}</p>
    </CardBody>
  );
}

function ExamResult({ exam, open }: { exam: ChildExam; open: boolean }) {
  const { t, i18n } = useTranslation();
  const toPractise = practiceSubjects(exam).filter(
    (subject) => subject === 'hindi' || subject === 'english' || subject === 'maths',
  );
  const range =
    exam.startsOn === exam.endsOn
      ? formatDay(exam.startsOn, i18n.language)
      : `${formatDay(exam.startsOn, i18n.language)} – ${formatDay(exam.endsOn, i18n.language)}`;
  return (
    <details open={open} className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="flex items-start gap-2">
          <ChevronDown
            className="mt-0.5 size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          <span className="space-y-0.5">
            <span className="block font-semibold text-fg">{examName(exam, t)}</span>
            <span className="block text-sm text-fg-muted">{range}</span>
          </span>
        </span>
        {exam.percent !== null && exam.total !== null && exam.outOf !== null ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-fg tabular-nums">
            {formatMarks(exam.total, i18n.language)}/{exam.outOf} (
            {formatMarks(exam.percent, i18n.language)}%)
            <StarRow count={starsForPercent(exam.percent)} />
          </span>
        ) : null}
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-3">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {t('family.results.caption', { exam: examName(exam, t) })}
          </caption>
          <thead>
            <tr className="text-left text-fg-muted">
              <th scope="col" className="py-1.5 font-medium">
                {t('family.results.subject')}
              </th>
              <th scope="col" className="py-1.5 font-medium">
                {t('family.results.result')}
              </th>
              <th scope="col" className="py-1.5 font-medium">
                <span className="sr-only">{t('family.results.starsHeading')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exam.papers.map((paper) => {
              const percent = resultPercent(paper);
              const stars = starsOf(paper, percent);
              return (
                <tr key={paper.paperId} className="border-t border-border">
                  <th scope="row" className="py-2 text-left font-medium text-fg">
                    {subjectName(paper, t)}
                  </th>
                  <td className="py-2 text-fg tabular-nums">
                    {paper.absent
                      ? t('family.results.absent')
                      : paper.scale === 'marks'
                        ? `${formatMarks(paper.marks ?? 0, i18n.language)}/${String(paper.maxMarks ?? 0)}`
                        : t('family.results.grade', { grade: paper.grade ?? '' })}
                  </td>
                  <td className="py-2 text-right">
                    {stars === null ? null : <StarRow count={stars} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {toPractise.length > 0 ? (
          <p className="text-sm text-fg">
            {t('family.results.practise', {
              subjects: toPractise.map((subject) => t(`exams.subject.${subject}`)).join(', '),
            })}{' '}
            <Link to="/app/family/practice" className="font-medium text-primary hover:underline">
              {t('family.practice.open')}
            </Link>
          </p>
        ) : null}
      </div>
    </details>
  );
}

function FamilyDashboard({ student }: { student: Student }) {
  const { t } = useTranslation();
  const localise = useLocalisedName();
  const today = todayInIndia();
  const results = useQuery(familyResultsQuery(student.id));
  const attendance = useQuery(familyAttendanceQuery(student.id));
  const classId = student.class?.id ?? null;
  const notes = useQuery({
    ...classNotesQuery(classId ?? ''),
    enabled: classId !== null,
  });
  const [allNotes, setAllNotes] = useState(false);
  const { days } = usePracticeDays(student.id, today);
  const practice = summarisePractice(days, today);
  const noteList = notes.data ?? [];
  const shownNotes = allNotes ? noteList : noteList.slice(0, NOTES_FIRST);

  return (
    <div className="container-page space-y-6 py-8">
      <PageHeader title={t('home.familyGreeting')} description={t('home.familyDescription')} />
      <Card aria-labelledby="child-details">
        <CardHeader
          titleId="child-details"
          title={
            <span className="inline-flex items-center gap-2">
              <GraduationCap className="size-5 text-primary" aria-hidden="true" />
              {student.full_name}
            </span>
          }
          actions={
            <Button asChild>
              <Link to="/app/family/practice">
                <Sparkles aria-hidden="true" />
                {t('family.practice.open')}
              </Link>
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-fg-muted">{t('account.learnerCode')}</dt>
              <dd className="font-medium text-fg tabular-nums">{student.student_code}</dd>
            </div>
            {student.school ? (
              <div>
                <dt className="text-sm text-fg-muted">{t('home.columns.school')}</dt>
                <dd className="font-medium text-fg">{localise(student.school)}</dd>
              </div>
            ) : null}
            {student.class ? (
              <div>
                <dt className="text-sm text-fg-muted">{t('home.class')}</dt>
                <dd className="font-medium text-fg">
                  {classLabel(t, student.class.grade, student.class.section)}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="text-sm text-fg-muted">
            {practice.today > 0
              ? t('family.practice.today', { count: practice.today })
              : t('family.practice.invite')}
          </p>
        </CardBody>
      </Card>

      <Card aria-labelledby="teacher-notes">
        <CardHeader
          titleId="teacher-notes"
          title={
            <span className="inline-flex items-center gap-2">
              <Megaphone className="size-5 text-primary" aria-hidden="true" />
              {t('family.notes.title')}
            </span>
          }
          description={t('family.notes.description')}
        />
        {classId === null ? (
          <EmptyState icon={NotebookText} title={t('family.notes.noClass')} />
        ) : (
          <QueryState
            isPending={notes.isPending}
            isError={notes.isError}
            onRetry={() => void notes.refetch()}
          >
            {noteList.length === 0 ? (
              <EmptyState icon={NotebookText} title={t('family.notes.none')} />
            ) : (
              <CardBody className="space-y-3">
                {shownNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={{
                      id: note.id,
                      kind: note.kind,
                      body: note.body,
                      dueOn: note.dueOn,
                      authorName: note.authorName,
                      at: note.createdAt,
                      attachment: note.attachment,
                      waitingFile: null,
                    }}
                  />
                ))}
                {noteList.length > NOTES_FIRST ? (
                  <Button variant="secondary" onClick={() => setAllNotes((value) => !value)}>
                    {allNotes
                      ? t('family.notes.fewer')
                      : t('family.notes.all', { total: noteList.length })}
                  </Button>
                ) : null}
              </CardBody>
            )}
          </QueryState>
        )}
      </Card>

      <Card aria-labelledby="child-attendance">
        <CardHeader
          titleId="child-attendance"
          title={
            <span className="inline-flex items-center gap-2">
              <CalendarCheck className="size-5 text-primary" aria-hidden="true" />
              {t('family.attendance.title')}
            </span>
          }
        />
        <QueryState
          isPending={attendance.isPending}
          isError={attendance.isError}
          onRetry={() => void attendance.refetch()}
        >
          <AttendanceBody summary={summariseAttendance(attendance.data ?? [])} />
        </QueryState>
      </Card>

      <Card aria-labelledby="child-results">
        <CardHeader
          titleId="child-results"
          title={
            <span className="inline-flex items-center gap-2">
              <Trophy className="size-5 text-primary" aria-hidden="true" />
              {t('family.results.title')}
            </span>
          }
          description={t('family.results.description')}
        />
        <QueryState
          isPending={results.isPending}
          isError={results.isError}
          onRetry={() => void results.refetch()}
        >
          {(results.data ?? []).length === 0 ? (
            <EmptyState
              icon={Trophy}
              title={t('family.results.none')}
              description={t('family.results.noneBody')}
            />
          ) : (
            <CardBody className="space-y-3">
              {(results.data ?? []).map((exam, index) => (
                <ExamResult key={exam.id} exam={exam} open={index === 0} />
              ))}
              <p className="text-sm text-fg-muted">{t('family.results.starsNote')}</p>
            </CardBody>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

/** A family's view of their own child: the teacher's notes, attendance, results and practice. */
export function FamilyHome() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  useDocumentTitle(t('workspaces.family'));
  return access.student ? <FamilyDashboard student={access.student} /> : null;
}
