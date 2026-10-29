import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CalendarClock,
  CalendarPlus,
  ClipboardList,
  FileSpreadsheet,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery, classRosterQuery, rollOn } from '@/features/attendance/attendance-api';
import { formatDay } from '@/features/attendance/dates';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import {
  examDedupeKey,
  examName,
  marksOpen,
  MAX_MARKS_LIMIT,
  paperDedupeKey,
  paperMarksKey,
  subjectName,
} from './exam-change';
import {
  classExamsQuery,
  prepareOpenPapers,
  useMovePaper,
  useRemoveExam,
  type ClassPaper,
  type ExamSummary,
  type PaperMarks,
} from './exam-api';
import { examReasonFor } from './exam-reasons';
import { ScheduleExamDialog } from './schedule-exam-dialog';

type Stage = 'toMark' | 'upcoming' | 'done';

function stageOf(
  papers: readonly ClassPaper[],
  children: (paper: ClassPaper) => number,
  today: string,
): Stage {
  if (papers.some((paper) => marksOpen(paper.heldOn, today) && paper.results < children(paper))) {
    return 'toMark';
  }
  return papers.every((paper) => paper.heldOn > today) ? 'upcoming' : 'done';
}

/** A teacher's view of the exams of a class: what to mark, what is coming up, and the results. */
export function ClassExamsPage({ classSectionId }: { classSectionId: string }) {
  const { t } = useTranslation();
  const localise = useLocalisedName();
  const today = todayInIndia();
  const details = useQuery(classDetailsQuery(classSectionId));
  const papers = useQuery(classExamsQuery(classSectionId));
  const roster = useQuery(classRosterQuery(classSectionId));
  const [scheduling, setScheduling] = useState(false);
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  // While there is a network, the marks and roll of every paper open for marks are kept on the
  // phone, so that marks can be entered in a classroom without one.
  useEffect(() => {
    if (isOnline && papers.data) {
      prepareOpenPapers(queryClient, papers.data, todayInIndia());
    }
  }, [isOnline, papers.data, queryClient]);
  const title = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('exams.classFallback');
  useDocumentTitle(t('exams.class.title'));

  const children = (paper: ClassPaper) => rollOn(roster.data ?? [], paper.heldOn).length;
  const exams = new Map<string, { exam: ExamSummary; papers: ClassPaper[] }>();
  for (const paper of papers.data ?? []) {
    const entry = exams.get(paper.examId) ?? { exam: paper.exam, papers: [] };
    entry.papers.push(paper);
    exams.set(paper.examId, entry);
  }
  const staged = [...exams.values()]
    .map((entry) => ({
      ...entry,
      papers: [...entry.papers].sort((a, b) => a.heldOn.localeCompare(b.heldOn)),
      stage: stageOf(entry.papers, children, today),
    }))
    .sort((a, b) => b.exam.startsOn.localeCompare(a.exam.startsOn));
  const stages: Stage[] = ['toMark', 'upcoming', 'done'];

  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app/teacher">{t('exams.class.back')}</BackLink>
      <PageHeader
        title={t('exams.class.title')}
        description={details.data ? `${title} · ${localise(details.data.school)}` : undefined}
        actions={
          details.data ? (
            <Dialog open={scheduling} onOpenChange={setScheduling}>
              <DialogTrigger asChild>
                <Button>
                  <CalendarPlus aria-hidden="true" />
                  {t('exams.class.schedule')}
                </Button>
              </DialogTrigger>
              {scheduling ? (
                <ScheduleExamDialog
                  target={{
                    kind: 'class',
                    classSectionId,
                    grade: details.data.grade,
                    section: details.data.section,
                    schoolId: details.data.school.id,
                  }}
                  onDone={() => setScheduling(false)}
                />
              ) : null}
            </Dialog>
          ) : null
        }
      />

      <QueryState
        isPending={papers.isPending}
        isError={papers.isError}
        onRetry={() => void papers.refetch()}
      >
        {staged.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t('exams.class.empty.title')}
            description={t('exams.class.empty.body')}
          />
        ) : (
          stages.map((stage) => {
            const ofStage = staged.filter((entry) => entry.stage === stage);
            if (ofStage.length === 0) {
              return null;
            }
            return (
              <section key={stage} className="space-y-3" aria-labelledby={`exams-${stage}`}>
                <h2 id={`exams-${stage}`} className="text-lg font-semibold text-fg">
                  {t(`exams.class.${stage}`)}
                </h2>
                {ofStage.map((entry) => (
                  <ExamCard
                    key={entry.exam.id}
                    exam={entry.exam}
                    papers={entry.papers}
                    classSectionId={classSectionId}
                    children={children}
                  />
                ))}
              </section>
            );
          })
        )}
      </QueryState>
    </div>
  );
}

