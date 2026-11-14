/* =============================================================================
 * YouTube Live Watchlist  (in-page floating button)
 * -----------------------------------------------------------------------------
 * You maintain a manual list of channels to follow. When you open YouTube, the
 * extension checks each one's live status and shows the live ones in a
 * bottom-left floating panel.
 *
 * Checks ONLY when you open YouTube (once per page load, subject to a TTL) + a
 * manual Refresh button. No background polling — nothing runs when YouTube
 * isn't open. See detect.ts for how "live" is determined.
 * ========================================================================== */
import { CONFIG, log, warn } from './config'
import { handleFromUrl, parseChannelInput } from './channel'
import { checkOne } from './detect'
import { LOCAL, SYNC, areaGet, areaSet, buildWatchlist, idOf } from './storage'
import type { ResultsMap, RowMode, Status, WatchEntry } from './types'

/* === State ================================================================= */
let watchlist: WatchEntry[] = []
let results: ResultsMap = {}
let lastRefresh = 0 // timestamp (ms) of the last completed check
let panelOpen = false
let settingsOpen = false // panel shows the settings (add/remove) view
let checking = false

/* === Persistence =========================================================== */
async function loadState(): Promise<void> {
  const [sy, lo] = await Promise.all([
    areaGet(SYNC, [CONFIG.CHANNELS_KEY]),
    areaGet(LOCAL, [CONFIG.WATCHLIST_KEY, CONFIG.RESULTS_KEY, CONFIG.LAST_REFRESH_KEY]),
  ])

  const rawLocal = lo[CONFIG.WATCHLIST_KEY]
  const localEntries: WatchEntry[] = Array.isArray(rawLocal) ? rawLocal : []

  const syncedIds = sy[CONFIG.CHANNELS_KEY]
  let ids: string[]
  let migrate = false
  if (Array.isArray(syncedIds)) {
    ids = syncedIds // sync is the source of truth for membership
  } else if (localEntries.length) {
    ids = localEntries.map((e) => idOf(e.url)) // legacy local-only → migrate up
    migrate = true
  } else {
    ids = []
  }

  watchlist = buildWatchlist(ids, localEntries)
  const rawResults = lo[CONFIG.RESULTS_KEY]
  results = rawResults && typeof rawResults === 'object' ? (rawResults as ResultsMap) : {}
  lastRefresh = Number(lo[CONFIG.LAST_REFRESH_KEY]) || 0

  if (migrate) {
    log('Seeding sync channel ids from local watchlist.')
    await saveChannels()
  }
  // Only rewrite local detail if synced membership actually differs from what
  // local already had (e.g. a channel added on another device).
  const localIds = localEntries.map((e) => idOf(e.url))
  const sameMembership = ids.length === localIds.length && ids.every((id) => localIds.includes(id))
  if (!sameMembership) await saveDetail()
}

// Membership → sync (ids only); detail/cache → local.
const saveChannels = () =>
  areaSet(SYNC, { [CONFIG.CHANNELS_KEY]: watchlist.map((e) => idOf(e.url)) })
const saveDetail = () => areaSet(LOCAL, { [CONFIG.WATCHLIST_KEY]: watchlist })
const saveWatchlist = () => Promise.all([saveChannels(), saveDetail()]) // membership change
const saveResults = () => {
  // Drop results for channels no longer on the list. An in-flight check can
  // write a result after its channel was removed (here or via sync), so prune
  // on every save rather than only in removeChannel.
  const urls = new Set(watchlist.map((e) => e.url))
  for (const url of Object.keys(results)) if (!urls.has(url)) delete results[url]
  return areaSet(LOCAL, { [CONFIG.RESULTS_KEY]: results })
}
const saveLastRefresh = () => areaSet(LOCAL, { [CONFIG.LAST_REFRESH_KEY]: lastRefresh })

/* === Checking ============================================================== */
async function checkEntry(entry: WatchEntry): Promise<void> {
  const r = await checkOne(entry, results[entry.url]?.avatar)
  results[entry.url] = r
  // Remember a freshly-discovered name on the entry for future loads.
  if (!entry.name && r.name) entry.name = r.name
}

