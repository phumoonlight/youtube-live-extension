/* ===========================================================================
 * Channel input parsing
 * ---------------------------------------------------------------------------
 * Accepts: a full channel URL, a /@handle, a bare @handle, a bare handle, a
 * UC… channel id, or a /channel/UC… path. Returns { url, liveUrl } or null.
 * ======================================================================== */

export interface ParsedChannel {
  url: string
  liveUrl: string
}

export function parseChannelInput(raw: string): ParsedChannel | null {
  let s = (raw || '').trim()
  if (!s) return null

  // If a full URL was pasted, reduce it to its path.
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {
      return null
    }
  }
  s = s.replace(/^\/+/, '') // drop leading slashes

  let path: string
  let m: RegExpMatchArray | null
  if (/^UC[\w-]{10,}$/.test(s)) path = `/channel/${s}`
  else if ((m = s.match(/^channel\/(UC[\w-]+)/))) path = `/channel/${m[1]}`
  else if ((m = s.match(/^(@[\w.\-]+)/))) path = `/${m[1]}`
  else if (/^[\w.\-]+$/.test(s))
    path = `/@${s}` // bare word → treat as handle
  else return null

  const url = 'https://www.youtube.com' + path
  return { url, liveUrl: url + '/live' }
}

/** First path segment of a channel URL ("@handle" / "channel"), for display. */
export function handleFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/^\/+/, '')
    return p.split('/')[0] || url
  } catch {
    return url
  }
}
