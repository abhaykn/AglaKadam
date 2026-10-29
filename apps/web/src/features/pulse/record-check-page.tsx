import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import {
  ChevronLeft,
  CircleAlert,
  Ear,
  HandHeart,
  Languages,
  Mic,
  MicOff,
  Save,
  ShieldCheck,
  Smartphone,
  Square,
  StepForward,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { classLabel } from '@/features/workspaces/grade-label';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { readLocal, removeLocal, writeLocal } from '@/lib/local-storage';
import { useDocumentTitle } from '@/lib/use-document-title';
import { CheckForm } from './check-form';
import {
  EMPTY_FORM,
  isAdaptedComplete,
  isComplete,
  type CheckFormValues,
} from './check-form-values';
import { chooseItem } from './choose-item';
import type { PulseItem } from './item-bank';
import { ReadingDisplay, SpeakingDisplay } from './item-display';
import {
  itemRecord,
  nextReadingLevel,
  READING_LIMIT_MS,
  type ItemLevel,
  type ShownStep,
} from './item-levels';
import {
  monthEndOf,
  pulseCycleQuery,
  saveAdaptedCheck,
  savePulseCheck,
  viewOn,
  type PulseChild,
  type PulseCycle,
} from './pulse-api';
import { compareDue, statusOf } from './pulse-status';
import {
  MAX_RECORDING_MS,
  MicrophoneError,
  MicrophoneSession,
  MIN_RECORDING_MS,
  NOISY_ROOM_DBFS,
  type MicrophoneProblem,
  type Recording,
} from './recorder';
import { useWaitingPulse } from './use-waiting-pulse';
import { useWithdrawnConsent } from './use-withdrawn-consent';

const WAVEFORM_BARS = 24;

/** The items are fixed from the moment recording starts, so they can never change under the teacher. */
interface RecordingStep {
  name: 'recording';
  noiseDbfs: number;
  startedAt: string;
  item: PulseItem;
  shown: [ShownStep, ...ShownStep[]];
}

interface FormStep extends Omit<RecordingStep, 'name'> {
  name: 'form';
  recording: Recording;
  /** Address of the recording for listening back; released when the form closes. */
  audioUrl: string;
  checkId: string;
}

type Step =
  | { name: 'intro' }
  | { name: 'opening' }
  | { name: 'measuring' }
  | { name: 'ready'; noiseDbfs: number }
  | RecordingStep
  | FormStep;

/**
 * How many recordings of this child were started for this attempt, kept on the device. Every start
 * shows the items, so starts that did not end in a saved check are reported with the check.
 */
function startsKey(sampleId: string, attempt: number): string {
  return `ak.pulse.starts.${sampleId}.${String(attempt)}`;
}

function readStarts(sampleId: string, attempt: number): number {
  const value = Number(readLocal(startsKey(sampleId, attempt)));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function currentLevel(step: RecordingStep): ItemLevel {
  return step.shown[step.shown.length - 1]?.level ?? step.shown[0].level;
}

/** The form for a finished recording. */
function toForm(step: RecordingStep, recording: Recording): FormStep {
  return {
    ...step,
    name: 'form',
    recording,
    audioUrl: URL.createObjectURL(recording.blob),
    checkId: crypto.randomUUID(),
  };
}

/** Live input level, waveform and recording time, refreshed about ten times a second. */
function useMeter(session: MicrophoneSession | null, active: boolean) {
  const [meter, setMeter] = useState({
    level: -100,
    elapsed: 0,
    bars: Array<number>(WAVEFORM_BARS).fill(0),
  });
  useEffect(() => {
    if (!session || !active) {
      return;
    }
    const timer = setInterval(() => {
      setMeter({
        level: session.level(),
        elapsed: session.elapsed(),
        bars: session.waveform(WAVEFORM_BARS),
      });
    }, 100);
    return () => clearInterval(timer);
  }, [session, active]);
  return meter;
}

function LevelMeter({ level }: { level: number }) {
  // -60 dBFS and below shows as empty; 0 dBFS as full.
  const fill = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
      <div
        className="h-full rounded-full bg-success transition-[width] duration-100"
        style={{ width: `${String(fill)}%` }}
      />
    </div>
  );
}

function Waveform({ bars }: { bars: number[] }) {
  return (
    <div className="flex h-12 items-center justify-center gap-1" aria-hidden="true">
      {bars.map((bar, index) => (
        <span
          key={index}
          className="w-1.5 rounded-full bg-primary transition-[height] duration-100"
          style={{ height: `${String(Math.max(8, Math.round(bar * 100)))}%` }}
        />
      ))}
    </div>
  );
}

function formatClock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

interface CheckProps {
  classSectionId: string;
  cycle: PulseCycle;
  child: PulseChild;
  item: PulseItem;
  attempt: 1 | 2;
  classLabelValue: { grade: number; section: string };
}

function Recorder({ classSectionId, cycle, child, item, attempt, classLabelValue }: CheckProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [step, setStep] = useState<Step>({ name: 'intro' });
  const [problem, setProblem] = useState<MicrophoneProblem | null>(null);
  const [values, setValues] = useState<CheckFormValues>(EMPTY_FORM);
  const [showMissing, setShowMissing] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [session, setSession] = useState<MicrophoneSession | null>(null);
  const sessionRef = useRef<MicrophoneSession | null>(null);
  const mounted = useRef(true);
  const stepRef = useRef<Step>(step);
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Read when leaving the page: once the check is saved, nothing is lost by leaving.
  const saved = useRef(false);
  const meter = useMeter(
    session,
    step.name === 'measuring' || step.name === 'ready' || step.name === 'recording',
  );

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const clearReadingTimer = () => {
    if (readingTimer.current !== null) {
      clearTimeout(readingTimer.current);
      readingTimer.current = null;
    }
  };

  // The microphone is always released when the page is left, also while it is still opening.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (readingTimer.current !== null) {
        clearTimeout(readingTimer.current);
      }
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const audioUrl = step.name === 'form' ? step.audioUrl : null;
  useEffect(
    () => () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    },
    [audioUrl],
  );

  // Each stage gets the focus, so that a screen reader follows the check from step to step.
  const stage =
    step.name === 'recording'
      ? currentLevel(step) === 'english'
        ? 'english'
        : 'reading'
      : step.name === 'form'
        ? 'form'
        : 'preparing';
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  const closeMicrophone = () => {
    clearReadingTimer();
    sessionRef.current?.close();
    sessionRef.current = null;
    setSession(null);
  };

  const recordingStarted = step.name === 'recording' || step.name === 'form';
  const blocker = useBlocker({
    shouldBlockFn: () => recordingStarted && !saved.current,
    enableBeforeUnload: () => recordingStarted && !saved.current,
    withResolver: true,
  });

  const fail = (error: unknown) => {
    closeMicrophone();
    setProblem(error instanceof MicrophoneError ? error.problem : 'unsupported');
    setStep({ name: 'intro' });
  };

  const checkRoom = async () => {
    setProblem(null);
    try {
      let current = sessionRef.current;
      if (!current) {
        setStep({ name: 'opening' });
        const opened = await MicrophoneSession.open();
        if (!mounted.current) {
          // The page was left while the browser asked for the microphone.
          opened.close();
          return;
        }
        current = opened;
        sessionRef.current = opened;
        setSession(opened);
      }
      setStep({ name: 'measuring' });
      const noiseDbfs = await current.measureNoise();
      if (mounted.current && sessionRef.current === current) {
        setStep({ name: 'ready', noiseDbfs: Math.round(noiseDbfs * 10) / 10 });
      }
    } catch (error) {
      if (mounted.current) {
        fail(error);
      }
    }
  };

  /** The recording is over: the form follows, and the microphone is released for it. */
  const finishRecording = (from: RecordingStep, recording: Recording) => {
    closeMicrophone();
    if (recording.durationMs < MIN_RECORDING_MS) {
      toast.error(t('pulse.tooShort'));
      setStep({ name: 'intro' });
      return;
    }
    setStep(toForm(from, recording));
  };

  /** Moves on to the English part, at the latest when the reading time is up. */
  const moveToEnglish = () => {
    clearReadingTimer();
    const elapsed = Math.round(sessionRef.current?.elapsed() ?? READING_LIMIT_MS);
    setStep((latest) =>
      latest.name === 'recording' && currentLevel(latest) !== 'english'
        ? { ...latest, shown: [...latest.shown, { level: 'english', atMs: elapsed }] }
        : latest,
    );
  };

  const startRecording = () => {
    const current = sessionRef.current;
    if (step.name !== 'ready' || !current) {
      return;
    }
    if (current.isInterrupted) {
      fail(new MicrophoneError('busy'));
      return;
    }
    // The page may have been opened before midnight on the month's last day.
    if (todayInIndia() > monthEndOf(cycle.month)) {
      closeMicrophone();
      setStep({ name: 'intro' });
      toast.error(t('pulse.monthEnded'));
      return;
    }
    try {
      current.start((end) => {
        const latest = stepRef.current;
        if (!mounted.current || latest.name !== 'recording') {
          return;
        }
        if (end.kind === 'limit') {
          toast.info(t('pulse.stoppedAtLimit'));
          finishRecording(latest, end.recording);
        } else {
          toast.error(t('pulse.interrupted'));
          fail(new MicrophoneError('busy'));
        }
      });
    } catch (error) {
      fail(error);
      return;
    }
    writeLocal(startsKey(child.sampleId, attempt), String(readStarts(child.sampleId, attempt) + 1));
    readingTimer.current = setTimeout(moveToEnglish, READING_LIMIT_MS);
    setStep({
      name: 'recording',
      noiseDbfs: step.noiseDbfs,
      startedAt: new Date().toISOString(),
      item,
      shown: [{ level: 'passage', atMs: 0 }],
    });
  };

  const stepDown = () => {
    const current = sessionRef.current;
    if (step.name !== 'recording' || !current) {
      return;
    }
    const next = nextReadingLevel(currentLevel(step));
    if (next) {
      setStep({
        ...step,
        shown: [...step.shown, { level: next, atMs: Math.round(current.elapsed()) }],
      });
    }
  };

  const stopRecording = async () => {
    const current = sessionRef.current;
    if (step.name !== 'recording' || !current) {
      return;
    }
    clearReadingTimer();
    try {
      finishRecording(step, await current.stop());
    } catch (error) {
      fail(error);
    }
  };

  const save = async () => {
    if (step.name !== 'form' || isSaving || saved.current) {
      return;
    }
    if (!isComplete(values)) {
      setShowMissing(true);
      return;
    }
    setSaving(true);
    try {
      const starts = readStarts(child.sampleId, attempt);
      const { queued } = await savePulseCheck(
        {
          mode: 'recorded',
          checkId: step.checkId,
          sampleId: child.sampleId,
          classSectionId,
          studentId: child.studentId,
          attempt,
          itemCode: step.item.reading.code,
          promptCode: step.item.speaking.code,
          item: itemRecord(step.item, step.shown, Math.max(0, starts - 1)),
          contentType: step.recording.format.contentType,
          durationMs: Math.min(
            Math.max(step.recording.durationMs, MIN_RECORDING_MS),
            MAX_RECORDING_MS,
          ),
          noiseDbfs: step.noiseDbfs,
          readingLevel: values.readingLevel,
          englishLevel: values.englishLevel,
          clarity: values.clarity,
          classroom: values.classroom,
          tags: values.tags,
          recordedAt: step.startedAt,
          childName: child.name,
          classLabel: classLabelValue,
        },
        step.recording.blob,
        queryClient,
      );
      saved.current = true;
      removeLocal(startsKey(child.sampleId, attempt));
      toast.success(
        !queued
          ? t('pulse.saved', { name: child.name })
          : isOnline
            ? t('pulse.savedUploading', { name: child.name })
            : t('pulse.savedOnDevice', { name: child.name }),
      );
      void navigate({
        to: '/app/pulse/$classId',
        params: { classId: classSectionId },
        replace: true,
      });
    } catch {
      setSaving(false);
      toast.error(isOnline ? t('pulse.saveFailed') : t('pulse.needsNetwork'));
    }
  };

  const isPreparing =
    step.name === 'intro' ||
    step.name === 'opening' ||
    step.name === 'measuring' ||
    step.name === 'ready';
  const noisy = step.name === 'ready' && step.noiseDbfs > NOISY_ROOM_DBFS;
  const level = step.name === 'recording' ? currentLevel(step) : null;
  const easier = level ? nextReadingLevel(level) : null;

  return (
    <div className="space-y-5">
      {problem ? (
        <Alert tone="danger" title={t('pulse.microphone.title')} assertive>
          {t(`pulse.microphone.${problem}`)}
        </Alert>
      ) : null}

      {isPreparing ? (
        <Card className="space-y-4 p-5">
          <h2 ref={headingRef} tabIndex={-1} className="font-semibold text-fg outline-none">
            {t('pulse.stage.preparing')}
          </h2>
          <ul className="space-y-3 text-sm text-fg">
            <li className="flex gap-3">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              {t('pulse.guide.placement')}
            </li>
            <li className="flex gap-3">
              <Ear className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              {t('pulse.guide.twoParts', {
                language: cycle.language === 'hi' ? t('pulse.language.hi') : t('pulse.language.en'),
              })}
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              {t('pulse.guide.privacy')}
            </li>
          </ul>

          {step.name === 'measuring' || step.name === 'ready' ? (
            <div className="space-y-2">
              <LevelMeter level={meter.level} />
              {step.name === 'measuring' ? (
                <p className="text-sm text-fg-muted" aria-live="polite">
                  {t('pulse.noise.measuring')}
                </p>
              ) : noisy ? (
                <Alert tone="warning" title={t('pulse.noise.noisyTitle')}>
                  {t('pulse.noise.noisyBody')}
                </Alert>
              ) : (
                <Alert tone="success">{t('pulse.noise.quiet')}</Alert>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            {step.name === 'ready' ? (
              <>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={startRecording}
                  leadingIcon={<Mic aria-hidden="true" />}
                >
                  {noisy ? t('pulse.recordAnyway') : t('pulse.startRecording')}
                </Button>
                <Button size="lg" variant="secondary" onClick={() => void checkRoom()}>
                  {t('pulse.noise.again')}
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                className="flex-1"
                isLoading={step.name === 'opening' || step.name === 'measuring'}
                onClick={() => void checkRoom()}
                leadingIcon={<Ear aria-hidden="true" />}
              >
                {t('pulse.noise.check')}
              </Button>
            )}
          </div>
        </Card>
      ) : null}

      {step.name === 'recording' && level ? (
        <Card className="space-y-5 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="flex items-center gap-2 font-medium text-danger outline-none"
            >
              <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              {level === 'english' ? t('pulse.part.english') : t('pulse.part.reading')}
            </h2>
            <p className="text-lg font-semibold text-fg tabular-nums">
              {formatClock(meter.elapsed)} / {formatClock(MAX_RECORDING_MS)}
            </p>
          </div>
          <Waveform bars={meter.bars} />
          {level === 'english' ? (
            <SpeakingDisplay part={step.item.speaking} />
          ) : (
            <ReadingDisplay part={step.item.reading} level={level} />
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            {easier ? (
              <Button
                size="lg"
                variant="secondary"
                className="flex-1"
                onClick={stepDown}
                leadingIcon={<StepForward aria-hidden="true" />}
              >
                {t(easier === 'words' ? 'pulse.stepDown.words' : 'pulse.stepDown.letters')}
              </Button>
            ) : null}
            {level === 'english' ? (
              <Button
                size="lg"
                variant="danger"
                className="flex-1"
                onClick={() => void stopRecording()}
                leadingIcon={<Square aria-hidden="true" />}
              >
                {t('pulse.stop')}
              </Button>
            ) : (
              <Button
                size="lg"
                className="flex-1"
                onClick={moveToEnglish}
                leadingIcon={<Languages aria-hidden="true" />}
              >
                {t('pulse.nextEnglish')}
              </Button>
            )}
          </div>
        </Card>
      ) : null}

      {step.name === 'form' ? (
        <Card className="space-y-5 p-5">
          <div className="space-y-2">
            <h2 ref={headingRef} tabIndex={-1} className="font-semibold text-fg outline-none">
              {t('pulse.form.title')}
            </h2>
            <audio
              controls
              src={step.audioUrl}
              className="w-full"
              aria-label={t('pulse.form.listen')}
            />
          </div>
          <CheckForm
            kind="recorded"
            readingLanguage={cycle.language}
            values={values}
            onChange={setValues}
            showMissing={showMissing}
          />
          <Button
            size="lg"
            className="w-full"
            isLoading={isSaving}
            onClick={() => void save()}
            leadingIcon={<Save aria-hidden="true" />}
          >
            {t('pulse.form.save')}
          </Button>
        </Card>
      ) : null}

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            blocker.reset?.();
          }
        }}
      >
        <DialogContent title={t('pulse.leaveTitle')} description={t('pulse.leaveBody')}>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse">
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              {t('pulse.keepRecording')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                closeMicrophone();
                blocker.proceed?.();
              }}
            >
              {t('pulse.discardRecording')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The adapted check of a child with special needs: the teacher uses the same passage, words,
 * letters and pictures with whatever support the child needs, and records what they observed.
 * Nothing is recorded and no machine scores it.
 */
function AdaptedCheck({ classSectionId, cycle, child, item, classLabelValue }: CheckProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [level, setLevel] = useState<ItemLevel>('passage');
  const [values, setValues] = useState<CheckFormValues>(EMPTY_FORM);
  const [showMissing, setShowMissing] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const startedAt = useMemo(() => new Date().toISOString(), []);
  // One id for the observation, so that saving again after a lost answer is recognised.
  const [checkId] = useState(() => crypto.randomUUID());
  const easier = nextReadingLevel(level);

  const save = async () => {
    if (isSaving) {
      return;
    }
    if (!isAdaptedComplete(values)) {
      setShowMissing(true);
      return;
    }
    setSaving(true);
    try {
      const { queued } = await saveAdaptedCheck(
        {
          mode: 'adapted',
          checkId,
          sampleId: child.sampleId,
          classSectionId,
          studentId: child.studentId,
          readingLevel: values.readingLevel,
          englishLevel: values.englishLevel,
          tags: values.tags,
          recordedAt: startedAt,
          childName: child.name,
          classLabel: classLabelValue,
        },
        queryClient,
      );
      toast.success(
        !queued
          ? t('pulse.saved', { name: child.name })
          : isOnline
            ? t('pulse.savedUploading', { name: child.name })
            : t('pulse.savedOnDevice', { name: child.name }),
      );
      void navigate({
        to: '/app/pulse/$classId',
        params: { classId: classSectionId },
        replace: true,
      });
    } catch {
      setSaving(false);
      toast.error(isOnline ? t('pulse.saveFailed') : t('pulse.needsNetwork'));
    }
  };

  return (
    <div className="space-y-5">
      <Alert tone="info" title={t('pulse.adapted.title')}>
        {t('pulse.adapted.body')}
      </Alert>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-fg">{t('pulse.part.reading')}</h2>
        <ReadingDisplay part={item.reading} level={level} />
        {easier ? (
          <Button
            variant="secondary"
            onClick={() => setLevel(easier)}
            leadingIcon={<StepForward aria-hidden="true" />}
          >
            {t(easier === 'words' ? 'pulse.stepDown.words' : 'pulse.stepDown.letters')}
          </Button>
        ) : null}
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-fg">{t('pulse.part.english')}</h2>
        <SpeakingDisplay part={item.speaking} />
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-semibold text-fg">{t('pulse.adapted.formTitle')}</h2>
        <CheckForm
          kind="adapted"
          readingLanguage={cycle.language}
          values={values}
          onChange={setValues}
          showMissing={showMissing}
        />
        <Button
          size="lg"
          className="w-full"
          isLoading={isSaving}
          onClick={() => void save()}
          leadingIcon={<Save aria-hidden="true" />}
        >
          {t('pulse.form.save')}
        </Button>
      </Card>
    </div>
  );
}

/** Recording one drawn child's check, with or without a network. */
export function RecordCheckPage({
  classSectionId,
  sampleId,
  attempt,
}: {
  classSectionId: string;
  sampleId: string;
  attempt: 1 | 2;
}) {
  const { t } = useTranslation();
  const details = useQuery(classDetailsQuery(classSectionId));
  const pulse = useQuery(pulseCycleQuery(classSectionId));
  const waiting = useWaitingPulse(classSectionId);
  const withdrawn = useWithdrawnConsent(classSectionId);
  // The day the page was opened: a check under way is not lost when the date changes at midnight.
  const [today] = useState(todayInIndia);
  useDocumentTitle(t('pulse.recordTitle'));

  const view = pulse.data ? viewOn(pulse.data, today) : undefined;
  // A cycle kept on the device from an earlier month is over; its children can no longer be recorded.
  const cycle = view?.cycle && today <= monthEndOf(view.cycle.month) ? view.cycle : null;
  const child = view?.children.find((entry) => entry.sampleId === sampleId) ?? null;
  const status = child ? statusOf(child, today, waiting.checks, waiting.absences) : null;
  const consentWithdrawn = child !== null && !child.adapted && withdrawn.has(child.studentId);
  const allowed =
    status !== null &&
    !consentWithdrawn &&
    (attempt === 1 ? status.kind === 'due' : status.kind === 'recorded' && status.canRetake);
  const previousReading = status?.kind === 'recorded' ? status.first.itemCode : null;
  const previousSpeaking = status?.kind === 'recorded' ? status.first.promptCode : null;

  const item = useMemo(() => {
    if (!cycle || !child || !view || !waiting.isLoaded) {
      return null;
    }
    const seen = new Set([
      ...(view.seenItems[child.studentId] ?? []),
      ...waiting.checks
        .filter((entry) => entry.change.studentId === child.studentId)
        .flatMap((entry) =>
          entry.change.mode === 'recorded' ? [entry.change.itemCode, entry.change.promptCode] : [],
        ),
    ]);
    return chooseItem({
      language: cycle.language,
      grade: cycle.grade,
      sampleId: child.sampleId,
      attempt,
      seen,
      previous: { reading: previousReading, speaking: previousSpeaking },
    });
  }, [
    cycle,
    child,
    view,
    waiting.isLoaded,
    waiting.checks,
    attempt,
    previousReading,
    previousSpeaking,
  ]);

  // "Week 2 · 3 of 5", counted in the order of the list. A child replaced before being recorded
  // is no longer part of the week.
  const weekChildren =
    child && view
      ? view.children
          .filter(
            (entry) =>
              entry.week === child.week && (entry.replacedAt === null || entry.checks.length > 0),
          )
          .sort(compareDue)
      : [];
  const position = child
    ? weekChildren.findIndex((entry) => entry.sampleId === child.sampleId) + 1
    : 0;

  return (
    <div className="container-page max-w-2xl space-y-5 py-8">
      <Link
        to="/app/pulse/$classId"
        params={{ classId: classSectionId }}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('pulse.backToList')}
      </Link>
      <QueryState
        isPending={details.isPending || pulse.isPending || !waiting.isLoaded}
        isError={(details.isError && !details.data) || (pulse.isError && !pulse.data)}
        onRetry={() => {
          void details.refetch();
          void pulse.refetch();
        }}
      >
        {cycle && child && details.data && item && allowed ? (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-sm text-fg-muted">
                {classLabel(t, details.data.grade, details.data.section)}
                {' · '}
                {t('pulse.weekPosition', {
                  week: child.week,
                  position,
                  total: weekChildren.length,
                })}
              </p>
              <h1 className="text-2xl font-bold text-fg">
                {child.name || t('pulse.unnamedChild')}{' '}
                <span className="text-base font-normal text-fg-muted tabular-nums">
                  {child.studentCode}
                </span>
              </h1>
              <p
                className={cn(
                  'inline-flex items-center gap-1.5 text-sm',
                  child.adapted ? 'text-info' : 'text-fg-muted',
                )}
              >
                {child.adapted ? <HandHeart className="size-4" aria-hidden="true" /> : null}
                {child.adapted
                  ? t('pulse.adapted.label')
                  : attempt === 2
                    ? t('pulse.secondRecording')
                    : t('pulse.firstRecording')}
              </p>
            </div>
            {child.adapted ? (
              <AdaptedCheck
                classSectionId={classSectionId}
                cycle={cycle}
                child={child}
                item={item}
                attempt={1}
                classLabelValue={{ grade: details.data.grade, section: details.data.section }}
              />
            ) : (
              <Recorder
                classSectionId={classSectionId}
                cycle={cycle}
                child={child}
                item={item}
                attempt={attempt}
                classLabelValue={{ grade: details.data.grade, section: details.data.section }}
              />
            )}
          </div>
        ) : (
          <EmptyState
            icon={child ? MicOff : CircleAlert}
            title={
              consentWithdrawn ? t('pulse.consentWithdrawn.title') : t('pulse.cannotRecord.title')
            }
            description={
              consentWithdrawn ? t('pulse.consentWithdrawn.body') : t('pulse.cannotRecord.body')
            }
          />
        )}
      </QueryState>
    </div>
  );
}
