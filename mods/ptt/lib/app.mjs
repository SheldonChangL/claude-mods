// The ptt mod's core: what the hooks module (hooks/main.mjs, the only file
// that touches `$`) hands every event to. Pure of `$`: it works through a
// port of plain closures the hooks module builds per dispatch.
//
// Three parts, wired together here:
//   the service (service.mjs)  reads www.ptt.cc through `$.http.fetch`, one
//                              request at a time, and keeps what it read in
//                              this module's memory (`data`)
//   the feature (actions.mjs)  the person's boards, the screen shown, the
//                              actions behind every button; it tells the
//                              service what to read through a "want"
//   the view (view.mjs)        draws the pane from the session state and `data`
//
// Nothing is fetched in a session until /ptt is first run there. The boards
// are kept in the plugin store (`$.store`); the screen shown in session
// state (`$.state`); pages, articles and the hot boards in memory only, so a
// reload or a new session reads them again.

import { createPttFeature } from './actions.mjs'
import { createGetHtml } from './client.mjs'
import { toFrame } from './frame.mjs'
import { badgeOf } from './model.mjs'
import { sanitizeText } from './sanitize.mjs'
import { acceptWant, createPttService } from './service.mjs'
import { INITIAL, normalizeLocal } from './state.mjs'
import { layoutFor } from './ui/layout.mjs'
import { text } from './ui/primitives.mjs'

export const PANE_ID = 'ptt'
export const PANE_TITLE = 'PTT'
export const REPLIES = Object.freeze({
  opened: 'PTT: pane opened.',
  openedUnplaced: 'PTT: pane opened but not shown yet; see the notice.',
  openFailed: 'PTT: could not open the pane.',
  closed: 'PTT: pane closed.',
  notOpen: 'PTT: the pane is not open.',
  usage: 'Usage: /ptt to open the pane, /ptt close to close it.',
})

const clone = (value) => JSON.parse(JSON.stringify(value))

/** What a press hands an action: a string argument as `value`, and the surface pressed from. */
function actionInput(args) {
  const [first, second] = args
  if (typeof first === 'string') return { value: first, surface: second?.surface }
  return { surface: first?.surface }
}

/**
 * @param {object} [options]
 * @param {number} [options.refreshSeconds]   how often the boards are polled for new posts (60..3600)
 * @param {string} [options.version]          for the user agent
 * @param {object} [options.limits]           TESTS: shorter timings for the service
 */
