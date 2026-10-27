// The mod's only network: GETs of https://www.ptt.cc/bbs/..., through the
// engine's `$.http.fetch`, one at a time.
//
// createGetHtml makes one request, checked: a fixed origin and path prefix
// (SAFE_URL), a timeout, at most responseBytes. fetchHtml reads its answer:
// 3xx `redirect`, 404 `not-found`, 429/503 `throttled` (with the Retry-After
// to hold for), other non-2xx `http`, a 2xx that is not text/html
// `content-type`. Headers sent: the over18 cookie (PTT's age gate; no
// account), a user agent naming this mod and its version, accept text/html.
//
// createQueue is the politeness: one request in flight, at least gapMs
// between two starts, at most queueMax waiting, the same URL waiting twice is
// one request, a view or a lookup the pane waits on goes before the boards'
// polling, and after a 429/503 every request waits until blockedUntil.
// Errors are PttError with a short code; a page's body never travels into a
// log. Timing (now, sleep) is injected ($.clock; a fake in tests).

import { ARTICLE_ID, BOARD, HOT_URL, PTT_BBS, PTT_LIMITS, PttError, PUSH_FILTERS } from './config.mjs'

export { PttError } from './config.mjs'

/** The latest page of a board, or page N. */
export function boardUrl(board, page = null) {
  if (typeof board !== 'string' || !BOARD.test(board)) throw new PttError('bad-request')
  if (page === null) return `${PTT_BBS}${board}/index.html`
  if (!Number.isSafeInteger(page) || page < 1 || page > PTT_LIMITS.pageMax) throw new PttError('bad-request')
  return `${PTT_BBS}${board}/index${page}.html`
}

/**
 * A board's posts with at least `push` pushes, PTT's own search
 * (`recommend:<n>`): page 1 is the newest, higher pages are older.
 */
export function searchUrl(board, push, page = null) {
  if (typeof board !== 'string' || !BOARD.test(board) || !PUSH_FILTERS.includes(push)) throw new PttError('bad-request')
  const n = page === null ? 1 : page
  if (!Number.isSafeInteger(n) || n < 1 || n > PTT_LIMITS.pageMax) throw new PttError('bad-request')
  return `${PTT_BBS}${board}/search?page=${n}&q=recommend%3A${push}`
}

export function articleUrl(board, id) {
  if (typeof board !== 'string' || !BOARD.test(board) || typeof id !== 'string' || !ARTICLE_ID.test(id)) throw new PttError('bad-request')
  return `${PTT_BBS}${board}/${id}.html`
}

export { HOT_URL }

/** Only these pages are ever asked: the hot boards, a board's index pages, an article. */
const SAFE_URL = /^https:\/\/www\.ptt\.cc\/bbs\/(?:(?:hotboards|[A-Za-z0-9_-]{1,12}\/(?:index\d{0,6}|M\.\d{9,11}\.A\.[0-9A-F]{3}))\.html|[A-Za-z0-9_-]{1,12}\/search\?page=\d{1,6}&q=recommend%3A(?:10|30|50|100))$/

const encoder = new TextEncoder()

/**
 * The PTT GET, made from the engine's `$.http.fetch` (the mod has no network
 * of its own) and a timer. Resolves { status, headers: { 'retry-after',
 * 'content-type' }, body } or rejects PttError (bad-request, timeout,
 * network, too-large).
 *
 * The URL is checked against SAFE_URL first: only www.ptt.cc/bbs pages this
 * service builds. `$.http.fetch` reads the whole body and has no timeout of
 * its own: the timer stops waiting for it (the request may finish unseen) and
 * a body past maxBytes is refused once read. Whether the host follows a
 * redirect is the host's: a 3xx that reaches here is an error (fetchHtml).
 *
 * @param {{ fetch: (url: string, init: object) => Promise<{ status: number, headers: Record<string, string>, text: string }>, after: (ms: number, fn: () => void) => { cancel(): void } }} io
 */
export function createGetHtml({ fetch, after }) {
  return function getHtml(url, { timeoutMs = PTT_LIMITS.timeoutMs, maxBytes = PTT_LIMITS.responseBytes, userAgent = 'ptt-mod (read-only personal pane)' } = {}) {
    return new Promise((resolve, reject) => {
      if (typeof url !== 'string' || !SAFE_URL.test(url)) {
        reject(new PttError('bad-request'))
        return
      }
      let settled = false
      let timer = null
      const settle = (fn) => {
        if (settled) return
        settled = true
        timer?.cancel?.()
        fn()
      }
      try {
        timer = after(timeoutMs, () => settle(() => reject(new PttError('timeout'))))
      } catch {}
      Promise.resolve()
        .then(() => fetch(url, { method: 'GET', headers: { accept: 'text/html', cookie: 'over18=1', 'user-agent': userAgent } }))
        .then(
          (res) =>
            settle(() => {
              const text = typeof res?.text === 'string' ? res.text : ''
              if (text.length > maxBytes || encoder.encode(text).length > maxBytes) return reject(new PttError('too-large'))
              const header = (name) => String(res?.headers?.[name] ?? '')
              resolve({ status: Number(res?.status) || 0, headers: { 'retry-after': header('retry-after'), 'content-type': header('content-type') }, body: text })
            }),
          () => settle(() => reject(new PttError('network'))),
        )
    })
  }
}

/** Retry-After (seconds, or an HTTP date) as milliseconds within [min, max]; the default when absent or unreadable. */
export function retryAfterMs(header, { now = Date.now(), fallback = PTT_LIMITS.retryAfterDefaultMs, min = PTT_LIMITS.retryAfterMinMs, max = PTT_LIMITS.retryAfterMaxMs } = {}) {
  const text = String(header ?? '').trim()
  let ms = fallback
  if (text) {
    const seconds = Number(text)
    if (Number.isFinite(seconds) && seconds >= 0) ms = Math.round(seconds * 1000)
    else {
      const at = Date.parse(text)
      if (Number.isFinite(at)) ms = at - now
    }
  }
  return Math.min(max, Math.max(min, ms))
}

