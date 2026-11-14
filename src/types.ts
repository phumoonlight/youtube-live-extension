/** A channel on the watchlist (full detail, stored locally). */
export interface WatchEntry {
  url: string // e.g. https://www.youtube.com/@handle
  name: string // cached display name ('' until discovered)
  liveUrl?: string
}

export type CheckError = 'login' | 'network'

export interface CheckSuccess {
  isLive: boolean
  name: string
  avatar: string | null
  watchUrl: string
  ts: number
  error?: undefined
}

export interface CheckFailure {
  error: CheckError
  ts: number
  isLive?: undefined
  name?: undefined
  avatar?: undefined
  watchUrl?: undefined
}

export type CheckResult = CheckSuccess | CheckFailure

/** url -> last check result */
export type ResultsMap = Record<string, CheckResult>

export type Status = 'live' | 'offline' | 'checking' | 'unknown' | CheckError

export type RowMode = 'main' | 'manage'
