import type { AuthStatus } from '@/application/stores/auth';

export type ProtectedRouteTarget = '/(main)/buddies' | '/(auth)/phone' | null;

/**
 * Decide where the root protected-route guard should redirect.
 *
 * Returns the target path, or null when the current group is already correct
 * (or auth is still initializing and the gate must wait).
 *
 * BIZ-291 — cold start with a restored token lands at the root index
 * (segments=[]), which is neither `(auth)` nor `(main)`. The previous gate
 * only redirected when status='auth' AND inAuthGroup, so the auth-cold-start
 * fell through and the user got stranded on Splash. The fix is to redirect
 * to `(main)` whenever an authenticated user is *outside* `(main)`.
 */
export function computeProtectedRoute(
  status: AuthStatus,
  segments: readonly string[],
): ProtectedRouteTarget {
  if (status === 'initializing') return null;
  const inAuthGroup = segments[0] === '(auth)';
  const inMainGroup = segments[0] === '(main)';
  if (status === 'auth') {
    return inMainGroup ? null : '/(main)/buddies';
  }
  return inAuthGroup ? null : '/(auth)/phone';
}
