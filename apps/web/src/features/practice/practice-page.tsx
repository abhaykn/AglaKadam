import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Calculator,
  CircleCheck,
  Star,
  Type,
  Volume2,
  WholeWord,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import type { Grade, ReadingLanguage } from '@/features/pulse/item-bank';
import { PageHeader } from '@/features/workspaces/page-header';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import { mathsQuestion, seededRandom, type MathsQuestion } from './maths';
import { PRACTICE_LETTERS, practiceGrade, practiceStories, practiceWords } from './practice-bank';
import { summarisePractice, usePracticeDays } from './progress';
import { useSpeaker } from './speech';

type Activity = 'story' | 'words' | 'letters' | 'numbers';

function shuffled<Value>(values: readonly Value[], seed: number): Value[] {
  const random = seededRandom(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as Value, copy[index] as Value];
  }
  return copy;
}

function ListenButton({ speak, text }: { speak: ((text: string) => void) | null; text: string }) {
  const { t } = useTranslation();
  if (!speak) {
    return null;
  }
  return (
    <Button variant="soft" onClick={() => speak(text)}>
      <Volume2 aria-hidden="true" />
      {t('practice.listen')}
    </Button>
  );
}

function Stars({ count, label }: { count: number; label: string }) {
  return (
    <p className="inline-flex items-center gap-1.5 font-semibold text-fg">
      <Star className="size-5 fill-warning text-warning" aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </p>
  );
}

/** A story to read, and a question about it. */
function StoryPractice({
  language,
  grade,
  speak,
  onStar,
}: {
  language: ReadingLanguage;
  grade: Grade;
  speak: ((text: string) => void) | null;
  onStar: () => void;
}) {
  const { t } = useTranslation();
  const stories = practiceStories(language, grade);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const story = stories[index % stories.length];
  const choices = useMemo(
    () => (story ? shuffled(story.choices, index * 31 + grade) : []),
    [story, index, grade],
  );
  if (!story) {
    return null;
  }
  const right = story.choices[0];
  const choose = (choice: string) => {
    if (answer === right) {
      return;
    }
    setAnswer(choice);
    if (choice === right) {
      onStar();
    }
  };
  return (
    <div className="space-y-5">
      <p
        lang={language}
        className="rounded-xl bg-surface-sunken p-5 text-xl leading-loose text-fg sm:text-2xl"
      >
        {story.text}
      </p>
      <ListenButton speak={speak} text={story.text} />
      <div className="space-y-3">
        <p lang={language} className="text-lg font-semibold text-fg">
          {story.question}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              lang={language}
              onClick={() => choose(choice)}
              aria-pressed={answer === choice}
              className={cn(
                'min-h-12 rounded-xl border px-4 py-3 text-left text-base font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                answer === choice && choice === right
                  ? 'border-success bg-success-soft text-fg'
                  : answer === choice
                    ? 'border-danger bg-danger-soft text-fg'
                    : 'border-border bg-surface text-fg hover:bg-surface-muted',
              )}
            >
              {choice}
            </button>
          ))}
        </div>
        <p role="status" className="min-h-6 text-sm font-medium">
          {answer === null ? null : answer === right ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <CircleCheck className="size-4" aria-hidden="true" />
              {t('practice.right')}
            </span>
          ) : (
            <span className="text-fg-muted">{t('practice.tryAgain')}</span>
          )}
        </p>
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          setIndex((value) => value + 1);
          setAnswer(null);
        }}
      >
        {t('practice.nextStory')}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/** One word at a time, read aloud by the child, heard again if they wish. */
