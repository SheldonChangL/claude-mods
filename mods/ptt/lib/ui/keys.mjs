// Key convention. Keys go on Box, Button, Input and Select (a key on Text is
// dropped). Every dynamic item is keyed by its own id, never by its index.
//
//   <featureId>-<part>[:<id>]         a feature's own elements: the prefix is
//                                     what ctx.ui.focus checks, the `:<id>`
//                                     names one item (`notes-row:<note id>`)
//   <key>:<slot>                      a part a widget derives from its key
//                                     (`notes-row:abc:head`)
//
// ':' never appears in a feature id or a note id, so no id can make one key
// collide with another.

export const featureKey = (featureId, part, id) => (id === undefined ? `${featureId}-${part}` : `${featureId}-${part}:${id}`)
export const slot = (key, name) => `${key}:${name}`
