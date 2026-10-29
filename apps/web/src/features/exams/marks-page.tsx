import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Eraser, History, RotateCcw, Save, Undo2, UserX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  classDetailsQuery,
  classRosterQuery,
  rollOn,
  type RosterEntry,
} from '@/features/attendance/attendance-api';
import { dayInIndia, formatDay } from '@/features/attendance/dates';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  examName,
  forgetFinishedSaves,
  forgetMarksSaves,
  marksChange,
  marksDedupeKey,
  marksDraftKey,
  marksOpen,
  paperMarksKey,
  reconcileMarksSaves,
  rememberExamQueries,
  STALE_MARKS,
  subjectName,
  type MarksChange,
} from './exam-change';
import {
  classExamsQuery,
  examRollQuery,
  markChangesQuery,
  paperMarksQuery,
  useSaveMarks,
  type ClassPaper,
  type MarkChange,
  type PaperMarks,
} from './exam-api';
import { examReasonFor } from './exam-reasons';
import {
  formatMarks,
  GRADES,
  parseMarks,
  summarise,
  type Grade,
  type MarkEntry,
  type MarksProblem,
} from './marks';

/** A child's result as typed on the page, before it is checked. */
interface TypedEntry {
  text: string;
  grade: Grade | null;
  absent: boolean;
}

type TypedEntries = Record<string, TypedEntry>;

function typedFrom(mark: MarkEntry | undefined): TypedEntry {
  return {
    text: mark?.marks === null || mark?.marks === undefined ? '' : String(mark.marks),
    grade: mark?.grade ?? null,
    absent: mark?.absent ?? false,
  };
}

function sameTyped(a: TypedEntry, b: TypedEntry): boolean {
  return a.text.trim() === b.text.trim() && a.grade === b.grade && a.absent === b.absent;
}

/** A paper's marks, entered child by child. */
export function MarksPage({
  classSectionId,
  paperId,
}: {
  classSectionId: string;
  paperId: string;
}) {
  const { t } = useTranslation();
  const papers = useQuery(classExamsQuery(classSectionId));
  const details = useQuery(classDetailsQuery(classSectionId));
  const classRoster = useQuery(classRosterQuery(classSectionId));
  const paper = papers.data?.find((entry) => entry.id === paperId);
  const heldOn = paper?.heldOn ?? '';
  const marks = useQuery({ ...paperMarksQuery(paperId), enabled: paper !== undefined });
  const roll = useQuery({
    ...examRollQuery(classSectionId, heldOn, heldOn),
    enabled: paper !== undefined,
  });
  useDocumentTitle(t('exams.class.title'));

  // A paper without any results yet has no marks to read: it can be marked without a network.
  const stored: PaperMarks | null | undefined =
    marks.data !== undefined
      ? marks.data
      : paper?.revision === 0 && paper.results === 0
        ? { revision: 0, clientChangeId: null, marks: [] }
        : undefined;
  // The roll of the paper's day from the server, else worked out from the class list on the phone.
  const children =
    roll.data ?? (paper && classRoster.data ? rollOn(classRoster.data, heldOn) : undefined);

  const back = (
    <BackLink to="/app/exams/$classId" params={{ classId: classSectionId }}>
      {t('exams.marks.back')}
    </BackLink>
  );

  if (!paper || !stored || !children) {
    const waitingForPaper = papers.isPending;
    const waitingForMarks = paper !== undefined && stored === undefined && marks.isPending;
    const waitingForRoll =
      paper !== undefined && children === undefined && (roll.isPending || classRoster.isPending);
    return (
      <div className="container-page space-y-5 py-8">
        {back}
        <QueryState
          isPending={waitingForPaper || waitingForMarks || waitingForRoll}
          isError={papers.isError || marks.isError || (roll.isError && classRoster.isError)}
          onRetry={() => {
            void papers.refetch();
            void marks.refetch();
            void roll.refetch();
          }}
        >
          <EmptyState
            icon={History}
            title={t('exams.marks.notFound.title')}
            description={t('exams.marks.notFound.body')}
          />
        </QueryState>
      </div>
    );
  }

  return (
    <div className="container-page space-y-5 py-8">
      {back}
      <MarksEditor
        key={paper.id}
        paper={paper}
        stored={stored}
        roll={rollOn(children, paper.heldOn)}
        label={details.data ? { grade: details.data.grade, section: details.data.section } : null}
      />
    </div>
  );
}

