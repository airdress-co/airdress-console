import { describe, expect, it } from 'vitest';
import { callbackTarget, chooseChannel, isVersion, versionFromPointer } from './route.ts';

describe('the entry document', () => {
  it('follows ?channel=, then the stored choice, then stable', () => {
    expect(chooseChannel('next', 'stable')).toBe('next');
    expect(chooseChannel(null, 'next')).toBe('next');
    expect(chooseChannel('nightly', 'bogus')).toBe('stable');
    expect(chooseChannel(null, null)).toBe('stable');
  });

  it('reads a version pointer and nothing else', () => {
    expect(versionFromPointer({ version: '0.1.0' })).toBe('0.1.0');
    expect(versionFromPointer({ version: '0.2.0-rc.1' })).toBe('0.2.0-rc.1');
    expect(versionFromPointer({ version: 'v0.1.0' })).toBeNull();
    expect(versionFromPointer({ version: '../../x' })).toBeNull();
    expect(versionFromPointer('0.1.0')).toBeNull();
    expect(versionFromPointer(null)).toBeNull();
  });

  it('accepts only semver as a version', () => {
    expect(isVersion('1.2.3')).toBe(true);
    expect(isVersion('1.2')).toBe(false);
    expect(isVersion('1.2.3/../4')).toBe(false);
  });

  it('hands the hub answer to the build named in state', () => {
    expect(callbackTarget('?code=c&state=0.1.0~abc')).toBe(
      '/v/0.1.0/?code=c&state=0.1.0%7Eabc&oauth=callback',
    );
    expect(callbackTarget('?error=access_denied&state=0.2.0-rc.1~x')).toBe(
      '/v/0.2.0-rc.1/?error=access_denied&state=0.2.0-rc.1%7Ex&oauth=callback',
    );
  });

  it('refuses a state that names no version', () => {
    expect(callbackTarget('?code=c&state=abc')).toBeNull();
    expect(callbackTarget('?code=c&state=~abc')).toBeNull();
    expect(callbackTarget('?code=c&state=..%2F..~abc')).toBeNull();
    expect(callbackTarget('?code=c')).toBeNull();
  });
});
