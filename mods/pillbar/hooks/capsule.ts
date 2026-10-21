// Desktop capsules (design: Codex, round 3): each meter is one SVG image, a
// tinted rounded shell with an icon, label, bar, value and detail, after the
// polish of a reference band the user showed. Text is monospace, so a capsule's
// width is exact: characters × size × 0.6, held with textLength.

import type { Meter, MeterKey, Tone } from './model'
import { percent } from './model'

/**
 * full: icon label bar value | clock detail; medium: icon bar value | detail;
 * compact: quota and context keep a short bar (and the time marker), system
 * meters drop theirs; tiny: icon value short-detail.
 */
export type CapsuleDensity = 'full' | 'medium' | 'compact' | 'tiny'

const DENSITIES: readonly CapsuleDensity[] = ['full', 'medium', 'compact', 'tiny']

// ---- Palette ----------------------------------------------------------------

/** [stroke, fill, icon, bar, label, value, detail] */
type Hue = readonly [string, string, string, string, string, string, string]

const DARK: Record<MeterKey | 'amber' | 'red', Hue> = {
  '5h': ['#10B981', '#10B981', '#34D399', '#4ADE80', '#A7F3D0', '#ECFDF5', '#6EE7B7'],
  week: ['#8B5CF6', '#8B5CF6', '#A78BFA', '#A78BFA', '#C4B5FD', '#F5F3FF', '#C4B5FD'],
  ctx: ['#6366F1', '#6366F1', '#818CF8', '#818CF8', '#C7D2FE', '#EEF2FF', '#A5B4FC'],
  cpu: ['#06B6D4', '#06B6D4', '#22D3EE', '#22D3EE', '#A5F3FC', '#ECFEFF', '#67E8F9'],
  mem: ['#EC4899', '#EC4899', '#F472B6', '#F472B6', '#FBCFE8', '#FDF2F8', '#F9A8D4'],
  disk: ['#3B82F6', '#3B82F6', '#60A5FA', '#60A5FA', '#BFDBFE', '#EFF6FF', '#93C5FD'],
  amber: ['#F59E0B', '#F59E0B', '#FBBF24', '#FBBF24', '#FDE68A', '#FFFBEB', '#FCD34D'],
  red: ['#EF4444', '#EF4444', '#F87171', '#F87171', '#FECACA', '#FEF2F2', '#FCA5A5'],
}

const LIGHT: Record<MeterKey | 'amber' | 'red', Hue> = {
  '5h': ['#059669', '#10B981', '#047857', '#059669', '#047857', '#052E16', '#047857'],
  week: ['#7C3AED', '#8B5CF6', '#6D28D9', '#7C3AED', '#6D28D9', '#2E1065', '#7C3AED'],
  ctx: ['#4F46E5', '#6366F1', '#4338CA', '#4F46E5', '#4338CA', '#1E1B4B', '#4F46E5'],
  cpu: ['#0891B2', '#06B6D4', '#0E7490', '#0891B2', '#0E7490', '#164E63', '#0E7490'],
  mem: ['#DB2777', '#EC4899', '#BE185D', '#DB2777', '#BE185D', '#500724', '#BE185D'],
  disk: ['#2563EB', '#3B82F6', '#1D4ED8', '#2563EB', '#1D4ED8', '#172554', '#2563EB'],
  amber: ['#D97706', '#F59E0B', '#B45309', '#D97706', '#92400E', '#451A03', '#B45309'],
  red: ['#DC2626', '#EF4444', '#B91C1C', '#DC2626', '#991B1B', '#450A0A', '#B91C1C'],
}

const TRACK = { dark: 'rgba(148,163,184,.18)', light: 'rgba(15,23,42,.14)' }
const MARKER = { dark: 'rgba(241,245,249,.92)', light: 'rgba(30,41,59,.82)' }

/** Severity replaces the meter's own hue; no reading keeps it, dimmed. */
const hueKey = (key: MeterKey, tone: Tone) => (tone === 'critical' ? 'red' : tone === 'caution' ? 'amber' : key)

// ---- Icons (24×24 strokes, lucide style) ------------------------------------

