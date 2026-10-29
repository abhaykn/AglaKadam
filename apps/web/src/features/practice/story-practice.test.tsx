import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import { practiceStories } from './practice-bank';
import { StoryPractice } from './practice-page';

afterEach(() => {
  vi.restoreAllMocks();
});

function open(random: number) {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  return render(<StoryPractice language="en" grade={2} speak={null} onStar={() => undefined} />);
}

const shown = () =>
  practiceStories('en', 2).find((story) => screen.queryByText(story.text) !== null)?.text;

describe('the story to read', () => {
  it('does not begin with the same story every time the activity is opened', () => {
    const firsts = new Set<string | undefined>();
    for (const random of [0.02, 0.17, 0.31, 0.46, 0.58, 0.73, 0.88, 0.97]) {
      const { unmount } = open(random);
      firsts.add(shown());
      unmount();
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('tells every story once before it tells any again', async () => {
    const stories = practiceStories('en', 2);
    open(0.42);
    const told: (string | undefined)[] = [shown()];
    for (let index = 1; index < stories.length; index += 1) {
      await userEvent.click(screen.getByRole('button', { name: en.practice.nextStory }));
      told.push(shown());
    }
    expect(new Set(told).size).toBe(stories.length);
    await userEvent.click(screen.getByRole('button', { name: en.practice.nextStory }));
    expect(shown()).toBe(told[0]);
  });

  it('shuffles the answers differently for different openings', () => {
    const orders = new Set<string>();
    for (const random of [0.03, 0.21, 0.4, 0.62, 0.84]) {
      const { unmount } = open(random);
      const first = practiceStories('en', 2).find(
        (story) => screen.queryByText(story.text) !== null,
      );
      const buttons = screen.getAllByRole('button', { pressed: false });
      orders.add(
        `${first?.code ?? ''}|${buttons
          .map((button) => button.textContent)
          .filter((text) => first?.choices.includes(text))
          .join(',')}`,
      );
      unmount();
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
