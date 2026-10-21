import { describe, expect, test } from 'claude-code/testing'

import { capsuleLayout, capsuleSvg, capsuleWidth, textPx } from '../hooks/capsule'
import {
  cells,
  countdown,
  diskTone,
  freeGigabytes,
  gigabytes,
  lineSplitter,
  mergeWindows,
  meters,
  parseSample,
  parseWindows,
  terminalLayout,
  tightCountdown,
} from '../hooks/model'

// The test runtime has timers; the hooks environment's lib does not declare them.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const NOW = Date.UTC(2026, 9, 21, 1, 0, 0)
const GIB = 1024 ** 3
const SAMPLE = { cpu: 19, mem: { used: 18.3 * GIB, total: 24 * GIB }, disk: { used: 437e9, total: 494.38e9 }, at: NOW - 1000 }
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 29, resetsAt: new Date(NOW + (4 * 60 + 4) * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + (2 * 24 + 3) * 3_600_000).toISOString() },
]
const CONTEXT = { tokens: 84_000, window: 200_000, percent: 42 }
const INPUTS = { windows: WINDOWS, context: CONTEXT, sys: SAMPLE, probe: 'live' as const, now: NOW }

describe('model', () => {
  test('countdowns and sizes', () => {
    expect(countdown(NOW + 47 * 60_000, NOW)).toBe('47m')
    expect(countdown(NOW + 244 * 60_000, NOW)).toBe('4h 04m')
    expect(countdown(NOW + 51 * 3_600_000, NOW)).toBe('2d 3h')
    expect(countdown(NOW - 1, NOW)).toBe('')
    expect([tightCountdown('4h 04m'), tightCountdown('2d 3h'), tightCountdown('47m')]).toEqual(['4h04', '2d3h', '47m'])
    expect(gigabytes(18.3 * GIB, 24 * GIB)).toBe('18.3/24G')
    // Finder's figures for this Mac: 494.38 GB, about 57 GB free.
    expect(freeGigabytes(437e9, 494.38e9)).toBe('57G')
    expect(freeGigabytes(494.38e9 - 7.25e9, 494.38e9)).toBe('7.3G')
  })

  test('meters: values, details, compact details and the quota time marker', () => {
    const [fiveHour, week, ctx, cpu, mem, disk] = meters(INPUTS)
    expect(fiveHour).toMatchObject({ pct: 29, detail: '4h 04m', compact: '4h04', tone: 'calm' })
    // 4h04 of 5h left: 56 minutes, 18.7% of the window, gone.
    expect(Math.abs(fiveHour!.marker! - 56 / 300)).toBeLessThan(1e-3)
    expect(week).toMatchObject({ pct: 41, detail: '2d 3h', compact: '2d3h' })
    expect(Math.abs(week!.marker! - (1 - 51 / 168))).toBeLessThan(1e-3)
    expect(ctx).toMatchObject({ pct: 42, detail: '84k/200k', compact: '84k', marker: null })
    expect(cpu).toMatchObject({ pct: 19, detail: '', marker: null })
    expect(mem).toMatchObject({ detail: '18.3/24G', compact: '18.3G', tone: 'calm' })
    expect(disk).toMatchObject({ detail: '57G free', compact: '57G', tone: 'calm' })
    expect(Math.round(disk!.pct!)).toBe(88)
  })

  test('severity: amber at 75%, red at 90%; memory 85/95; disk by free space', () => {
    const tone = (pct: number) => meters({ ...INPUTS, windows: [{ kind: 'five_hour', percentUsed: pct }] })[0]!.tone
    expect([tone(74), tone(75), tone(90)]).toEqual(['calm', 'caution', 'critical'])
    const mem = (used: number) => meters({ ...INPUTS, sys: { ...SAMPLE, mem: { used, total: 100 } } })[4]!.tone
    expect([mem(76), mem(85), mem(95)]).toEqual(['calm', 'caution', 'critical'])
    expect([diskTone(57e9), diskTone(19e9), diskTone(9e9)]).toEqual(['calm', 'caution', 'critical'])
    expect(meters({ ...INPUTS, context: null })[2]).toMatchObject({ pct: null, tone: 'unknown' })
    expect(meters({ ...INPUTS, now: NOW + 60_000 }).slice(3).every(m => m.pct === null)).toBe(true)
    expect(meters({ ...INPUTS, now: NOW + 3 * 86_400_000 })[1]!.pct).toBeNull()
  })

  test('terminal: thin lines, the roomiest density that fits', () => {
    expect(cells(20, 8)).toEqual({ filled: '━━', track: '──────' })
    expect(cells(2, 3)).toEqual({ filled: '━', track: '──' })
    const ms = meters(INPUTS)
    for (const [columns, density] of [[200, 'wide'], [100, 'medium'], [60, 'narrow'], [30, 'tiny']] as const) {
      const band = terminalLayout(ms, columns)
      expect(band.density).toBe(density)
      if (density !== 'tiny') expect(band.width).toBeLessThanOrEqual(columns)
    }
  })

  test('stored windows: fresh readings win by kind, reset windows drop, junk is ignored', () => {
    const old = [{ kind: 'five_hour', percentUsed: 10, resetsAt: new Date(NOW - 1000).toISOString() }, WINDOWS[1]!]
    expect(mergeWindows(old, [], NOW)).toEqual([WINDOWS[1]])
    expect(mergeWindows(old, [WINDOWS[0]!], NOW)).toEqual(WINDOWS)
    expect(mergeWindows([WINDOWS[1]!], [{ ...WINDOWS[1]!, percentUsed: 50 }], NOW)[0]!.percentUsed).toBe(50)
    expect(parseWindows(JSON.parse(JSON.stringify(WINDOWS)))).toEqual(WINDOWS)
    expect(parseWindows([{ kind: 1 }, null, { kind: 'x', percentUsed: 'a' }])).toEqual([])
    expect(parseWindows('nope')).toEqual([])
  })

  test('sampler lines split across pieces are joined; garbage is dropped', () => {
    const split = lineSplitter()
    const line = JSON.stringify(SAMPLE)
    expect(split(line.slice(0, 10))).toEqual([])
    expect(split(`${line.slice(10)}\nnoise\n`).map(parseSample)).toEqual([SAMPLE, null])
  })
})

