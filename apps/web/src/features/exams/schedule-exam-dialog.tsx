import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classLabel } from '@/features/workspaces/grade-label';
import { EXAM_KINDS, SUBJECTS, type ExamKind, type Subject } from './exam-change';
import { currentAcademicYearQuery, useSaveExam } from './exam-api';
import { buildExam, type ScheduleProblem } from './schedule';

/** Where an exam is scheduled: one class of a school, or the classes of a cluster. */
export type ScheduleTarget =
  | { kind: 'class'; classSectionId: string; grade: number; section: string; schoolId: string }
  | {
      kind: 'cluster';
      clusterId: string;
      classes: readonly { id: string; grade: number; schoolId: string }[];
    };

interface SubjectChoice {
  chosen: boolean;
  heldOn: string;
}

/**
 * The form inside a dialog for scheduling an exam: its kind and name, the subjects and the day of
 * each, and how it is marked; for a cluster, also the grades. Closes itself once the exam is kept.
 */
export function ScheduleExamDialog({
  target,
  onDone,
}: {
  target: ScheduleTarget;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const today = todayInIndia();
  const year = useQuery(currentAcademicYearQuery());
  const saveExam = useSaveExam();
  const isClass = target.kind === 'class';
  const [kind, setKind] = useState<ExamKind>(isClass ? 'class_test' : 'half_yearly');
  const [title, setTitle] = useState('');
  const [subjects, setSubjects] = useState<Record<Subject, SubjectChoice>>(
    () =>
      Object.fromEntries(
        SUBJECTS.map((subject) => [subject, { chosen: false, heldOn: today }]),
      ) as Record<Subject, SubjectChoice>,
  );
  const [otherName, setOtherName] = useState('');
  const [scale, setScale] = useState<'marks' | 'grades'>('marks');
  const [maxMarks, setMaxMarks] = useState(isClass ? '20' : '100');
  const availableGrades =
    target.kind === 'cluster'
      ? [...new Set(target.classes.map((entry) => entry.grade))].sort((a, b) => a - b)
      : [];
  const [grades, setGrades] = useState<number[]>(availableGrades.filter((grade) => grade >= 1));
  const [problem, setProblem] = useState<ScheduleProblem | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = SUBJECTS.filter((subject) => subjects[subject].chosen);
  const classCount =
    target.kind === 'cluster'
      ? target.classes.filter((entry) => grades.includes(entry.grade)).length
      : 1;

  const submit = async () => {
    if (busy) {
      return;
    }
    const built = buildExam({
      examId: crypto.randomUUID(),
      academicYear: year.data ?? null,
      kind,
      title,
      clusterId: target.kind === 'cluster' ? target.clusterId : null,
      schoolId: target.kind === 'class' ? target.schoolId : null,
      classes:
        target.kind === 'class'
          ? [{ id: target.classSectionId, grade: target.grade }]
          : target.classes,
      grades: target.kind === 'cluster' ? grades : null,
      subjects: chosen.map((subject) => ({
        subject,
        subjectName: subject === 'other' ? otherName : '',
        heldOn: subjects[subject].heldOn,
      })),
      scale,
      maxMarks,
      today,
      newId: () => crypto.randomUUID(),
    });
    if ('problem' in built) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const schoolOf = (classSectionId: string) =>
        target.kind === 'class'
          ? target.schoolId
          : (target.classes.find((entry) => entry.id === classSectionId)?.schoolId ?? '');
      if (await saveExam(built.exam, access.user_id, schoolOf)) {
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={
        target.kind === 'class'
          ? t('exams.schedule.titleClass', {
              class: classLabel(t, target.grade, target.section),
            })
          : t('exams.schedule.titleCluster')
      }
      description={
        target.kind === 'class' ? t('exams.schedule.bodyClass') : t('exams.schedule.bodyCluster')
      }
    >
      <form
        className="max-h-[70vh] space-y-5 overflow-y-auto pe-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('exams.schedule.kind')}>
            <Select
              value={kind}
              onChange={(event) =>
                setKind(EXAM_KINDS.find((entry) => entry === event.target.value) ?? 'class_test')
              }
            >
              {EXAM_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`exams.kind.${entry}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('exams.schedule.name')} hint={t('exams.schedule.nameHint')}>
            <Input
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>

        {target.kind === 'cluster' ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">{t('exams.schedule.grades')}</legend>
            <div className="flex flex-wrap gap-2">
              {availableGrades.map((grade) => {
                const selected = grades.includes(grade);
                return (
                  <label
                    key={grade}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected}
                      onChange={() =>
                        setGrades((current) =>
                          selected
                            ? current.filter((entry) => entry !== grade)
                            : [...current, grade],
                        )
                      }
                    />
                    <span className="text-sm text-fg">{classLabel(t, grade)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">{t('exams.schedule.subjects')}</legend>
          <ul className="space-y-2">
            {SUBJECTS.map((subject) => {
              const choice = subjects[subject];
              return (
                <li
                  key={subject}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2"
                >
                  <label className="flex min-h-11 min-w-40 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={choice.chosen}
                      onChange={() =>
                        setSubjects((current) => ({
                          ...current,
                          [subject]: { ...current[subject], chosen: !current[subject].chosen },
                        }))
                      }
                    />
                    <span className="text-sm text-fg">{t(`exams.subject.${subject}`)}</span>
                  </label>
                  {choice.chosen ? (
                    <Input
                      type="date"
                      className="w-44"
                      aria-label={`${t('exams.schedule.date')}: ${t(`exams.subject.${subject}`)}`}
                      value={choice.heldOn}
                      min={year.data?.startsOn}
                      max={year.data?.endsOn}
                      onChange={(event) =>
                        setSubjects((current) => ({
                          ...current,
                          [subject]: { ...current[subject], heldOn: event.target.value },
                        }))
                      }
                    />
                  ) : null}
                  {choice.chosen && subject === 'other' ? (
                    <Input
                      className="w-full"
                      aria-label={t('exams.schedule.otherName')}
                      placeholder={t('exams.schedule.otherName')}
                      value={otherName}
                      maxLength={40}
                      onChange={(event) => setOtherName(event.target.value)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceGroup
            label={t('exams.schedule.scale')}
            value={scale}
            onChange={setScale}
            options={[
              { value: 'marks', label: t('exams.schedule.scaleMarks') },
              { value: 'grades', label: t('exams.schedule.scaleGrades') },
            ]}
          />
          {scale === 'marks' ? (
            <Field label={t('exams.schedule.maxMarks')}>
              <Input
                inputMode="numeric"
                value={maxMarks}
                maxLength={3}
                onChange={(event) => setMaxMarks(event.target.value)}
              />
            </Field>
          ) : null}
        </div>

        {target.kind === 'cluster' && chosen.length > 0 ? (
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t('exams.schedule.papers', {
              papers: t('exams.schedule.paperCount', { count: classCount * chosen.length }),
              classes: t('exams.schedule.classCount', { count: classCount }),
            })}
          </p>
        ) : null}

        {problem ? (
          <Alert tone="danger" assertive>
            {t(`exams.schedule.${problem}`)}
          </Alert>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={busy || year.isPending}>
            <CalendarPlus aria-hidden="true" />
            {t('exams.schedule.save')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
