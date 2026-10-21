import { describe, expect, test } from 'claude-code/testing'

import {
  barSvg,
  cells,
  countdown,
  desktopLayout,
  desktopStatus,
  diskTone,
  freeSpace,
  gigabytes,
  lineSplitter,
  meters,
  parseSample,
  terminalLayout,
} from '../hooks/model'

// The test runtime has timers; the hooks environment's lib does not declare them.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const NOW = Date.UTC(2026, 9, 20, 9, 0, 0)
const GB = 1024 ** 3
const SAMPLE = { cpu: 19, mem: { used: 19.9 * GB, total: 24 * GB }, disk: { used: 444 * GB, total: 494 * GB }, at: NOW - 1000 }
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 0, resetsAt: new Date(NOW + (2 * 60 + 24) * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + (5 * 24 + 14) * 3_600_000).toISOString() },
]
const CONTEXT = { tokens: 84_000, window: 200_000, percent: 42 }
const INPUTS = { windows: WINDOWS, context: CONTEXT, sys: SAMPLE, probe: 'live' as const, now: NOW }

describe('model', () => {
  test('thin terminal bar: ━ filled, ─ track, a nonzero reading fills one cell', () => {
    expect(cells(20, 8)).toEqual({ filled: '━━', track: '──────' })
    expect(cells(0, 3)).toEqual({ filled: '', track: '───' })
    expect(cells(2, 3)).toEqual({ filled: '━', track: '──' })
    expect(cells(null, 3)).toEqual({ filled: '', track: '───' })
    expect(cells(50, 0)).toEqual({ filled: '', track: '' })
  })

  test('countdown and sizes read like /usage', () => {
    expect(countdown(NOW + 47 * 60_000, NOW)).toBe('47m')
    expect(countdown(NOW + 144 * 60_000, NOW)).toBe('2h 24m')
    expect(countdown(NOW + (5 * 24 + 14) * 3_600_000, NOW)).toBe('5d 14h')
    expect(countdown(NOW - 1, NOW)).toBe('')
    expect(gigabytes(19.9 * GB, 24 * GB)).toBe('19.9/24 GB')
    expect(gigabytes(444 * GB, 494 * GB)).toBe('444/494 GB')
  })

  test('disk: free space in decimal GB like Finder, severity by what is left', () => {
    // The sampler's reading of this Mac (statfs on /System/Volumes/Data).
    const [used, total] = [443_885_096_960, 494_384_795_648]
    expect(freeSpace(used, total)).toBe('50 GB free')
    expect(freeSpace(total - 7.25e9, total)).toBe('7.3 GB free')
    expect([diskTone(50e9), diskTone(19e9), diskTone(9e9), diskTone(4e9)]).toEqual(['calm', 'caution', 'high', 'critical'])
    const disk = meters({ ...INPUTS, sys: { ...SAMPLE, disk: { used, total } } })[5]!
    expect(disk).toMatchObject({ tone: 'calm', detail: '50 GB free' })
    expect(Math.round(disk.pct!)).toBe(90)
    expect(desktopStatus(disk, 'wide')).toBe('90% · 50 GB free')
    expect(desktopStatus(disk, 'medium')).toBe('90% · 50G free')
  })

  test('severity: quota 50/80/95, system by its own limits; no reading is unknown', () => {
    const tone = (pct: number) => meters({ ...INPUTS, windows: [{ kind: 'five_hour', percentUsed: pct }] })[0]!.tone
    expect([tone(10), tone(50), tone(80), tone(95)]).toEqual(['calm', 'caution', 'high', 'critical'])
    const sys = meters({ ...INPUTS, sys: { ...SAMPLE, cpu: 90, disk: { used: 98, total: 100 } } }).slice(3)
    expect(sys.map(m => m.tone)).toEqual(['high', 'caution', 'critical'])
    expect(meters(INPUTS)[2]).toMatchObject({ key: 'ctx', pct: 42, tone: 'calm', detail: '84k/200k' })
    const ctx = (percent: number) => meters({ ...INPUTS, context: { ...CONTEXT, percent } })[2]!.tone
    expect([ctx(59), ctx(60), ctx(80), ctx(90)]).toEqual(['calm', 'caution', 'high', 'critical'])
    expect(meters({ ...INPUTS, context: { window: 1_000_000 } })[2]).toMatchObject({ pct: null, tone: 'unknown' })
    expect(meters({ ...INPUTS, context: null })[2]!.pct).toBeNull()
    expect(meters({ ...INPUTS, context: { tokens: 250_000, window: 1_000_000 } })[2]).toMatchObject({ pct: 25, detail: '250k/1M' })
    expect(meters({ ...INPUTS, now: NOW + 60_000 }).slice(3).every(m => m.pct === null)).toBe(true)
    expect(meters({ ...INPUTS, now: NOW + 6 * 86_400_000 })[1]!.pct).toBeNull()
  })

  test('terminal: the roomiest density that fits, never wider than the room', () => {
    const ms = meters(INPUTS)
    for (const [columns, density] of [[200, 'wide'], [100, 'medium'], [60, 'narrow'], [30, 'tiny']] as const) {
      const band = terminalLayout(ms, columns)
      expect(band.density).toBe(density)
      if (density !== 'tiny') expect(band.width).toBeLessThanOrEqual(columns)
    }
  })

  test('desktop: the roomiest density whose estimate fits; the 765 px band of the screenshot is not medium', () => {
    const ms = meters({ ...INPUTS, sys: { ...SAMPLE, disk: { used: 443_885_096_960, total: 494_384_795_648 } } })
    // 765 px / 8 px a cell ≈ 95 columns: medium (~970 px) drew meters over each other.
    const shot = desktopLayout(ms, 95)
    expect(shot.density).toBe('compact')
    expect(shot.width).toBeLessThanOrEqual(95 * 8)
    expect(shot.quota.map(d => d.label)).toEqual(['5h', 'Wk', 'Ctx'])
    expect(shot.quota.map(d => d.status)).toEqual(['0% · 2h24m', '20% · 5d14h', '42%'])
    expect(shot.system.map(d => d.status)).toEqual(['19%', '83%', '50G free'])
    expect(desktopLayout(ms, 200).density).toBe('wide')
    expect(desktopLayout(ms, 135).density).toBe('medium')
    expect(desktopLayout(ms, 70).density).toBe('narrow')
    const tiny = desktopLayout(ms, 40)
    expect(tiny).toMatchObject({ density: 'narrow', isOverflowing: true })
  })

  test('desktop: status text and SVG bar', () => {
    const [fiveHour, week, ctx, , mem] = meters(INPUTS)
    expect(desktopStatus(week!, 'wide')).toBe('20% · resets in 5d 14h')
    expect(desktopStatus(week!, 'medium')).toBe('20% · 5d 14h')
    expect(desktopStatus(week!, 'compact')).toBe('20% · 5d14h')
    expect(desktopStatus(week!, 'narrow')).toBe('20%')
    expect(desktopStatus(ctx!, 'wide')).toBe('42% · 84k/200k')
    expect(desktopStatus(ctx!, 'compact')).toBe('42%')
    expect(desktopStatus(mem!, 'wide')).toBe('83% · 19.9/24 GB')
    expect(barSvg(week!, { width: 64, height: 6 })).toContain('<rect width="12.8" height="6" fill="#67AD6B"')
    expect(barSvg(fiveHour!, { width: 64, height: 6 })).not.toContain('#67AD6B')
  })

  test('sampler lines split across pieces are joined; garbage is dropped', () => {
    const split = lineSplitter()
    const line = JSON.stringify(SAMPLE)
    expect(split(line.slice(0, 10))).toEqual([])
    expect(split(`${line.slice(10)}\nnoise\n`).map(parseSample)).toEqual([SAMPLE, null])
  })
})

