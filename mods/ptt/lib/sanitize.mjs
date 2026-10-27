// Text that came from outside this mod's own code (a PTT title, a name, a
// post, an error message) passes through here
// before it is drawn or logged. Pure.
//
// Removes terminal control: OSC/DCS/APC/PM/SOS strings, CSI sequences (7-bit
// and C1), other ESC sequences, and every C0/C1 control character except
// `\n` and `\t`, and invisible bidi / zero-width characters. Then caps the
// length. `singleLine` also folds newlines and tabs into one space (badges,
// toasts, log lines).

const OSC_7BIT = /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g
const STRING_7BIT = /\x1b[PX^_][\s\S]*?(?:\x1b\\|$)/g
const CSI_7BIT = /\x1b\[[0-?]*[ -/]*[@-~]?/g
const OSC_C1 = /\x9d[\s\S]*?(?:\x07|\x9c|$)/g
const STRING_C1 = /[\x90\x98\x9e\x9f][\s\S]*?(?:\x9c|$)/g
const CSI_C1 = /\x9b[0-?]*[ -/]*[@-~]?/g
const ESC_OTHER = /\x1b[ -/]*[0-~]?/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g
// Bidi overrides/isolates, zero-width characters, BOM, line/paragraph
// separators: invisible, and able to reorder or split what is drawn.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2064\u2066-\u2069\ufeff]/g
const LINE_BREAKS = /[\n\t]+/g

export const DEFAULT_MAX = 2000

/**
 * @param {unknown} input            anything; non-strings are stringified
 * @param {{ max?: number, singleLine?: boolean }} [options] cap in characters (code points), default 2000
 * @returns {string}
 */
export function sanitizeText(input, { max = DEFAULT_MAX, singleLine = false } = {}) {
  let text = String(input ?? '')
    .replace(OSC_7BIT, '')
    .replace(STRING_7BIT, '')
    .replace(CSI_7BIT, '')
    .replace(OSC_C1, '')
    .replace(STRING_C1, '')
    .replace(CSI_C1, '')
    .replace(ESC_OTHER, '')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
  if (singleLine) text = text.replace(LINE_BREAKS, ' ')
  const limit = Math.max(1, Math.floor(max))
  if (text.length <= limit) return text
  const chars = Array.from(text)
  return chars.length <= limit ? text : `${chars.slice(0, limit - 1).join('')}…`
}
