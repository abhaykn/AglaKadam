import { useCallback, useEffect, useState } from 'react';
import type { ReadingLanguage } from '@/features/pulse/item-bank';

/**
 * Reading aloud with the phone's own voices (the browser's speech synthesis), which costs nothing
 * and works without a network where the voice is installed. Where the phone has no voice for the
 * language, nothing is offered: a voice of another language would teach the wrong sounds.
 */

/** The best voice for a language: Indian voices first, then any voice of the language. */
export function pickVoice(
  voices: readonly Pick<SpeechSynthesisVoice, 'lang' | 'localService'>[],
  language: ReadingLanguage,
): number | null {
  const tag = (voice: Pick<SpeechSynthesisVoice, 'lang'>) =>
    voice.lang.replace('_', '-').toLowerCase();
  const preferences =
    language === 'hi'
      ? [(lang: string) => lang === 'hi-in', (lang: string) => lang.startsWith('hi')]
      : [
          (lang: string) => lang === 'en-in',
          (lang: string) => lang === 'en-gb',
          (lang: string) => lang.startsWith('en'),
        ];
  for (const matches of preferences) {
    // A voice on the phone itself works offline; prefer it to one that needs the network.
    const local = voices.findIndex((voice) => matches(tag(voice)) && voice.localService);
    if (local !== -1) {
      return local;
    }
    const any = voices.findIndex((voice) => matches(tag(voice)));
    if (any !== -1) {
      return any;
    }
  }
  return null;
}

function synthesis(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

/** A function that reads text aloud in a language, or null where the phone cannot. */
export function useSpeaker(language: ReadingLanguage): ((text: string) => void) | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const speech = synthesis();
    if (!speech) {
      return;
    }
    const choose = () => {
      const voices = speech.getVoices();
      const index = pickVoice(voices, language);
      setVoice(index === null ? null : (voices[index] ?? null));
    };
    choose();
    // Phones load their voices after the page; the list arrives with this event.
    speech.addEventListener('voiceschanged', choose);
    return () => {
      speech.removeEventListener('voiceschanged', choose);
      speech.cancel();
    };
  }, [language]);

  const speak = useCallback(
    (text: string) => {
      const speech = synthesis();
      if (!speech || !voice) {
        return;
      }
      speech.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      // A little slower than normal speech, so a young reader can follow.
      utterance.rate = 0.8;
      speech.speak(utterance);
    },
    [voice],
  );

  return voice ? speak : null;
}
