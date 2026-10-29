import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import type * as SahayakApi from './sahayak-api';
import { OrderReader } from './order-reader';

const calls = vi.hoisted(() => ({ prepare: vi.fn(), readOrder: vi.fn() }));

vi.mock('@/features/class-notes/note-file', () => ({ prepareNoteFile: calls.prepare }));
vi.mock('./sahayak-api', async (original) => ({
  ...(await original<typeof SahayakApi>()),
  readOrder: calls.readOrder,
  base64Of: () => Promise.resolve('cGhvdG8='),
}));

async function choose(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('The photo input is missing.');
  }
  await userEvent.upload(input, file);
  return input;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('reading an order from a photo', () => {
  it('lets the same photo be chosen again after it could not be used', async () => {
    calls.prepare.mockResolvedValue({ problem: 'type' });
    render(<OrderReader onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.order.open }));
    const photo = new File(['heic'], 'order.heic', { type: 'image/heic' });
    const input = await choose(photo);
    expect(await screen.findByText(en.sahayak.order.notPicture)).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('shows the failure instead of reading for ever when the photo cannot be prepared', async () => {
    calls.prepare.mockRejectedValue(new Error('The picture could not be decoded.'));
    render(<OrderReader onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.order.open }));
    await choose(new File(['jpeg'], 'order.jpg', { type: 'image/jpeg' }));
    expect(
      await screen.findByRole('button', { name: en.sahayak.order.choose }),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.sahayak.order.reading)).toBeNull();
    expect(calls.readOrder).not.toHaveBeenCalled();
  });
});
