/**
 * Library version.
 *
 * Declared as a constant rather than read from `package.json`: a JSON import
 * would pull the whole manifest into every bundle, including the UMD build
 * meant for a `<script>` tag. `scripts/build.mjs` asserts this stays in sync
 * with `package.json`, so the two cannot silently diverge.
 */
export const VERSION = '0.1.0';

/**
 * The `x-lastUpdated` date of the API spec this version of the library was
 * written against.
 *
 * The API is an unofficial community reference and may change without notice.
 * When a route or response shape does not look the way you expect, compare
 * this against the current spec at https://wardogs.tech/openapi.json before
 * assuming a bug in your own code.
 */
export const SPEC_UPDATED = '2026-09-14';

/** Raw specification version string, e.g. `"1.1.0"`. */
export const SPEC_VERSION = '1.1.0';

/** API version this library targets. Only `v1` exists. */
export const API_VERSION = 'v1';
