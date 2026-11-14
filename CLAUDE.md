# CLAUDE.md

Chrome MV3 extension (personal use) that injects a floating 📡 button into YouTube showing which
channels on a manually-curated watchlist are live. No API key, no background/service worker, no
polling — checks run only from the content script when a YouTube page loads (subject to a TTL) or
on manual Refresh.

## Commands

```sh
npm install
npm run build       # src/ → dist/youtube-live/ (Load unpacked this) + dist/youtube-live.zip
npm run watch       # rebuild dist/youtube-live/ on change (inline sourcemaps, no zip)
npm run typecheck   # tsc --noEmit (strict)
npm run format      # prettier (see .prettierrc: no semicolons, single quotes, width 100)
```

No test suite. Verify changes with `typecheck` + `build`, then reload the extension and a YouTube
tab manually.

## Layout

- `src/content.ts` — entry point. Holds all mutable state (`watchlist`, `results`, `lastRefresh`,
  panel flags), check orchestration (`checkAll` with bounded concurrency), add/remove, all DOM
  rendering, and `init`. UI is plain DOM (`el()` helper), re-rendered wholesale via `renderAll()`.
- `src/detect.ts` — `checkOne()`: same-origin `fetch(<channel>/live)` and count `"isLive": true`
  matches (`>= CONFIG.LIVE_COUNT` ⇒ live; 1 = scheduled). Also regex-scrapes channel name/avatar.
- `src/channel.ts` — `parseChannelInput()` (accepts `@handle`, bare handle, channel URL, `UC…` id).
- `src/storage.ts` — promise wrappers over `chrome.storage` callbacks; `idOf`/`urlFromId`;
  `buildWatchlist` merges synced ids with local detail.
- `src/config.ts` — `CONFIG` knobs (keys, `LIVE_COUNT`, `CONCURRENCY`, `REFRESH_TTL_MS`, `DEBUG`).
- `src/manifest.json`, `src/styles.css` — copied verbatim into the output by `build.mjs`.
- `example.js` (root) — reference only, not built or shipped.

## Conventions & gotchas

- Content scripts are classic scripts: esbuild bundles to a single **IIFE**
  `dist/youtube-live/content.js`. Don't add more entry points without adding them to both
  `build.mjs` and `src/manifest.json`. New static files must be added to `STATIC` in `build.mjs`
  (the zip is built flat from the output folder — no subfolders).
- **Storage split:** `chrome.storage.sync` holds _only_ the channel id list (`yls_channels`) —
  membership, tiny, rarely written. Everything else (entries with names, results cache,
  last-refresh) goes to `chrome.storage.local`. Keep frequently-written data out of sync (8 KB/item
  and write-rate quotas). Names discovered during checks are detail → local only.
- Storage keys (`yls_*`) and DOM ids/classes (`yls-*`) are effectively a persisted/public contract;
  renaming them loses users' saved watchlists or breaks `styles.css`.
- Results are keyed by entry `url`; sync ids are `@handle` or `channel/UC…` (see `idOf`).
- The panel stops click propagation on purpose (re-render detaches the clicked button, which would
  otherwise look like an outside click and close the panel). Keep that.
- The only permission is `storage`. Fetches are same-origin from youtube.com with cookies, so no
  `host_permissions` are needed — avoid adding a background worker or permissions unless required.
- Detection is a heuristic on YouTube's HTML; if it breaks, adjust `LIVE_COUNT` / regexes in
  `detect.ts` first.
- Keep the version in `src/manifest.json` and `package.json` in sync when bumping.
- `"key"` in `src/manifest.json` pins the extension ID to `dopependhfjcpnffdceadmaebaonjkip`
  regardless of load path. `chrome.storage` (incl. sync across devices) is scoped to that ID —
  never remove or change the key, or every user's saved watchlist disappears. The matching private
  key is `key.pem` (git-ignored, only needed to pack a .crx).