const ICONS: Record<MeterKey | 'clock', string> = {
  '5h': '<path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="m12 14 4-4"/><circle cx="12" cy="14" r="1"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  ctx: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
  mem: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h3v4H6zM12 10h3v4h-3zM18 10h.01M6 18v3M10 18v3M14 18v3M18 18v3"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h.01M7 16h.01M11 16h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}

// ---- Geometry ---------------------------------------------------------------

const H = 32
const STROKE = 1.25
const ICON = 16
const CLOCK = 14
const FONT = 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,monospace'

/** Width of `text` at `size` px in the monospace stack. */
export const textPx = (text: string, size: number) => Math.round([...text].length * size * 0.6 * 100) / 100

/** XML-escaped, every non-ASCII character as a numeric reference (`—` → `&#8212;`). */
const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[^\x20-\x7e]/gu, c => `&#${c.codePointAt(0)};`)

type Part =
  | { kind: 'icon'; icon: keyof typeof ICONS; size: number; cls: 'icon' }
  | { kind: 'text'; text: string; size: number; weight: number; cls: 'label' | 'value' | 'detail' }
  | { kind: 'bar'; width: number }
  | { kind: 'divider' }
  | { kind: 'gap'; px: number }

/** The parts of one capsule at a density, left to right, without padding. */
function parts(m: Meter, density: CapsuleDensity): Part[] {
  const value = percent(m)
  const icon: Part = { kind: 'icon', icon: m.key, size: ICON, cls: 'icon' }
  const gap = (px: number): Part => ({ kind: 'gap', px })
  const text = (t: string, size: number, weight: number, cls: 'label' | 'value' | 'detail'): Part => ({ kind: 'text', text: t, size, weight, cls })
  const detailParts = (size: number): Part[] => {
    if (!m.detail) return []
    const clock = m.marker !== null ? [{ kind: 'icon', icon: 'clock', size: CLOCK, cls: 'icon' } as Part, gap(5)] : []
    return [gap(8), { kind: 'divider' }, gap(8), ...clock, text(m.detail, size, 600, 'detail')]
  }
  if (density === 'full') {
    return [icon, gap(6), text(m.labels.long, 12, 600, 'label'), gap(8), { kind: 'bar', width: 48 }, gap(7), text(value, 12, 700, 'value'), ...detailParts(11)]
  }
  if (density === 'medium') {
    return [icon, gap(6), { kind: 'bar', width: 36 }, gap(6), text(value, 11, 700, 'value'), ...detailParts(11)]
  }
  const short: Part[] = m.compact ? [gap(5), text(m.compact, 10, 600, 'detail')] : []
  if (density === 'compact' && m.group === 'quota') {
    return [icon, gap(6), { kind: 'bar', width: 28 }, gap(6), text(value, 11, 700, 'value'), ...short]
  }
  return [icon, gap(5), text(value, 11, 700, 'value'), ...short]
}

const partPx = (p: Part) =>
  p.kind === 'icon' ? p.size : p.kind === 'text' ? textPx(p.text, p.size) : p.kind === 'bar' ? p.width : p.kind === 'divider' ? 1 : p.px

const padding = (density: CapsuleDensity) => (density === 'full' ? 10 : 8)

