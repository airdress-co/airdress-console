/**
 * Every query key starts with the operator's FQDN, so switching airdress can
 * never show another airdress's cached data (SPEC-184 design §3.3). Areas
 * add their own factories under `operatorKeys`; nothing else builds keys.
 */
export const operatorKeys = {
  all: (fqdn: string) => ['op', fqdn] as const,
  area: (fqdn: string, area: string) => ['op', fqdn, area] as const,
  clientConfig: (fqdn: string) => ['op', fqdn, 'client-config'] as const,
  capabilities: (fqdn: string) => ['op', fqdn, 'capabilities'] as const,
};
