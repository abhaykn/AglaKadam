/**
 * Names are taken out of text before it is sent to a language-model service: the class's
 * children become "[child]" and the class's teachers "[teacher]". A whole name is replaced first
 * (a short one such as "Om" as well), then each part of it of three letters or more, so "Asha" is
 * caught in "Asha Kumari read well".
 *
 * Names are matched as they are written in the school's records. A name written in another script
 * (a Latin name spoken and transcribed in Devanagari) is not recognised, which is why the services
 * are also told never to repeat a name.
 */

export interface NameToHide {
  name: string;
  label: string;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Letters and marks of any script count as part of a word. */
const WORD = '\\p{L}\\p{M}\\p{N}';

export function redactNames(text: string, names: readonly NameToHide[]): string {
  const patterns: { pattern: string; label: string; length: number }[] = [];
  for (const { name, label } of names) {
    const whole = name.trim().replace(/\s+/g, ' ');
    if (Array.from(whole).length < 2) {
      continue;
    }
    patterns.push({ pattern: escape(whole).replace(/ /g, '\\s+'), label, length: whole.length });
    for (const part of whole.split(' ')) {
      if (Array.from(part).length >= 3) {
        patterns.push({ pattern: escape(part), label, length: part.length });
      }
    }
  }
  // Longer names first, so that a full name is not left half replaced.
  patterns.sort((a, b) => b.length - a.length);
  let result = text;
  for (const { pattern, label } of patterns) {
    result = result.replace(new RegExp(`(?<![${WORD}])${pattern}(?![${WORD}])`, 'giu'), label);
  }
  return result;
}
