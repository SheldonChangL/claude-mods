// A one-row band above the prompt: the account's 5-hour and weekly windows and
// this session's context window, then this machine's CPU, memory and disk.
// Design by Codex: on Desktop one tinted SVG capsule per meter (capsule.ts),
// quota bars with a countdown to the reset; on the terminal thin `━━──` lines.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Context, ProbeStatus, SysSample, Window } from '../types'
import { GAP_CAPSULE, GAP_GROUP, capsuleLayout } from './capsule'
import type { Capsule } from './capsule'
import { TERMINAL_FILL, lineSplitter, mergeWindows, meters, parseQuotaLine, parseSample, parseWindows, terminalLayout } from './model'

const sys = atom({ plugin: 'pillbar', key: 'sys' } as const, null as SysSample | null)
const probe = atom({ plugin: 'pillbar', key: 'probe' } as const, 'starting' as ProbeStatus)
const windows = atom({ plugin: 'pillbar', key: 'windows' } as const, [] as Window[])
const context = atom({ plugin: 'pillbar', key: 'context' } as const, null as Context | null)
const isHidden = atom({ plugin: 'pillbar', key: 'isHidden' } as const, false)

const INTERVAL_MS = 3000
/** CPU is drawn as the mean of the last 30 s of samples (local every 3 s, the daemon's every 5 s). */
const CPU_WINDOW_MS = 30_000
const RETRIES = 3

const toWindows = (limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Window[] =>
  limits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

/** The figures alone: never the /context breakdown. */
const toContext = ({ tokens, window, percent }: Context): Context => ({ tokens, window, percent })

/** The last quota windows any session read, kept across sessions and restarts. */
const STORE_WINDOWS = 'windows'
/** How often a session picks up a reading another session stored. */
const STORE_POLL_MS = 60_000

/**
 * Lays `fresh` readings (and what `$.store` holds) over the known windows. A
 * session the engine has not yet answered reports no windows: that keeps the
 * last reading rather than blanking it.
 */
async function rememberWindows($: EngineInterface, fresh: readonly Window[]) {
  const now = await $.clock.now()
  const stored = parseWindows(await $.store.get(STORE_WINDOWS))
  // The store holds the newest reading any session took, so it outranks this
  // session's earlier copy; a fresh reading outranks both.
  const merged = mergeWindows(mergeWindows(await read($, windows), stored, now), fresh, now)
  await update($, windows, () => merged)
  if (fresh.length > 0) await $.store.set(STORE_WINDOWS, merged)
}

/** `node` on PATH, then the newest nvm node, then Homebrew's and /usr/local's. */
async function nodeCandidates($: EngineInterface): Promise<string[]> {
  const found = ['node']
  let home = ''
  try {
    home = (await $.env.get('HOME')) ?? ''
  } catch {
    // no environment here
  }
  if (home) {
    try {
      const versions = (await $.fs.list(`${home}/.nvm/versions/node`))
        .filter(e => e.kind === 'dir' && /^v\d+/.test(e.name))
        .map(e => e.name)
        .sort((a, b) => Number(b.slice(1).split('.')[0]) - Number(a.slice(1).split('.')[0]))
      for (const v of versions.slice(0, 2)) found.push(`${home}/.nvm/versions/node/${v}/bin/node`)
    } catch {
      // no nvm here
    }
  }
  found.push('/opt/homebrew/bin/node', '/usr/local/bin/node')
  return found
}

// Module memory: a reload starts the sampler over (the old child is killed).
let isProbing = false

async function runProbe($: EngineInterface) {
  if (isProbing) return
  isProbing = true
  // The feed reads the JetDeck daemon (vitals and the plan usage) when it can,
  // and samples locally when it cannot (bin/feed.mjs).
  const script = `${$.plugin.root}/bin/feed.mjs`
  // Desktop may start the engine without nvm's PATH, so after `node` itself
  // the usual install places are tried by path: no shell, no rc files run.
  const candidates = (await nodeCandidates($)).map(node => [node, script, String(INTERVAL_MS)])
  const cpu: { at: number; value: number }[] = []
  try {
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      for (const argv of candidates) {
        let gotLine = false
        try {
          const split = lineSplitter()
          for await (const piece of $.process.spawn({ argv })) {
            if (!('text' in piece) || piece.stream !== 'stdout') continue
            for (const line of split(piece.text)) {
              const quota = parseQuotaLine(line)
              if (quota) {
                await rememberWindows($, quota)
                continue
              }
              const sample = parseSample(line)
              if (!sample) continue
              cpu.push({ at: sample.at, value: sample.cpu })
              while (cpu.length > 1 && sample.at - cpu[0]!.at > CPU_WINDOW_MS) cpu.shift()
              const mean = Math.round((cpu.reduce((a, b) => a + b.value, 0) / cpu.length) * 10) / 10
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

let isPolling = false

/** Picks up readings other sessions store, and drops windows that reset. */
async function pollStoredWindows($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    for (;;) {
      await $.clock.sleep(STORE_POLL_MS)
      await rememberWindows($, [])
    }
  } catch {
    // The module unloaded mid-sleep.
  } finally {
    isPolling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'pillbar', description: 'Show or hide the quota and system meters above the prompt' })
    try {
      const usage = await $.session.usage()
      await rememberWindows($, toWindows(usage.rateLimits))
      await update($, context, () => toContext(usage.context))
    } catch {}
    void runProbe($)
    void pollStoredWindows($)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await rememberWindows($, toWindows(e.rateLimits))
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
      const band = capsuleLayout(ms, e.props.bodyColumns)
      // Capsules never shrink (a squeezed one drew over its neighbour); a row
      // still too wide wraps whole capsules instead.
      const capsule = (c: Capsule) => (
        <Box key={`pillbar-${c.key}`} flexShrink={0}>
          <Svg source={c.svg} alt={c.alt} width={c.width} height={32} />
        </Box>
      )
      const group = (cs: Capsule[]) => (
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap={GAP_CAPSULE} flexShrink={0}>
          {cs.map(capsule)}
        </Box>
      )
      return stack(
        <Box key="pillbar" flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={GAP_GROUP} rowGap={1}>
          {group(band.quota)}
          {group(band.system)}
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
