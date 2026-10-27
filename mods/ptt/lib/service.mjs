// The PTT service: reads public pages of https://www.ptt.cc/bbs/ (no login,
// nothing posted) for the pane, and publishes what it read, in whole values,
// to the mod's memory (lib/app.mjs `data`), which the pane draws from:
//
//   status                { v: 1, state: 'off' | 'on', refreshSeconds, boardsWatched, wants, lastErrorCode, blockedUntil }
//   hot                   { v: 1, state, errorCode, stale, fetchedAt, lastAttempt, items: [{ name, users, category, title }] }
//   lookup:<query>        { v: 1, query, state: 'loading' | 'found' | 'missing' | 'error', name, errorCode, checkedAt }   (query lowercased)
//   board:<Name>:latest   { v: 1, board, page: 'latest' | N, index, prev, next, state, errorCode, stale, fetchedAt, lastAttempt,
//   board:<Name>:<N>        items: [{ id, title, author, date, push, mark, deleted, pinned }] }
//   search:<Name>:<p>:latest | search:<Name>:<p>:<N>   the same shape plus `push: p`: posts with at least p pushes
//                         (p one of 10, 30, 50, 100), PTT's own search; page 1 ('latest') is the newest, prev is older
//   article:<Board>:<id>  { v: 1, board, id, state, errorCode, stale, fetchedAt, lastAttempt, url, meta: { author, title, time },
//                           body, bodyCut, pushes: [{ tag, user, text, time }], pushesCut, counts: { up, down, arrow } }
//
// Wants: the pane writes `want:<token>` = { v: 1, boards, view, lookup,
// refreshAt }: the boards to poll for new posts, the one thing it shows (a
// board page, an article, the hot boards, or nothing), a board name to look
// up, and when Refresh was last pressed. A want is checked (acceptWant)
// before it is served. A value is fetched when first wanted, when wanted
// again past its TTL, or on a Refresh press (acted on once, at most every
// pressMinMs). The boards are polled every refreshSeconds while the service
// is on. A want not written again for wantTtlMs lapses. Values are bounded
// per kind; past a bound the least recently wanted goes.
//
// Every fetch goes through one queue (client.mjs): one request at a time, at
// least a second apart, views and lookups before polling, everything held
// after a 429/503. Failures stay local: a value that cannot be read says so
// in its own key and keeps its last good items (stale). Nothing here logs a
// title, a name, a body or a path: codes and counts only. Timers and the
// GET are injected: the mod reaches the network and the clock through `$`.

import { ARTICLE_ID, BOARD, HOT_URL, parsePttConfig, PTT_LIMITS, PttError, PUSH_FILTERS, REFRESH, TOKEN } from './config.mjs'
import { articleUrl, boardUrl, createQueue, searchUrl } from './client.mjs'
import { boardNameOf, parseArticle, parseBoardPage, parseHotBoards, parseSearchPage } from './parse.mjs'

export const PTT_NAMESPACE = 'ptt'
export const STATUS_KEY = 'status'
export const HOT_KEY = 'hot'
export const WANT_PREFIX = 'want:'
export const boardKey = (board, page = null) => `board:${board}:${page === null ? 'latest' : String(page)}`
export const articleKey = (board, id) => `article:${board}:${id}`
/** A push-count search page's key; page 1 and null are the same page (the newest). */
export const searchKey = (board, push, page = null) => `search:${board}:${push}:${page === null || page === 1 ? 'latest' : String(page)}`
export const lookupKey = (query) => `lookup:${String(query).toLowerCase()}`

const WANT_FIELDS = new Set(['v', 'boards', 'view', 'lookup', 'refreshAt'])
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k))
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const board = (value) => typeof value === 'string' && BOARD.test(value)

function viewOf(view) {
  if (view === null || view === undefined) return null
  if (!isObject(view)) return undefined
  if (view.kind === 'hot' && exactKeys(view, ['kind'])) return { kind: 'hot' }
  // `push` (a push-count filter) may be left out: a build before it sends none.
  if (view.kind === 'board' && (exactKeys(view, ['kind', 'board', 'page']) || exactKeys(view, ['kind', 'board', 'page', 'push'])) && board(view.board)) {
    const push = view.push === undefined || view.push === null ? null : PUSH_FILTERS.includes(view.push) ? view.push : undefined
    if (push === undefined) return undefined
    const page = view.page === null ? null : Number.isSafeInteger(view.page) && view.page >= 1 && view.page <= PTT_LIMITS.pageMax ? view.page : undefined
    if (page === undefined) return undefined
    // A search's page 1 is its newest: the same as no page.
    return { kind: 'board', board: view.board, page: push !== null && page === 1 ? null : page, ...(push !== null ? { push } : {}) }
  }
  if (view.kind === 'article' && exactKeys(view, ['kind', 'board', 'id']) && board(view.board) && typeof view.id === 'string' && ARTICLE_ID.test(view.id)) return { kind: 'article', board: view.board, id: view.id }
  return undefined
}

