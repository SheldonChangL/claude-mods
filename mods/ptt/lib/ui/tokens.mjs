// Design tokens: semantic names only, mapped onto what the engine's
// elements natively understand. No hex colours, no pixel sizes, no custom
// style props: the surface draws them in its own theme.
//
//   space    Box gaps and padding, in character cells (the same on every
//            surface). Engine 2.1.299 adds step names ('sm', 'md') that each
//            surface sizes its own way, but Claude Desktop ships 2.1.295,
//            which refuses them (and then draws nothing of the pane), so the
//            steps stay cells until Desktop's engine has them.
//   text     Text roles -> Text props (`bold`, `dimColor`, theme colour
//            names), the ones every supported engine draws (see TEXT).
//   layout   gaps per layout mode (core/ui/layout.mjs picks the mode).

export const SPACE = Object.freeze({ none: 0, xs: 1, sm: 1, md: 2, lg: 3 })

/**
 * Text roles. Only props every supported engine draws: Claude Desktop ships
 * engine 2.1.295, which refuses a Text with `size`, `weight` or `tabular`
 * (added in 2.1.299) and then draws nothing of the pane. So: `bold`,
 * `dimColor`, `italic` and theme colour names (the engine's ThemeKey).
 */
export const TEXT = Object.freeze({
  title: Object.freeze({ bold: true }),
  section: Object.freeze({ bold: true, dimColor: true }),
  heading: Object.freeze({ bold: true }),
  label: Object.freeze({ dimColor: true }),
  body: Object.freeze({}),
  muted: Object.freeze({ dimColor: true }),
  meta: Object.freeze({ dimColor: true }),
  danger: Object.freeze({ color: 'error' }),
  success: Object.freeze({ color: 'success' }),
  warning: Object.freeze({ color: 'warning' }),
})

/**
 * Densities: how much air a layout mode gets. Pane padding stays 0: the
 * surface already pads its pane, and on the terminal every cell counts.
 */
export const DENSITY = Object.freeze({
  // Down: one blank row between sections and between items, none inside an
  // item. Across: one cell between inline things.
  normal: Object.freeze({ panePaddingX: SPACE.none, bodyPaddingY: 1, sectionGap: 1, cardGap: 1, rowGap: SPACE.none, inlineGap: 1 }),
  compact: Object.freeze({ panePaddingX: SPACE.none, bodyPaddingY: SPACE.none, sectionGap: 1, cardGap: 1, rowGap: SPACE.none, inlineGap: 1 }),
})

/** The one loading text (shown only for waits worth a line). */
export const LOADING_TEXT = 'Loading…'

/** Bounded text: previews and status badges never grow with their input. */
export const BOUNDS = Object.freeze({
  previewChars: Object.freeze({ wide: 120, normal: 72, compact: 36 }),
  titleChars: 120,
  metaChars: 24,
  statusBadgeChars: 8,
  badgeMax: 999,
})
