// The PTT pane's behaviour: your boards, how many posts are new on each, a
// board's posts page by page (or filtered by push count), an article with
// its pushes, and PTT's hot boards. Read-only: no account, no login, nothing
// is ever posted, pushed or sent to PTT.
//
// This part never reaches the network: the service (service.mjs) reads the
// pages, one request at a time, and publishes them; this part reads them
// (ctx.shared) and draws them. It tells the service what to read through a
// want (`want:<token>`: your boards, the screen shown, a board name to
// check, when Refresh was pressed). lib/app.mjs supplies the ctx.
//
// Your boards are your own list, in the plugin store (storage.mjs): every
// session shares it. Adding a board by name asks PTT whether it has it and
// how it is spelt (soft_job -> Soft_Job); adding one from the hot boards
// needs no check. A board's posts newer than when it was last opened count
// as new.

import { BOARD, FAVORITES_MAX, PUSH_FILTERS, badgeOf, boardOf, lookupOf, lookupKey, newestPostedAt, wantKey } from './model.mjs'
import { backToBoard, goHome, goHot, goManage, INITIAL, normalizeLocal, openArticle, openBoard, pressRefresh, pushShown, toggleFull, toPage, typed, WANT_TOKEN, wantOf, withFavorites, withNotice, withPush } from './state.mjs'
import { changeFavorites, hasBoard, moved, readFavorites } from './storage.mjs'
import { PTT_KEYS, PTT_TEXT, renderPtt } from './view.mjs'

/** How long Add waits for PTT to answer a board name check. */
export const LOOKUP_WAIT_MS = 15000
/** The want is written again this often while the pane is in use (the service lets a want lapse after 2 hours). */
export const WANT_REFRESH_MS = 10 * 60 * 1000

export const ADD_TEXT = Object.freeze({
  invalid: 'Board names are letters, digits, _ or -, at most 12 characters.',
  already: (name) => `${name} is already in your boards.`,
  full: `At most ${FAVORITES_MAX} boards: remove one first.`,
  missing: (name) => `PTT has no board named ${name}.`,
  failed: (code) => `Could not check the board right now (${code}). Try again.`,
  slow: 'PTT did not answer in time. Try again.',
  added: (name) => `Added ${name}.`,
  saveFailed: 'Could not save your boards.',
})

/** A new want token: random (crypto where there is one). */
function newWantToken(random = Math.random) {
  let tail = ''
  try {
    tail = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? ''
  } catch {}
  while (tail.length < 24) tail += Math.floor(random() * 36 ** 6).toString(36)
  return `p${tail.slice(0, 24)}`
}

/** Tells the service what this pane reads. A refused or unreachable write is kept for the pane to say, never thrown. */
async function syncWant(ctx) {
  let local = normalizeLocal(await ctx.state.get())
  if (!local.wantToken || !WANT_TOKEN.test(local.wantToken)) {
    const token = newWantToken()
    await ctx.state.update((state) => ({ ...normalizeLocal(state), wantToken: normalizeLocal(state).wantToken ?? token }))
    local = normalizeLocal(await ctx.state.get())
  }
  let wantError = null
  const want = wantOf(local)
  try {
    await ctx.shared.set(wantKey(local.wantToken), want)
  } catch (error) {
    wantError = error?.name === 'SharedUnavailableError' ? 'unreachable' : error?.code === 'invalid_params' || error?.code === 'invalid_value' ? 'refused' : 'failed'
    // A service that cannot filter refuses a want that names one:
    // ask it for the board unfiltered, and say why. The next write (every
    // change, every activation, every 10 minutes) tries the filter again.
    if (wantError === 'refused' && want.view?.push) {
      const { push: _push, ...view } = want.view
      try {
        await ctx.shared.set(wantKey(local.wantToken), { ...want, view })
        wantError = 'filter'
      } catch {}
    }
    ctx.log.warn(`want: not written as asked (${wantError}${error?.code ? `, ${String(error.code).slice(0, 30)}` : ''})`)
  }
  if (wantError !== local.wantError) await ctx.state.update((state) => ({ ...normalizeLocal(state), wantError }))
}

/** Copies the stored favourites into the local model. */
async function refreshFavorites(ctx) {
  const favorites = await readFavorites(ctx)
  await ctx.state.update((local) => withFavorites(local, favorites))
  return favorites
}

/** Writes the local model with its focus target, then asks for that focus. */
async function move(ctx, change, focus) {
  await ctx.state.update((local) => change(local, focus))
  if (focus) await ctx.ui.focus(focus)
}