describe('capsules', () => {
  test("the 5h capsule matches Codex's reference geometry (217 px)", () => {
    const [fiveHour] = meters(INPUTS)
    expect(textPx('29%', 12)).toBe(21.6)
    expect(capsuleWidth(fiveHour!, 'full')).toBe(217)
    const svg = capsuleSvg(fiveHour!, 'full')
    expect(svg).toContain('width="217" height="32"')
    expect(svg).toContain('>5h</text>')
    expect(svg).toContain('>29%</text>')
    expect(svg).toContain('>4h 04m</text>')
    // The bar fill (29% of 48) and the marker (18.7% of 48 from x 54.4).
    expect(svg).toContain('width="13.92" height="6" fill="#4ADE80"')
    expect(svg).toMatch(/class="marker" d="M63\.\d+ 10v12"/)
    expect(svg).toContain('@media (prefers-color-scheme:light)')
  })

  test('severity swaps the hue; no reading draws an em dash, escaped, dimmed', () => {
    const hot = meters({ ...INPUTS, windows: [{ ...WINDOWS[0]!, percentUsed: 93 }] })[0]!
    expect(capsuleSvg(hot, 'full')).toContain('stroke="#EF4444"')
    const none = meters({ ...INPUTS, context: null })[2]!
    const svg = capsuleSvg(none, 'medium')
    expect(svg).toContain('>&#8212;</text>')
    expect(svg).toContain('opacity=".6"')
    expect(svg).not.toContain('class="divider"')
  })

  test('compact keeps the quota bars and marker, drops the system bars', () => {
    const [fiveHour, , , cpu] = meters(INPUTS)
    expect(capsuleSvg(fiveHour!, 'compact')).toContain('class="marker"')
    expect(capsuleSvg(cpu!, 'compact')).not.toContain('class="track"')
    expect(capsuleSvg(fiveHour!, 'tiny')).not.toContain('class="track"')
  })

  test('one density for the row: full when wide, compact at the 765 px band, tiny below', () => {
    const ms = meters(INPUTS)
    expect(capsuleLayout(ms, 200).density).toBe('full')
    const shot = capsuleLayout(ms, 95)
    expect(shot.density).toBe('compact')
    expect(shot.width).toBeLessThanOrEqual(95 * 8)
    expect(shot.quota.map(c => c.key)).toEqual(['5h', 'week', 'ctx'])
    expect(shot.system.map(c => c.key)).toEqual(['cpu', 'mem', 'disk'])
    expect(capsuleLayout(ms, 70).density).toBe('tiny')
    expect(capsuleLayout(ms, 40)).toMatchObject({ density: 'tiny', isOverflowing: true })
  })
})

