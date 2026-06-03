import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ko from './ko.json';

export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ko';

const resources = {
  ko: { translation: ko },
  en: { translation: en },
} as const;

const i18n = createInstance();

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  compatibilityJSON: 'v4',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };
export default i18n;
