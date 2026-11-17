import en from './en.json';
import id from './id.json';

export type Locale = 'en' | 'id';
export type Dictionary = typeof en;

export const dictionaries: Record<Locale, Dictionary> = {
  en,
  id,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] || dictionaries.en;
}