function WordPractice({
  language,
  grade,
  speak,
  onStar,
}: {
  language: ReadingLanguage;
  grade: Grade;
  speak: ((text: string) => void) | null;
  onStar: () => void;
}) {
  const { t } = useTranslation();
  const [seed] = useState(() => Math.floor(Math.random() * 997));
  const words = useMemo(
    () => shuffled(practiceWords(language, grade), seed),
    [language, grade, seed],
  );
  const [index, setIndex] = useState(0);
  const word = words[index % words.length] ?? '';
  return (
    <div className="space-y-5">
      <p
        lang={language}
        className="flex min-h-40 items-center justify-center rounded-xl bg-surface-sunken p-6 text-5xl font-bold text-fg sm:text-6xl"
      >
        {word}
      </p>
      <p className="text-sm text-fg-muted">{t('practice.wordsHint')}</p>
      <div className="flex flex-wrap gap-2">
        <ListenButton speak={speak} text={word} />
        <Button
          onClick={() => {
            onStar();
            setIndex((value) => value + 1);
          }}
        >
          <CircleCheck aria-hidden="true" />
          {t('practice.readIt')}
        </Button>
        <Button variant="secondary" onClick={() => setIndex((value) => value + 1)}>
          {t('practice.skip')}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** The alphabet; a letter is heard when tapped. */
function LetterPractice({
  language,
  speak,
}: {
  language: ReadingLanguage;
  speak: ((text: string) => void) | null;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        {speak ? t('practice.lettersHint') : t('practice.lettersHintSilent')}
      </p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
        {PRACTICE_LETTERS[language].map((letter) => (
          <button
            key={letter}
            type="button"
            lang={language}
            aria-pressed={chosen === letter}
            onClick={() => {
              setChosen(letter);
              speak?.(letter);
            }}
            className={cn(
              'flex aspect-square items-center justify-center rounded-xl border text-3xl font-bold transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              chosen === letter
                ? 'border-primary bg-primary-soft text-primary-soft-fg'
                : 'border-border bg-surface text-fg hover:bg-surface-muted',
            )}
          >
            {language === 'en' ? `${letter.toUpperCase()}${letter}` : letter}
          </button>
        ))}
      </div>
    </div>
  );
}

function questionText(question: MathsQuestion, t: TFunction) {
  const [first = 0, second = 0, third = 0] = question.numbers;
  switch (question.kind) {
    case 'count':
      return t('practice.maths.count');
    case 'compare':
      return t('practice.maths.compare');
    case 'next':
      return `${String(first)}, ${String(second)}, ${String(third)}, ?`;
    case 'add':
      return `${String(first)} + ${String(second)} = ?`;
    case 'subtract':
      return `${String(first)} − ${String(second)} = ?`;
    case 'multiply':
      return `${String(first)} × ${String(second)} = ?`;
    case 'divide':
      return `${String(first)} ÷ ${String(second)} = ?`;
  }
}

/** Number questions with four answers (two when comparing), a new one after each right answer. */
function NumberPractice({ grade, onStar }: { grade: Grade; onStar: () => void }) {
  const { t } = useTranslation();
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const question = useMemo(() => mathsQuestion(grade, seededRandom(seed)), [grade, seed]);
  const [answer, setAnswer] = useState<number | null>(null);
  const solved = answer === question.answer;
  const choose = (choice: number) => {
    if (solved) {
      return;
    }
    setAnswer(choice);
    if (choice === question.answer) {
      onStar();
    }
  };
  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl bg-surface-sunken p-6 text-center">
        <p className="text-3xl font-bold text-fg tabular-nums sm:text-4xl">
          {questionText(question, t)}
        </p>
        {question.kind === 'count' ? (
          <p
            role="img"
            className="mx-auto flex max-w-xs flex-wrap justify-center gap-2"
            aria-label={t('practice.maths.countLabel')}
          >
            {Array.from({ length: question.numbers[0] ?? 0 }, (_, index) => (
              <Star key={index} className="size-8 fill-warning text-warning" aria-hidden="true" />
            ))}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          'grid gap-2',
          question.choices.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
        )}
      >
        {question.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={answer === choice}
            onClick={() => choose(choice)}
            className={cn(
              'min-h-16 rounded-xl border text-2xl font-bold tabular-nums transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              answer === choice && solved
                ? 'border-success bg-success-soft text-fg'
                : answer === choice
                  ? 'border-danger bg-danger-soft text-fg'
                  : 'border-border bg-surface text-fg hover:bg-surface-muted',
            )}
          >
            {choice}
          </button>
        ))}
      </div>
      <p role="status" className="min-h-6 text-sm font-medium">
        {answer === null ? null : solved ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CircleCheck className="size-4" aria-hidden="true" />
            {t('practice.right')}
          </span>
        ) : (
          <span className="text-fg-muted">{t('practice.tryAgain')}</span>
        )}
      </p>
      <Button
        variant={solved ? 'primary' : 'secondary'}
        onClick={() => {
          setSeed((value) => value + 1);
          setAnswer(null);
        }}
      >
        {t('practice.nextQuestion')}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * Practice at home for a child of Classes 1 to 3: stories with a question, words and letters to
 * read aloud (heard in the phone's own voice where it has one), and number questions. Everything
 * works without a network, and nothing the child does is sent anywhere.
 */
export function PracticePage() {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const student = access.student;
  const today = todayInIndia();
  const grade = practiceGrade(student?.class?.grade);
  const [language, setLanguage] = useState<ReadingLanguage>(i18n.language === 'hi' ? 'hi' : 'en');
  const [activity, setActivity] = useState<Activity>('story');
  const speak = useSpeaker(language);
  const { days, addStar } = usePracticeDays(student?.id ?? 'device', today);
  const summary = summarisePractice(days, today);
  useDocumentTitle(t('practice.title'));

  return (
    <div className="container-page space-y-6 py-8">
      <Link
        to="/app/family"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('practice.back')}
      </Link>
      <PageHeader
        title={t('practice.title')}
        description={t('practice.description', { grade })}
        actions={
          <Stars count={summary.today} label={t('practice.starsToday', { count: summary.today })} />
        }
      />
      <Card>
        <CardBody className="space-y-5">
          <ChoiceGroup
            label={t('practice.language')}
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'hi', label: 'हिन्दी' },
              { value: 'en', label: 'English' },
            ]}
          />
          <ChoiceGroup
            label={t('practice.activity')}
            value={activity}
            onChange={setActivity}
            options={[
              {
                value: 'story',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <BookOpenText className="size-4" aria-hidden="true" />
                    {t('practice.activities.story')}
                  </span>
                ),
              },
              {
                value: 'words',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <WholeWord className="size-4" aria-hidden="true" />
                    {t('practice.activities.words')}
                  </span>
                ),
              },
              {
                value: 'letters',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <Type className="size-4" aria-hidden="true" />
                    {t('practice.activities.letters')}
                  </span>
                ),
              },
              {
                value: 'numbers',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <Calculator className="size-4" aria-hidden="true" />
                    {t('practice.activities.numbers')}
                  </span>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          {activity === 'story' ? (
            <StoryPractice
              key={language}
              language={language}
              grade={grade}
              speak={speak}
              onStar={addStar}
            />
          ) : activity === 'words' ? (
            <WordPractice
              key={language}
              language={language}
              grade={grade}
              speak={speak}
              onStar={addStar}
            />
          ) : activity === 'letters' ? (
            <LetterPractice key={language} language={language} speak={speak} />
          ) : (
            <NumberPractice grade={grade} onStar={addStar} />
          )}
        </CardBody>
      </Card>
      <p className="text-sm text-fg-muted">
        {t('practice.week', { count: summary.daysThisWeek })} {speak ? null : t('practice.noVoice')}
      </p>
    </div>
  );
}
