// Pure data for the band: what each meter says and its severity, plus the
// terminal's text layout. Desktop capsules are drawn in capsule.ts. No `$`
// here (it may not cross an import).

import type { Context, ProbeStatus, SysSample, Window } from '../types'

export type Tone = 'calm' | 'caution' | 'critical' | 'unknown'
export type Density = 'wide' | 'medium' | 'narrow' | 'tiny'

/** Terminal theme keys for a bar's filled cells. */
export const TERMINAL_FILL: Record<Tone, string> = {
  calm: 'success',
  caution: 'warning',
  critical: 'error',
  unknown: 'inactive',
}

export type MeterKey = '5h' | 'week' | 'ctx' | 'cpu' | 'mem' | 'disk'

export type Meter = {
  key: MeterKey
  group: 'quota' | 'system'
  labels: { long: string; short: string; letter: string }
  /** 0-100, or null when there is no reading. */
  pct: number | null
  tone: Tone
  /** `4h 04m`, `84k/200k`, `18.3/24G`, `57G free`; empty when none. */
  detail: string
  /** The detail where room is short: `4h04`, `84k`, `18.3G`, `57G`. */
  compact: string
  /** How far through its window a quota is (0-1), for the time marker; else null. */
  marker: number | null
  /** Words for a reader that cannot see the drawing. */
  alt: string
}

type Thresholds = [caution: number, critical: number]

/** Amber at 75% used, red at 90%, for every percentage meter but memory. */
const USED: Thresholds = [75, 90]
/** macOS keeps memory full on purpose (cache, compression): 76% is ordinary. */
const MEMORY: Thresholds = [85, 95]

/** Disk severity by free space, not percent: 50 GB left on a 494 GB disk is fine. */
const DISK_FREE_GB: Thresholds = [20, 10]

/** Disks count in decimal gigabytes, as Finder does. */
const GB_DECIMAL = 1e9
const GIB = 1024 ** 3

export function diskTone(freeBytes: number): Tone {
  const gb = freeBytes / GB_DECIMAL
  const [caution, critical] = DISK_FREE_GB
  if (gb < critical) return 'critical'
  if (gb < caution) return 'caution'
  return 'calm'
}

/** A system sample older than this has no reading. */
export const SYS_STALE_MS = 15_000

const clamp = (n: number) => Math.min(100, Math.max(0, n))

export function toneFor(pct: number, [caution, critical]: Thresholds = USED): Tone {
  if (pct >= critical) return 'critical'
  if (pct >= caution) return 'caution'
  return 'calm'
}

