// Pure layout for the band (design: Codex, round 2): what each meter says, its
// severity, and which density fits. No `$` here (it may not cross an import).

import type { Context, ProbeStatus, SysSample, Window } from '../types'

export type Tone = 'calm' | 'caution' | 'high' | 'critical' | 'unknown'
export type Density = 'wide' | 'medium' | 'narrow' | 'tiny'

/** Terminal theme keys for a bar's filled cells. */
export const TERMINAL_FILL: Record<Tone, string> = {
  calm: 'success',
  caution: 'warning',
  high: 'claude',
  critical: 'error',
  unknown: 'inactive',
}

/** Desktop SVG fills: drawn as an image, so fixed colors that read on both themes. */
export const SVG_FILL: Record<Tone, string> = {
  calm: '#67AD6B',
  caution: '#C9A348',
  high: '#D77A43',
  critical: '#D45B5B',
  unknown: 'rgba(127,127,127,0.22)',
}
export const SVG_TRACK = 'rgba(127,127,127,0.22)'

export type Meter = {
  key: string
  group: 'quota' | 'system'
  labels: { long: string; short: string; letter: string }
  /** 0-100, or null when there is no reading. */
  pct: number | null
  tone: Tone
  /** Reset countdown (quota) or `19.9/24 GB` (memory, disk); empty when none. */
  detail: string
  /** Words for a reader that cannot see the bar. */
  alt: string
}

type Thresholds = [caution: number, high: number, critical: number]

const QUOTA: Thresholds = [50, 80, 95]
const CPU: Thresholds = [70, 85, 95]
const MEM: Thresholds = [75, 90, 97]
/** Context: amber when it is time to think about /compact, red near the limit. */
const CONTEXT: Thresholds = [60, 80, 90]

/** Disk severity by free space, not percent: 50 GB left on a 494 GB disk is fine. */
const DISK_FREE_GB: Thresholds = [20, 10, 5]

export function diskTone(freeBytes: number): Tone {
  const gb = freeBytes / GB_DECIMAL
  const [caution, high, critical] = DISK_FREE_GB
  if (gb < critical) return 'critical'
  if (gb < high) return 'high'
  if (gb < caution) return 'caution'
  return 'calm'
}

/** A system sample older than this has no reading. */
export const SYS_STALE_MS = 15_000

const clamp = (n: number) => Math.min(100, Math.max(0, n))

export function toneFor(pct: number, [caution, high, critical]: Thresholds): Tone {
  if (pct >= critical) return 'critical'
  if (pct >= high) return 'high'
  if (pct >= caution) return 'caution'
  return 'calm'
}

