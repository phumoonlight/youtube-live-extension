/** All tuning knobs live here. */
export const CONFIG = {
  DEBUG: false, // set true for console logging
  FAB_ID: 'yls-fab',
  PANEL_ID: 'yls-panel',
  CHANNELS_KEY: 'yls_channels', // SYNC: array of channel ids (membership only)
  WATCHLIST_KEY: 'yls_watchlist', // LOCAL: array of full entries { url, name }
  RESULTS_KEY: 'yls_results', // LOCAL: cache of last check, url -> result
  LAST_REFRESH_KEY: 'yls_last_refresh', // LOCAL: timestamp of last check
  LIVE_COUNT: 2, // number of `"isLive": true` that means "live now"
  CONCURRENCY: 4, // max simultaneous /live fetches (be gentle)
  CHECK_ON_LOAD: true, // auto-check when YouTube opens (subject to TTL below)
  REFRESH_TTL_MS: 5 * 60 * 1000, // skip auto-check if cache is newer than this
} as const

export const log = (...a: unknown[]): void => {
  if (CONFIG.DEBUG) console.log('[YT-Live]', ...a)
}
export const warn = (...a: unknown[]): void => console.warn('[YT-Live]', ...a)
