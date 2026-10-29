import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react';
import { Input, Textarea } from '@/components/ui/input';

/** How long typing must pause before the text is kept. */
const KEEP_AFTER_MS = 700;

interface DraftTextProps {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  maxLength: number;
}

/**
 * A text field that keeps what is typed when typing pauses or the field is left, rather than on
 * every key: each kept version is encrypted and stored on the device.
 */
export function DraftText({
  value,
  onCommit,
  multiline = false,
  maxLength,
  ...props
}: DraftTextProps &
  Omit<ComponentPropsWithRef<'input'> & ComponentPropsWithRef<'textarea'>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest text and handler, for keeping what was typed when the field goes away.
  const latest = useRef({ text: value, onCommit });
  useEffect(() => {
    latest.current = { text, onCommit };
  });

  // A new value from outside (for example the server's version) replaces what is shown, unless
  // the person is typing.
  useEffect(() => {
    if (timer.current === null && value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  // Text typed just before leaving the page (for example with the back gesture) is kept.
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        if (latest.current.text !== committed.current) {
          committed.current = latest.current.text;
          latest.current.onCommit(latest.current.text);
        }
      }
    },
    [],
  );

  const commit = (next: string) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (next !== committed.current) {
      committed.current = next;
      onCommit(next);
    }
  };

  const change = (next: string) => {
    setText(next);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      commit(next);
    }, KEEP_AFTER_MS);
  };

  const shared = {
    value: text,
    maxLength,
    onBlur: () => commit(text),
  };
  return multiline ? (
    <Textarea {...props} {...shared} onChange={(event) => change(event.target.value)} />
  ) : (
    <Input {...props} {...shared} onChange={(event) => change(event.target.value)} />
  );
}