/** Check every watchlist entry, with bounded concurrency. */
async function checkAll(): Promise<void> {
  if (checking || watchlist.length === 0) {
    renderAll()
    return
  }
  checking = true
  renderAll()
  try {
    const queue = watchlist.slice()
    const worker = async () => {
      let entry: WatchEntry | undefined
      while ((entry = queue.shift())) {
        await checkEntry(entry)
        renderAll()
      }
    }
    const n = Math.min(CONFIG.CONCURRENCY, queue.length)
    await Promise.all(Array.from({ length: n }, worker))
    lastRefresh = Date.now()
    // Names discovered during the check are detail only — write local, not sync.
    await Promise.all([saveResults(), saveDetail(), saveLastRefresh()])
    log('checkAll complete:', summarize())
  } finally {
    checking = false
    renderAll()
  }
}

const liveCount = () => watchlist.filter((e) => results[e.url]?.isLive).length
const summarize = () => `${liveCount()}/${watchlist.length} live`

/* === Watchlist mutations =================================================== */
async function addChannel(rawInput: string): Promise<boolean> {
  const parsed = parseChannelInput(rawInput)
  if (!parsed) {
    warn('Could not parse channel input:', rawInput)
    return false
  }
  if (watchlist.some((e) => idOf(e.url) === idOf(parsed.url))) return false // dupe
  // The in-memory entry keeps full detail (local); only its id goes to sync.
  const entry: WatchEntry = { url: parsed.url, name: '' }
  watchlist.push(entry)
  await saveWatchlist() // membership changed → sync ids + local detail
  renderAll()
  // Check just this one immediately for instant feedback.
  await checkEntry(entry)
  await Promise.all([saveResults(), saveDetail()]) // name is detail → local only
  renderAll()
  return true
}

async function removeChannel(url: string): Promise<void> {
  watchlist = watchlist.filter((e) => e.url !== url)
  delete results[url]
  await Promise.all([saveWatchlist(), saveResults()])
  renderAll()
}

/* === UI helpers ============================================================ */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string | null
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text
  return e
}

/** Small icon button for the header (gear / back / refresh). */
function iconButton(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'yls-iconbtn', glyph)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  b.addEventListener('click', onClick)
  return b
}

/** Human-friendly "time ago" for the last-refresh line. */
function relTime(ts: number): string {
  if (!ts) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function statusOf(entry: WatchEntry): Status {
  const r = results[entry.url]
  if (checking && !r) return 'checking'
  if (!r) return 'unknown'
  if (r.error) return r.error // 'login' | 'network'
  return r.isLive ? 'live' : 'offline'
}

/* === Floating button + panel =============================================== */
function ensureFab(): HTMLButtonElement {
  const existing = document.getElementById(CONFIG.FAB_ID)
  if (existing) return existing as HTMLButtonElement
  const fab = el('button')
  fab.id = CONFIG.FAB_ID
  fab.type = 'button'
  fab.setAttribute('aria-label', 'Live watchlist')
  fab.appendChild(el('span', 'yls-fab-dot'))
  fab.appendChild(el('span', 'yls-fab-icon', '📡'))
  fab.appendChild(el('span', 'yls-fab-count', '0'))
  fab.addEventListener('click', (e) => {
    e.stopPropagation()
    setPanelOpen(!panelOpen)
  })
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null
    if (
      panelOpen &&
      !target?.closest('#' + CONFIG.PANEL_ID) &&
      !target?.closest('#' + CONFIG.FAB_ID)
    ) {
      setPanelOpen(false)
    }
  })
  document.body.appendChild(fab)
  return fab
}