/** A storage change; a refused write becomes the notice under Add a board. */
async function saveFavorites(ctx, change) {
  try {
    const favorites = await changeFavorites(ctx, change)
    await ctx.state.update((local) => withFavorites(local, favorites))
    return favorites
  } catch (error) {
    ctx.log.warn(`favorites not saved: ${String(error?.message ?? error).slice(0, 80)}`)
    await ctx.state.update((local) => withNotice(local, ADD_TEXT.saveFailed))
    return null
  }
}

/** Marks a favourite seen up to the newest post its latest page shows (else now). */
async function markSeen(ctx, name) {
  const local = normalizeLocal(await ctx.state.get())
  if (!hasBoard(local.favorites, name)) return
  const newest = newestPostedAt(boardOf(await ctx.shared.snapshot(), name, null))
  const seenAt = newest ?? Math.floor((await ctx.clock.now()) / 1000)
  const current = local.favorites.find((favorite) => favorite.name.toLowerCase() === name.toLowerCase())
  if (current && current.lastSeen >= seenAt) return
  await saveFavorites(ctx, (list) => list.map((favorite) => (favorite.name.toLowerCase() === name.toLowerCase() ? { ...favorite, lastSeen: Math.max(favorite.lastSeen, seenAt) } : favorite)))
}

/** Adds a board PTT has confirmed (its real spelling), seen from now. */
async function addConfirmed(ctx, name) {
  const now = Math.floor((await ctx.clock.now()) / 1000)
  const saved = await saveFavorites(ctx, (list) => (hasBoard(list, name) || list.length >= FAVORITES_MAX ? list : [...list, { name, lastSeen: now }]))
  return saved !== null && hasBoard(saved, name)
}

/**
 * PTT's answer to a check, applied once: saved under PTT's spelling,
 * or the reason not, under Add a board. A check this session no longer runs
 * (another was started, or the tab was left and came back) is ignored.
 */
async function finishLookup(ctx, name, answer) {
  if (normalizeLocal(await ctx.state.get()).lookup !== name) return
  let notice
  let added = false
  if (!answer) notice = ADD_TEXT.slow
  else if (answer.state === 'missing') notice = ADD_TEXT.missing(name)
  else if (answer.state === 'error') notice = ADD_TEXT.failed(answer.errorCode ?? 'error')
  else if (hasBoard(normalizeLocal(await ctx.state.get()).favorites, answer.name)) notice = ADD_TEXT.already(answer.name)
  else {
    added = await addConfirmed(ctx, answer.name)
    notice = added ? ADD_TEXT.added(answer.name) : ADD_TEXT.saveFailed
  }
  await ctx.state.update((state) => ({ ...normalizeLocal(state), lookup: null, input: added ? '' : normalizeLocal(state).input, notice, focus: PTT_KEYS.addInput }))
  await syncWant(ctx)
  await ctx.ui.focus(PTT_KEYS.addInput)
}

/**
 * Add a board by name: checked here, then with PTT through the service (the
 * want's `lookup`), then saved. The action does not wait for PTT: the answer
 * arrives through a subscription to `lookup:<name>`, or a timer gives up
 * after LOOKUP_WAIT_MS. Both are the feature's own, so leaving the tab
 * cancels them (and activate clears the check), never leaving an action
 * waiting on a timer that will not fire.
 */
async function addByName(ctx, typedName) {
  const name = String(typedName ?? '').trim()
  const local = normalizeLocal(await ctx.state.get())
  if (local.lookup) return // a check is running
  if (!BOARD.test(name)) return move(ctx, (state, focus) => withNotice(state, ADD_TEXT.invalid, focus), PTT_KEYS.addInput)
  if (hasBoard(local.favorites, name)) return move(ctx, (state, focus) => withNotice(state, ADD_TEXT.already(local.favorites.find((f) => f.name.toLowerCase() === name.toLowerCase()).name), focus), PTT_KEYS.addInput)
  if (local.favorites.length >= FAVORITES_MAX) return move(ctx, (state, focus) => withNotice(state, ADD_TEXT.full, focus), PTT_KEYS.addInput)
  await ctx.state.update((state) => ({ ...normalizeLocal(state), lookup: name, notice: '' }))
  await syncWant(ctx)
  const key = lookupKey(name)
  let settled = false
  let unsubscribe = () => {}
  let timer = null
  const settle = (answer) => {
    if (settled) return
    settled = true
    unsubscribe()
    timer?.cancel?.()
    finishLookup(ctx, name, answer).catch((error) => ctx.log.warn(`lookup not applied: ${String(error?.message ?? error).slice(0, 80)}`))
  }
  unsubscribe = ctx.shared.subscribe(key, (value) => {
    const answer = lookupOf({ [key]: value }, name)
    if (answer && answer.state !== 'loading') settle(answer)
  })
  timer = ctx.clock.after(LOOKUP_WAIT_MS, () => settle(null))
  // An answer PTT gave earlier (found or missing, kept an hour) is final now.
  // An earlier error is not: the service asks PTT again for this check.
  const known = lookupOf({ [key]: await ctx.shared.get(key) }, name)
  if (known && (known.state === 'found' || known.state === 'missing')) settle(known)
}

