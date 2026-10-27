// The breakpoint policy, in one place. Features and widgets never compare
// widths themselves: they read `layout.mode` and the gaps it brings.
//
//   compact   bodyColumns < 40   one column of everything, no rules or air
//   normal    40..71             the default sidebar
//   wide      >= 72              room for a row's meta on its title line and
//                                longer previews
//
// The frame (core/frame.mjs) measures; this file decides.
//
// Composition: the same data and widgets, composed per surface. The
// terminal draws its own chrome (a title, `/ptt close`, visible
// hotkeys, upper-case captions); an app surface (Claude Desktop, VS Code,
// mobile) already has a pane title and a close control, and draws a Button's
// `hotkey` as a visible key cap, so it gets none of those. Every surface
// difference is here: widgets read `layout.composition`, features never test
// the surface.

import { BOUNDS, DENSITY } from './tokens.mjs'

export const BREAKPOINTS = Object.freeze({ compact: 40, wide: 72 })

/** @returns {'compact' | 'normal' | 'wide'} */
export function modeFor(columns) {
  if (!(columns >= BREAKPOINTS.compact)) return 'compact'
  return columns >= BREAKPOINTS.wide ? 'wide' : 'normal'
}

export const COMPOSITIONS = Object.freeze({
  terminal: Object.freeze({
    name: 'terminal',
    header: true, // the pane has no title of its own
    closeHint: true, // `/ptt close` (no close control on a terminal pane)
    hotkeys: true, // drawn as `1 Notes`, pressed with 1..9
    captionCase: 'upper', // QUICK NOTE
    badgeStyle: 'bracket', // Notes [2]
    activeTab: 'primary', // the accent colour marks the active tab
    quietSecondary: false, // secondary actions at full strength
    fieldGap: 0,
    headGap: 0,
    linkOpens: 'any', // a terminal opens any link it draws (OSC 8)
  }),
  app: Object.freeze({
    name: 'app',
    header: false, // the app's pane chrome shows the title
    closeHint: false, // and has its own close control
    hotkeys: false, // a hotkey would be drawn as a key cap beside every tab
    captionCase: 'as-is', // Quick note
    badgeStyle: 'plain', // Notes 2
    activeTab: 'plain', // active at full strength, the others dimmed: no heavy pill
    quietSecondary: true, // secondary actions dimmed at rest
    fieldGap: 1,
    headGap: 1,
    // Claude Desktop makes a link only of https: (or http://localhost); any
    // other href is drawn as plain text that looks clickable and is not.
    linkOpens: 'https',
  }),
})

/**
 * Whether a link to `href` opens on this composition's surface. A link that
 * would not open must not be drawn as one: offer another way (copy it).
 */
export function linkOpens(composition, href) {
  if (composition?.linkOpens === 'any') return true
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  } catch {
    return false
  }
}

/** The composition for a surface: the terminal's, or the app one. */
export const compositionFor = (surface) => (surface === 'terminal' || surface === undefined ? COMPOSITIONS.terminal : COMPOSITIONS.app)

/**
 * What a widget needs to lay itself out.
 * @param {import('../frame.mjs').Frame} frame
 */
export function layoutFor(frame) {
  const mode = frame.mode ?? modeFor(frame.bodyColumns)
  const density = mode === 'compact' ? DENSITY.compact : DENSITY.normal
  return Object.freeze({
    mode,
    compact: mode === 'compact',
    wide: mode === 'wide',
    surface: frame.surface ?? 'terminal',
    columns: frame.bodyColumns,
    composition: compositionFor(frame.surface ?? 'terminal'),
    ...density,
    previewChars: BOUNDS.previewChars[mode],
  })
}
