/**
 * UI store — TECH §2.4. Theme override (system | light | dark), language,
 * toast queue, modal routing. Persisted via AsyncStorage in sub 7.
 *
 * Foundation (BIZ-268) ships the empty slice. The current ThemeProvider still
 * follows `useColorScheme()` directly; sub 7 (BIZ-276) replaces that with a
 * `theme` selector here so users can override the system mode in Settings.
 */
import { create } from 'zustand';

import { DEFAULT_LOCALE, type Locale } from '@/i18n';

export type ThemePreference = 'system' | 'light' | 'dark';

type UIState = {
  theme: ThemePreference;
  locale: Locale;
};

export const useUIStore = create<UIState>(() => ({
  theme: 'system',
  locale: DEFAULT_LOCALE,
}));
