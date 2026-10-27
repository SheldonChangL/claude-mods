// What the pane reads of the service's values (the contract is at the top of
// service.mjs) and
// the rules for new posts. Pure. Every value is checked again here, field by
// field: one from another build, or a bad write, reads as missing, never as
// a crash. The feature never reaches the network.

export const BOARD = /^[A-Za-z0-9_-]{1,12}$/
export const ARTICLE_ID = /^M\.(\d{9,11})\.A\.[0-9A-F]{3}$/
export const FAVORITES_MAX = 30
/** The push-count filters a board offers: PTT's own search, `recommend:<n>` (100 is 爆). */
export const PUSH_FILTERS = Object.freeze([10, 30, 50, 100])

export const STATUS_KEY = 'status'
export const HOT_KEY = 'hot'
export const wantKey = (token) => `want:${token}`
export const lookupKey = (query) => `lookup:${String(query).toLowerCase()}`
export const boardKey = (board, page) => `board:${board}:${page === null || page === undefined ? 'latest' : page}`
export const articleKey = (board, id) => `article:${board}:${id}`
/** A push-count search page: page 1 and none are the same page (the newest). */
export const searchKey = (board, push, page) => `search:${board}:${push}:${page === null || page === undefined || page === 1 ? 'latest' : page}`
export const articleUrl = (board, id) => `https://www.ptt.cc/bbs/${board}/${id}.html`

const STATES = new Set(['loading', 'ready', 'error'])
const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
const ms = (value) => (Number.isFinite(value) && value > 0 ? value : null)
const page = (value) => (Number.isSafeInteger(value) && value >= 1 && value <= 999999 ? value : null)
const code = (value) => (typeof value === 'string' && value !== '' ? value.slice(0, 40) : null)

/** The post time of an article id (`M.<seconds>.A.<hex>`), in seconds; null when it is not one. */
export function postedAt(id) {
  const match = typeof id === 'string' ? ARTICLE_ID.exec(id) : null
  return match ? Number(match[1]) : null
}

function itemOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && ARTICLE_ID.test(raw.id) ? raw.id : null
  const deleted = raw.deleted === true || id === null
  return { id, title: str(raw.title, 200), author: str(raw.author, 40), date: str(raw.date, 8).trim(), push: str(raw.push, 4).trim(), mark: str(raw.mark, 4).trim(), deleted, pinned: raw.pinned === true }
}

/** The common head of a fetched value: state, error, staleness, times. */
function headOf(raw) {
  return { state: STATES.has(raw.state) ? raw.state : 'error', errorCode: code(raw.errorCode), stale: raw.stale === true, fetchedAt: ms(raw.fetchedAt), lastAttempt: ms(raw.lastAttempt) }
}

/** One board page (or, with `push`, one page of its push-count search), checked; null when there is none (yet). */
export function boardOf(shared, board, pageNumber = null, push = null) {
  const raw = shared?.[push ? searchKey(board, push, pageNumber) : boardKey(board, pageNumber)]
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  const items = (Array.isArray(raw.items) ? raw.items.slice(0, 40) : []).map(itemOf).filter(Boolean)
  return { ...headOf(raw), board: str(raw.board, 12) || board, index: page(raw.index), prev: page(raw.prev), next: page(raw.next), items }
}

/** One article, checked; null when there is none (yet). */
export function articleOf(shared, board, id) {
  const raw = shared?.[articleKey(board, id)]
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  const counts = raw.counts && typeof raw.counts === 'object' ? raw.counts : {}
  const n = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0)
  const pushes = (Array.isArray(raw.pushes) ? raw.pushes.slice(0, 500) : [])
    .filter((push) => push && typeof push === 'object')
    .map((push) => ({ tag: ['推', '噓', '→'].includes(push.tag) ? push.tag : '→', user: str(push.user, 40), text: str(push.text, 200), time: str(push.time, 20).trim() }))
  return {
    ...headOf(raw),
    board,
    id,
    url: articleUrl(board, id),
    meta: { author: str(meta.author, 120), title: str(meta.title, 200), time: str(meta.time, 40) },
    body: str(raw.body, 24000),
    bodyCut: raw.bodyCut === true,
    pushes,
    pushesCut: n(raw.pushesCut),
    counts: { up: n(counts.up), down: n(counts.down), arrow: n(counts.arrow) },
  }
}

/** The hot boards list, checked; null when there is none (yet). */
export function hotOf(shared) {
  const raw = shared?.[HOT_KEY]
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  const items = (Array.isArray(raw.items) ? raw.items.slice(0, 150) : [])
    .filter((item) => item && typeof item === 'object' && typeof item.name === 'string' && BOARD.test(item.name))
    .map((item) => ({ name: item.name, users: Number.isSafeInteger(item.users) && item.users >= 0 ? item.users : null, category: str(item.category, 20), title: str(item.title, 120) }))
  return { ...headOf(raw), items }
}

/** A lookup's answer, checked: { state: 'loading' | 'found' | 'missing' | 'error', name, errorCode } or null. */
export function lookupOf(shared, query) {
  const raw = shared?.[lookupKey(query)]
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  const state = ['loading', 'found', 'missing', 'error'].includes(raw.state) ? raw.state : 'error'
  const name = typeof raw.name === 'string' && BOARD.test(raw.name) ? raw.name : null
  if (state === 'found' && name === null) return { state: 'error', name: null, errorCode: 'bad-shape' }
  return { state, name, errorCode: code(raw.errorCode) }
}

/** The service's status value, checked (for the pane's notes); null when none. */
export function statusOf(shared) {
  const raw = shared?.[STATUS_KEY]
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  return { state: raw.state === 'on' ? 'on' : 'off', lastErrorCode: code(raw.lastErrorCode), blockedUntil: ms(raw.blockedUntil) }
}

/** Posts on a board page, newest first: the pinned ones last, deleted rows where they were. */
export function newestFirst(items) {
  const listed = items.filter((item) => !item.pinned).reverse()
  return [...listed, ...items.filter((item) => item.pinned)]
}

/** The newest post time on a page (pinned rows aside), in seconds; null when none. */
export function newestPostedAt(page) {
  let newest = null
  for (const item of page?.items ?? []) {
    if (item.pinned) continue
    const at = postedAt(item.id)
    if (at !== null && (newest === null || at > newest)) newest = at
  }
  return newest
}

/**
 * New posts on a board since `lastSeen` (seconds): { count, more } where
 * `more` says every post on the latest page is new (there may be more), or
 * null when the latest page is not known yet.
 */
export function newPosts(shared, favorite) {
  const latest = boardOf(shared, favorite.name, null)
  if (!latest || latest.items.length === 0) return null
  const posts = latest.items.filter((item) => !item.pinned && postedAt(item.id) !== null)
  const fresh = posts.filter((item) => postedAt(item.id) > favorite.lastSeen)
  return { count: fresh.length, more: fresh.length > 0 && fresh.length === posts.length }
}

/** The tab badge: new posts across the favourites; none when there are none. */
export function badgeOf(favorites, shared) {
  let total = 0
  for (const favorite of favorites ?? []) total += newPosts(shared, favorite)?.count ?? 0
  return total > 0 ? total : undefined
}
