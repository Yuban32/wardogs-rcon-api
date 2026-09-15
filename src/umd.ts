/**
 * UMD entry point.
 *
 * The ESM entry (`index.ts`) is re-exported wholesale and then attached to a
 * single global, so a `<script>` tag consumer writes:
 *
 * ```html
 * <script src="https://unpkg.com/@yuban32/wardogs-rcon-api/dist/wardogs-rcon-api.umd.js"></script>
 * <script>
 *   const { createClient } = WardogsRCON;
 * </script>
 * ```
 *
 * The namespace is deliberately not flattened onto `window`: putting
 * `createClient`, `Status`, `Config` and forty other names at the top level
 * would collide with whatever else the page has loaded. One global holding
 * everything is predictable, and mirrors how the ESM namespace import reads.
 */

export * from './index.js';

/**
 * Library version, duplicated here as a named export on the UMD global so a
 * `<script>` consumer can confirm which build a cached CDN URL actually served
 * — the usual explanation for "the new API is not there".
 */
export { VERSION as version } from './version.js';
