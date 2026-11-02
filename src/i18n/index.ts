import de from './de.json';
import en from './en.json';

export type MessageSchema = typeof en;
export type Locale = 'en' | 'de';

/** German is held to the English shape: a missing key is a type error. */
export const messages: Readonly<Record<Locale, MessageSchema>> = { en, de };

export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const primary = language.toLowerCase().split('-')[0];
    if (primary === 'de' || primary === 'en') return primary;
  }
  return 'en';
}