/**
 * A want as a client wrote it, checked; null when it is not one (the server
 * then refuses the write). v must be 1; boards, view, lookup and refreshAt
 * may be left out (empty / null); nothing else may be there.
 */
export function acceptWant(key, value) {
  if (typeof key !== 'string' || !key.startsWith(WANT_PREFIX) || !TOKEN.test(key.slice(WANT_PREFIX.length))) return null
  if (!isObject(value) || value.v !== 1) return null
  if (Object.keys(value).some((field) => !WANT_FIELDS.has(field))) return null
  const boards = value.boards === undefined ? [] : value.boards
  if (!Array.isArray(boards) || boards.length > PTT_LIMITS.boardsPerWant || !boards.every(board)) return null
  if (new Set(boards.map((b) => b.toLowerCase())).size !== boards.length) return null
  const view = viewOf(value.view)
  if (view === undefined) return null
  const lookup = value.lookup === undefined || value.lookup === null ? null : board(value.lookup) ? value.lookup : undefined
  if (lookup === undefined) return null
  const refreshAt = value.refreshAt === undefined ? null : value.refreshAt
  if (!(refreshAt === null || (Number.isSafeInteger(refreshAt) && refreshAt > 0 && refreshAt < 1e14))) return null
  return { v: 1, boards: [...boards], view, lookup, refreshAt }
}

const encoder = new TextEncoder()
const byteLength = (text) => encoder.encode(text).length
const EMPTY_META = Object.freeze({ author: '', title: '', time: '' })
const WHAT = Object.freeze({ board: 'a board page', article: 'an article', hot: 'the hot boards', lookup: 'a lookup' })

/**
 * An article value under `maxBytes` of JSON: pushes dropped from the end
 * (counted in pushesCut), then the body cut (bodyCut).
 */
export function fitArticle(value, maxBytes = PTT_LIMITS.articleBytes) {
  const size = (v) => byteLength(JSON.stringify(v))
  if (size(value) <= maxBytes) return value
  const room = maxBytes - size({ ...value, pushes: [], pushesCut: value.pushes.length })
  let used = 0
  let kept = 0
  for (const push of value.pushes) {
    const bytes = byteLength(JSON.stringify(push)) + (kept > 0 ? 1 : 0)
    if (used + bytes > room) break
    used += bytes
    kept += 1
  }
  let out = { ...value, pushes: value.pushes.slice(0, kept), pushesCut: value.pushes.length - kept + value.pushesCut }
  for (let over = size(out) - maxBytes; over > 0; over = size(out) - maxBytes) {
    if (out.body.length > 0) {
      let body = out.body.slice(0, Math.max(0, out.body.length - Math.max(1, Math.ceil(over / 3))))
      if (/[\ud800-\udbff]$/.test(body)) body = body.slice(0, -1)
      out = { ...out, body, bodyCut: true }
    } else if (out.pushes.length > 0) out = { ...out, pushes: out.pushes.slice(0, -1), pushesCut: out.pushesCut + 1 }
    else break
  }
  return out
}

/**
 * @param {object} options
 * @param {(key: string, value: unknown) => void} options.publish   null removes the key
 * @param {(message: string, level?: string) => void} [options.log]
 * @param {(url: string, options: object) => Promise<{ status, headers, body }>} options.get   the GET (client.createGetHtml over $.http.fetch; tests: a fake)
 * @param {{ after: (ms: number, fn: () => void) => { cancel(): void }, every: (ms: number, fn: () => void) => { cancel(): void } }} options.timers   $.clock's timers (the mod has no others)
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]   TESTS: the queue's waits
 * @param {object} [options.limits]   TESTS: shorter timings, smaller bounds
 * @param {string} [options.version]   the mod's version, for the user agent
 */
