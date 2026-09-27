import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ta } from './ta';

/**
 * Localisation. English is the source language; others are partial dictionaries that fall back
 * to English. New languages (Hindi, Malayalam, Telugu, Kannada) are added by registering a
 * dictionary here — no component changes needed. Clinical strings require reviewed translations.
 */

export type Locale = 'en' | 'ta';

export const LOCALES: { id: Locale; label: string; speech: string; reviewed: boolean }[] = [
  { id: 'en', label: 'English', speech: 'en-IN', reviewed: true },
  { id: 'ta', label: 'தமிழ் (Tamil)', speech: 'ta-IN', reviewed: false },
];

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ta };

export type Params = Record<string, string | number>;

export function translate(locale: Locale, key: string, params?: Params): string {
  const raw = (DICTS[locale] as Record<string, string | undefined>)[key] ?? (en as Record<string, string>)[key] ?? key;
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
