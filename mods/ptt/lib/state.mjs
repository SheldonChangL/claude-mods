// PTT's session-local model (ctx.state, member "ptt"): how one pane looks at
// the service's values, plus a copy of the stored favourites for drawing.
// Never shared. The favourites themselves live in storage (storage.mjs) and
// are copied in on every activation.
//
//   view        'home' | 'board' | 'article' | 'hot' | 'manage'
//   board       the board the board / article view shows, or null
//   page        the board page shown: null for the latest, else its number
//   push        the push-count filter on the board: null (all), or 10 / 30 / 50 / 100
//   article     the article the article view shows (its id), or null
//   from        where Back from the board view goes: 'home' | 'hot'
//   favorites   [{ name, lastSeen }] (a copy of storage; lastSeen in seconds)
//   input       what is typed in Add a board
//   lookup      a board name PTT is being asked about for Add, or null
//   full        the article's body and pushes shown whole (Show more)
//   wantToken   this session's want key (want:<token>); made on first use
//   refreshAt   when Refresh was last pressed (ms), or null
//   wantError   why the last want could not be written: null | 'unreachable' | 'refused' | 'failed',
//               or 'filter': the service refused the push filter and took the want without it
//   focus       key of the control the last action meant to hold the keyboard
//   notice      one line about the last action ('' when none)

import { ARTICLE_ID, BOARD, FAVORITES_MAX, PUSH_FILTERS } from './model.mjs'

export const VIEWS = Object.freeze(['home', 'board', 'article', 'hot', 'manage'])
export const WANT_TOKEN = /^[A-Za-z0-9_-]{8,64}$/

export const INITIAL = Object.freeze({
  view: 'home',
  board: null,
  page: null,
  push: null,
  article: null,
  from: 'home',
  favorites: Object.freeze([]),
  input: '',
  lookup: null,
  full: false,
  wantToken: null,
  refreshAt: null,
  wantError: null,
  focus: null,
  notice: '',
})

const pressAt = (value) => (Number.isSafeInteger(value) && value > 0 && value < 1e14 ? value : null)
const seconds = (value) => (Number.isSafeInteger(value) && value >= 0 && value < 1e11 ? value : 0)

/** Favourites as stored or copied: valid names, no duplicates (any case), at most 30. */
export function normalizeFavorites(list) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(list) ? list : []) {
    const name = typeof raw?.name === 'string' && BOARD.test(raw.name) ? raw.name : null
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, lastSeen: seconds(raw.lastSeen) })
    if (out.length >= FAVORITES_MAX) break
  }
  return out
}

/** The stored model, every field checked (a model from another build reads as the defaults). */
export function normalizeLocal(local) {
  const raw = local && typeof local === 'object' ? local : {}
  const board = typeof raw.board === 'string' && BOARD.test(raw.board) ? raw.board : null
  const article = board && typeof raw.article === 'string' && ARTICLE_ID.test(raw.article) ? raw.article : null
  let view = VIEWS.includes(raw.view) ? raw.view : 'home'
  if (view === 'board' && !board) view = 'home'
  if (view === 'article' && !article) view = board ? 'board' : 'home'
  return {
    view,
    board,
    page: Number.isSafeInteger(raw.page) && raw.page >= 1 && raw.page <= 999999 ? raw.page : null,
    push: board && PUSH_FILTERS.includes(raw.push) ? raw.push : null,
    article,
    from: raw.from === 'hot' ? 'hot' : 'home',
    favorites: normalizeFavorites(raw.favorites),
    input: typeof raw.input === 'string' ? raw.input.slice(0, 40) : '',
    lookup: typeof raw.lookup === 'string' && BOARD.test(raw.lookup) ? raw.lookup : null,
    full: raw.full === true,
    wantToken: typeof raw.wantToken === 'string' && WANT_TOKEN.test(raw.wantToken) ? raw.wantToken : null,
    refreshAt: pressAt(raw.refreshAt),
    wantError: ['unreachable', 'refused', 'failed', 'filter'].includes(raw.wantError) ? raw.wantError : null,
    focus: typeof raw.focus === 'string' && raw.focus.startsWith('ptt-') ? raw.focus.slice(0, 200) : null,
    notice: typeof raw.notice === 'string' ? raw.notice.slice(0, 300) : '',
  }
}

const at = (local, change) => ({ ...normalizeLocal(local), ...change })

export const goHome = (local, focus) => at(local, { view: 'home', board: null, page: null, push: null, article: null, full: false, focus })
export const goHot = (local, focus) => at(local, { view: 'hot', board: null, page: null, push: null, article: null, full: false, notice: '', focus })
export const goManage = (local, focus) => at(local, { view: 'manage', notice: '', focus })
export const openBoard = (local, board, from, focus) => at(local, { view: 'board', board, page: null, push: null, article: null, from: from === 'hot' ? 'hot' : 'home', full: false, notice: '', focus })
/** A push-count filter (or null for all): the newest page of it. */
export const withPush = (local, push, focus) => at(local, { view: 'board', push: PUSH_FILTERS.includes(push) ? push : null, page: null, article: null, full: false, focus })
export const toPage = (local, page, focus) => at(local, { view: 'board', page: page ?? null, article: null, full: false, focus })
export const openArticle = (local, id, focus) => at(local, { view: 'article', article: id, full: false, focus })
export const backToBoard = (local, focus) => at(local, { view: 'board', article: null, full: false, focus })
export const typed = (local, value) => at(local, { input: typeof value === 'string' ? value.slice(0, 40) : '' })
export const withNotice = (local, notice, focus) => at(local, { notice, focus: focus === undefined ? normalizeLocal(local).focus : focus })
export const withFavorites = (local, favorites) => at(local, { favorites: normalizeFavorites(favorites) })
export const toggleFull = (local, focus) => at(local, { full: !normalizeLocal(local).full, focus })
export const pressRefresh = (local, when, focus) => at(local, { refreshAt: pressAt(when) ?? normalizeLocal(local).refreshAt, notice: '', focus })

/** The push filter the board shows: none while the service cannot filter (wantError 'filter'). */
export const pushShown = (local) => (local.wantError === 'filter' ? null : local.push)

/** What this session's want says (the contract's want, without `v`). */
export function wantOf(local) {
  const current = normalizeLocal(local)
  let view = null
  // `push` only when filtered: a service from before the filter refuses a field it does not know.
  if (current.view === 'board' && current.board) view = { kind: 'board', board: current.board, page: current.page, ...(current.push ? { push: current.push } : {}) }
  else if (current.view === 'article' && current.board && current.article) view = { kind: 'article', board: current.board, id: current.article }
  else if (current.view === 'hot') view = { kind: 'hot' }
  return { v: 1, boards: current.favorites.map((favorite) => favorite.name), view, lookup: current.lookup, refreshAt: current.refreshAt }
}
