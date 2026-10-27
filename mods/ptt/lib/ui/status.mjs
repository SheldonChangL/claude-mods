// Status lines: a state the person should know about (reconnecting,
// unavailable, error, done, loading). Normal states draw an empty line.
//
// The Status Box is always present and only its text changes: on a terminal
// a pane whose tree changes shape loses the keyboard, and a status comes and
// goes with no key press.

import { text } from './primitives.mjs'
import { LOADING_TEXT } from './tokens.mjs'

const ROLE = Object.freeze({
  reconnecting: 'warning',
  unavailable: 'warning',
  incompatible: 'danger',
  error: 'danger',
  success: 'success',
  loading: 'muted',
})

/** @param {{ key: string, kind?: string | null, text?: string }} status */
export function Status(el, layout, { key, kind = null, text: message = '' }) {
  const shown = kind && message ? message : ''
  return h(el.Box, { key, flexShrink: 1 }, text(el, ROLE[kind] ?? 'muted', shown, { wrap: 'truncate-end' }))
}

/** The one loading line: `Loading…`, dimmed. */
export function Loading(el, { key }) {
  return h(el.Box, { key }, text(el, 'muted', LOADING_TEXT))
}