/** `47m`, `4h 04m`, `2d 3h`; empty once past. */
export function countdown(resetsAt: number, now: number): string {
  const minutes = Math.floor((resetsAt - now) / 60_000)
  if (minutes < 0) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** `4h04`, `2d3h`, `47m`: a countdown closed up. */
export const tightCountdown = (s: string) => {
  const t = s.replace(/ /g, '')
  return t.includes('h') && !t.includes('d') ? t.replace(/m$/, '') : t
}

/** Memory in binary gigabytes, as Activity Monitor counts: `18.3/24G`. */
export function gigabytes(used: number, total: number): string {
  const totalGb = total / GIB
  const digits = totalGb >= 100 ? 0 : 1
  const trim = (n: number) => (digits === 0 ? String(Math.round(n)) : String(Number(n.toFixed(1))))
  return `${(used / GIB).toFixed(digits)}/${trim(totalGb)}G`
}

/** `57G`; one decimal under 10 GB. */
export function freeGigabytes(used: number, total: number): string {
  const gb = Math.max(0, total - used) / GB_DECIMAL
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}G`
}

/** `84k`, `1M`: a token count as the status line abbreviates it. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/**
 * Known windows with fresh readings laid over them by kind, less any whose
 * reset has passed. The account's windows are the same in every session, so a
 * reading another session (or this one before a restart) stored still holds.
 */
export function mergeWindows(known: readonly Window[], fresh: readonly Window[], now: number): Window[] {
  const byKind = new Map<string, Window>()
  for (const w of [...known, ...fresh]) byKind.set(w.kind, w)
  return [...byKind.values()].filter(w => !w.resetsAt || Date.parse(w.resetsAt) > now)
}

/** Windows as `$.store` gave them back, checked; [] for anything else. */
export function parseWindows(value: unknown): Window[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(w =>
    w && typeof w === 'object' && typeof w.kind === 'string' && Number.isFinite(w.percentUsed)
      ? [{ kind: w.kind, percentUsed: w.percentUsed, ...(typeof w.resetsAt === 'string' ? { resetsAt: w.resetsAt } : {}) }]
      : [],
  )
}

export type Inputs = {
  windows: Window[]
  context: Context | null
  sys: SysSample | null
  probe: ProbeStatus
  now: number
}

/** Each quota window the engine reports, and how long it runs. */
const QUOTA_WINDOWS = {
  fiveHour: { kind: 'five_hour', ms: 5 * 3_600_000 },
  week: { kind: 'seven_day', ms: 7 * 86_400_000 },
}

const unknown = (key: MeterKey, group: Meter['group'], labels: Meter['labels'], alt: string): Meter => ({
  key,
  group,
  labels,
  pct: null,
  tone: 'unknown',
  detail: '',
  compact: '',
  marker: null,
  alt,
})

export function meters({ windows, context, sys, probe, now }: Inputs): Meter[] {
  const quota = (key: MeterKey, labels: Meter['labels'], name: string, spec: { kind: string; ms: number }): Meter => {
    const w = windows.find(x => x.kind === spec.kind)
    const at = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    // A window whose reset has passed no longer says how much is used.
    if (!w || (Number.isFinite(at) && at <= now)) return unknown(key, 'quota', labels, `${name}: unavailable`)
    const pct = clamp(w.percentUsed)
    const detail = Number.isFinite(at) ? countdown(at, now) : ''
    const marker = Number.isFinite(at) ? Math.min(1, Math.max(0, 1 - (at - now) / spec.ms)) : null
    const alt = `${name}: ${Math.round(pct)}% used${detail ? `, resets in ${detail}` : ''}${marker !== null ? `, ${Math.round(marker * 100)}% of the window gone` : ''}`
    return { key, group: 'quota', labels, pct, tone: toneFor(pct), detail, compact: tightCountdown(detail), marker, alt }
  }

  const isLive = sys !== null && probe !== 'failed' && now - sys.at <= SYS_STALE_MS
  const system = (key: MeterKey, labels: Meter['labels'], name: string, pct: number | undefined, tone?: Tone, detail = '', compact = ''): Meter => {
    if (!isLive || pct === undefined || !Number.isFinite(pct)) return unknown(key, 'system', labels, `${name}: unavailable`)
    const p = clamp(pct)
    return { key, group: 'system', labels, pct: p, tone: tone ?? toneFor(p), detail, compact, marker: null, alt: `${name}: ${Math.round(p)}%${detail ? `, ${detail}` : ''}` }
  }
  const ratio = (b: { used: number; total: number } | undefined) => (b && b.total > 0 ? (b.used / b.total) * 100 : undefined)
  const mem = sys ? gigabytes(sys.mem.used, sys.mem.total) : ''
  const free = sys ? freeGigabytes(sys.disk.used, sys.disk.total) : ''

  return [
    quota('5h', { long: '5h', short: '5h', letter: '5h' }, '5-hour quota', QUOTA_WINDOWS.fiveHour),
    quota('week', { long: '7d', short: '7d', letter: 'W' }, 'Weekly quota', QUOTA_WINDOWS.week),
    contextMeter(context),
    system('cpu', { long: 'CPU', short: 'CPU', letter: 'C' }, 'CPU', sys?.cpu),
    system('mem', { long: 'MEM', short: 'MEM', letter: 'M' }, 'Memory', ratio(sys?.mem), toneFor(ratio(sys?.mem) ?? 0, MEMORY), mem, mem.split('/')[0] + 'G'),
    system(
      'disk',
      { long: 'DISK', short: 'DSK', letter: 'D' },
      'Disk',
      ratio(sys?.disk),
      sys ? diskTone(sys.disk.total - sys.disk.used) : undefined,
      free ? `${free} free` : '',
      free,
    ),
  ]
}

/**
 * How full this session's context window is, the figure that says when to
 * /compact or start fresh. Known once a response has reported it.
 */
function contextMeter(c: Context | null): Meter {
  const labels = { long: 'Ctx', short: 'Ctx', letter: 'X' }
  const pct = c?.percent ?? (c?.tokens !== undefined && c.window > 0 ? (c.tokens / c.window) * 100 : undefined)
  if (!c || pct === undefined || !Number.isFinite(pct)) return unknown('ctx', 'quota', labels, 'Context window: no reading yet')
  const p = clamp(pct)
  const detail = c.tokens !== undefined ? `${tokens(c.tokens)}/${tokens(c.window)}` : ''
  const compact = c.tokens !== undefined ? tokens(c.tokens) : ''
  return {
    key: 'ctx',
    group: 'quota',
    labels,
    pct: p,
    tone: toneFor(p),
    detail,
    compact,
    marker: null,
    alt: `Context window: ${Math.round(p)}%${detail ? `, ${detail} tokens` : ''}`,
  }
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
  // Wide keeps every detail (resets closed up); medium the resets and the disk's
  // free space; narrow and tiny none.
  const detail =
    density === 'wide'
      ? m.group === 'quota' && m.key !== 'ctx'
        ? m.detail.replace(/ /g, '')
        : m.detail
      : density === 'medium' && ((m.group === 'quota' && m.key !== 'ctx') || m.key === 'disk')
        ? m.key === 'disk'
          ? m.detail
          : m.detail.replace(/ /g, '')
        : ''
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
