import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, LoaderCircle, MessagesSquare, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Textarea } from '@/components/ui/input';
import { formatNoteTime } from '@/features/class-notes/note-format';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { PageHeader } from '@/features/workspaces/page-header';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  checksMet,
  DEBRIEF_CHECKS,
  debrief,
  debriefsKey,
  debriefsQuery,
  rehearse,
  sahayakError,
  SCENARIO_CODES,
  scenarioCodeOf,
  type Debrief,
  type RehearsalLine,
  type SahayakLanguage,
  type ScenarioCode,
} from './sahayak-api';

/** The CRP's turns after which the room asks for the debrief, as the function allows no more. */
const MAX_CRP_TURNS = 20;
const LINE_LIMIT = 800;

type Stage =
  | { kind: 'choose' }
  | { kind: 'talk'; scenario: ScenarioCode; lines: RehearsalLine[] }
  | { kind: 'debrief'; scenario: ScenarioCode; result: Debrief };

function DebriefView({ result }: { result: Debrief }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" aria-live="polite">
      <ul className="space-y-2">
        {DEBRIEF_CHECKS.map((check) => (
          <li key={check} className="flex items-start gap-2 text-sm">
            {result[check] ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span className="text-fg">
              <span className="sr-only">
                {result[check] ? t('sahayak.rehearsal.met') : t('sahayak.rehearsal.notMet')}
              </span>
              {t(`sahayak.rehearsal.checks.${check}`)}
            </span>
          </li>
        ))}
      </ul>
      <Alert tone="success" title={t('sahayak.rehearsal.wentWell')}>
        {result.wentWell}
      </Alert>
      <Alert tone="info" title={t('sahayak.rehearsal.tryNext')}>
        {result.tryNext}
      </Alert>
    </div>
  );
}

/**
 * The rehearsal room: the CRP practises a hard feedback conversation with a simulated teacher,
 * then gets a debrief against five checks of good coaching. Only the debrief is kept, for the
 * CRP alone; the conversation is forgotten when the page closes.
 */
