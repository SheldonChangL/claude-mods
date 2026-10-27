// PTT service configuration: what the pane may ask (`configure`:
// on/off and the favourites polling interval), the shapes a want may name,
// and the limits the service works within. Pure (no Node API).
//
// Nothing here is a secret: the service reads public pages of
// https://www.ptt.cc/bbs/ (no login, nothing posted), politely: one request
// at a time, at least requestGapMs apart, holding everything after a 429/503.

/** The only origin the service ever asks, and the only path prefix. */
export const PTT_ORIGIN = 'https://www.ptt.cc'
export const PTT_BBS = `${PTT_ORIGIN}/bbs/`
export const HOT_URL = `${PTT_BBS}hotboards.html`

/** A board name, an article id (the file name of its page) and a want token. */
export const BOARD = /^[A-Za-z0-9_-]{1,12}$/
export const ARTICLE_ID = /^M\.\d{9,11}\.A\.[0-9A-F]{3}$/
export const TOKEN = /^[A-Za-z0-9_-]{8,64}$/
/** The push-count filters a board view may ask for: PTT's own search, `recommend:<n>` (100 is 爆). */
export const PUSH_FILTERS = Object.freeze([10, 30, 50, 100])

/** Bounds and timings: past each, a deterministic cut (never unbounded growth). */
export const PTT_LIMITS = Object.freeze({
  // fetching
  timeoutMs: 10 * 1000,
  responseBytes: 2 * 1024 * 1024,
  requestGapMs: 1000, // at least this long between two request starts
  queueMax: 64,
  retryAfterDefaultMs: 60 * 1000, // a 429/503 without a readable Retry-After holds this long
  retryAfterMinMs: 60 * 1000,
  retryAfterMaxMs: 10 * 60 * 1000,
  // freshness
  latestTtlMs: 60 * 1000,
  pageTtlMs: 10 * 60 * 1000,
  articleTtlMs: 5 * 60 * 1000,
  hotTtlMs: 10 * 60 * 1000,
  lookupTtlMs: 60 * 60 * 1000,
  lookupRetryMs: 10 * 1000, // a failed lookup is asked again on the next lookup, at most this often
  pressMinMs: 10 * 1000, // a Refresh press is acted on at most this often per want
  // wants
  wantTtlMs: 2 * 60 * 60 * 1000,
  wantsMax: 64,
  sweepMs: 60 * 1000,
  boardsPerWant: 30,
  pageMax: 999999,
  // kept values
  boardEntries: 40,
  articleEntries: 6,
  lookupEntries: 20,
  // value sizes
  itemsMax: 40,
  hotMax: 150,
  bodyChars: 24000,
  articleBytes: 48 * 1024,
  titleChars: 200,
  nameChars: 40,
  pushTextChars: 200,
  metaChars: 200,
  shortChars: 16, // dates, push values, marks, push times
  categoryChars: 40,
})

/** The favourites polling interval a session may ask for: 300 s by default, 60 s at least, 1 hour at most. */
export const REFRESH = Object.freeze({ defaultSeconds: 300, minSeconds: 60, maxSeconds: 3600 })

/**
 * A session's configuration: on or off, and the polling interval (seconds),
 * clamped. Nothing else is read from it.
 * @returns {{ enabled: boolean, refreshSeconds: number }}
 */
export function parsePttConfig(input) {
  const seconds = Number(input?.refreshSeconds)
  const wanted = Number.isFinite(seconds) && seconds > 0 ? seconds : REFRESH.defaultSeconds
  return { enabled: input?.enabled === true, refreshSeconds: Math.round(Math.min(Math.max(wanted, REFRESH.minSeconds), REFRESH.maxSeconds)) }
}

/** The codes a PTT value's errorCode may hold (and the service's own two). */
export const PTT_ERROR_CODES = Object.freeze(['redirect', 'not-found', 'throttled', 'http', 'timeout', 'network', 'too-large', 'content-type', 'bad-shape', 'bad-request', 'queue-full', 'stopped'])

export class PttError extends Error {
  /**
   * @param {string} code  one of PTT_ERROR_CODES
   * @param {{ status?: number, retryAfterMs?: number | null }} [extra]
   */
  constructor(code, { status = 0, retryAfterMs = null } = {}) {
    super(code)
    this.name = 'PttError'
    this.code = PTT_ERROR_CODES.includes(code) ? code : 'http'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}
