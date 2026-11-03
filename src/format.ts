/** A timestamp as the person's locale writes it; the raw value when it is not one. */
export function formatTime(iso: string | undefined, locale: string): string {
  if (iso === undefined) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** The first eight characters of an id, enough to tell rows apart. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
