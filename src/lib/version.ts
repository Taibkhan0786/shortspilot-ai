/**
 * Release version — bump on every shipped change so a running instance can be
 * identified unambiguously (shown in the admin console footer and exposed via
 * GET /api/v1/health). If a local install shows an older version than the
 * sandbox/GitHub HEAD, its files are stale — re-extract the latest zip.
 */
export const APP_VERSION = "1.4.0";
export const APP_BUILD = "2026-11-10";
