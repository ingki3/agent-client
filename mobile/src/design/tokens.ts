/**
 * Design tokens extracted from AgentClient.pen (BIZ-DS-01 ~ BIZ-DS-06).
 * Source of truth: /tmp/agentclient-pen-variables.json (raw hex from pen variables).
 * If pen `get_variables` drifts from these values, the spec hex here wins (per CLAUDE.md
 * "Spec ↔ variables drift" rule) and a sub-issue should reconcile.
 */

export type ColorMode = "light" | "dark";

type ColorPair = { light: string; dark: string };

export const colors = {
  primary: { light: "#2563EB", dark: "#3B82F6" },
  "primary-pressed": { light: "#1D4ED8", dark: "#60A5FA" },
  "on-primary": { light: "#FFFFFF", dark: "#FFFFFF" },

  surface: { light: "#FFFFFF", dark: "#0B0E14" },
  "surface-elevated": { light: "#F4F5F7", dark: "#161B22" },
  "surface-overlay": { light: "#FFFFFFE6", dark: "#1F2530E6" },

  border: { light: "#E5E7EB", dark: "#2A2F3A" },
  "border-strong": { light: "#D1D5DB", dark: "#3A4150" },

  "text-primary": { light: "#111827", dark: "#F3F4F6" },
  "text-secondary": { light: "#4B5563", dark: "#9CA3AF" },
  "text-disabled": { light: "#9CA3AF", dark: "#4B5563" },
  "text-inverse": { light: "#FFFFFF", dark: "#0B0E14" },

  "user-bubble": { light: "#2563EB", dark: "#2563EB" },
  "on-user-bubble": { light: "#FFFFFF", dark: "#FFFFFF" },
  "agent-bubble": { light: "#F1F3F5", dark: "#1F2530" },
  "on-agent-bubble": { light: "#111827", dark: "#F3F4F6" },
  "system-bubble": { light: "#00000000", dark: "#00000000" },
  "trace-summary": { light: "#EEF2FF", dark: "#1E1B4B" },
  "on-trace-summary": { light: "#3730A3", dark: "#C7D2FE" },

  success: { light: "#15803D", dark: "#22C55E" },
  warning: { light: "#B45309", dark: "#FBBF24" },
  error: { light: "#DC2626", dark: "#F87171" },
  info: { light: "#2563EB", dark: "#60A5FA" },
  offline: { light: "#6B7280", dark: "#9CA3AF" },

  "focus-ring": { light: "#2563EB", dark: "#60A5FA" },

  // Channel accents (buddy color slots 1..8)
  "accent-buddy-1": { light: "#4F46E5", dark: "#818CF8" },
  "accent-buddy-2": { light: "#059669", dark: "#34D399" },
  "accent-buddy-3": { light: "#B45309", dark: "#FBBF24" },
  "accent-buddy-4": { light: "#DC2626", dark: "#F87171" },
  "accent-buddy-5": { light: "#7C3AED", dark: "#A78BFA" },
  "accent-buddy-6": { light: "#0E7490", dark: "#22D3EE" },
  "accent-buddy-7": { light: "#DB2777", dark: "#F472B6" },
  "accent-buddy-8": { light: "#4D7C0F", dark: "#A3E635" },
} satisfies Record<string, ColorPair>;

export type ColorToken = keyof typeof colors;

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
  bubble: 18,
  full: 9999,
} as const;

export const fontSize = {
  caption: 12,
  "body-sm": 13,
  code: 14,
  body: 15,
  "title-sm": 16,
  "body-lg": 17,
  "title-md": 18,
  "title-lg": 22,
  "title-xl": 28,
  display: 34,
} as const;

export const duration = {
  instant: 100,
  fast: 150,
  base: 200,
  slow: 300,
  slower: 450,
} as const;

export const touch = {
  min: 44,
} as const;

export const fontFamily = {
  sans: "Inter",
  display: "Inter",
  mono: "JetBrains Mono",
  koreanName: "Pretendard",
} as const;