export function RehearsalPage() {
  const { t, i18n } = useTranslation();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const history = useQuery(debriefsQuery());
  const [language, setLanguage] = useState<SahayakLanguage>(i18n.language === 'en' ? 'en' : 'hi');
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useDocumentTitle(t('sahayak.rehearsal.title'));

  const lineCount = stage.kind === 'talk' ? stage.lines.length : 0;
  useEffect(() => {
    const element = end.current;
    // Not every browser engine (nor the test one) can scroll an element into view.
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'end' });
    }
  }, [lineCount]);

  const start = (scenario: ScenarioCode) => {
    setError(null);
    setText('');
    setStage({
      kind: 'talk',
      scenario,
      lines: [
        {
          role: 'teacher',
          text: t(`sahayak.rehearsal.scenarios.${scenario}.opening`, { lng: language }),
        },
      ],
    });
  };

  const crpTurns =
    stage.kind === 'talk' ? stage.lines.filter((line) => line.role === 'crp').length : 0;

  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stage.kind !== 'talk' || !text.trim() || busy) {
      return;
    }
    const lines: RehearsalLine[] = [
      ...stage.lines,
      { role: 'crp', text: text.trim().slice(0, LINE_LIMIT) },
    ];
    setStage({ ...stage, lines });
    setText('');
    setBusy(true);
    setError(null);
    try {
      const answer = await rehearse(stage.scenario, language, lines);
      setStage({ ...stage, lines: [...lines, { role: 'teacher', text: answer.reply }] });
    } catch (failure) {
      // The CRP's line is given back to the field, to be sent again.
      setStage({ ...stage, lines: stage.lines });
      setText(lines.at(-1)?.text ?? '');
      setError(sahayakError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (stage.kind !== 'talk') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await debrief(stage.scenario, language, stage.lines);
      setStage({ kind: 'debrief', scenario: stage.scenario, result });
      queryClient.setQueryData<Debrief[]>(debriefsKey(), (entries) => [result, ...(entries ?? [])]);
    } catch (failure) {
      setError(sahayakError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const scenarioTitle = (code: string) => {
    const known = scenarioCodeOf(code);
    return known ? t(`sahayak.rehearsal.scenarios.${known}.title`) : code;
  };

  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app/crp">{t('visits.plan.back')}</BackLink>
      <PageHeader
        title={t('sahayak.rehearsal.title')}
        description={t('sahayak.rehearsal.description')}
      />

      {!isOnline ? <Alert tone="warning">{t('sahayak.offline')}</Alert> : null}

      {stage.kind === 'choose' ? (
        <>
          <Card>
            <CardBody>
              <ChoiceGroup
                label={t('sahayak.rehearsal.language')}
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'hi', label: 'हिन्दी' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </CardBody>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {SCENARIO_CODES.map((code) => (
              <Card key={code} aria-labelledby={`scenario-${code}`}>
                <CardHeader
                  titleId={`scenario-${code}`}
                  title={scenarioTitle(code)}
                  description={t(`sahayak.rehearsal.scenarios.${code}.briefing`)}
                />
                <CardBody>
                  <Button disabled={!isOnline} onClick={() => start(code)}>
                    <MessagesSquare aria-hidden="true" />
                    {t('sahayak.rehearsal.start')}
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
          <Card aria-labelledby="rehearsal-history">
            <CardHeader
              titleId="rehearsal-history"
              title={t('sahayak.rehearsal.history')}
              description={t('sahayak.rehearsal.historyBody')}
            />
            <CardBody>
              {(history.data ?? []).length === 0 ? (
                <p className="text-sm text-fg-muted">{t('sahayak.rehearsal.noHistory')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(history.data ?? []).map((entry) => (
                    <li key={entry.id} className="space-y-1 py-3">
                      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium text-fg">{scenarioTitle(entry.scenario)}</span>
                        <span className="text-fg-muted">
                          {formatNoteTime(entry.createdAt, i18n.language)} ·{' '}
                          {t('sahayak.rehearsal.checksMet', {
                            met: checksMet(entry),
                            total: DEBRIEF_CHECKS.length,
                          })}
                        </span>
                      </p>
                      <p className="text-sm text-fg-muted">{entry.tryNext}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      {stage.kind === 'talk' ? (
        <Card aria-labelledby="rehearsal-talk">
          <CardHeader
            titleId="rehearsal-talk"
            title={scenarioTitle(stage.scenario)}
            description={t(`sahayak.rehearsal.scenarios.${stage.scenario}.briefing`)}
          />
          <CardBody className="space-y-4">
            <p className="text-sm text-fg-muted">{t('sahayak.rehearsal.simulated')}</p>
            <ol className="space-y-3" aria-label={t('sahayak.rehearsal.conversation')}>
              {stage.lines.map((line, index) => (
                <li
                  key={index}
                  lang={language}
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                    line.role === 'teacher'
                      ? 'bg-surface-sunken text-fg'
                      : 'ms-auto bg-primary-soft text-primary-soft-fg',
                  )}
                >
                  <span className="sr-only">
                    {line.role === 'teacher'
                      ? t('sahayak.rehearsal.teacherSays')
                      : t('sahayak.rehearsal.youSay')}
                  </span>
                  {line.text}
                </li>
              ))}
              {busy ? (
                <li className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  {t('sahayak.rehearsal.thinking')}
                </li>
              ) : null}
            </ol>
            <div ref={end} />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {crpTurns < MAX_CRP_TURNS ? (
              <form className="space-y-2" onSubmit={(event) => void send(event)}>
                <label htmlFor="rehearsal-line" className="sr-only">
                  {t('sahayak.rehearsal.yourLine')}
                </label>
                <Textarea
                  id="rehearsal-line"
                  rows={2}
                  lang={language}
                  value={text}
                  maxLength={LINE_LIMIT}
                  placeholder={t('sahayak.rehearsal.placeholder')}
                  onChange={(event) => setText(event.target.value)}
                />
                <Button type="submit" disabled={!isOnline || busy || !text.trim()}>
                  <Send aria-hidden="true" />
                  {t('sahayak.rehearsal.send')}
                </Button>
              </form>
            ) : (
              <Alert tone="info">{t('sahayak.rehearsal.longEnough')}</Alert>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                variant={crpTurns >= 3 ? 'primary' : 'secondary'}
                disabled={!isOnline || busy || crpTurns < 2}
                onClick={() => void finish()}
              >
                {t('sahayak.rehearsal.finish')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStage({ kind: 'choose' })}>
                {t('sahayak.rehearsal.leave')}
              </Button>
            </div>
            {crpTurns < 2 ? (
              <p className="text-sm text-fg-muted">{t('sahayak.rehearsal.finishHint')}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {stage.kind === 'debrief' ? (
        <Card aria-labelledby="rehearsal-debrief">
          <CardHeader
            titleId="rehearsal-debrief"
            title={t('sahayak.rehearsal.debriefTitle')}
            description={scenarioTitle(stage.scenario)}
          />
          <CardBody className="space-y-4">
            <DebriefView result={stage.result} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => start(stage.scenario)}>
                <RotateCcw aria-hidden="true" />
                {t('sahayak.rehearsal.again')}
              </Button>
              <Button variant="secondary" onClick={() => setStage({ kind: 'choose' })}>
                {t('sahayak.rehearsal.another')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
