// A one-row band above the prompt: the account's 5-hour and weekly windows and
// this session's context window, then this machine's CPU, memory and disk. Design by Codex: on
// Desktop a label, a rounded SVG track and `20% · resets in 5d 14h`, as
// Claude's /usage panel draws them; on the terminal thin `━━──` lines.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Context, ProbeStatus, SysSample, Window } from '../types'
import { TERMINAL_FILL, desktopLayout, lineSplitter, meters, parseSample, terminalLayout } from './model'
import type { DesktopMeter } from './model'

const sys = atom({ plugin: 'pillbar', key: 'sys' } as const, null as SysSample | null)
const probe = atom({ plugin: 'pillbar', key: 'probe' } as const, 'starting' as ProbeStatus)
const windows = atom({ plugin: 'pillbar', key: 'windows' } as const, [] as Window[])
const context = atom({ plugin: 'pillbar', key: 'context' } as const, null as Context | null)
const isHidden = atom({ plugin: 'pillbar', key: 'isHidden' } as const, false)

const INTERVAL_MS = 3000
/** CPU is drawn as the mean of the last 30 s of samples. */
const CPU_WINDOW = Math.round(30_000 / INTERVAL_MS)
const RETRIES = 3

const toWindows = (limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Window[] =>
  limits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

/** The figures alone: never the /context breakdown. */
const toContext = ({ tokens, window, percent }: Context): Context => ({ tokens, window, percent })

// Module memory: a reload starts the sampler over (the old child is killed).
let isProbing = false

async function runProbe($: EngineInterface) {
  if (isProbing) return
  isProbing = true
  const script = `${$.plugin.root}/bin/sysprobe.mjs`
  const candidates = [
    ['node', script, String(INTERVAL_MS)],
    // Desktop may start the engine without nvm's PATH: ask an interactive zsh.
    ['/bin/zsh', '-ilc', 'exec node "$0" "$1"', script, String(INTERVAL_MS)],
  ]
  const cpu: number[] = []
  try {
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      for (const argv of candidates) {
        let gotLine = false
        try {
          const split = lineSplitter()
          for await (const piece of $.process.spawn({ argv })) {
            if (!('text' in piece) || piece.stream !== 'stdout') continue
            for (const line of split(piece.text)) {
              const sample = parseSample(line)
              if (!sample) continue
              cpu.push(sample.cpu)
              if (cpu.length > CPU_WINDOW) cpu.shift()
              const mean = Math.round((cpu.reduce((a, b) => a + b, 0) / cpu.length) * 10) / 10
              if (!gotLine) await update($, probe, () => 'live')
              gotLine = true
              await update($, sys, () => ({ ...sample, cpu: mean }))
            }
          }
        } catch {
          // Could not start (no node on this PATH) or the module is unloading.
        }
        if (gotLine) break
      }
      // A child that read out and then died leaves its last sample to go stale.
      if ((await read($, sys)) === null) await update($, probe, () => 'failed')
      await $.clock.sleep(10_000 * (attempt + 1))
    }
  } catch {
    // The module unloaded mid-sleep.
  } finally {
    isProbing = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'pillbar', description: 'Show or hide the quota and system meters above the prompt' })
    try {
      const usage = await $.session.usage()
      await update($, windows, () => toWindows(usage.rateLimits))
      await update($, context, () => toContext(usage.context))
    } catch {}
    void runProbe($)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, windows, () => toWindows(e.rateLimits))
    if (e.changed.includes('context')) await update($, context, () => toContext(e.context))
    return next(e)
  })

  on('command.run', { command: 'pillbar' }, async $ => {
    const hidden = await update($, isHidden, v => !v)
    return { text: hidden ? 'Meters hidden. /pillbar shows them again.' : 'Meters shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const ms = meters({
      windows: await read($, windows),
      context: await read($, context),
      sys: await read($, sys),
      probe: await read($, probe),
      now: await $.clock.now(),
    })
    const { Box, Text } = $.ui.resolve(e)
    // Another plugin's band (clawd-run's game) may sit beneath: draw it above
    // the meters rather than in its place, so the meters stay by the prompt.
    const below = await next(e)
    const stack = (row: RenderElement) => (
      <Box key="pillbar-stack" flexDirection="column">
        {below}
        {row}
      </Box>
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const band = desktopLayout(ms, e.props.bodyColumns)
      // Meters never shrink (a squeezed one drew over its neighbour); one row
      // that is still too wide wraps whole meters instead.
      const meter = (d: DesktopMeter) => (
        <Box key={`pillbar-${d.key}`} flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          <Text size="caption" color="text">
            {d.label}
          </Text>
          <Svg source={d.svg} alt={d.alt} width={d.bar.width} height={d.bar.height} />
          <Text size="caption" color="subtle" tabular>
            {d.status}
          </Text>
        </Box>
      )
      return stack(
        <Box key="pillbar" flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={2} rowGap={0}>
          {band.quota.map(meter)}
          <Text color="inactive">│</Text>
          {band.system.map(meter)}
        </Box>,
      )
    }

    const band = terminalLayout(ms, e.props.bodyColumns)
    const isRoomy = band.density === 'wide' || band.density === 'medium'
    const parts = band.meters.flatMap((t, i) => {
      const joint =
        i === 0 ? [] : [<Text color="inactive">{isRoomy ? (ms[i]!.group !== ms[i - 1]!.group ? ' ║ ' : ' │ ') : ' '}</Text>]
      return [
        ...joint,
        <Box key={`pillbar-${t.key}`} flexDirection="row" flexShrink={0}>
          <Text color="text">{t.label}</Text>
          <Text color={t.tone === 'unknown' ? 'inactive' : 'text'}>{`${t.sep}${t.value}`}</Text>
          {t.filled || t.track ? <Text color={TERMINAL_FILL[t.tone]}>{`${t.sep}${t.filled}`}</Text> : null}
          {t.track ? <Text color="inactive">{t.track}</Text> : null}
          {t.detail ? <Text color="subtle">{` ${t.detail}`}</Text> : null}
        </Box>,
      ]
    })
    return stack(
      <Box key="pillbar" flexDirection="row" flexWrap="nowrap" overflow="hidden">
        {parts}
      </Box>,
    )
  })
}
