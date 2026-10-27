// The smallest pieces every widget here is built from. Pure: element table
// in, element out; no `$`, no state, no storage, no timers, no logging.
// Text never carries a key or layout props (the engine drops them); a Box
// around it does.

import { sanitizeText } from '../sanitize.mjs'
import { TEXT } from './tokens.mjs'

/** A Text in a role (tokens.TEXT): `text(el, 'muted', '2 notes')`. */
export function text(el, role, content, extra = {}) {
  return h(el.Text, { ...(TEXT[role] ?? TEXT.body), ...extra }, content)
}

/**
 * User text for one line: sanitized (no terminal control, one line) and cut
 * to at most `max` characters, ending in `…` when cut. Deterministic: the
 * same input always gives the same output.
 */
export function clip(value, max) {
  const clean = sanitizeText(value ?? '', { max: Math.max(max * 4, 64), singleLine: true }).trim()
  const chars = Array.from(clean)
  if (chars.length <= max) return clean
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/** A column of children with a gap. */
export function stack(el, key, gap, ...children) {
  return h(el.Box, { key, flexDirection: 'column', ...(gap ? { rowGap: gap } : {}) }, ...children)
}

/** A row of children that wraps when narrow. */
export function inline(el, key, gap, ...children) {
  return h(el.Box, { key, flexDirection: 'row', flexWrap: 'wrap', ...(gap ? { columnGap: gap } : {}) }, ...children)
}

/**
 * A Button in a role: `primary` (the one thing to do), `secondary` (the
 * default look), `quiet` (dimmed: destructive or rare). With a layout, its
 * composition decides the rest: on an app surface secondary actions are
 * dimmed at rest too (only the primary stands out) and no hotkey is set (the
 * app would draw it as a visible key cap). A hotkey is opt-in: only a layout
 * whose composition has hotkeys (the terminal) sets one, so a call without a
 * layout never puts a key cap on Desktop.
 */
export function action(el, { key, label, onPress, kind = 'secondary', hotkey, autoFocus = false }, layout = null) {
  const composition = layout?.composition
  const props = { key, label, onPress }
  if (kind === 'primary') props.variant = 'primary'
  if (kind === 'quiet' || (kind === 'secondary' && composition?.quietSecondary)) props.dimColor = true
  if (hotkey && composition?.hotkeys === true) props.hotkey = hotkey
  // Where the ring starts when the site takes the keyboard (one per site).
  if (autoFocus) props.autoFocus = true
  return h(el.Button, props)
}

/**
 * Icons by meaning, as text every surface draws. A surface with Svg may draw
 * real ones later; nothing here depends on that.
 */
export const ICONS = Object.freeze({
  notes: 'N',
  connected: '●',
  warning: '!',
  error: '×',
  success: '✓',
  loading: '…',
  more: '…',
})

export const icon = (name) => ICONS[name] ?? ''
