// What a list or a feature shows when it has nothing:
//   No notes yet
//   Add your first note above.
//   [ optional action ]

import { slot } from './keys.mjs'
import { clip, text } from './primitives.mjs'

export function EmptyState(el, layout, { key, title, description = null, action = null }) {
  const { Box } = el
  return h(
    Box,
    { key, flexDirection: 'column' },
    h(Box, { key: slot(key, 'title') }, text(el, 'body', clip(title, 200), { wrap: 'wrap' })),
    ...(description ? [h(Box, { key: slot(key, 'description') }, text(el, 'muted', clip(description, 400), { wrap: 'wrap' }))] : []),
    ...(action ? [h(Box, { key: slot(key, 'action'), marginTop: layout.rowGap }, action)] : []),
  )
}
