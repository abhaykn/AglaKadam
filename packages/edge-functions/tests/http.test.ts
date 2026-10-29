import { describe, expect, it } from 'vitest';
import { networkAddressOf } from '../../../supabase/functions/_shared/http.ts';

describe('the network a request comes from', () => {
  it('trusts the address set by the edge network over one the caller can write', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    });
    expect(networkAddressOf(headers)).toBe('203.0.113.7');
  });

  it('falls back to the first forwarded address, and to nothing', () => {
    expect(networkAddressOf(new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
    expect(networkAddressOf(new Headers())).toBe('');
  });
});