export function createPttService({ publish, log = () => {}, get, timers, now = Date.now, sleep, limits = {}, version = 'unknown' } = {}) {
  const L = { ...PTT_LIMITS, ...limits }
  const userAgent = `ptt-mod/${String(version).replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 32) || 'unknown'} (read-only personal pane)`
  const wait = sleep ?? ((ms) => new Promise((resolve) => timers.after(ms, resolve)))
  let active = false
  let refreshSeconds = REFRESH.defaultSeconds
  let stopped = 0 // bumped by stop(): work from before writes nothing
  let lastErrorCode = null
  let statusText = null
  let poller = null
  let sweeper = null
  const startedAt = now()
  const wants = new Map() // want key -> { want, at }
  // want key -> { refreshAt, actedAt }: the last press seen and when one was last acted on.
  // Kept after a want lapses (bounded), so a session writing its want again replays nothing.
  const seenPresses = new Map()
  const SEEN_MAX = 512
  const entries = new Map() // published key -> { key, kind, url, board, page, id, query, value, running, wantedAt }
  const BOUND = { board: L.boardEntries, article: L.articleEntries, lookup: L.lookupEntries, hot: 1 }
  const queue = createQueue({
    get,
    userAgent,
    now,
    sleep: wait,
    limits: L,
    onBlocked: (until) => {
      if (until !== null) log(`ptt: throttled by the site; holding requests for ${Math.round((until - now()) / 1000)} s`, 'warn')
      writeStatus()
    },
  })

  const put = (key, value) => {
    try {
      publish(key, value)
      return true
    } catch (error) {
      log(`ptt: could not publish ${key.split(':')[0]} (${error?.code ?? 'error'})`, 'warn')
      return false
    }
  }

  // ---- status

  /** Every board some live want polls (as spelled). */
  const watched = () => {
    const out = new Set()
    for (const { want } of wants.values()) for (const b of want.boards) out.add(b)
    return [...out]
  }

  function writeStatus() {
    if (!active) return
    const value = { v: 1, state: 'on', refreshSeconds, boardsWatched: watched().length, wants: wants.size, lastErrorCode, blockedUntil: queue.blockedUntil() }
    const text = JSON.stringify(value)
    if (text === statusText) return
    if (put(STATUS_KEY, value)) statusText = text
  }

  // ---- entries

  function entryFor(kind, key, fields) {
    let entry = entries.get(key)
    if (!entry) {
      const same = [...entries.values()].filter((e) => e.kind === kind)
      if (same.length >= BOUND[kind]) {
        let victim = null
        for (const e of same) if (!e.running && (victim === null || e.wantedAt < victim.wantedAt)) victim = e
        if (victim) {
          entries.delete(victim.key)
          if (victim.value) put(victim.key, null)
        }
      }
      entry = { key, kind, value: null, running: null, wantedAt: now(), ...fields }
      entries.set(key, entry)
    }
    entry.wantedAt = now()
    return entry
  }

  const boardEntry = (name, page, push = null) =>
    push === null ? entryFor('board', boardKey(name, page), { url: boardUrl(name, page), board: name, page, push: null }) : entryFor('board', searchKey(name, push, page), { url: searchUrl(name, push, page), board: name, page, push })
  const articleEntry = (name, id) => entryFor('article', articleKey(name, id), { url: articleUrl(name, id), board: name, id })
  const hotEntry = () => entryFor('hot', HOT_KEY, { url: HOT_URL })
  const lookupEntry = (query) => {
    const q = query.toLowerCase()
    return entryFor('lookup', lookupKey(q), { url: boardUrl(q, null), query: q })
  }

  function emptyValue(entry) {
    const base = { state: 'loading', errorCode: null, stale: false, fetchedAt: null, lastAttempt: null }
    if (entry.kind === 'board') return { v: 1, board: entry.board, page: entry.page === null ? 'latest' : entry.page, ...(entry.push ? { push: entry.push } : {}), index: null, prev: null, next: null, ...base, items: [] }
    if (entry.kind === 'article') return { v: 1, board: entry.board, id: entry.id, ...base, url: entry.url, meta: { ...EMPTY_META }, body: '', bodyCut: false, pushes: [], pushesCut: 0, counts: { up: 0, down: 0, arrow: 0 } }
    if (entry.kind === 'hot') return { v: 1, ...base, items: [] }
    return { v: 1, query: entry.query, state: 'loading', name: null, errorCode: null, checkedAt: null }
  }

  /** The value a good page makes (throws PttError('bad-shape') when the page is not one). */
  function goodValue(entry, html, at) {
    const fresh = { state: 'ready', errorCode: null, stale: false, fetchedAt: at, lastAttempt: at }
    if (entry.kind === 'board') {
      const page = entry.push ? parseSearchPage(html, { page: entry.page }) : parseBoardPage(html, { latest: entry.page === null, page: entry.page })
      return { ...emptyValue(entry), index: page.index, prev: page.prev, next: page.next, ...fresh, items: page.items }
    }
    if (entry.kind === 'article') {
      const article = parseArticle(html)
      return fitArticle({ ...emptyValue(entry), ...fresh, meta: article.meta, body: article.body, bodyCut: article.bodyCut, pushes: article.pushes, pushesCut: 0, counts: article.counts }, L.articleBytes)
    }
    if (entry.kind === 'hot') return { ...emptyValue(entry), ...fresh, items: parseHotBoards(html) }
    const name = boardNameOf(html)
    if (!name) throw new PttError('bad-shape')
    return { v: 1, query: entry.query, state: 'found', name, errorCode: null, checkedAt: at }
  }

  function errorValue(entry, code, at) {
    const before = entry.value
    if (entry.kind === 'lookup') {
      if (code === 'not-found') return { v: 1, query: entry.query, state: 'missing', name: null, errorCode: null, checkedAt: at }
      return { v: 1, query: entry.query, state: 'error', name: null, errorCode: code, checkedAt: at }
    }
    const kept = before && (before.state === 'ready' || (before.state === 'error' && before.stale))
    if (kept) return { ...before, state: 'error', errorCode: code, stale: true, lastAttempt: at }
    return { ...emptyValue(entry), state: 'error', errorCode: code, lastAttempt: at }
  }

  /** A found lookup's page is also the board's latest page. */
  function adoptLookupPage(name, html, at) {
    let page
    try {
      page = parseBoardPage(html, { latest: true })
    } catch {
      return
    }
    const entry = boardEntry(name, null)
    if (entry.running) return
    entry.value = { ...emptyValue(entry), index: page.index, prev: page.prev, next: page.next, state: 'ready', errorCode: null, stale: false, fetchedAt: at, lastAttempt: at, items: page.items }
    put(entry.key, entry.value)
  }

  /** Fetches an entry's page (a fetch already running is the answer). */
  function refetch(entry, priority) {
    if (entry.running) return entry.running
    const mine = stopped
    if (entry.value === null) {
      entry.value = emptyValue(entry)
      put(entry.key, entry.value)
    }
    entry.running = (async () => {
      let html = null
      let failure = null
      try {
        html = await queue.request(entry.url, { priority })
      } catch (error) {
        failure = error
      }
      if (mine !== stopped || entries.get(entry.key) !== entry) return
      const at = now()
      if (failure === null) {
        try {
          entry.value = goodValue(entry, html, at)
          put(entry.key, entry.value)
          lastErrorCode = null
          if (entry.kind === 'lookup') adoptLookupPage(entry.value.name, html, at)
          writeStatus()
          return
        } catch (error) {
          failure = error
        }
      }
      const code = failure instanceof PttError ? failure.code : 'bad-shape'
      if (!(entry.kind === 'lookup' && code === 'not-found')) {
        lastErrorCode = code
        log(`ptt: ${WHAT[entry.kind]} not read (${code})`)
      }
      entry.value = errorValue(entry, code, at)
      put(entry.key, entry.value)
      writeStatus()
    })().finally(() => {
      entry.running = null
    })
    return entry.running
  }

  const ttlOf = (entry) => (entry.kind === 'board' ? (entry.page === null ? L.latestTtlMs : L.pageTtlMs) : entry.kind === 'article' ? L.articleTtlMs : entry.kind === 'hot' ? L.hotTtlMs : L.lookupTtlMs)

  /** Is the entry's value due a fetch (first wanted, or past its TTL)? */
  function due(entry) {
    if (entry.running) return false
    const value = entry.value
    if (value === null || value.state === 'loading') return true
    if (entry.kind === 'lookup') return now() - value.checkedAt >= (value.state === 'error' ? L.lookupRetryMs : L.lookupTtlMs)
    const last = value.state === 'ready' ? value.fetchedAt : value.lastAttempt
    return last === null || now() - last >= ttlOf(entry)
  }

  // ---- wants

  function serveView(view, force) {
    if (view === null) return
    const entry = view.kind === 'board' ? boardEntry(view.board, view.page, view.push ?? null) : view.kind === 'article' ? articleEntry(view.board, view.id) : hotEntry()
    if (force || due(entry)) void refetch(entry, 'high')
  }

  /**
   * Favourites through the queue (after views): each board in `boards` whose
   * latest page is older than maxAgeMs; onlyNew: only boards never read.
   */
  function poll({ boards = watched(), maxAgeMs = refreshSeconds * 1000, onlyNew = false } = {}) {
    if (!active) return
    for (const name of boards) {
      const existing = entries.get(boardKey(name, null))
      if (existing?.running) continue
      const value = existing?.value ?? null
      if (onlyNew && value !== null) continue
      if (value !== null && value.state !== 'loading') {
        const last = value.state === 'ready' ? value.fetchedAt : value.lastAttempt
        if (last !== null && now() - last < maxAgeMs) continue
      }
      void refetch(boardEntry(name, null), 'low')
    }
  }

  function serve(key, want) {
    const baseline = startedAt - 5000
    let seen = seenPresses.get(key)
    if (!seen) {
      seen = { refreshAt: baseline, actedAt: -Infinity }
      if (seenPresses.size >= SEEN_MAX) seenPresses.delete(seenPresses.keys().next().value)
    } else seenPresses.delete(key)
    seenPresses.set(key, seen)
    let pressed = false
    if (want.refreshAt !== null && want.refreshAt > seen.refreshAt) {
      seen.refreshAt = want.refreshAt
      if (now() - seen.actedAt >= L.pressMinMs) {
        seen.actedAt = now()
        pressed = true
      }
    }
    serveView(want.view, pressed)
    // Refresh with no view (the favourites list): this want's boards not read within latestTtlMs.
    if (pressed && want.view === null) poll({ boards: want.boards, maxAgeMs: L.latestTtlMs })
    if (want.lookup !== null) {
      const entry = lookupEntry(want.lookup)
      if (due(entry)) void refetch(entry, 'high')
    }
    poll({ boards: want.boards, onlyNew: true })
  }

  function serveWant(key, want) {
    wants.set(key, { want, at: now() })
    if (!active) return
    serve(key, want)
    writeStatus()
  }

  /** Lapsed wants go, from memory and from shared state (a session gone leaves nothing behind). */
  function sweep() {
    const cutoff = now() - L.wantTtlMs
    const gone = []
    for (const [key, slot] of wants) if (slot.at < cutoff) gone.push(key)
    while (wants.size - gone.length > L.wantsMax) {
      const oldest = [...wants.keys()].find((k) => !gone.includes(k))
      if (!oldest) break
      gone.push(oldest)
    }
    for (const key of gone) {
      wants.delete(key)
      put(key, null)
    }
    if (gone.length > 0) writeStatus()
  }

  function armPoller() {
    poller?.cancel?.()
    const mine = stopped
    poller = timers.after(refreshSeconds * 1000, () => {
      poller = null
      if (mine !== stopped || !active) return
      // A little slack: a board read at the last tick finished a moment after it.
      poll({ maxAgeMs: refreshSeconds * 900 })
      armPoller()
    })
  }

  return Object.freeze({
    /**
     * A session switches the service on (`ptt.configure`, { enabled, refreshSeconds }).
     * The first starts polling and serves the wants already stored; later ones
     * change at most the interval. Off changes nothing (another session may still want it).
     * @returns {{ accepted: true, state: 'off' | 'on' }}
     */
    configure(input) {
      const config = parsePttConfig(input)
      if (!config.enabled) return { accepted: true, state: active ? 'on' : 'off' }
      const changed = config.refreshSeconds !== refreshSeconds
      refreshSeconds = config.refreshSeconds
      if (!active) {
        active = true
        log(`ptt: on, polling favourites every ${refreshSeconds} s`)
        sweeper = timers.every(L.sweepMs, sweep)
        armPoller()
        for (const [key, slot] of wants) serve(key, slot.want)
      } else if (changed) {
        log(`ptt: polling favourites every ${refreshSeconds} s`)
        armPoller()
      }
      writeStatus()
      return { accepted: true, state: 'on' }
    },

    /** A client's want (want:<token>), checked: the value to store, or null to refuse it. */
    acceptWant,
    /** A want the server stored: served. */
    wanted: (key, want) => serveWant(key, want),
    /** TESTS: the wants' sweep, now. */
    sweep,
    /** TESTS: a favourites polling pass, now. */
    poll: () => poll(),

    stop() {
      stopped += 1
      poller?.cancel?.()
      sweeper?.cancel?.()
      poller = null
      sweeper = null
      queue.clear()
      entries.clear()
      wants.clear()
      active = false
      statusText = null
    },

    /** Safe facts only: counts, states and codes, never a name or a title. */
    describe: () => {
      const count = (kind) => [...entries.values()].filter((e) => e.kind === kind).length
      return {
        configured: active,
        refreshSeconds,
        wants: wants.size,
        boardsWatched: watched().length,
        entries: { boards: count('board'), articles: count('article'), lookups: count('lookup'), hot: count('hot') },
        queue: queue.stats(),
        lastErrorCode,
        pollerArmed: poller !== null,
      }
    },
  })
}
