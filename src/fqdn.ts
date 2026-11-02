// A host name as a person types it: labels of letters, digits and hyphens,
// at least two of them. No scheme, no port, no path.
const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The normalised FQDN, or undefined when the input is not one. */
export function parseFqdn(input: string): string | undefined {
  const candidate = input.trim().toLowerCase().replace(/\.$/, '');
  return HOST.test(candidate) ? candidate : undefined;
}
