/* ===========================================================================
 * Storage
 * ---------------------------------------------------------------------------
 * Split by purpose:
 *   - SYNC  holds ONLY the channel ids (membership) — tiny and rarely written,
 *           so it follows you across signed-in Chrome devices.
 *   - LOCAL holds the full entries ({ url, name }), the results cache and the
 *           last-refresh time — larger / rewritten often / device-specific.
 * On another device the synced ids rebuild the list; names/avatars fill in
 * from that device's own checks. Falls back to local if sync is unavailable.
 * ======================================================================== */
import { warn } from './config'
import type { WatchEntry } from './types'

type Area = chrome.storage.StorageArea

function area(name: 'sync' | 'local'): Area | null {
  try {
    return chrome.storage?.[name] ?? null
  } catch {
    return null
  }
}

export const LOCAL = area('local')
export const SYNC = area('sync') ?? LOCAL

export function areaGet(store: Area | null, keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (!store) return resolve({})
    try {
      store.get(keys, (v) => resolve(v || {}))
    } catch {
      resolve({})
    }
  })
}

export function areaSet(store: Area | null, obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!store) return resolve()
    try {
      store.set(obj, () => {
        // Surface (but don't throw on) quota / rate-limit errors.
        if (chrome.runtime?.lastError) {
          warn('storage error:', chrome.runtime.lastError.message)
        }
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

/** A compact, stable channel id from a channel URL: "@handle" or
 *  "channel/UC…". This is what we keep in sync storage. */
export function idOf(url: string): string {
  const m = (url || '').match(/(@[^/?#]+|channel\/UC[\w-]+)/)
  return m ? m[1] : url || ''
}

/** Rebuild a channel URL from a stored id. */
export function urlFromId(id: string): string {
  if (!id) return ''
  if (/^https?:/i.test(id)) return id
  return 'https://www.youtube.com/' + String(id).replace(/^\/+/, '')
}

/** Merge a list of channel ids with whatever local detail we have, producing
 *  full { url, name } entries (minimal placeholders for unknown ids). */
export function buildWatchlist(ids: string[], localEntries: WatchEntry[]): WatchEntry[] {
  const byId = new Map((localEntries || []).map((e) => [idOf(e.url), e]))
  return ids.map((id) => byId.get(id) || { url: urlFromId(id), name: '' })
}
