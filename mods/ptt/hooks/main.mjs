// ptt hooks module: THE ONLY FILE THAT TOUCHES `$`.
//
// The engine scans this file before loading it and lists every `$.noun.method`
// it spells. `$` may be handed to a function declared in this file, never to
// one imported from another: so everything the rest of the mod needs from the
// engine is wrapped here into a port of plain closures (makePort) and passed
// down to lib/app.mjs.
//
// What the mod calls, and why:
//   http.fetch       GET www.ptt.cc/bbs pages only (lib/client.mjs checks every URL)
//   state.get/set    the screen shown (session state)
//   store.get/set    your boards (kept across sessions)
//   clock.*          the request gap, timeouts, the new-posts poll
//   ui.*             the pane, focus after an action, ↑ Top, Copy link, a toast, the debug log
//   command.register /ptt

import { update } from 'claude-code'

import { createApp, PANE_ID } from '../lib/app.mjs'
import { PTT_INTERVAL } from '../lib/options.mjs'

// `$.state` references must be literal here and declared in types/index.d.ts.
const LOCAL = { plugin: 'ptt', key: 'local' }

function makePort($) {
  return {
    http: { fetch: (url, init) => $.http.fetch(url, init) },
    state: {
      get: () => $.state.get(LOCAL),
      set: (value) => $.state.set(LOCAL, value),
      update: (fn) => update($, LOCAL, fn),
    },
    store: {
      get: (key) => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
    },
    clock: {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
    },
    ui: {
      open: (args) => $.ui.open(args),
      close: (id) => $.ui.close({ id }),
      panes: () => $.ui.panes(),
      invalidate: () => $.ui.invalidate('ui.render'),
      focus: (key) => $.ui.focus({ requestId: 'ptt', key }),
      scroll: (args) => $.ui.scroll(args),
      copy: (text, surface) => $.ui.copy({ text, surface }),
      toast: (text) => $.ui.toast(text),
    },
    log: (text) => $.ui.log(text, { to: 'debug' }),
  }
}

export function register(on, options) {
  const seconds = Number(options?.refreshSeconds)
  const app = createApp({
    refreshSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(Math.min(Math.max(seconds, PTT_INTERVAL.minSeconds), PTT_INTERVAL.maxSeconds)) : PTT_INTERVAL.defaultSeconds,
    version: '0.1.0',
  })

  on('session.start', async ($, e, next) => {
    // The command is registered by its literal name and matched by the same
    // literal below: the validator then reads the command.run hook as one
    // that answers its own command.
    await $.command.register({ name: 'ptt', description: 'PTT: your boards, new posts, articles (read-only)', argumentHint: '[close]' })
    return next(e)
  })

  on('command.run', { command: 'ptt' }, async ($, e) => app.command(makePort($), e.args ?? ''))

  // The pane, matched on the component and this pane's id. A throw while
  // drawing is answered with a minimal tree built here; the engine would
  // otherwise close the pane.
  on('ui.render', { component: 'Pane', requestId: 'ptt' }, async ($, e, next) => {
    let el
    try {
      el = $.ui.resolve(e)
      const { value } = await $.state.get(LOCAL)
      return app.render(makePort($), el, { surface: e.surface, props: e.props, viewport: e.viewport }, value)
    } catch (error) {
      $.ui.log(`ptt: pane render failed: ${String(error?.message ?? error).slice(0, 300)}`, { to: 'debug' })
      if (el === undefined) return next(e)
      return h(el.Box, { key: 'ptt-error' }, h(el.Text, { color: 'error' }, 'Something went wrong.'))
    }
  })

  on('session.end', async ($, e, next) => {
    await app.end(makePort($), e.reason)
    return next(e)
  })
}

export { PANE_ID }