/**
 * One page through `get`, its answer read: the body of a 2xx text/html, or a PttError.
 * @param {typeof getHtml} get
 */
export async function fetchHtml(get, url, options, { now = Date.now(), limits = PTT_LIMITS } = {}) {
  let answer
  try {
    answer = await get(url, options)
  } catch (error) {
    throw error instanceof PttError ? error : new PttError('network')
  }
  const status = Number(answer?.status) || 0
  const header = (name) => String(answer?.headers?.[name] ?? '')
  if (status === 429 || status === 503) throw new PttError('throttled', { status, retryAfterMs: retryAfterMs(header('retry-after'), { now, fallback: limits.retryAfterDefaultMs, min: limits.retryAfterMinMs, max: limits.retryAfterMaxMs }) })
  if (status >= 300 && status < 400) throw new PttError('redirect', { status })
  if (status === 404) throw new PttError('not-found', { status })
  if (status < 200 || status >= 300) throw new PttError('http', { status })
  if (!/^text\/html\b/i.test(header('content-type').trim())) throw new PttError('content-type', { status })
  return typeof answer.body === 'string' ? answer.body : String(answer.body ?? '')
}

/**
 * The service's request queue.
 * @param {object} options
 * @param {typeof getHtml} options.get
 * @param {string} options.userAgent
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {object} [options.limits]   requestGapMs, queueMax, timeoutMs, responseBytes, retryAfter*
 * @param {(blockedUntil: number | null) => void} [options.onBlocked]   the hold began (a time) or ended (null)
 */
export function createQueue({ get, userAgent, now = Date.now, sleep, limits = {}, onBlocked = () => {} } = {}) {
  if (typeof get !== 'function' || typeof sleep !== 'function') throw new TypeError('createQueue needs get and sleep')
  const L = { ...PTT_LIMITS, ...limits }
  const waiting = [] // { url, priority: 0 high | 1 low, promise, resolve, reject }
  let pumping = false
  let generation = 0
  let lastStart = null
  let blockedUntil = null
  let requests = 0
  let throttles = 0

  function take() {
    let best = 0
    for (let i = 1; i < waiting.length; i += 1) if (waiting[i].priority < waiting[best].priority) best = i
    return waiting.splice(best, 1)[0]
  }

  async function pump() {
    if (pumping) return
    pumping = true
    const mine = generation
    // The moment a wait was for, once the timer has fired: the timer ($.clock)
    // and now() may be different clocks (a test's mocked clock), so a wait
    // that ran out is never waited again for the same moment.
    let waitedFor = -Infinity
    try {
      while (waiting.length > 0 && mine === generation) {
        const ready = Math.max(lastStart === null ? 0 : lastStart + L.requestGapMs, blockedUntil ?? 0)
        const wait = ready - now()
        if (wait > 0 && ready > waitedFor) {
          await sleep(wait)
          waitedFor = ready
          continue // time is read again: a hold may have begun meanwhile
        }
        if (blockedUntil !== null) {
          blockedUntil = null
          onBlocked(null)
        }
        const job = take()
        lastStart = now()
        requests += 1
        try {
          const body = await fetchHtml(get, job.url, { timeoutMs: L.timeoutMs, maxBytes: L.responseBytes, userAgent }, { now: now(), limits: L })
          job.resolve(body)
        } catch (error) {
          if (error instanceof PttError && error.code === 'throttled' && mine === generation) {
            throttles += 1
            blockedUntil = now() + (error.retryAfterMs ?? L.retryAfterDefaultMs)
            onBlocked(blockedUntil)
          }
          job.reject(error)
        }
      }
    } finally {
      if (mine === generation) pumping = false
    }
  }

  return Object.freeze({
    /**
     * A page, through the queue. The same URL already waiting is the same
     * request (and moves up when this ask is the more urgent).
     * @param {string} url
     * @param {{ priority?: 'high' | 'low' }} [options]
     * @returns {Promise<string>} the page's HTML
     */
    request(url, { priority = 'high' } = {}) {
      const rank = priority === 'low' ? 1 : 0
      const queued = waiting.find((job) => job.url === url)
      if (queued) {
        queued.priority = Math.min(queued.priority, rank)
        return queued.promise
      }
      if (waiting.length >= L.queueMax) {
        // Full: an urgent ask takes the place of the last polling one; otherwise it is refused.
        const victim = rank === 0 ? waiting.findLastIndex((job) => job.priority === 1) : -1
        if (victim < 0) return Promise.reject(new PttError('queue-full'))
        waiting.splice(victim, 1)[0].reject(new PttError('queue-full'))
      }
      const job = { url, priority: rank }
      job.promise = new Promise((resolve, reject) => {
        job.resolve = resolve
        job.reject = reject
      })
      job.promise.catch(() => {})
      waiting.push(job)
      void pump()
      return job.promise
    },
    /** Every waiting request ends (`stopped`); one in flight publishes nothing (its caller checks). */
    clear() {
      generation += 1
      pumping = false
      for (const job of waiting.splice(0)) job.reject(new PttError('stopped'))
    },
    blockedUntil: () => (blockedUntil !== null && blockedUntil > now() ? blockedUntil : null),
    stats: () => ({ waiting: waiting.length, requests, throttles, blockedUntil: blockedUntil !== null && blockedUntil > now() ? blockedUntil : null }),
  })
}
