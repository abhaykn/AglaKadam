import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The hosting configuration (`vercel.json` at the repository root) must stay in step with the
 * page: the security policy allows the one inline script by its hash, and the page's own files
 * must never be answered with the page itself.
 */
interface HostingConfig {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const root = new URL('../../../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')) as HostingConfig;
const page = readFileSync(new URL('apps/web/index.html', root), 'utf8');

function headerOf(key: string): string {
  const value = config.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === key)?.value;
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

describe('the hosting configuration', () => {
  it('allows exactly the inline scripts of the page, by their hash', () => {
    const inline = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) =>
        `'sha256-${createHash('sha256')
          .update(match[1] ?? '')
          .digest('base64')}'`,
    );
    expect(inline.length).toBeGreaterThan(0);
    const scriptSources = /script-src ([^;]+)/.exec(headerOf('Content-Security-Policy'))?.[1];
    expect(scriptSources?.split(' ').filter((source) => source.startsWith("'sha256-"))).toEqual(
      inline,
    );
  });

  it('answers application pages with the page, and missing code files with a 404', () => {
    const [rewrite] = config.rewrites;
    expect(rewrite?.destination).toBe('/index.html');
    const pattern = new RegExp(`^${rewrite?.source ?? ''}$`);
    expect(pattern.test('/app/crp/plan')).toBe(true);
    expect(pattern.test('/demo')).toBe(true);
    // A file of a replaced version must fail, so that the page offers a reload.
    expect(pattern.test('/assets/index-old.js')).toBe(false);
    expect(pattern.test('/icons/icon-192.png')).toBe(false);
  });

  it('never lets the service worker or the page be cached, and keeps versioned files for good', () => {
    const cacheOf = (path: string) =>
      config.headers
        .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
        .flatMap((rule) => rule.headers)
        .find((header) => header.key === 'Cache-Control')?.value;
    expect(cacheOf('/sw.js')).toBe('no-cache');
    expect(cacheOf('/index.html')).toBe('no-cache');
    expect(cacheOf('/manifest.webmanifest')).toBe('no-cache');
    expect(cacheOf('/assets/index-D8vodF2.js')).toContain('immutable');
  });
});
