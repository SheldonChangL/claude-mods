// https addresses in a PTT post (an image, a video, a page), found so the
// pane can offer them as links that open in the person's browser. Pure.
// Nothing here fetches anything: the service never reads them and the pane
// never shows what they point at, it only draws the address as a Link where
// the surface opens links.
//
// Only https, only a plain host (no user or password before an `@`, no
// space or quote), at most 2048 characters (the engine's Link limit).
// Anything else in the text, an http address included, stays text.

/** The characters an address may be made of, as PTT posts write them (ASCII only: `https://x/a.jpg（圖）` ends at the `g`). */
const CANDIDATE = /https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g
/** Punctuation that ends a sentence rather than an address. */
const TRAILING = /[.,;:!?)\]'*]+$/
const ADDRESS = /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d{1,5})?(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/
export const LINK_MAX = 2048

/** Is `address` an https address the pane may offer as a link? */
export function isLinkAddress(address) {
  return typeof address === 'string' && address.length <= LINK_MAX && ADDRESS.test(address)
}

/**
 * One line split into text and https addresses, in order:
 * [{ text }] for a line with none, else e.g. [{ text: '圖：' }, { url }, { text: ' 好看' }].
 */
export function segmentsOf(line) {
  const text = String(line ?? '')
  const out = []
  let at = 0
  for (const match of text.matchAll(CANDIDATE)) {
    const address = match[0].replace(TRAILING, '')
    if (!isLinkAddress(address)) continue
    if (match.index > at) out.push({ text: text.slice(at, match.index) })
    out.push({ url: address })
    at = match.index + address.length
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) })
  return out
}

export const hasLinkAddress = (line) => segmentsOf(line).some((part) => part.url)
