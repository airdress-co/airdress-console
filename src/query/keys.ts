/**
 * Every query key starts with the operator's FQDN, so switching airdress can
 * never show another airdress's cached data (SPEC-184 design §3.3). Areas
 * add their own factories here; nothing else builds keys. No key ever holds
 * a token or a value the person typed.
 */
export const operatorKeys = {
  all: (fqdn: string) => ['op', fqdn] as const,
  area: (fqdn: string, area: string) => ['op', fqdn, area] as const,
  clientConfig: (fqdn: string) => ['op', fqdn, 'client-config'] as const,
  capabilities: (fqdn: string) => ['op', fqdn, 'capabilities'] as const,
  health: (fqdn: string) => ['op', fqdn, 'health'] as const,
  subUsers: (fqdn: string) => ['op', fqdn, 'people', 'sub-users'] as const,
  devices: (fqdn: string) => ['op', fqdn, 'devices'] as const,
  machinePending: (fqdn: string) => ['op', fqdn, 'machines', 'pending'] as const,
  machines: (fqdn: string) => ['op', fqdn, 'machines', 'list'] as const,
  preauthKeys: (fqdn: string) => ['op', fqdn, 'machines', 'preauth-keys'] as const,
  subnames: (fqdn: string) => ['op', fqdn, 'subnames'] as const,
  shells: (fqdn: string) => ['op', fqdn, 'shells'] as const,
  grants: (fqdn: string) => ['op', fqdn, 'grants'] as const,
  functions: (fqdn: string) => ['op', fqdn, 'functions', 'list'] as const,
  schedules: (fqdn: string) => ['op', fqdn, 'functions', 'schedules'] as const,
  functionVersions: (fqdn: string, name: string) =>
    ['op', fqdn, 'functions', name, 'versions'] as const,
  functionLogs: (fqdn: string, name: string) => ['op', fqdn, 'functions', name, 'logs'] as const,
  /** Versions' builds by version id; a version's build never changes, so the ids are the key. */
  versionBuilds: (fqdn: string, versions: readonly string[]) =>
    ['op', fqdn, 'function-builds', ...versions] as const,
};
