import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './rich-text';
import { parseBlocks } from './rich-text-blocks';

describe('the formatting of Disha’s answers', () => {
  it('reads paragraphs and lists', () => {
    expect(
      parseBlocks('First line\nstill the same paragraph\n\n- one\n- two\n\n1. step\n2) next'),
    ).toEqual([
      { kind: 'paragraph', text: 'First line still the same paragraph' },
      { kind: 'bullets', items: ['one', 'two'] },
      { kind: 'numbers', items: ['step', 'next'] },
    ]);
  });

  it('shows lists and bold words as elements', () => {
    render(<RichText text={'Use **place value**:\n- ones\n- tens'} />);
    expect(screen.getByText('place value').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'ones',
      'tens',
    ]);
  });

  it('never turns an answer into markup', () => {
    const { container } = render(
      <RichText
        text={'<img src=x onerror=alert(1)> and <script>alert(2)</script> **<b>bold</b>**'}
      />,
    );
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
