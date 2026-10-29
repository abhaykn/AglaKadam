import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUp, Eraser, LoaderCircle, RotateCcw, ShieldCheck, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { languageStore } from '@/features/preferences/preferences';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { DishaAvatar } from './disha-avatar';
import { RichText } from './rich-text';
import { MESSAGE_LIMIT, tutorError, type TutorMessage, type TutorPersona } from './tutor-api';
import {
  adoptAccount,
  clearConversation,
  messagesOf,
  retryLast,
  sendMessage,
  tutorStore,
} from './tutor-chat';

const SUGGESTIONS = [1, 2, 3, 4] as const;

function Bubble({ message }: { message: TutorMessage }) {
  const { t } = useTranslation();
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap text-primary-fg shadow-md shadow-primary/15">
          <span className="sr-only">{t('tutor.you')}: </span>
          {message.text}
        </p>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2.5">
      <DishaAvatar className="mt-1 size-7" />
      <div className="max-w-[88%] min-w-0 space-y-1.5">
        <div className="rounded-2xl rounded-tl-md border border-border bg-surface-sunken px-4 py-3 text-[0.9375rem] break-words text-fg">
          <span className="sr-only">{t('tutor.name')}: </span>
          <RichText text={message.text} />
        </div>
        {message.provider ? (
          <p className="ps-1 text-xs text-fg-subtle">{t(`tutor.via.${message.provider}`)}</p>
        ) : null}
      </div>
    </li>
  );
}

function Thinking() {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2.5" role="status">
      <DishaAvatar className="mt-1 size-7" />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border bg-surface-sunken px-4 py-3.5">
        <span className="sr-only">{t('tutor.thinking')}</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden="true"
            className="size-2 animate-bounce rounded-full bg-primary/70"
            style={{ animationDelay: `${String(dot * 150)}ms` }}
          />
        ))}
      </div>
    </li>
  );
}

function Welcome({
  persona,
  disabled,
  onPick,
}: {
  persona: TutorPersona;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center px-1 pt-4 pb-2 text-center">
      <span className="relative inline-flex">
        <span
          aria-hidden="true"
          className="absolute -inset-4 rounded-full bg-primary/25 blur-2xl"
        />
        <DishaAvatar className="relative size-16 drop-shadow-lg" />
      </span>
      <h3
        className="mt-4 text-3xl leading-tight text-fg"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {t('tutor.hello')}
      </h3>
      <p className="mt-1.5 max-w-xs text-sm text-fg-muted">{t(`tutor.greeting.${persona}`)}</p>
      <p className="mt-6 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        {t('tutor.tryAsking')}
      </p>
      <ul className="mt-2.5 flex w-full flex-col gap-2">
        {SUGGESTIONS.map((number) => {
          const text = t(`tutor.suggestions.${persona}.s${number}`);
          return (
            <li key={number}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(text);
                }}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-start text-sm text-fg transition-colors hover:border-primary/60 hover:bg-surface-muted disabled:opacity-55"
              >
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface TutorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  persona: TutorPersona;
}

/** The conversation with Disha: a drawer that opens over any page of the application. */
export function TutorPanel({ open, onOpenChange, userId, persona }: TutorPanelProps) {
  const { t } = useTranslation();
  const language = useStore(languageStore);
  const isOnline = useOnlineStatus();
  const state = useStore(tutorStore);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    adoptAccount(userId);
  }, [userId]);

  const messages = messagesOf(state, persona);
  const waiting = state.pending === persona;
  const failed = state.failure?.persona === persona;
  const failure: unknown = failed ? state.failure?.error : null;
  const busy = state.pending !== null;

  // Follow the conversation as it grows.
  useEffect(() => {
    const area = scroller.current;
    if (area) {
      area.scrollTop = area.scrollHeight;
    }
  }, [messages.length, waiting, failed]);

  // Grow the box with the text, up to five lines.
  useEffect(() => {
    const box = input.current;
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${String(Math.min(box.scrollHeight, 132))}px`;
    }
  }, [draft]);

  const lang = language === 'hi' ? 'hi' : 'en';
  const canSend = isOnline && !busy && draft.trim() !== '';

  const send = (text: string) => {
    if (!isOnline || busy) {
      return;
    }
    setDraft('');
    void sendMessage(userId, persona, lang, text);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) {
      send(draft);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) {
        send(draft);
      }
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ak-dialog-overlay fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-placement="right"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          // The launcher's button closes the drawer itself; the drawer must not treat a tap on it
          // as one outside and close first, or the same tap would open it again.
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-tutor-toggle]')) {
              event.preventDefault();
            }
          }}
          className="ak-dialog-content fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col border-l border-border bg-surface-solid text-fg shadow-2xl shadow-black/40 outline-none"
        >
          <header className="flex items-center gap-3 border-b border-border px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
            <DishaAvatar className="size-11" />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="flex items-baseline gap-2 text-lg leading-tight font-semibold text-fg">
                {t('tutor.name')}
                <span className="text-sm font-normal text-fg-muted">{t('tutor.nameNative')}</span>
              </DialogPrimitive.Title>
              <p className="truncate text-xs text-fg-muted">{t(`tutor.tagline.${persona}`)}</p>
            </div>
            {messages.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('tutor.newChat')}
                title={t('tutor.newChat')}
                disabled={busy}
                onClick={() => {
                  clearConversation(persona);
                }}
              >
                <Eraser aria-hidden="true" />
              </Button>
            ) : null}
            <DialogPrimitive.Close
              className="inline-flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
              aria-label={t('common.close')}
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>

          <div
            ref={scroller}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4 motion-safe:scroll-smooth"
          >
            {messages.length === 0 && !waiting ? (
              <Welcome persona={persona} disabled={!isOnline || busy} onPick={send} />
            ) : (
              <ol className="space-y-4" aria-label={t('tutor.conversation')} aria-live="polite">
                {messages.map((message) => (
                  <Bubble key={message.id} message={message} />
                ))}
                {waiting ? <Thinking /> : null}
              </ol>
            )}
            {failed ? (
              <Alert tone="danger" assertive>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{tutorError(failure, t)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<RotateCcw aria-hidden="true" />}
                    disabled={!isOnline || busy}
                    onClick={() => {
                      void retryLast(userId, persona, lang);
                    }}
                  >
                    {t('errorBoundary.retry')}
                  </Button>
                </div>
              </Alert>
            ) : null}
          </div>

          <div className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {!isOnline ? (
              <Alert tone="warning" className="mb-3">
                <span className="inline-flex items-start gap-2">
                  <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('tutor.offline')}
                </span>
              </Alert>
            ) : null}
            <form onSubmit={submit} className="flex items-end gap-2">
              <label htmlFor="tutor-message" className="sr-only">
                {t('tutor.placeholder')}
              </label>
              <textarea
                id="tutor-message"
                ref={input}
                rows={1}
                value={draft}
                maxLength={MESSAGE_LIMIT}
                disabled={!isOnline}
                placeholder={t('tutor.placeholder')}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                onKeyDown={onKeyDown}
                className={cn(
                  'max-h-[8.25rem] min-h-11 flex-1 resize-none rounded-[1.375rem] border border-border bg-surface px-4 py-2.5 text-[0.9375rem] leading-normal text-fg shadow-xs',
                  'placeholder:text-fg-subtle hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              />
              <Button
                type="submit"
                size="icon"
                className="rounded-full"
                disabled={!canSend}
                aria-label={t('tutor.send')}
              >
                {waiting ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
              </Button>
            </form>
            <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-snug text-fg-subtle">
              <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {t('tutor.disclaimer')}
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
