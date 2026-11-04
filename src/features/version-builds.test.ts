import { describe, expect, it } from 'vitest';
import { readVersionBuild, runsHere } from './functions/api.ts';

const build = (engineDigest?: string, transpiler?: string) => ({ engineDigest, transpiler });

describe('whether a version runs on this operator', () => {
  it('reads the build from a version source record', () => {
    expect(
      readVersionBuild('/v1/functions/sources/v', {
        version: 'sha256:aa',
        engineDigest: 'sha256:engine',
        transpiler: 'swc-1',
      }),
    ).toEqual(build('sha256:engine', 'swc-1'));
  });

  it('runs where engine and transpiler match the running version', () => {
    expect(runsHere(build('e1', 't1'), build('e1', 't1'))).toBe(true);
  });

  // 2026-11-04 on VM3: every older version was built on the engine before
  // the 10 October one, and "Run this version" answered 422 engine_unavailable.
  it('does not run on another engine, or with another transpiler', () => {
    expect(runsHere(build('e0', 't1'), build('e1', 't1'))).toBe(false);
    expect(runsHere(build('e1', 't0'), build('e1', 't1'))).toBe(false);
  });

  it('leaves the decision to the operator when either side is unknown', () => {
    expect(runsHere(undefined, build('e1', 't1'))).toBe(true);
    expect(runsHere(build('e0', 't1'), undefined)).toBe(true);
    expect(runsHere(build(undefined, 't1'), build('e1', 't1'))).toBe(true);
  });
});
