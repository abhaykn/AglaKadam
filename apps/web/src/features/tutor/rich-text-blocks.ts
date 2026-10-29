/**
 * Splits the plain-text answers of Disha into paragraphs and lists: lines that begin with "- " or
 * "1. " are list items, and a blank line ends a paragraph.
 */

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBER = /^\s*\d{1,2}[.)]\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    const last = blocks.at(-1);
    if (line.trim() === '') {
      closeParagraph();
    } else if (bullet?.[1] !== undefined) {
      closeParagraph();
      if (last?.kind === 'bullets' && paragraph.length === 0) {
        last.items.push(bullet[1]);
      } else {
        blocks.push({ kind: 'bullets', items: [bullet[1]] });
      }
    } else if (number?.[1] !== undefined) {
      closeParagraph();
      if (last?.kind === 'numbers') {
        last.items.push(number[1]);
      } else {
        blocks.push({ kind: 'numbers', items: [number[1]] });
      }
    } else {
      paragraph.push(line.trim());
    }
  }
  closeParagraph();
  return blocks;
}