function ExamCard({
  exam,
  papers,
  classSectionId,
  children,
}: {
  exam: ExamSummary;
  papers: ClassPaper[];
  classSectionId: string;
  children: (paper: ClassPaper) => number;
}) {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const today = todayInIndia();
  const waiting = useWaitingChange(examDedupeKey(exam.id));
  const removeExam = useRemoveExam();
  const [removing, setRemoving] = useState(false);
  const name = examName(exam, t);
  // An exam of the school is managed by its teachers; a cluster's exam by its CRPs.
  const removable =
    (exam.createdBy === access.user_id || exam.schoolId !== null) &&
    papers.every((paper) => paper.results === 0);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {name}
            {exam.clusterId ? <Badge tone="brand">{t('exams.class.forCluster')}</Badge> : null}
          </span>
        }
        description={
          exam.startsOn === exam.endsOn
            ? formatDay(exam.startsOn, i18n.language)
            : t('exams.crp.dates', {
                from: formatDay(exam.startsOn, i18n.language),
                to: formatDay(exam.endsOn, i18n.language),
              })
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link
                to="/app/exams/$classId/result/$examId"
                params={{ classId: classSectionId, examId: exam.id }}
              >
                <FileSpreadsheet aria-hidden="true" />
                {t('exams.class.result')}
              </Link>
            </Button>
            {removable ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('exams.class.remove')}
                onClick={() => setRemoving(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        }
      />
      {waiting.state === 'pending' ? (
        <p className="px-5 text-sm text-fg-muted">{t('exams.class.waiting')}</p>
      ) : null}
      {waiting.state === 'failed' && waiting.error ? (
        <div className="px-5">
          <Alert tone="danger">{examReasonFor(waiting.error, t)}</Alert>
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {papers.map((paper) => (
          <PaperRow
            key={paper.id}
            paper={paper}
            exam={exam}
            children={children(paper)}
            classSectionId={classSectionId}
            today={today}
          />
        ))}
      </ul>

      <Dialog open={removing} onOpenChange={setRemoving}>
        {removing ? (
          <DialogContent
            title={t('exams.removeDialog.title')}
            description={t('exams.removeDialog.body', { exam: name })}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(false)}>
                {t('exams.removeDialog.keep')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void removeExam({
                    examId: exam.id,
                    kind: exam.kind,
                    title: exam.title,
                    classSectionIds: [...new Set(papers.map((paper) => paper.classSectionId))],
                  });
                  setRemoving(false);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t('exams.removeDialog.confirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function PaperRow({
  paper,
  exam,
  children,
  classSectionId,
  today,
}: {
  paper: ClassPaper;
  exam: ExamSummary;
  children: number;
  classSectionId: string;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const [moving, setMoving] = useState(false);
  const waiting = useWaitingChange(paperDedupeKey(paper.id));
  const open = marksOpen(paper.heldOn, today);
  const complete = children > 0 && paper.results >= children;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-fg">{subjectName(paper, t)}</p>
        <p className="text-sm text-fg-muted">
          {formatDay(paper.heldOn, i18n.language)} ·{' '}
          {paper.scale === 'marks'
            ? t('exams.class.outOf', { max: paper.maxMarks ?? 0 })
            : t('exams.class.graded')}
        </p>
        {paper.heldOn <= today ? (
          <Badge tone={complete ? 'success' : open ? 'warning' : 'neutral'}>
            {t('exams.class.progress', { entered: paper.results, children })}
          </Badge>
        ) : null}
        {waiting.state === 'pending' ? (
          <p className="text-sm text-fg-muted">{t('exams.class.waiting')}</p>
        ) : null}
        {waiting.state === 'failed' && waiting.error ? (
          <p className="text-sm font-medium text-danger">{examReasonFor(waiting.error, t)}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {paper.heldOn > today || open ? (
          <Dialog open={moving} onOpenChange={setMoving}>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <CalendarClock aria-hidden="true" />
                {t('exams.class.move')}
              </Button>
            </DialogTrigger>
            {moving ? (
              <MovePaperDialog paper={paper} exam={exam} onDone={() => setMoving(false)} />
            ) : null}
          </Dialog>
        ) : null}
        {paper.heldOn <= today ? (
          <Button asChild variant={open && !complete ? 'primary' : 'secondary'}>
            <Link
              to="/app/exams/$classId/paper/$paperId"
              params={{ classId: classSectionId, paperId: paper.id }}
            >
              <NotebookPen aria-hidden="true" />
              {open ? t('exams.class.enterMarks') : t('exams.class.viewMarks')}
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function MovePaperDialog({
  paper,
  exam,
  onDone,
}: {
  paper: ClassPaper;
  exam: ExamSummary;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const movePaper = useMovePaper();
  const [heldOn, setHeldOn] = useState(paper.heldOn);
  const [maxMarks, setMaxMarks] = useState(String(paper.maxMarks ?? ''));
  const max = Number(maxMarks);
  // The highest mark already given, when the phone holds the paper's marks.
  const highest = Math.max(
    0,
    ...(queryClient.getQueryData<PaperMarks | null>(paperMarksKey(paper.id))?.marks ?? []).map(
      (mark) => mark.marks ?? 0,
    ),
  );
  const maxValid =
    paper.scale === 'grades' ||
    (/^\d{1,3}$/.test(maxMarks.trim()) && max >= 1 && max <= MAX_MARKS_LIMIT && max >= highest);
  // A paper with results keeps its day.
  const dayValid =
    heldOn >= exam.startsOn &&
    heldOn <= exam.endsOn &&
    (paper.results === 0 || heldOn === paper.heldOn);
  return (
    <DialogContent
      title={t('exams.move.title', { subject: subjectName(paper, t) })}
      description={t('exams.move.body', {
        from: formatDay(exam.startsOn, i18n.language),
        to: formatDay(exam.endsOn, i18n.language),
      })}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!maxValid || !dayValid) {
            return;
          }
          void movePaper({
            paperId: paper.id,
            classSectionId: paper.classSectionId,
            heldOn,
            maxMarks: paper.scale === 'marks' ? max : null,
            subject: paper.subject,
            subjectName: paper.subjectName,
          });
          onDone();
        }}
      >
        <Field
          label={t('exams.schedule.date')}
          error={dayValid ? undefined : t('exams.refused.dates')}
        >
          <Input
            type="date"
            value={heldOn}
            min={exam.startsOn}
            max={exam.endsOn}
            disabled={paper.results > 0}
            onChange={(event) => setHeldOn(event.target.value)}
          />
        </Field>
        {paper.scale === 'marks' ? (
          <Field
            label={t('exams.schedule.maxMarks')}
            error={
              maxValid
                ? undefined
                : max < highest
                  ? t('exams.refused.maximum')
                  : t('exams.schedule.maxInvalid')
            }
          >
            <Input
              inputMode="numeric"
              value={maxMarks}
              maxLength={3}
              onChange={(event) => setMaxMarks(event.target.value)}
            />
          </Field>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!maxValid || !dayValid}>
            {t('exams.move.save')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