const BAND = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

/** `$.store` beneath the plugin, readable by the test. */
function stubStore(on: any, entries: Record<string, unknown>) {
  const store = new Map(Object.entries(entries))
  on('store.get', async (_$: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async (_$: unknown, e: any) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return store
}

async function start($: any, on: any, surface: string, { rateLimits = WINDOWS, stored }: { rateLimits?: unknown[]; stored?: unknown } = {}) {
  const store = stubStore(on, stored === undefined ? {} : { windows: stored })
  on('clock.now', async () => ({ value: NOW }))
  on('session.start', async () => ({ cwd: '/' }))
  // The engine's own band, drawn when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('command.register', async (_$: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.usage', async () => ({ value: { startedAt: NOW, context: { ...CONTEXT, breakdown: { gridRows: [] } }, rateLimits } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: `${JSON.stringify(SAMPLE)}\n` }
    return { value: { code: 0, signal: null } }
  })
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  // The sampler loop runs on after session.start returns: wait for its first write.
  for (let i = 0; i < 50; i += 1) {
    const ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(200) })
    const cpu = await ui.find({ key: 'pillbar-cpu' })
    await ui.unmount()
    if (JSON.stringify(cpu ?? '').includes('19%')) return store
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the sampler never wrote a sample')
}

const runPillbar = ($: any) => $.command.run({ command: 'pillbar', args: '' })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band draws all six meters at every width, above nothing it replaces`, async ($, on) => {
    await start($, on, surface)
    for (const columns of [200, 100, 60, 30]) {
      const ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(columns) })
      for (const key of ['5h', 'week', 'ctx', 'cpu', 'mem', 'disk']) {
        expect(await ui.find({ key: `pillbar-${key}` })).toBeDefined()
      }
      expect(JSON.stringify(await ui.find({ key: 'pillbar-week' }))).toContain('41%')
      // The band beneath (clawd-run's game, here the engine's) still draws.
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`${surface}: after a restart, before the engine has a reading, the stored quota shows`, async ($, on) => {
    // The engine reports no windows yet; the store holds the last session's reading.
    await start($, on, surface, { rateLimits: [], stored: WINDOWS })
    const ui = await $.ui.mount({ plugin: 'pillbar', surface, ...BAND(200) })
    expect(JSON.stringify(await ui.find({ key: 'pillbar-5h' }))).toContain('29%')
    expect(JSON.stringify(await ui.find({ key: 'pillbar-week' }))).toContain('41%')
    await ui.unmount()
  })

  test(`${surface}: a fresh reading is stored for the next session`, async ($, on) => {
    const store = await start($, on, surface)
    expect(parseWindows(store.get('windows'))).toEqual(WINDOWS)
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
