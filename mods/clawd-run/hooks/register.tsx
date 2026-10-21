import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const turn = atom({ plugin: 'clawd-run', key: 'turn' } as const, null)
const isPreview = atom({ plugin: 'clawd-run', key: 'isPreview' } as const, false)
const spend = atom({ plugin: 'clawd-run', key: 'spend' } as const, { tokens: 0, usd: null })

export const register: Register = (on, options) => {
  const delay = Number(options.delaySeconds)
  const delayMs = Math.max(0, Number.isFinite(delay) ? delay : 20) * 1000
  // the session's cost when the running main turn began, and that turn
  let usdAtStart: number | null = null
  let runningTurn: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawd-run',
      description: 'Show or hide Clawd\'s game above the prompt right now',
    })

    return next(e)
  })

  on('command.run', { command: 'clawd-run' }, async $ => {
    const shown = await update($, isPreview, was => !was)

    return { text: shown ? 'Clawd is playing.' : 'Clawd went back to watching.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const turnId = e.turnId
      runningTurn = turnId
      // no figure (no ledger, or no answer): the tally shows tokens alone
      usdAtStart = await $.session.usage().then(
        now => now.cost?.usd ?? null,
        () => null,
      )
      await update($, spend, () => ({ tokens: 0, usd: usdAtStart === null ? null : 0 }))
      await update($, turn, () => ({ turnId, isLong: false }))
      $.clock.after(delayMs, () => {
        void update($, turn, now => (now?.turnId === turnId ? { turnId, isLong: true } : now))
      })
    }

    return next(e)
  })

  // every response in the running turn, its subagents' included, adds its
  // tokens; the dollars are the session's cost since the turn began
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage
    if (runningTurn !== null && usage) {
      const tokens =
        usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      const usd = await $.session.usage().then(
        now => now.cost?.usd,
        () => undefined,
      )
      const since = usd === undefined || usdAtStart === null ? null : Math.max(0, usd - usdAtStart)
      await update($, spend, was => ({ tokens: was.tokens + tokens, usd: since }))
    }

    return response
  })

  on('turn.complete', async ($, e, next) => {
    const turnId = e.turnId
    if (runningTurn === turnId) runningTurn = null
    await update($, turn, now => (now?.turnId === turnId ? null : now))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, turn)
    const used = await read($, spend)
    const isLong = e.props.isWorking && now?.isLong === true
    const isShown = isLong || (await read($, isPreview))
    const rows = Math.min(11, e.props.maxRows - 3)

    if (e.props.hasSurvey || !isShown || rows < 7 || e.surface === 'mobile' || e.surface === 'vscode') {
      return next(e)
    }

    const { Box, Client } = $.ui.resolve(e)
    // Another plugin's band (a meter row) may sit beneath: keep it under the
    // game, by the prompt, rather than drawing in its place.
    const below = await next(e)

    return (
      <Box key="clawd-run-stack" flexDirection="column">
        <Client
          key="clawd-run"
          module="./game.tsx"
          props={{
            rows,
            columns: e.props.bodyColumns,
            isWorking: e.props.isWorking,
            surface: e.surface,
            tokens: used.tokens,
            usd: used.usd,
          }}
          height={rows}
          width="100%"
        />
        {below}
      </Box>
    )
  })
}