const BAND = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

async function start($: any, on: any, surface: string) {
  on('clock.now', async () => ({ value: NOW }))
  on('session.start', async () => ({ cwd: '/' }))
  // The engine's own band, drawn when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('command.register', async (_$: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.usage', async () => ({ value: { startedAt: NOW, context: { ...CONTEXT, breakdown: { gridRows: [] } }, rateLimits: WINDOWS } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: `${JSON.stringify(SAMPLE)}\n` }
    return { value: { code: 0, signal: null } }
  })
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  // The sampler loop runs on after session.start returns: wait for its first write.
  for (let i = 0; i < 50; i += 1) {
    const ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(200) })
    const text = (await ui.find({ key: 'pillbar-cpu' }))?.text ?? ''
    await ui.unmount()
    if (text.includes('19%')) return
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the sampler never wrote a sample')
}

const runPillbar = ($: any) => $.command.run({ command: 'pillbar', args: '' })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band draws all six meters at every width`, async ($, on) => {
    await start($, on, surface)
    for (const columns of [200, 100, 60, 30]) {
      const ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(columns) })
      for (const key of ['5h', 'week', 'ctx', 'cpu', 'mem', 'disk']) {
        expect(await ui.find({ key: `pillbar-${key}` })).toBeDefined()
      }
      expect(await ui.find({ key: 'pillbar-fable' })).toBeUndefined()
      // The band beneath (clawd-run's game, here the engine's) still draws, above the meters.
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      expect((await ui.find({ key: 'pillbar-week' }))?.text).toContain('20%')
      expect((await ui.find({ key: 'pillbar-ctx' }))?.text).toContain('42%')
      await ui.unmount()
    }
  })

  test(`${surface}: /pillbar hides the band and shows it again`, async ($, on) => {
    await start($, on, surface)
    expect((await runPillbar($)).text).toContain('hidden')
    let ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(200) })
    expect(await ui.find({ key: 'pillbar' })).toBeUndefined()
    await ui.unmount()
    expect((await runPillbar($)).text).toContain('shown')
    ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(200) })
    expect(await ui.find({ key: 'pillbar' })).toBeDefined()
    await ui.unmount()
  })
}
