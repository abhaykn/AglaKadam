import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import type * as FunctionsModule from '@/lib/functions';
import { FunctionCallError } from '@/lib/functions';
import { TutorPanel } from './tutor-panel';
import { endConversations, tutorStore } from './tutor-chat';

const calls: Record<string, unknown>[] = [];
const answers: unknown[] = [];

vi.mock('@/lib/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof FunctionsModule>();
  return {
    ...actual,
    callFunction: (_name: string, body: Record<string, unknown>) => {
      calls.push(body);
      const next = answers.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function open(persona: 'family' | 'teacher' | 'crp' = 'teacher', userId = 'user-1') {
  return render(
    <TutorPanel open onOpenChange={() => undefined} userId={userId} persona={persona} />,
  );
}

const reply = (text: string, provider: 'claude' | 'groq' = 'groq') => ({
  reply: text,
  provider,
  fell_back: provider === 'groq',
});

beforeEach(() => {
  calls.length = 0;
  answers.length = 0;
  setOnline(true);
  tutorStore.set({ userId: null, chats: {}, pending: null, failure: null });
});

describe('the conversation with Disha', () => {
  it('greets each kind of person in their own way, with questions to start from', () => {
    open('family');
    expect(screen.getByRole('heading', { name: en.tutor.hello })).toBeInTheDocument();
    expect(screen.getByText(en.tutor.greeting.family)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.tutor.suggestions.family.s1 })).toBeEnabled();
    expect(screen.queryByText(en.tutor.suggestions.teacher.s1)).not.toBeInTheDocument();
  });

  it('answers a question typed by the person, and says who wrote the answer', async () => {
    answers.push(reply('Add the **tens** first:\n- 20 + 10 = 30', 'claude'));
    open('teacher');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'How do I add 27 and 15?');
    await userEvent.click(screen.getByRole('button', { name: en.tutor.send }));

    expect(await screen.findByText('tens')).toBeInTheDocument();
    expect(screen.getByText(en.tutor.via.claude)).toBeInTheDocument();
    expect(calls).toEqual([
      {
        action: 'chat',
        persona: 'teacher',
        language: 'en',
        messages: [{ role: 'user', text: 'How do I add 27 and 15?' }],
      },
    ]);
    // The box is emptied for the next question.
    expect(screen.getByLabelText(en.tutor.placeholder)).toHaveValue('');
  });

  it('sends a suggested question with one tap', async () => {
    answers.push(reply('Here is an idea.'));
    open('crp');
    await userEvent.click(screen.getByRole('button', { name: en.tutor.suggestions.crp.s1 }));
    expect(await screen.findByText('Here is an idea.')).toBeInTheDocument();
    expect(screen.getByText(en.tutor.via.groq)).toBeInTheDocument();
  });

  it('sends the whole conversation with each new question', async () => {
    answers.push(reply('First.'));
    answers.push(reply('Second.'));
    open('teacher');
    const box = screen.getByLabelText(en.tutor.placeholder);
    await userEvent.type(box, 'One{Enter}');
    await screen.findByText('First.');
    await userEvent.type(box, 'Two{Enter}');
    await screen.findByText('Second.');
    expect(calls[1]?.messages).toEqual([
      { role: 'user', text: 'One' },
      { role: 'assistant', text: 'First.' },
      { role: 'user', text: 'Two' },
    ]);
  });

  it('does not send an empty message, and a new line needs Shift+Enter', async () => {
    open('teacher');
    const box = screen.getByLabelText(en.tutor.placeholder);
    expect(screen.getByRole('button', { name: en.tutor.send })).toBeDisabled();
    await userEvent.type(box, '   ');
    expect(screen.getByRole('button', { name: en.tutor.send })).toBeDisabled();
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b');
    expect(box).toHaveValue('   a\nb');
    expect(calls).toHaveLength(0);
  });

  it('says why there is no answer, and asks again on request', async () => {
    answers.push(new FunctionCallError('ai_unavailable', 503));
    answers.push(reply('Back now.'));
    open('teacher');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'Hello{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.tutor.errors.unavailable);

    await userEvent.click(within(alert).getByRole('button', { name: en.errorBoundary.retry }));
    expect(await screen.findByText('Back now.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Asking again does not repeat the person's message.
    expect(calls[1]?.messages).toEqual([{ role: 'user', text: 'Hello' }]);
  });

  it('keeps a conversation for each kind of person', async () => {
    answers.push(reply('For teachers.'));
    const { unmount } = open('teacher');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'Hi{Enter}');
    await screen.findByText('For teachers.');
    unmount();

    open('crp');
    expect(screen.queryByText('For teachers.')).not.toBeInTheDocument();
    expect(screen.getByText(en.tutor.greeting.crp)).toBeInTheDocument();
  });

  it('forgets everything when another account uses the device', async () => {
    answers.push(reply('Private.'));
    const first = open('teacher', 'user-1');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'Hi{Enter}');
    await screen.findByText('Private.');
    first.unmount();

    open('teacher', 'user-2');
    await waitFor(() => {
      expect(screen.queryByText('Private.')).not.toBeInTheDocument();
    });
  });

  it('starts a new conversation on request', async () => {
    answers.push(reply('Something.'));
    open('teacher');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'Hi{Enter}');
    await screen.findByText('Something.');
    await userEvent.click(screen.getByRole('button', { name: en.tutor.newChat }));
    expect(screen.queryByText('Something.')).not.toBeInTheDocument();
    expect(screen.getByText(en.tutor.greeting.teacher)).toBeInTheDocument();
  });

  it('waits for a network instead of sending a question that cannot be answered', () => {
    setOnline(false);
    open('teacher');
    expect(screen.getByText(en.tutor.offline)).toBeInTheDocument();
    expect(screen.getByLabelText(en.tutor.placeholder)).toBeDisabled();
    expect(screen.getByRole('button', { name: en.tutor.suggestions.teacher.s1 })).toBeDisabled();
  });

  it('reminds people not to share personal details', () => {
    open('family');
    expect(screen.getByText(en.tutor.disclaimer)).toBeInTheDocument();
  });

  it('ends every conversation when the person signs out', async () => {
    answers.push(reply('Gone soon.'));
    const first = open('teacher');
    await userEvent.type(screen.getByLabelText(en.tutor.placeholder), 'Hi{Enter}');
    await screen.findByText('Gone soon.');
    first.unmount();

    endConversations();
    expect(tutorStore.get().chats).toEqual({});
    open('teacher');
    expect(screen.queryByText('Gone soon.')).not.toBeInTheDocument();
  });

  it('lets a person who got no answer ask something else, without a broken conversation', async () => {
    answers.push(new FunctionCallError('network', 0));
    answers.push(reply('A fresh answer.'));
    open('teacher');
    const box = screen.getByLabelText(en.tutor.placeholder);
    await userEvent.type(box, 'First question{Enter}');
    await screen.findByRole('alert');

    await userEvent.type(box, 'Another question{Enter}');
    expect(await screen.findByText('A fresh answer.')).toBeInTheDocument();
    // The unanswered question gave way: the turns still alternate.
    expect(calls[1]?.messages).toEqual([{ role: 'user', text: 'Another question' }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
