import { describe, expect, it } from 'vitest';
import { base64url, challengeFor, randomToken } from './pkce.ts';

describe('pkce', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    await expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('encodes without padding or URL-unsafe characters', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });

  it('draws fresh random tokens of the expected length', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
  });
});
