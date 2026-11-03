/**
 * Which operator release first serves each area (SPEC-184 FR-23, design §7).
 * Measured from airdress-operator's `routes_catalog.rs`: the first `v*` tag
 * whose catalog lists the area's routes. Every area also needs the console's
 * own floor, the release that admits its origin and accepts its token.
 * Regenerate when the API pin (`api/operator-openapi.pin`) moves.
 */
export const CONSOLE_FLOOR = 'v0.1.164';

export type Area =
  'overview' | 'people' | 'devices' | 'machines' | 'subnames' | 'shells' | 'grants' | 'functions';

export const AREA_SINCE: Readonly<Record<Area, string>> = {
  overview: 'v0.1.113', // GET /v1/capabilities
  people: 'v0.1.78', // /v1/admin/sub-users/{id}/publication-block
  devices: 'v0.1.9', // /v1/endpoints/enrollments/{id}
  machines: 'v0.1.72', // /v1/admin/machines/*
  subnames: 'v0.1.163', // /v1/admin/dns/subnames
  shells: 'v0.1.113', // /v1/admin/shells
  grants: 'v0.1.164', // /v1/admin/grants
  functions: 'v0.1.89', // /v1/functions/{name}/promote
};

export const AREAS: readonly Area[] = [
  'overview',
  'people',
  'devices',
  'machines',
  'subnames',
  'shells',
  'grants',
  'functions',
];

type Triple = readonly [number, number, number];

/** `v0.1.164`, `0.1.164-hotfix.1` → [0, 1, 164]; anything else → undefined. */
export function parseVersion(version: string): Triple | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function atLeast(version: string, floor: string): boolean {
  const have = parseVersion(version);
  const want = parseVersion(floor);
  if (have === undefined || want === undefined) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** The release an area needs on this operator: the later of its route and the console floor. */
export function requiredFor(area: Area): string {
  const since = AREA_SINCE[area];
  return atLeast(since, CONSOLE_FLOOR) ? since : CONSOLE_FLOOR;
}

/**
 * `true` serves, `false` does not, `undefined` when the version is unknown
 * (the console then tries and reads the answer, design §7).
 */
export function supports(version: string | undefined, area: Area): boolean | undefined {
  if (version === undefined || parseVersion(version) === undefined) return undefined;
  return atLeast(version, requiredFor(area));
}