export function capsuleWidth(m: Meter, density: CapsuleDensity): number {
  return Math.ceil(2 * padding(density) + parts(m, density).reduce((n, p) => n + partPx(p), 0))
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** One meter as a standalone SVG document. */
export function capsuleSvg(m: Meter, density: CapsuleDensity): string {
  const width = capsuleWidth(m, density)
  const k = hueKey(m.key, m.tone)
  const [dStroke, dFill, dIcon, dBar, dLabel, dValue, dDetail] = DARK[k]
  const [lStroke, lFill, lIcon, lBar, lLabel, lValue, lDetail] = LIGHT[k]
  const dim = m.tone === 'unknown'
  const body: string[] = []
  let x = padding(density)
  for (const p of parts(m, density)) {
    if (p.kind === 'icon') {
      const y = (H - p.size) / 2
      body.push(
        `<g class="icon" color="${dIcon}" transform="translate(${r2(x)} ${r2(y)}) scale(${r2(p.size / 24)})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[p.icon]}</g>`,
      )
    } else if (p.kind === 'text') {
      const color = p.cls === 'label' ? dLabel : p.cls === 'value' ? dValue : dDetail
      const y = p.size >= 11 ? 20 : 19.5
      body.push(
        `<text class="${p.cls}" x="${r2(x)}" y="${y}" fill="${color}" font-size="${p.size}" font-weight="${p.weight}" textLength="${textPx(p.text, p.size)}" lengthAdjust="spacingAndGlyphs">${escape(p.text)}</text>`,
      )
    } else if (p.kind === 'bar') {
      const fill = m.pct === null ? 0 : r2((p.width * m.pct) / 100)
      // Unique per capsule and density, in case a host inlines several documents.
      const clip = `pillbar-${m.key}-${density}-bar`
      body.push(`<clipPath id="${clip}"><rect x="${r2(x)}" y="13" width="${p.width}" height="6" rx="3"/></clipPath>`)
      body.push(`<rect class="track" x="${r2(x)}" y="13" width="${p.width}" height="6" rx="3" fill="${TRACK.dark}"/>`)
      if (fill > 0) body.push(`<rect class="bar" x="${r2(x)}" y="13" width="${fill}" height="6" fill="${dBar}" clip-path="url(#${clip})"/>`)
      if (m.marker !== null) {
        const mx = r2(x + p.width * m.marker)
        body.push(`<path class="marker" d="M${mx} 10v12" stroke="${MARKER.dark}" stroke-width="1.5" stroke-linecap="round"/>`)
      }
    } else if (p.kind === 'divider') {
      body.push(`<rect class="divider" x="${r2(x)}" y="8" width="1" height="16" rx=".5" fill="${dLabel}" fill-opacity=".28"/>`)
    }
    x += partPx(p)
  }
  // Dark colors as attributes (they hold if a host drops <style>); the light
  // theme overrides them from the stylesheet, which outranks attributes. Rules
  // are scoped to this capsule's root, so a host that inlines several capsules
  // in one document cannot cross their palettes.
  const root = `pillbar-${m.key}-${density}-${m.tone}`
  const s = (cls: string) => `.${root} .${cls}`
  const style =
    `<style>.${root} text{font-family:${FONT}}@media (prefers-color-scheme:light){` +
    `${s('shell')}{fill:${lFill};fill-opacity:.07;stroke:${lStroke};stroke-opacity:.45}` +
    `${s('icon')}{color:${lIcon}}${s('track')}{fill:${TRACK.light}}${s('bar')}{fill:${lBar}}${s('marker')}{stroke:${MARKER.light}}` +
    `${s('label')}{fill:${lLabel}}${s('value')}{fill:${lValue}}${s('detail')}{fill:${lDetail}}${s('divider')}{fill:${lLabel}}}</style>`
  const inset = STROKE / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${root}" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"${dim ? ' opacity=".6"' : ''}>` +
    style +
    `<rect class="shell" x="${inset}" y="${inset}" width="${r2(width - STROKE)}" height="${H - STROKE}" rx="${r2((H - STROKE) / 2)}" fill="${dFill}" fill-opacity=".10" stroke="${dStroke}" stroke-opacity=".55" stroke-width="${STROKE}"/>` +
    body.join('') +
    `</svg>`
  )
}

// ---- Row layout -------------------------------------------------------------

/** Desktop lays a Box gap cell out ~8 px wide (measured on a 765 px band). */
export const CELL_PX = 8
/** Gaps in cells: between capsules of a group, and between the two groups. */
export const GAP_CAPSULE = 1
export const GAP_GROUP = 3

export type Capsule = { key: MeterKey; svg: string; width: number; alt: string }

export type CapsuleBand = {
  density: CapsuleDensity
  quota: Capsule[]
  system: Capsule[]
  width: number
  /** Even compact is wider than the band: the row wraps whole capsules. */
  isOverflowing: boolean
}

/** One density for the whole row: the roomiest whose width fits `columns` cells. */
export function capsuleLayout(ms: Meter[], columns: number): CapsuleBand {
  const room = columns * CELL_PX
  let band: CapsuleBand | undefined
  for (const density of DENSITIES) {
    const all = ms.map(m => ({ key: m.key, svg: capsuleSvg(m, density), width: capsuleWidth(m, density), alt: m.alt }))
    const quota = all.filter((_, i) => ms[i]!.group === 'quota')
    const system = all.filter((_, i) => ms[i]!.group === 'system')
    const gaps = (Math.max(0, quota.length - 1) + Math.max(0, system.length - 1)) * GAP_CAPSULE * CELL_PX + GAP_GROUP * CELL_PX
    const width = all.reduce((n, c) => n + c.width, 0) + gaps
    band = { density, quota, system, width, isOverflowing: width > room }
    if (!band.isOverflowing) return band
  }
  return band!
}