function ensurePanel(): HTMLDivElement {
  const existing = document.getElementById(CONFIG.PANEL_ID)
  if (existing) return existing as HTMLDivElement
  const panel = el('div')
  panel.id = CONFIG.PANEL_ID
  panel.hidden = true
  // Keep clicks inside the panel from reaching the document "click outside"
  // handler. Without this, a control that re-renders the panel (e.g. Refresh)
  // detaches its own button mid-click, so the outside-check misreads it as a
  // click outside and closes the panel. (Links still navigate — this only
  // stops propagation, not the default action.)
  panel.addEventListener('click', (e) => e.stopPropagation())
  document.body.appendChild(panel)
  return panel
}

function setPanelOpen(open: boolean): void {
  panelOpen = open
  if (open) settingsOpen = false // always (re)open on the main view
  const panel = document.getElementById(CONFIG.PANEL_ID)
  const fab = document.getElementById(CONFIG.FAB_ID)
  if (panel) panel.hidden = !open
  if (fab) fab.classList.toggle('yls-open', open)
  if (open) renderPanel() // make sure it's current when opened
}

function renderFab(): void {
  const fab = ensureFab()
  const count = liveCount()
  const countEl = fab.querySelector('.yls-fab-count')
  if (countEl) countEl.textContent = String(count)
  fab.classList.toggle('yls-has-live', count > 0)
  fab.classList.toggle('yls-checking', checking)
}

function renderPanel(): void {
  const panel = ensurePanel()
  panel.innerHTML = ''
  if (settingsOpen) renderSettingsView(panel)
  else renderMainView(panel)
}

/* --- Main view: one unified list, live channels on top -------------------- */
function renderMainView(panel: HTMLElement): void {
  const header = el('div', 'yls-panel-header')
  const count = liveCount()
  header.appendChild(el('span', 'yls-title', count ? `🔴 Live now · ${count}` : 'Live watchlist'))
  const actions = el('div', 'yls-header-actions')
  const refresh = iconButton('⟳', 'Refresh', () => void checkAll())
  refresh.classList.toggle('yls-spin', checking)
  refresh.disabled = checking || watchlist.length === 0
  actions.appendChild(refresh)
  actions.appendChild(
    iconButton('⚙', 'Settings', () => {
      settingsOpen = true
      renderPanel()
    })
  )
  header.appendChild(actions)
  panel.appendChild(header)

  /* Last-refresh line */
  panel.appendChild(
    el(
      'div',
      'yls-updated',
      checking ? 'Checking…' : lastRefresh ? `Updated ${relTime(lastRefresh)}` : 'Not checked yet'
    )
  )

  if (watchlist.some((e) => results[e.url]?.error === 'login')) {
    panel.appendChild(el('div', 'yls-warn', 'Log in to YouTube to check live status.'))
  }

  /* One list — live channels first (stable), the rest faded but readable. */
  const list = el('div', 'yls-section')
  if (watchlist.length === 0) {
    list.appendChild(el('div', 'yls-panel-empty', 'Open ⚙ Settings to add a channel.'))
  } else {
    const rank = (e: WatchEntry) => (statusOf(e) === 'live' ? 0 : 1)
    const sorted = watchlist
      .map((entry, i) => [entry, i] as const)
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([entry]) => entry)
    for (const entry of sorted) list.appendChild(channelRow(entry, 'main'))
  }
  panel.appendChild(list)
}

/* --- Settings view: add + remove channels --------------------------------- */
function renderSettingsView(panel: HTMLElement): void {
  const header = el('div', 'yls-panel-header')
  const actions = el('div', 'yls-header-actions')
  actions.appendChild(
    iconButton('‹', 'Back', () => {
      settingsOpen = false
      renderPanel()
    })
  )
  header.appendChild(actions)
  header.appendChild(el('span', 'yls-title', 'Settings'))
  panel.appendChild(header)

  /* Add row */
  const addRow = el('div', 'yls-addrow')
  const input = el('input', 'yls-input')
  input.type = 'text'
  input.placeholder = '@handle, channel URL, or UC… id'
  const addBtn = el('button', 'yls-add', '＋')
  addBtn.type = 'button'
  addBtn.title = 'Add channel'
  addBtn.setAttribute('aria-label', 'Add channel')
  const submit = async () => {
    const val = input.value
    input.value = ''
    const ok = await addChannel(val)
    if (!ok) {
      input.value = val
      input.classList.add('yls-input-error')
      setTimeout(() => input.classList.remove('yls-input-error'), 1200)
    }
  }
  addBtn.addEventListener('click', () => void submit())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit()
  })
  addRow.appendChild(input)
  addRow.appendChild(addBtn)
  panel.appendChild(addRow)

  /* Manage list with remove buttons */
  const manage = el('div', 'yls-section')
  manage.appendChild(el('div', 'yls-section-label', `Watchlist · ${watchlist.length}`))
  if (watchlist.length === 0) {
    manage.appendChild(el('div', 'yls-panel-empty', 'No channels yet — add one above.'))
  } else {
    for (const entry of watchlist) manage.appendChild(channelRow(entry, 'manage'))
  }
  panel.appendChild(manage)
}

