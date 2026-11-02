import { describe, expect, it } from 'vitest';
import { parseFqdn } from './fqdn.ts';
import { preferredLocale } from './i18n/index.ts';

describe('parseFqdn', () => {
  it('accepts a host name and normalises it', () => {
    expect(parseFqdn(' QA-Device.a.airdr.es. ')).toBe('qa-device.a.airdr.es');
  });

  it('refuses a scheme, a path, a port or a single label', () => {
    for (const input of [
      'https://x.example',
      'x.example/v1',
      'x.example:443',
      'localhost',
      '',
      '-a.example',
    ]) {
      expect(parseFqdn(input)).toBeUndefined();
    }
  });
});

describe('preferredLocale', () => {
  it('picks the first supported language and falls back to English', () => {
    expect(preferredLocale(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(preferredLocale(['fr'])).toBe('en');
  });
});