/**
 * @param {{ configured?: boolean }} [options]   configured: the switch is on
 */
export function createPttFeature({ configured = false } = {}) {
  const view = Object.freeze({ configured: configured === true })
  return Object.freeze({
    id: 'ptt',
    title: 'PTT',
    icon: 'P',
    order: 60,
    capabilities: view.configured ? ['state', 'storage', 'shared', 'ui', 'clock'] : ['state', 'ui'],
    initialState: INITIAL,

    init: (ctx) => ctx.log.debug(`init (${view.configured ? 'on' : 'off'})`),
    // Every activation reads the favourites again (another session may have
    // changed them) and writes the want (a reload, /clear, a new session, a
    // restart): the service then knows what this pane reads.
    activate: async (ctx) => {
      ctx.log.debug('activate')
      if (!view.configured) return
      // A check left running by a reload or /clear is over.
      await ctx.state.update((state) => ({ ...normalizeLocal(state), lookup: null }))
      await refreshFavorites(ctx)
      await syncWant(ctx)
      ctx.clock.every(WANT_REFRESH_MS, () => syncWant(ctx))
    },
    // lib/app.mjs cancels the keep-alive timer with the pane's other timers.
    deactivate: (ctx) => ctx.log.debug('deactivate'),
    // The session ends: its want names nothing (the service stops polling for it). Best effort.
    dispose: async (ctx, reason) => {
      ctx.log.debug(`dispose (${reason})`)
      if (!view.configured) return
      try {
        const local = normalizeLocal(await ctx.state.get())
        if (local.wantToken) await ctx.shared.set(wantKey(local.wantToken), { v: 1, boards: [], view: null, lookup: null, refreshAt: local.refreshAt })
      } catch {}
    },

    actions: Object.freeze({
      typed: (ctx, { value }) => ctx.state.update((local) => typed(local, value)),
      addFromInput: async (ctx, { value }) => {
        await ctx.state.update((local) => typed(local, value))
        await addByName(ctx, value)
      },
      // Hot boards and a board's own Add: the name is PTT's own spelling already.
      addHot: async (ctx, { value }) => {
        const name = String(value ?? '')
        if (!BOARD.test(name)) return
        const local = normalizeLocal(await ctx.state.get())
        if (local.favorites.length >= FAVORITES_MAX) return move(ctx, (state, focus) => withNotice(state, ADD_TEXT.full, focus), PTT_KEYS.back)
        await addConfirmed(ctx, name)
        await syncWant(ctx)
        await ctx.ui.focus(PTT_KEYS.hotOpen(name))
      },
      addThis: async (ctx) => {
        const local = normalizeLocal(await ctx.state.get())
        if (!local.board) return
        await addConfirmed(ctx, local.board)
        await syncWant(ctx)
        await ctx.ui.focus(PTT_KEYS.back)
      },

      openBoard: async (ctx, { value }) => {
        const name = String(value ?? '')
        if (!BOARD.test(name)) return
        await markSeen(ctx, name)
        await move(ctx, (local, focus) => openBoard(local, name, 'home', focus), PTT_KEYS.back)
        await syncWant(ctx)
      },
      openHot: async (ctx, { value }) => {
        const name = String(value ?? '')
        if (!BOARD.test(name)) return
        await move(ctx, (local, focus) => openBoard(local, name, 'hot', focus), PTT_KEYS.back)
        await syncWant(ctx)
      },
      openArticle: async (ctx, { value }) => {
        const id = String(value ?? '')
        await move(ctx, (local, focus) => openArticle(local, id, focus), PTT_KEYS.back)
        await syncWant(ctx)
      },
      older: async (ctx) => {
        const local = normalizeLocal(await ctx.state.get())
        const page = boardOf(await ctx.shared.snapshot(), local.board, local.page, pushShown(local))?.prev ?? null
        if (local.view !== 'board' || page === null) return
        await move(ctx, (state, focus) => toPage(state, page, focus), PTT_KEYS.older)
        await syncWant(ctx)
      },
      newer: async (ctx) => {
        const local = normalizeLocal(await ctx.state.get())
        if (local.view !== 'board' || local.page === null) return
        // The page after this one; past the last numbered page, the latest.
        const found = boardOf(await ctx.shared.snapshot(), local.board, local.page, pushShown(local))?.next ?? null
        // A search's page 1 is its newest: shown as none.
        const next = pushShown(local) && found === 1 ? null : found
        await move(ctx, (state, focus) => toPage(state, next, focus), next === null ? PTT_KEYS.back : PTT_KEYS.newer)
        await syncWant(ctx)
      },
      // Back: article -> its board; board -> where it was opened from; hot -> home.
      back: async (ctx) => {
        const local = normalizeLocal(await ctx.state.get())
        if (local.view === 'article') await move(ctx, backToBoard, local.article ? PTT_KEYS.openPost(local.article) : PTT_KEYS.back)
        else if (local.view === 'board') {
          if (local.board) await markSeen(ctx, local.board)
          if (local.from === 'hot') await move(ctx, goHot, local.board ? PTT_KEYS.hotOpen(local.board) : PTT_KEYS.back)
          else await move(ctx, goHome, local.board && hasBoard(local.favorites, local.board) ? PTT_KEYS.openFavorite(local.favorites.find((f) => f.name.toLowerCase() === local.board.toLowerCase()).name) : PTT_KEYS.addInput)
        } else await move(ctx, goHome, PTT_KEYS.hot)
        await syncWant(ctx)
      },
      home: async (ctx) => {
        await move(ctx, goHome, PTT_KEYS.manage)
        await syncWant(ctx)
      },
      hot: async (ctx) => {
        await move(ctx, goHot, PTT_KEYS.back)
        await syncWant(ctx)
      },
      manage: (ctx) => move(ctx, goManage, PTT_KEYS.done),
      moveUp: async (ctx, { value }) => {
        await saveFavorites(ctx, (list) => moved(list, String(value ?? ''), -1))
        await ctx.ui.focus(PTT_KEYS.up(String(value ?? '')))
      },
      moveDown: async (ctx, { value }) => {
        await saveFavorites(ctx, (list) => moved(list, String(value ?? ''), 1))
        await ctx.ui.focus(PTT_KEYS.down(String(value ?? '')))
      },
      remove: async (ctx, { value }) => {
        await saveFavorites(ctx, (list) => list.filter((favorite) => favorite.name !== String(value ?? '')))
        await ctx.ui.focus(PTT_KEYS.done)
        await syncWant(ctx)
      },
      refresh: async (ctx) => {
        const at = await ctx.clock.now()
        await move(ctx, (local, focus) => pressRefresh(local, at, focus), PTT_KEYS.refresh)
        await syncWant(ctx)
      },
      toggleFull: (ctx) => move(ctx, toggleFull, PTT_KEYS.more),
      // The push-count filter: 'all' or 10 / 30 / 50 / 100; the newest page of it.
      filterPush: async (ctx, { value }) => {
        const local = normalizeLocal(await ctx.state.get())
        if (local.view !== 'board' || !local.board) return
        const push = PUSH_FILTERS.find((n) => String(n) === String(value)) ?? null
        if (push === local.push && local.page === null) return
        await move(ctx, (state, focus) => withPush(state, push, focus), PTT_KEYS.filter(push))
        await syncWant(ctx)
      },
      // The article's ptt.cc address on the clipboard: the way out where a Link cannot open.
      copyLink: async (ctx, { surface }) => {
        const local = normalizeLocal(await ctx.state.get())
        if (local.view !== 'article' || !local.board || !local.article) return
        const { isCopied } = await ctx.ui.copy(`https://www.ptt.cc/bbs/${local.board}/${local.article}.html`, surface)
        ctx.ui.toast(isCopied ? PTT_TEXT.linkCopied : PTT_TEXT.copyFailed)
      },
    }),

    render: (model, el, frame, actions) => renderPtt(model, el, frame, actions, view),
    badge: ({ local, shared } = {}) => (view.configured ? badgeOf(normalizeLocal(local).favorites, shared) : undefined),
  })
}