function MarksEditor({
  paper,
  stored,
  roll,
  label,
}: {
  paper: ClassPaper;
  stored: PaperMarks;
  roll: RosterEntry[];
  label: MarksChange['classLabel'];
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const today = todayInIndia();
  const saveMarks = useSaveMarks();
  const waiting = useWaitingChange(marksDedupeKey(paper.id));
  const saveButton = useRef<HTMLButtonElement>(null);
  rememberExamQueries(queryClient);
  const open = marksOpen(paper.heldOn, today);
  // Marks typed earlier on this phone and not saved come back while the paper is open.
  const [restored] = useState(() =>
    open ? (queryClient.getQueryData<TypedEntries | null>(marksDraftKey(paper.id)) ?? null) : null,
  );
  const [edits, setEdits] = useState<TypedEntries>(() => restored ?? {});
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [triedSave, setTriedSave] = useState(false);

  // Typed marks of a paper that has closed can no longer be saved.
  useEffect(() => {
    if (!open) {
      queryClient.setQueryData(marksDraftKey(paper.id), null);
    }
  }, [open, queryClient, paper.id]);

  // A save sent while no page was open is recognised by its identifier; once nothing waits on the
  // phone, the marks read from the server are the base of the next save.
  useEffect(() => {
    reconcileMarksSaves(queryClient, {
      id: paper.id,
      revision: stored.revision,
      clientChangeId: stored.clientChangeId,
    });
  }, [queryClient, paper.id, stored.revision, stored.clientChangeId]);
  useEffect(() => {
    if (waiting.isLoaded && waiting.id === null) {
      forgetFinishedSaves(queryClient, paper.id);
    }
  }, [waiting.isLoaded, waiting.id, queryClient, paper.id]);

  const waitingChange = useMemo(() => {
    const parsed = marksChange.schema.safeParse(waiting.payload);
    return parsed.success ? parsed.data : null;
  }, [waiting.payload]);
  const stale = waiting.state === 'failed' && waiting.error?.code === STALE_MARKS;
  // A save still on its way is what the page shows and builds on, not the older marks read before.
  // So is one the server refused for a reason the teacher can fix: their marks stay in front of
  // them, to correct and save again, instead of disappearing behind the older ones. A save refused
  // because someone else saved meanwhile is settled by the choice offered above the list.
  const baseline: readonly MarkEntry[] =
    waitingChange && (waiting.state === 'pending' || (waiting.state === 'failed' && !stale))
      ? waitingChange.entries
      : stored.marks;
  const byStudent = new Map(baseline.map((mark) => [mark.studentId, mark]));
  const onRoll = new Set(roll.map((child) => child.studentId));

  const typedOf = (studentId: string): TypedEntry =>
    edits[studentId] ?? typedFrom(byStudent.get(studentId));
  const dirty = Object.entries(edits).some(
    ([studentId, entry]) => !sameTyped(entry, typedFrom(byStudent.get(studentId))),
  );

  const problemOf = (entry: TypedEntry): MarksProblem | null => {
    if (paper.scale !== 'marks' || entry.absent || paper.maxMarks === null) {
      return null;
    }
    const read = parseMarks(entry.text, paper.maxMarks);
    return 'problem' in read ? read.problem : null;
  };

  const entryOf = (studentId: string): MarkEntry | null => {
    const typed = typedOf(studentId);
    if (typed.absent) {
      return { studentId, marks: null, grade: null, absent: true };
    }
    if (paper.scale === 'grades') {
      return typed.grade ? { studentId, marks: null, grade: typed.grade, absent: false } : null;
    }
    const read = parseMarks(typed.text, paper.maxMarks ?? 0);
    return 'value' in read && read.value !== null
      ? { studentId, marks: read.value, grade: null, absent: false }
      : null;
  };
  const entries: MarkEntry[] = [
    ...roll
      .map((child) => entryOf(child.studentId))
      .filter((entry): entry is MarkEntry => entry !== null),
    // Results of children no longer on this phone's list are sent back unchanged, never dropped.
    ...baseline
      .filter((mark) => !onRoll.has(mark.studentId))
      .map(({ studentId, marks, grade, absent }) => ({ studentId, marks, grade, absent })),
  ];
  const problems = roll.filter((child) => problemOf(typedOf(child.studentId)) !== null).length;
  const summary = summarise(
    entries,
    roll.map((child) => child.studentId),
    paper,
  );

  const blocker = useBlocker({
    shouldBlockFn: () => dirty || saving,
    enableBeforeUnload: () => dirty || saving,
    withResolver: true,
  });

  const keepDraft = (next: TypedEntries) => {
    queryClient.setQueryData(marksDraftKey(paper.id), Object.keys(next).length > 0 ? next : null);
  };

  const edit = (studentId: string, change: Partial<TypedEntry>) => {
    setEdits((current) => {
      const next = { ...current, [studentId]: { ...typedOf(studentId), ...change } };
      keepDraft(next);
      return next;
    });
  };

  const forgetEdits = () => {
    setEdits({});
    setTouched(new Set());
    keepDraft({});
  };

  const save = async () => {
    setTriedSave(true);
    if (problems > 0 || saving) {
      return;
    }
    setSaving(true);
    try {
      const kept = await saveMarks(
        {
          id: paper.id,
          classSectionId: paper.classSectionId,
          revision: stored.revision,
          subject: paper.subject,
          subjectName: paper.subjectName,
        },
        entries,
        label,
      );
      if (kept) {
        forgetEdits();
        setTriedSave(false);
        toast.success(t('exams.marks.saved'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** Takes the server's marks, or keeps the refused ones to save over them, after a conflict. */
  const resolveConflict = (keepMine: boolean) => {
    const refused = waiting.id;
    const mine = waitingChange?.entries ?? [];
    void (async () => {
      try {
        if (refused) {
          await offlineRuntime.discard(refused);
        }
        forgetMarksSaves(queryClient, paper.id);
        await queryClient.invalidateQueries({ queryKey: paperMarksKey(paper.id) });
        if (keepMine) {
          const next = Object.fromEntries(mine.map((entry) => [entry.studentId, typedFrom(entry)]));
          setEdits(next);
          keepDraft(next);
        } else {
          forgetEdits();
        }
      } catch {
        toast.error(t('exams.saveFailed'));
      }
    })();
  };

  const focusNext = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const next = [...document.querySelectorAll<HTMLInputElement>('[data-marks-index]')].find(
      (input) => Number(input.dataset.marksIndex) > index && !input.disabled,
    );
    (next ?? saveButton.current)?.focus();
  };

  return (
    <>
      <PageHeader
        title={`${subjectName(paper, t)} · ${label ? classLabel(t, label.grade, label.section) : t('exams.classFallback')}`}
        description={t('exams.marks.description', {
          exam: examName(paper.exam, t),
          date: formatDay(paper.heldOn, i18n.language),
        })}
        actions={
          <span role="status" aria-live="polite">
            {!waiting.isLoaded ? null : waiting.state === 'failed' ? (
              <Badge tone="danger">{t('exams.save.failed')}</Badge>
            ) : waiting.state === 'pending' ? (
              <Badge tone="warning">{t('exams.save.waiting')}</Badge>
            ) : stored.marks.length > 0 ? (
              <Badge tone="success">{t('exams.save.sent')}</Badge>
            ) : null}
          </span>
        }
      />

      {waiting.state === 'failed' && waiting.error ? (
        <Alert tone="danger" title={t('exams.marks.notSent')}>
          <p>{stale ? t('exams.marks.stale') : examReasonFor(waiting.error, t)}</p>
          {stale ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => resolveConflict(false)}>
                <RotateCcw aria-hidden="true" />
                {t('exams.marks.useServer')}
              </Button>
              {open ? (
                <Button variant="secondary" onClick={() => resolveConflict(true)}>
                  <Undo2 aria-hidden="true" />
                  {t('exams.marks.keepMine')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Alert>
      ) : null}

      {paper.heldOn > today ? (
        <Alert tone="info">
          {t('exams.marks.notYet', { date: formatDay(paper.heldOn, i18n.language) })}
        </Alert>
      ) : !open ? (
        <Alert tone="info">{t('exams.marks.closed')}</Alert>
      ) : null}
      {restored && dirty ? <Alert tone="info">{t('exams.marks.restored')}</Alert> : null}

      <Card>
        <CardHeader
          title={
            paper.scale === 'marks'
              ? t('exams.marks.outOf', { max: paper.maxMarks ?? 0 })
              : t('exams.marks.graded')
          }
          description={[
            t('exams.marks.entered', { entered: summary.entered, children: summary.children }),
            summary.absent > 0 ? t('exams.marks.absentCount', { count: summary.absent }) : null,
            summary.average !== null
              ? t('exams.marks.average', { value: formatMarks(summary.average, i18n.language) })
              : null,
            summary.highest !== null && summary.lowest !== null
              ? t('exams.marks.range', {
                  highest: formatMarks(summary.highest, i18n.language),
                  lowest: formatMarks(summary.lowest, i18n.language),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        {roll.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">{t('exams.marks.noChildren')}</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {roll.map((child, index) => {
              const typed = typedOf(child.studentId);
              const problem = problemOf(typed);
              const showProblem = problem !== null && (triedSave || touched.has(child.studentId));
              const errorId = `marks-problem-${child.studentId}`;
              return (
                <li
                  key={child.studentId}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{child.fullName}</p>
                    {showProblem ? (
                      <p id={errorId} className="text-sm font-medium text-danger">
                        {t(`exams.marks.problem.${problem}`, { max: paper.maxMarks ?? 0 })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {paper.scale === 'marks' ? (
                      <Input
                        className={cn(
                          'w-24 text-center tabular-nums',
                          showProblem && 'border-danger',
                        )}
                        inputMode="decimal"
                        enterKeyHint="next"
                        data-marks-index={index}
                        aria-label={t('exams.marks.marksLabel', { name: child.fullName })}
                        aria-invalid={showProblem}
                        aria-describedby={showProblem ? errorId : undefined}
                        value={typed.absent ? '' : typed.text}
                        maxLength={6}
                        disabled={!open || typed.absent}
                        onChange={(event) => edit(child.studentId, { text: event.target.value })}
                        onBlur={() =>
                          setTouched((current) => new Set(current).add(child.studentId))
                        }
                        onKeyDown={(event) => focusNext(event, index)}
                      />
                    ) : (
                      <GradePicker
                        label={t('exams.marks.gradeLabel', { name: child.fullName })}
                        value={typed.absent ? null : typed.grade}
                        disabled={!open || typed.absent}
                        onChange={(grade) => edit(child.studentId, { grade })}
                      />
                    )}
                    <Button
                      variant={typed.absent ? 'primary' : 'secondary'}
                      aria-pressed={typed.absent}
                      aria-label={t('exams.marks.absentLabel', { name: child.fullName })}
                      disabled={!open}
                      onClick={() => edit(child.studentId, { absent: !typed.absent })}
                    >
                      <UserX aria-hidden="true" />
                      {t('exams.marks.absent')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {open && roll.length > 0 ? (
          <CardBody className="space-y-3 border-t border-border">
            {triedSave && problems > 0 ? (
              <Alert tone="danger" assertive>
                {t('exams.marks.fixProblems')}
              </Alert>
            ) : null}
            {dirty ? <p className="text-sm text-fg-muted">{t('exams.marks.unsaved')}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button ref={saveButton} disabled={saving || !dirty} onClick={() => void save()}>
                <Save aria-hidden="true" />
                {t('exams.marks.save')}
              </Button>
              {dirty ? (
                <Button variant="secondary" disabled={saving} onClick={forgetEdits}>
                  <Eraser aria-hidden="true" />
                  {t('exams.marks.discard')}
                </Button>
              ) : null}
            </div>
          </CardBody>
        ) : null}
      </Card>

      <Corrections paperId={paper.id} roll={roll} />

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            blocker.reset?.();
          }
        }}
      >
        <DialogContent
          title={t('exams.marks.leave.title')}
          description={t('exams.marks.leave.body')}
        >
          <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse">
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              {t('exams.marks.leave.stay')}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t('exams.marks.leave.go')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Grades A to E in one row; choosing the chosen grade again clears it. */
function GradePicker({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: Grade | null;
  disabled: boolean;
  onChange: (grade: Grade | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {GRADES.map((grade) => (
        <Button
          key={grade}
          size="icon"
          variant={value === grade ? 'primary' : 'secondary'}
          aria-pressed={value === grade}
          disabled={disabled}
          onClick={() => onChange(value === grade ? null : grade)}
        >
          {grade}
        </Button>
      ))}
    </div>
  );
}

/** One result as text: marks, a grade, absent, or no result. */
function resultText(entry: MarkEntry | null, t: TFunction, language: string): string {
  if (!entry) {
    return t('exams.marks.history.removed');
  }
  if (entry.absent) {
    return t('exams.marks.absent');
  }
  if (entry.marks !== null) {
    return formatMarks(entry.marks, language);
  }
  return entry.grade ?? t('exams.marks.history.removed');
}

function Corrections({ paperId, roll }: { paperId: string; roll: RosterEntry[] }) {
  const { t, i18n } = useTranslation();
  const changes = useQuery(markChangesQuery(paperId));
  const nameOf = (studentId: string) =>
    roll.find((entry) => entry.studentId === studentId)?.fullName ?? t('exams.check.unnamed');
  const lines: MarkChange[] = changes.data ?? [];
  // The day in India on which a correction was made.
  const dayOf = dayInIndia;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="size-5 text-primary" aria-hidden="true" />
            {t('exams.marks.history.title')}
          </span>
        }
        description={t('exams.marks.history.body')}
      />
      <CardBody>
        {lines.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('exams.marks.history.none')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-fg">{nameOf(line.studentId)}:</span>
                <span className="text-fg tabular-nums">
                  {resultText(line.before, t, i18n.language)} →{' '}
                  {resultText(line.after, t, i18n.language)}
                </span>
                <span className="text-fg-muted">
                  {t('exams.marks.history.by', {
                    name: line.changedByName ?? t('exams.marks.history.someone'),
                    date: formatDay(dayOf(line.changedAt), i18n.language),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
