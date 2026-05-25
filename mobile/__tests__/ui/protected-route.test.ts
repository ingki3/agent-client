// computeProtectedRoute — BIZ-291 root-index auth-cold-start gate.
//
// Pure function, so the test exercises the redirect table directly: every
// (status, segments) pair maps to the expected target (or null = stay put).
// Regression case is `status='auth' && segments=[]`: pre-fix landed null, must
// now resolve to `/(main)/buddies`.

import type { AuthStatus } from '@/application/stores/auth';
import { computeProtectedRoute } from '@/ui/navigation/protected-route';

describe('computeProtectedRoute', () => {
  describe("status='initializing'", () => {
    it.each<[string, readonly string[]]>([
      ['root index', []],
      ['(auth) group', ['(auth)', 'phone']],
      ['(main) group', ['(main)', 'buddies']],
    ])('returns null on %s (gate waits)', (_label, segments) => {
      expect(computeProtectedRoute('initializing', segments)).toBeNull();
    });
  });

  describe("status='auth' (BIZ-291 regression)", () => {
    it('redirects to /(main)/buddies from the root index (segments=[])', () => {
      // BIZ-291 — cold start with restored token lands here. Pre-fix returned
      // null and stranded the user on Splash.
      expect(computeProtectedRoute('auth', [])).toBe('/(main)/buddies');
    });

    it('redirects to /(main)/buddies from inside (auth) (post-verify)', () => {
      expect(computeProtectedRoute('auth', ['(auth)', 'otp'])).toBe(
        '/(main)/buddies',
      );
    });

    it('stays put when already in (main)', () => {
      expect(computeProtectedRoute('auth', ['(main)', 'buddies'])).toBeNull();
      expect(computeProtectedRoute('auth', ['(main)', 'chat', '123'])).toBeNull();
    });
  });

  describe('non-auth statuses', () => {
    const nonAuth: AuthStatus[] = ['guest', 'awaiting_code'];

    it.each(nonAuth)('redirects %s to /(auth)/phone from the root index', (status) => {
      expect(computeProtectedRoute(status, [])).toBe('/(auth)/phone');
    });

    it.each(nonAuth)('redirects %s out of (main) back to /(auth)/phone', (status) => {
      expect(computeProtectedRoute(status, ['(main)', 'buddies'])).toBe(
        '/(auth)/phone',
      );
    });

    it.each(nonAuth)('stays put when %s is already inside (auth)', (status) => {
      expect(computeProtectedRoute(status, ['(auth)', 'phone'])).toBeNull();
      expect(computeProtectedRoute(status, ['(auth)', 'otp'])).toBeNull();
    });
  });
});
