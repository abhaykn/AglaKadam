import { describe, expect, it } from 'vitest';
import { aiSecrets } from '../src/ai-keys.ts';
import { envFile } from '../src/secrets.ts';

describe('the keys of the language-model services', () => {
  const groq = `gsk_${'a1B2'.repeat(10)}`;
  const claude = `sk-ant-api03-${'x_Y-'.repeat(10)}`;

  it('stores only the keys typed, each checked against its service', () => {
    expect(aiSecrets(` ${groq} `, '')).toEqual({ GROQ_API_KEY: groq });
    expect(aiSecrets('', claude)).toEqual({ ANTHROPIC_API_KEY: claude });
    expect(aiSecrets('', '')).toEqual({});
    expect(() => aiSecrets('sk-wrong', '')).toThrow(/Groq/);
    expect(() => aiSecrets(groq, groq)).toThrow(/Claude/);
  });

  it('writes one secret a line and refuses values that could add another', () => {
    expect(envFile({ GROQ_API_KEY: groq, ANTHROPIC_API_KEY: claude })).toBe(
      `GROQ_API_KEY=${groq}\nANTHROPIC_API_KEY=${claude}\n`,
    );
    expect(() => envFile({ GROQ_API_KEY: `${groq}\nOTHER=1` })).toThrow();
    expect(() => envFile({ 'bad name': 'x' })).toThrow();
  });
});
