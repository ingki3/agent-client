/**
 * Custom app entry. The push-preload background task must be DEFINED at the
 * module scope of a file the bundle always loads: a terminated-state push
 * launches a headless JS runtime that loads this entry without rendering any
 * route, so a definition inside app/ route files would never run there.
 */
import './app/_runtime/pushPreload';
import 'expo-router/entry';