export function createApp({ refreshSeconds = 300, version = 'unknown', limits = {} } = {}) {
  const feature = createPttFeature({ configured: true })
  const data = new Map() // published key -> value (pages, articles, hot boards, lookups, status, wants)
  const subscribers = new Map() // key -> Set<handler>
  const owned = new Set() // timers and subscriptions of the current activation
  let port = null // the newest port: what the service's later work reaches `$` through
  let service = null
  let active = false
  let activating = null
  let chain = Promise.resolve()

  /** One thing at a time: activations and actions never interleave. */
  function serial(task) {
    const run = chain.then(task, task)
    chain = run.catch(() => {})
    return run
  }

  const log = (message, level = 'debug') => {
    try {
      port?.log(sanitizeText(`ptt: ${message}`, { max: 500, singleLine: true }), level)
    } catch {}
  }

  function publish(key, value) {
    if (value === null || value === undefined) data.delete(key)
    else data.set(key, value)
    for (const handler of [...(subscribers.get(key) ?? [])]) {
      try {
        handler(value ?? undefined, { key })
      } catch (error) {
        log(`a subscriber of ${key.split(':')[0]} failed: ${error?.message ?? error}`, 'warn')
      }
    }
    try {
      port?.ui.invalidate()
    } catch {}
  }

  function ensureService() {
    if (service) return service
    service = createPttService({
      publish,
      log: (message) => log(message),
      get: createGetHtml({ fetch: (url, init) => port.http.fetch(url, init), after: (ms, fn) => port.clock.after(ms, fn) }),
      timers: { after: (ms, fn) => port.clock.after(ms, fn), every: (ms, fn) => port.clock.every(ms, fn) },
      limits,
      version,
    })
    service.configure({ enabled: true, refreshSeconds })
    return service
  }

  const track = (handle) => {
    if (handle && typeof handle.cancel === 'function') owned.add(handle)
    return handle
  }

  function release() {
    for (const handle of owned) {
      try {
        handle.cancel()
      } catch {}
    }
    owned.clear()
  }

  /** The feature's context (what actions.mjs, state and storage helpers call), over one port. */
  function ctxFor(p) {
    const say = (level) => (message) => log(String(message), level)
    return {
      log: { debug: say('debug'), info: say('debug'), warn: say('warn'), error: say('error') },
      state: {
        get: async () => {
          const { value } = await p.state.get()
          return value === undefined ? clone(INITIAL) : value
        },
        set: (value) => p.state.set(value),
        update: (fn) => p.state.update((previous) => fn(previous === undefined ? clone(INITIAL) : previous)),
      },
      storage: { get: (key) => p.store.get(key), set: (key, value) => p.store.set(key, value) },
      shared: {
        get: async (key) => data.get(key),
        snapshot: async () => Object.fromEntries(data),
        // Only this session's want: checked as the service's own contract, then served.
        set: async (key, value) => {
          if (typeof key !== 'string' || !key.startsWith('want:')) return
          const want = acceptWant(key, value)
          if (!want) throw Object.assign(new Error('not a ptt want'), { code: 'invalid_value' })
          data.set(key, want)
          ensureService().wanted(key, want)
        },
        subscribe: (key, handler) => {
          if (!subscribers.has(key)) subscribers.set(key, new Set())
          const entry = (value) => handler(value)
          subscribers.get(key).add(entry)
          const off = { cancel: () => subscribers.get(key)?.delete(entry) }
          owned.add(off)
          return () => {
            off.cancel()
            owned.delete(off)
          }
        },
      },
      clock: {
        now: () => p.clock.now(),
        after: (ms, fn) => track(p.clock.after(ms, fn)),
        every: (ms, fn) => track(p.clock.every(ms, fn)),
      },
      ui: {
        scrollTop: async () => {
          try {
            await p.ui.scroll({ in: PANE_ID, to: 'start' })
          } catch {}
        },
        focus: async (key) => {
          try {
            const moved = await p.ui.focus(key)
            return !moved?.deny
          } catch {
            return false
          }
        },
        copy: async (value, surface) => {
          try {
            const answer = await p.ui.copy(sanitizeText(value, { max: 2048, singleLine: true }), surface)
            return { isCopied: answer?.isCopied === true }
          } catch {
            return { isCopied: false }
          }
        },
        toast: (value) => {
          try {
            p.ui.toast(sanitizeText(value, { max: 300, singleLine: true }))
          } catch {}
        },
      },
    }
  }

  /** The pane is shown: read the boards, start the service, tell it what to read. Again after /clear. */
  function activate(p) {
    port = p
    if (active) return Promise.resolve()
    activating ??= serial(async () => {
      release()
      ensureService()
      try {
        await feature.activate(ctxFor(p))
        active = true
      } catch (error) {
        log(`activate failed: ${error?.message ?? error}`, 'error')
      }
    }).finally(() => {
      activating = null
    })
    return activating
  }

  function runAction(p, name, input) {
    port = p
    const handler = feature.actions[name]
    if (typeof handler !== 'function') return Promise.resolve()
    return serial(async () => {
      if (!active) await feature.activate(ctxFor(p)).then(() => (active = true), () => {})
      try {
        await handler(ctxFor(p), input)
      } catch (error) {
        log(`action ${name} failed: ${error?.message ?? error}`, 'error')
      }
    })
  }

  const actionsFor = (p) => Object.freeze(Object.fromEntries(Object.keys(feature.actions).map((name) => [name, (...args) => void runAction(p, name, actionInput(args))])))

  return {
    /** For tests and diagnostics. */
    get data() {
      return data
    },
    get service() {
      return service
    },
    get isActive() {
      return active
    },
    idle: () => serial(() => {}),

    /** /ptt and /ptt close. */
    async command(p, args) {
      port = p
      const word = String(args ?? '').trim().toLowerCase()
      if (word === 'close') {
        try {
          const panes = await p.ui.panes()
          if (!panes.some((pane) => pane.id === PANE_ID)) return { text: REPLIES.notOpen }
          await p.ui.close(PANE_ID)
          return { text: REPLIES.closed }
        } catch {
          return { text: REPLIES.openFailed }
        }
      }
      if (word !== '' && word !== 'open') return { text: REPLIES.usage }
      await activate(p)
      try {
        const opened = await p.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true })
        if (opened && opened.isPlaced === false) {
          p.ui.toast(sanitizeText(`PTT: the pane is open but not shown. ${opened.reason ?? ''}`, { max: 300, singleLine: true }).trim())
          return { text: REPLIES.openedUnplaced }
        }
        return { text: REPLIES.opened }
      } catch (error) {
        log(`ui.open failed: ${error?.message ?? error}`, 'error')
        return { text: REPLIES.openFailed }
      }
    },

    /**
     * Draws the pane: synchronous over what the hook read (`local`, the
     * session state) and this module's `data`. A pane drawn before the
     * activation (a reload, /clear) starts it from a timer, outside the draw.
     */
    render(p, el, event, local) {
      port = p
      if (!active && !activating) {
        try {
          p.clock.after(0, () => void activate(p).then(() => p.ui.invalidate()))
        } catch {}
      }
      const frame = toFrame(event)
      const layout = layoutFor(frame)
      const stored = local === undefined ? clone(INITIAL) : local
      const shared = Object.fromEntries(data)
      const body = feature.render({ local: stored, shared }, el, frame, actionsFor(p))
      if (!layout.composition.header) return body
      // The terminal: its pane has no title of its own, nor a close control.
      const fresh = badgeOf(normalizeLocal(stored).favorites, shared)
      return h(
        el.Box,
        { key: 'ptt-pane', flexDirection: 'column', rowGap: 1 },
        h(el.Box, { key: 'ptt-pane-title' }, text(el, 'title', fresh ? `PTT  ${fresh} new` : 'PTT')),
        body,
        h(el.Box, { key: 'ptt-pane-close' }, text(el, 'muted', '/ptt close')),
      )
    },

    /** Session end: a /clear resets the session state (the next draw activates again); any other ends everything. */
    async end(p, reason) {
      port = p
      if (reason === 'clear') {
        active = false
        return
      }
      await serial(async () => {
        try {
          await feature.dispose(ctxFor(p), reason)
        } catch {}
        release()
        service?.stop()
        service = null
        data.clear()
        active = false
      })
    },
  }
}