/**
 * A single channel row.
 *   mode 'main'   → unified list row. Live rows link to the stream; non-live
 *                   rows are faded (via the yls-status-* class) but readable.
 *   mode 'manage' → status dot + ✕ remove button (settings watchlist).
 * Every row carries a status dot (red when live).
 */
function channelRow(entry: WatchEntry, mode: RowMode): HTMLElement {
  const r = results[entry.url]
  const status = statusOf(entry)
  // Only the main view links to the stream; settings rows are never links so a
  // mis-click while managing the list can't navigate you away.
  const watchUrl = r?.watchUrl
  const row: HTMLElement = mode === 'main' && status === 'live' && watchUrl ? el('a') : el('div')
  row.className = 'yls-row yls-status-' + status
  if (row instanceof HTMLAnchorElement && watchUrl) row.href = watchUrl

  const avatar = el('img', 'yls-row-avatar')
  if (r?.avatar) avatar.src = r.avatar
  avatar.alt = ''
  row.appendChild(avatar)

  row.appendChild(el('span', 'yls-row-name', r?.name || entry.name || handleFromUrl(entry.url)))

  row.appendChild(el('span', 'yls-dot yls-dot-' + status))

  if (mode === 'manage') {
    const rm = el('button', 'yls-remove', '✕')
    rm.title = 'Remove'
    rm.addEventListener('click', (e) => {
      e.stopPropagation()
      void removeChannel(entry.url)
    })
    row.appendChild(rm)
  }
  return row
}

function renderAll(): void {
  try {
    renderFab()
    if (panelOpen) renderPanel()
  } catch (e) {
    warn('render failed:', e)
  }
}

/** Reflect membership edits made on another device/tab (synced channel ids). */
function watchSyncChanges(): void {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[CONFIG.CHANNELS_KEY]) return
      const ids: unknown = changes[CONFIG.CHANNELS_KEY].newValue
      if (!Array.isArray(ids)) return
      // Rebuild from synced ids, keeping any local detail we already have.
      watchlist = buildWatchlist(ids as string[], watchlist)
      void saveDetail() // persist the merged/pruned detail locally
      log('Membership updated from sync.')
      renderAll()
    })
  } catch {
    // storage.onChanged unavailable — non-fatal.
  }
}

/* === Init (runs when the YouTube page loads; no background activity) ======= */
let didInit = false
async function init(): Promise<void> {
  if (didInit) return // content script persists across SPA nav; init once
  didInit = true
  try {
    await loadState()
    watchSyncChanges()
    ensureFab()
    ensurePanel()
    renderAll() // show cached results immediately

    // Auto-check on open ONLY if the cache is stale (older than the TTL).
    // Fresh cache → show it as-is; the user can still Refresh manually.
    const age = Date.now() - lastRefresh
    if (CONFIG.CHECK_ON_LOAD && watchlist.length && age >= CONFIG.REFRESH_TTL_MS) {
      void checkAll()
    } else {
      log(`Using cached results (age ${Math.round(age / 1000)}s).`, summarize())
    }
  } catch (e) {
    warn('Init failed:', e)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init())
} else {
  void init()
}
