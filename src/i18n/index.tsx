import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ta } from './ta';

/**
 * Localisation. English is the source language; others are partial dictionaries that fall back
 * to English. New languages (Hindi, Malayalam, Telugu, Kannada) are added by registering a
 * dictionary here — no component changes needed. Clinical strings require reviewed translations.
 */

/** 'pseudo' is a layout-test locale (Phase 46): never offered to people, set only by tests. */
export type Locale = 'en' | 'ta' | 'pseudo';

/** Languages a person can choose. */
export type UserLocale = Exclude<Locale, 'pseudo'>;

export const LOCALES: { id: UserLocale; label: string; speech: string; reviewed: boolean }[] = [
  { id: 'en', label: 'English', speech: 'en-IN', reviewed: true },
  { id: 'ta', label: 'தமிழ் (Tamil)', speech: 'ta-IN', reviewed: false },
];

const DICTS: Record<UserLocale, Partial<Record<MessageKey, string>>> = { en, ta };

const ACCENT: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', c: 'ç', n: 'ñ', s: 'š', y: 'ý' };

/**
 * Pseudo-localisation for layout testing: accents every letter outside {placeholders}, adds about
 * 40% length (translations such as Tamil often run longer than English) and brackets the string so
 * clipped or hard-coded text is easy to see.
 */
export function pseudo(s: string): string {
  const body = s.split(/(\{\w+\})/).map((part) => (/^\{\w+\}$/.test(part) ? part : part.replace(/[a-zA-Z]/g, (c) => ACCENT[c] ?? c))).join('');
  // Padding comes as short words so it wraps like real text instead of forcing overflow.
  const words = Math.ceil((s.length * 0.4) / 6);
  return `[${body}${words ? ' ' + Array(words).fill('·····').join(' ') : ''}]`;
}

/** BCP 47 tag for the document: the pseudo locale uses the conventional pseudo-English tag. */
export const htmlLang = (l: Locale) => (l === 'pseudo' ? 'en-XA' : l);

export type Params = Record<string, string | number>;

export function translate(locale: Locale, key: string, params?: Params): string {
  const english = (en as Record<string, string>)[key];
  const raw = locale === 'pseudo' ? (english !== undefined ? pseudo(english) : key) : (DICTS[locale] as Record<string, string | undefined>)[key] ?? english ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

type TFn = (key: MessageKey | (string & {}), params?: Params) => string;

const I18nContext = createContext<{ locale: Locale; t: TFn }>({
  locale: 'en',
  t: (k, p) => translate('en', k, p),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback<TFn>((k, p) => translate(locale, k, p), [locale]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}

export function speechLang(locale: Locale): string {
  return LOCALES.find((l) => l.id === locale)?.speech ?? 'en-IN';
}
