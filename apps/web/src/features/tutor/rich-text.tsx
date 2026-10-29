import type { ReactNode } from 'react';
import { parseBlocks } from './rich-text-blocks';

/**
 * The plain-text answers of Disha, with the little formatting it is allowed: paragraphs, lists
 * that begin with "- " or "1. ", and **bold** words. Everything is built as elements and text, never
 * as markup, so nothing an answer contains can run or change the page.
 */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 leading-relaxed">
      {parseBlocks(text).map((block, index) => {
        if (block.kind === 'paragraph') {
          return <p key={index}>{inline(block.text)}</p>;
        }
        const Tag = block.kind === 'bullets' ? 'ul' : 'ol';
        return (
          <Tag
            key={index}
            className={
              block.kind === 'bullets'
                ? 'list-disc space-y-1 ps-5 marker:text-primary'
                : 'list-decimal space-y-1 ps-5 marker:font-medium marker:text-primary'
            }
          >
            {block.items.map((item, position) => (
              <li key={position}>{inline(item)}</li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
