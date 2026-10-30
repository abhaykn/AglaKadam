import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter } from './meter';
import { StatTile } from './stat-tile';
import { Users } from 'lucide-react';

describe('a figure with a bar', () => {
  it('writes the figure and fills the bar to its share', () => {
    const { container } = render(<Meter value={72} label="72%" />);
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('[style]')?.style.width).toBe('72%');
  });

  it('never draws more than the whole or less than nothing', () => {
    const over = render(<Meter value={140} label="140%" />);
    expect(over.container.querySelector<HTMLElement>('[style]')?.style.width).toBe('100%');
    over.unmount();
    const under = render(<Meter value={-5} label="-5%" />);
    expect(under.container.querySelector<HTMLElement>('[style]')?.style.width).toBe('0%');
  });
});

describe('a total with its name', () => {
  it('is a term and its description', () => {
    render(
      <dl>
        <StatTile icon={Users} label="Schools" value="16" />
      </dl>,
    );
    expect(screen.getByText('Schools').tagName).toBe('DT');
    expect(screen.getByText('16').tagName).toBe('DD');
  });
});