/** `47m`, `2h 24m`, `5d 14h`; empty once past. */
export function countdown(resetsAt: number, now: number): string {
  const minutes = Math.floor((resetsAt - now) / 60_000)
  if (minutes < 0) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const GB = 1024 ** 3

/** `19.9/24 GB`; whole numbers once the total reaches 100 GB. */
export function gigabytes(used: number, total: number): string {
  const totalGb = total / GB
  const digits = totalGb >= 100 ? 0 : 1
  const trim = (n: number) => (digits === 0 ? String(Math.round(n)) : String(Number(n.toFixed(1))))
  return `${(used / GB).toFixed(digits)}/${trim(totalGb)} GB`
}

/** Disks count in decimal gigabytes, as Finder does. */
const GB_DECIMAL = 1e9

/** `50 GB free`; one decimal under 10 GB. */
export function freeSpace(used: number, total: number): string {
  const gb = Math.max(0, total - used) / GB_DECIMAL
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB free`
}

export type Inputs = {
  windows: Window[]
  context: Context | null
  sys: SysSample | null
  probe: ProbeStatus
  now: number
}

const QUOTA_KINDS = {
  fiveHour: (k: string) => k === 'five_hour',
  week: (k: string) => k === 'seven_day',
}

/** `84k`, `1M`: a token count as the status line abbreviates it. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function meters({ windows, context, sys, probe, now }: Inputs): Meter[] {
  const quota = (key: string, labels: Meter['labels'], name: string, match: (k: string) => boolean): Meter => {
    const w = windows.find(x => match(x.kind))
    const at = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    // A window whose reset has passed no longer says how much is used.
    if (!w || (Number.isFinite(at) && at <= now)) {
      return { key, group: 'quota', labels, pct: null, tone: 'unknown', detail: '', alt: `${name}: unavailable` }
    }
    const pct = clamp(w.percentUsed)
    const detail = Number.isFinite(at) ? countdown(at, now) : ''
    const alt = `${name}: ${Math.round(pct)}%${detail ? `, resets in ${detail}` : ''}`
    return { key, group: 'quota', labels, pct, tone: toneFor(pct, QUOTA), detail, alt }
  }

  const isLive = sys !== null && probe !== 'failed' && now - sys.at <= SYS_STALE_MS
  const system = (
    key: string,
    labels: Meter['labels'],
    name: string,
    pct: number | undefined,
    severity: Thresholds | Tone,
    detail = '',
  ): Meter => {
    if (!isLive || pct === undefined || !Number.isFinite(pct)) {
      return { key, group: 'system', labels, pct: null, tone: 'unknown', detail: '', alt: `${name}: unavailable` }
    }
    const p = clamp(pct)
    const tone = typeof severity === 'string' ? severity : toneFor(p, severity)
    return { key, group: 'system', labels, pct: p, tone, detail, alt: `${name}: ${Math.round(p)}%${detail ? `, ${detail}` : ''}` }
  }
  const ratio = (b: { used: number; total: number } | undefined) => (b && b.total > 0 ? (b.used / b.total) * 100 : undefined)

  return [
    quota('5h', { long: '5h', short: '5h', letter: '5h' }, '5-hour quota', QUOTA_KINDS.fiveHour),
    quota('week', { long: 'Week', short: 'Wk', letter: 'W' }, 'Weekly quota', QUOTA_KINDS.week),
    contextMeter(context),
    system('cpu', { long: 'CPU', short: 'CPU', letter: 'C' }, 'CPU', sys?.cpu, CPU),
    system('mem', { long: 'MEM', short: 'MEM', letter: 'M' }, 'Memory', ratio(sys?.mem), MEM, sys ? gigabytes(sys.mem.used, sys.mem.total) : ''),
    system(
      'disk',
      { long: 'DISK', short: 'DSK', letter: 'D' },
      'Disk',
      ratio(sys?.disk),
      sys ? diskTone(sys.disk.total - sys.disk.used) : 'unknown',
      sys ? freeSpace(sys.disk.used, sys.disk.total) : '',
    ),
  ]
}

/**
 * How full this session's context window is, the figure that says when to
 * /compact or start fresh. Known once a response has reported it.
 */
function contextMeter(c: Context | null): Meter {
  const labels = { long: 'Context', short: 'Ctx', letter: 'X' }
  const pct = c?.percent ?? (c?.tokens !== undefined && c.window > 0 ? (c.tokens / c.window) * 100 : undefined)
  if (!c || pct === undefined || !Number.isFinite(pct)) {
    return { key: 'ctx', group: 'quota', labels, pct: null, tone: 'unknown', detail: '', alt: 'Context window: no reading yet' }
  }
  const p = clamp(pct)
  const detail = c.tokens !== undefined ? `${tokens(c.tokens)}/${tokens(c.window)}` : ''
  return { key: 'ctx', group: 'quota', labels, pct: p, tone: toneFor(p, CONTEXT), detail, alt: `Context window: ${Math.round(p)}%${detail ? `, ${detail} tokens` : ''}` }
}

export const percent = (m: Meter) => (m.pct === null ? '—' : `${Math.round(m.pct)}%`)

// ---- Terminal: `5h  0% ──────── 2h24m │ ...` --------------------------------

const TERMINAL_BAR: Record<Density, number> = { wide: 8, medium: 3, narrow: 3, tiny: 0 }

/** Filled and track cells; a known nonzero reading fills at least one. */
export function cells(pct: number | null, width: number): { filled: string; track: string } {
  if (width === 0) return { filled: '', track: '' }
  let n = pct === null ? 0 : Math.round((pct * width) / 100)
  if (pct !== null && pct > 0 && n === 0) n = 1
  return { filled: '━'.repeat(n), track: '─'.repeat(width - n) }
}

export type TerminalMeter = {
  key: string
  label: string
  value: string
  filled: string
  track: string
  detail: string
  tone: Tone
  /** Spaces between the parts: one, or none in narrow. */
  sep: string
}

export type TerminalBand = { density: Density; meters: TerminalMeter[]; width: number }

function terminalMeter(m: Meter, density: Density): TerminalMeter {
  const { filled, track } = cells(m.pct, TERMINAL_BAR[density])
  const label = density === 'wide' ? m.labels.short : m.labels.letter
  const value = density === 'wide' ? percent(m).padStart(3) : percent(m)
  // Wide keeps every detail; medium the reset and the disk's free space; narrow
  // and tiny none. Resets close up (`5d14h`); sizes keep their words.
  const isKept = density === 'wide' || (density === 'medium' && (m.group === 'quota' || m.key === 'disk'))
  const detail = !isKept ? '' : m.group === 'quota' ? m.detail.replace(/ /g, '') : m.detail.replace(' GB free', 'G free')
  return { key: m.key, label, value, filled, track, detail, tone: m.tone, sep: density === 'narrow' || density === 'tiny' ? '' : ' ' }
}

const textWidth = (t: TerminalMeter) =>
  [t.label, t.value, t.filled + t.track, t.detail].filter(Boolean).reduce((n, s, i) => n + [...s].length + (i > 0 ? t.sep.length : 0), 0)

/** Meters joined by ` │ ` (groups by ` ║ `), or one space in narrow and tiny. */
export function terminalLayout(ms: Meter[], columns: number): TerminalBand {
  for (const density of ['wide', 'medium', 'narrow', 'tiny'] as const) {
    const meters = ms.map(m => terminalMeter(m, density))
    const joints = density === 'wide' || density === 'medium' ? 3 : 1
    const width = meters.reduce((n, t) => n + textWidth(t), 0) + joints * (meters.length - 1)
    if (width <= columns || density === 'tiny') return { density, meters, width }
  }
  throw new Error('unreachable')
}

// ---- Desktop: label, an SVG track, `20% · resets in 5d 14h` ------------------

export type DesktopDensity = 'wide' | 'medium' | 'compact' | 'narrow'

const DESKTOP_DENSITIES: readonly DesktopDensity[] = ['wide', 'medium', 'compact', 'narrow']

/**
 * Desktop lays a cell out about 8 px wide (measured: a 765 px band, gap 1 is
 * ~8 px) and caption text runs ~6-7 px a character; the estimate leans wide so
 * a row that is judged to fit does fit.
 */
const CELL_PX = 8
const CHAR_PX = 6.5
/** Cells between a meter's parts, between meters, and around the divider. */
const GAP_INNER = 1
const GAP_METER = 2

export function desktopBarSize(m: Meter, density: DesktopDensity): { width: number; height: number } {
  if (density === 'wide') return { width: m.group === 'quota' ? 64 : 48, height: 6 }
  if (density === 'medium') return { width: 40, height: 6 }
  if (density === 'compact') return { width: 28, height: 6 }
  return { width: 20, height: 5 }
}

export type DesktopMeter = {
  key: string
  label: string
  status: string
  bar: { width: number; height: number }
  svg: string
  alt: string
}

export type DesktopBand = {
  density: DesktopDensity
  quota: DesktopMeter[]
  system: DesktopMeter[]
  /** Estimated px, and whether even narrow is wider than the band (it wraps). */
  width: number
  isOverflowing: boolean
}

const meterPx = (d: DesktopMeter) =>
  [...d.label].length * CHAR_PX + d.bar.width + [...d.status].length * CHAR_PX + 2 * GAP_INNER * CELL_PX

function desktopMeter(m: Meter, density: DesktopDensity): DesktopMeter {
  const bar = desktopBarSize(m, density)
  return { key: m.key, label: desktopLabel(m, density), status: desktopStatus(m, density), bar, svg: barSvg(m, bar), alt: m.alt }
}

/** The roomiest density whose estimated width fits `columns` cells. */
export function desktopLayout(ms: Meter[], columns: number): DesktopBand {
  const room = columns * CELL_PX
  let band: DesktopBand | undefined
  for (const density of DESKTOP_DENSITIES) {
    const all = ms.map(m => desktopMeter(m, density))
    // Five meter gaps, the divider's character and its two gaps.
    const width = all.reduce((n, d) => n + meterPx(d), 0) + (ms.length - 2) * GAP_METER * CELL_PX + CHAR_PX + 2 * GAP_METER * CELL_PX
    band = {
      density,
      quota: all.filter((_, i) => ms[i]!.group === 'quota'),
      system: all.filter((_, i) => ms[i]!.group === 'system'),
      width,
      isOverflowing: width > room,
    }
    if (!band.isOverflowing) return band
  }
  return band!
}

/** The bar as an SVG document: a rounded track, the fill clipped to it. */
export function barSvg(m: Meter, { width, height }: { width: number; height: number }): string {
  const fill = m.pct === null ? 0 : Math.round(((width * m.pct) / 100) * 10) / 10
  const r = height / 2
  const id = `pillbar-clip-${m.key}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<clipPath id="${id}"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="${SVG_TRACK}"/>` +
    (fill > 0 ? `<rect width="${fill}" height="${height}" fill="${SVG_FILL[m.tone]}" clip-path="url(#${id})"/>` : '') +
    `</svg>`
  )
}

export function desktopLabel(m: Meter, density: DesktopDensity): string {
  return density === 'wide' || density === 'medium' ? m.labels.long : m.labels.short
}

/**
 * `20% · resets in 5d 14h`, `76% · 19.9/24 GB`, `90% · 50 GB free`, shortened
 * as the room shrinks; the disk keeps its free space longest, memory its size
 * least long.
 */
export function desktopStatus(m: Meter, density: DesktopDensity): string {
  const p = percent(m)
  if (!m.detail) return p
  const tight = (s: string) => s.replace(/ /g, '')
  if (m.key === 'ctx') return density === 'wide' || density === 'medium' ? `${p} · ${m.detail}` : p
  if (m.group === 'quota') {
    if (density === 'wide') return `${p} · resets in ${m.detail}`
    if (density === 'medium') return `${p} · ${m.detail}`
    if (density === 'compact') return `${p} · ${tight(m.detail)}`
    return p
  }
  if (m.key === 'disk') {
    if (density === 'wide') return `${p} · ${m.detail}`
    if (density === 'medium') return `${p} · ${m.detail.replace(' GB free', 'G free')}`
    if (density === 'compact') return m.detail.replace(' GB free', 'G free')
    return m.detail.replace(' GB free', 'G')
  }
  if (density === 'wide') return `${p} · ${m.detail}`
  if (density === 'medium') return `${p} · ${m.detail.replace(' GB', 'G')}`
  return p
}

// ---- Sampler lines ----------------------------------------------------------

/** Splits a stream of text pieces into whole lines, keeping the tail. */
export function lineSplitter() {
  let tail = ''
  return (text: string): string[] => {
    const parts = (tail + text).split('\n')
    tail = parts.pop() ?? ''
    return parts.filter(line => line.trim().length > 0)
  }
}

/** One sampler line, checked; null when it is not one. */
export function parseSample(line: string): SysSample | null {
  try {
    const v = JSON.parse(line)
    const bytes = (b: unknown) =>
      typeof b === 'object' && b !== null && Number.isFinite((b as any).used) && Number.isFinite((b as any).total)
    if (!Number.isFinite(v?.cpu) || !bytes(v.mem) || !bytes(v.disk) || !Number.isFinite(v.at)) return null
    return { cpu: v.cpu, mem: { used: v.mem.used, total: v.mem.total }, disk: { used: v.disk.used, total: v.disk.total }, at: v.at }
  } catch {
    return null
  }
}
