/* ===========================================================================
 * Live detection
 * ---------------------------------------------------------------------------
 * fetch "https://www.youtube.com/<channel>/live" and count `"isLive": true`
 * in the returned HTML —
 *   2  → live now
 *   1  → scheduled / upcoming stream (not live)
 *   0  → offline
 * Same-origin fetch from the YouTube tab → uses your login cookies, needs no
 * host permissions, and is unlikely to be blocked.
 * ======================================================================== */
import { CONFIG, log } from './config'
import { handleFromUrl } from './channel'
import type { CheckResult, WatchEntry } from './types'

/** Decode a JSON-escaped string fragment captured from the page source. */
function jsonStr(raw: string): string {
  try {
    return JSON.parse('"' + raw + '"') as string
  } catch {
    return raw
  }
}

export function extractName(html: string): string | null {
  let m = html.match(/"author":"((?:[^"\\]|\\.)*)"/)
  if (m) return jsonStr(m[1])
  m = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)
  if (m) return jsonStr(m[1])
  m = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)
  if (m) return m[1]
  return null
}

export function extractAvatar(html: string): string | null {
  // The FIRST "avatar" in the HTML is the masthead/account avatar (the logged-
  // in user's own picture), so we must anchor to channel-specific keys instead.
  const url = '((?:[^"\\\\]|\\\\.)*?)'
  const patterns = [
    // Channel page (offline): channelMetadataRenderer.avatar
    new RegExp(
      '"channelMetadataRenderer":\\{[\\s\\S]{0,4000}?"avatar":\\{"thumbnails":\\[\\{"url":"' +
        url +
        '"'
    ),
    // Live watch page: the video owner's avatar
    new RegExp('"videoOwnerRenderer":\\{[\\s\\S]{0,4000}?"thumbnails":\\[\\{"url":"' + url + '"'),
    // New view-model channel header (decoratedAvatarViewModel)
    new RegExp(
      '"pageHeaderViewModel":\\{[\\s\\S]{0,8000}?"image":\\{"sources":\\[\\{"url":"' + url + '"'
    ),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return jsonStr(m[1])
  }
  return null
}

/**
 * Check one watchlist entry. Never throws.
 * `prevAvatar` is reused if this fetch can't find one.
 */
export async function checkOne(
  entry: WatchEntry,
  prevAvatar?: string | null
): Promise<CheckResult> {
  const liveUrl = entry.liveUrl || entry.url + '/live'
  try {
    const res = await fetch(liveUrl, { redirect: 'follow', credentials: 'include' })
    const finalUrl = res.url || liveUrl

    // Redirected to a consent/login wall → can't determine status.
    if (/consent\.youtube\.com|accounts\.google\.com/.test(finalUrl)) {
      return { error: 'login', ts: Date.now() }
    }

    const html = await res.text()
    const count = (html.match(/"isLive":\s*true/g) || []).length
    const isLive = count >= CONFIG.LIVE_COUNT

    return {
      isLive,
      name: entry.name || extractName(html) || handleFromUrl(entry.url),
      avatar: extractAvatar(html) || prevAvatar || null,
      watchUrl: isLive ? finalUrl : entry.url,
      ts: Date.now(),
    }
  } catch (e) {
    log('checkOne failed for', entry.url, e)
    return { error: 'network', ts: Date.now() }
  }
}
