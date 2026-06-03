/**
 * Phone — E.164 validation + country-code helpers (TECH §3.5, §11.6).
 *
 * libphonenumber-js full integration is scheduled with BIZ-262's dep install. Until then this
 * module ships a conservative E.164 validator that covers the FR-22 onboarding happy path
 * (KR/US/JP/CN/GB) and leaves room for a drop-in upgrade — the public surface is intentionally
 * small so the upgrade is mechanical.
 */

export type CountryCode = 'KR' | 'US' | 'JP' | 'CN' | 'GB' | 'DE' | 'FR' | 'OTHER';

export type CountryEntry = {
  code: CountryCode;
  label: string;
  dialCode: string; // e.g. "+82"
  trunkPrefix: string; // leading-zero stripped during normalization (e.g. KR "0")
  exampleNational: string;
};

export const COUNTRIES: readonly CountryEntry[] = [
  { code: 'KR', label: '대한민국', dialCode: '+82', trunkPrefix: '0', exampleNational: '10 1234 5678' },
  { code: 'US', label: 'United States', dialCode: '+1', trunkPrefix: '', exampleNational: '555 123 4567' },
  { code: 'JP', label: '日本', dialCode: '+81', trunkPrefix: '0', exampleNational: '90 1234 5678' },
  { code: 'CN', label: '中国', dialCode: '+86', trunkPrefix: '0', exampleNational: '131 2345 6789' },
  { code: 'GB', label: 'United Kingdom', dialCode: '+44', trunkPrefix: '0', exampleNational: '7400 123456' },
  { code: 'DE', label: 'Deutschland', dialCode: '+49', trunkPrefix: '0', exampleNational: '151 23456789' },
  { code: 'FR', label: 'France', dialCode: '+33', trunkPrefix: '0', exampleNational: '6 12 34 56 78' },
] as const;

export function findCountry(code: CountryCode): CountryEntry | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export type PhoneNormalizeResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'empty' | 'invalid_format' | 'too_short' | 'too_long' };

/**
 * Normalize national input + dial code into E.164.
 *
 * Examples:
 *   ("010-1234-5678", "+82", "0") -> "+821012345678"
 *   ("555-123-4567",  "+1",  "")  -> "+15551234567"
 */
export function normalizeToE164(input: string, dialCode: string, trunkPrefix: string): PhoneNormalizeResult {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length === 0) return { ok: false, reason: 'empty' };

  let national = digits;
  if (trunkPrefix && national.startsWith(trunkPrefix)) {
    national = national.slice(trunkPrefix.length);
  }
  if (national.length < 4) return { ok: false, reason: 'too_short' };
  if (national.length > 14) return { ok: false, reason: 'too_long' };

  const candidate = `${dialCode}${national}`;
  if (!E164_RE.test(candidate)) return { ok: false, reason: 'invalid_format' };
  return { ok: true, e164: candidate };
}

export function isValidE164(value: string): boolean {
  return E164_RE.test(value);
}

/**
 * Masked rendering for logs / breadcrumbs (TECH §5.4): "+82***5678".
 */
export function maskE164(value: string): string {
  if (!isValidE164(value)) return '***';
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}
