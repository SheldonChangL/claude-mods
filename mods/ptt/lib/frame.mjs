// Frame: the Pane render event normalized into what the views draw from.
// Pure: takes plain data (the event's surface, props and viewport), returns
// plain data. No `$`.
//
// 2.1.296 Pane props (RenderPropsOf['Pane']): title, isFocused, bodyColumns,
// placement ('dock' | 'inline'), scroll { offset, bodyRows }, view { agentId? }.
// `bodyColumns` is the box the pane body draws into (narrower than the
// viewport while docked), so layout keys on it, not on viewport.columns.

import { BREAKPOINTS, modeFor } from './ui/layout.mjs'

/** Below this many body columns the layout is compact (core/ui/layout.mjs owns the policy). */
export const COMPACT_COLUMNS = BREAKPOINTS.compact

/**
 * What each surface draws, from 2.1.296's `Elements` type: the one place
 * element availability per surface lives (how each surface composes the UI
 * is core/ui/layout.mjs, COMPOSITIONS).
 *
 * Needed because `$.ui.resolve(e)` hands back every constructor on every
 * surface (the terminal's table has `Svg`, mobile's has `Select`): checking
 * `el.Select` says nothing. The surface then drops an element it cannot draw.
 */
export const SURFACE_ELEMENTS = Object.freeze({
  terminal: Object.freeze(['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown', 'Client', 'Raster', 'Image']),
  desktop: Object.freeze(['Box', 'Text', 'Button', 'Input', 'Select', 'Svg', 'Link', 'Code', 'Markdown', 'Client']),
  vscode: Object.freeze(['Box', 'Text', 'Button', 'Input', 'Select', 'Svg', 'Link', 'Code', 'Markdown']),
  mobile: Object.freeze(['Box', 'Text', 'Button', 'Svg', 'Link', 'Code', 'Markdown']),
})
const MINIMAL_ELEMENTS = Object.freeze(['Box', 'Text', 'Button'])

/** Whether the frame's surface draws `element` (e.g. 'Select'). */
export const surfaceHas = (frame, element) => (frame.elements ?? MINIMAL_ELEMENTS).includes(element)

/**
 * @typedef {object} Frame
 * @property {string}  surface       'terminal' | 'desktop' | 'vscode' | 'mobile', as the engine reported it
 * @property {number}  bodyColumns   cells across the pane body (>= 1)
 * @property {number}  bodyRows      the room's rows (not the rows showing), >= 1
 * @property {boolean} isFocused     the person gave the pane the keyboard
 * @property {'dock' | 'inline'} placement
 * @property {'compact' | 'normal' | 'wide'} mode   the layout mode (core/ui/layout.mjs)
 * @property {boolean} compact       mode === 'compact'
 * @property {readonly string[]} elements   what this surface draws (SURFACE_ELEMENTS)
 */

const positiveInt = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined

/**
 * @param {{ surface?: string, props?: object, viewport?: { columns?: number, rows?: number } }} [event]
 * @returns {Frame}
 */
export function toFrame(event = {}) {
  const props = event.props ?? {}
  const viewport = event.viewport ?? {}
  const bodyColumns = positiveInt(props.bodyColumns) ?? positiveInt(viewport.columns) ?? 80
  const bodyRows = positiveInt(props.scroll?.bodyRows) ?? positiveInt(viewport.rows) ?? 24
  const surface = typeof event.surface === 'string' ? event.surface : 'terminal'
  return {
    surface,
    bodyColumns,
    bodyRows,
    isFocused: props.isFocused === true,
    placement: props.placement === 'inline' ? 'inline' : 'dock',
    mode: modeFor(bodyColumns),
    compact: modeFor(bodyColumns) === 'compact',
    elements: SURFACE_ELEMENTS[surface] ?? MINIMAL_ELEMENTS,
  }
}
