import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import hi from '@/i18n/locales/hi.json';
import { renderRoute } from '@/test/render-route';

describe('landing page', () => {
  it('presents the headline and the five loop steps in order', async () => {
    renderRoute('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: en.landing.hero.title }),
    ).toBeInTheDocument();

    const section = screen.getByRole('region', { name: en.landing.loop.title });
    const stepHeadings = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);

    expect(stepHeadings).toEqual([
      en.landing.loop.steps.pulse.title,
      en.landing.loop.steps.plan.title,
      en.landing.loop.steps.observe.title,
      en.landing.loop.steps.coach.title,
      en.landing.loop.steps.followUp.title,
    ]);
  });

  it('switches the interface to Hindi', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { level: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: hi.landing.hero.title }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'hi-IN');
  });

  it('shows the not-found page for an unknown address', async () => {
    renderRoute('/this-page-does-not-exist');

    expect(
      await screen.findByRole('heading', { level: 1, name: en.notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.notFound.backHome })).toHaveAttribute('href', '/');
  });
});
