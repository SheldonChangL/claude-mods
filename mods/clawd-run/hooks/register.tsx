import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const turn = atom({ plugin: 'clawd-run', key: 'turn' } as const, null)
const isPreview = atom({ plugin: 'clawd-run', key: 'isPreview' } as const, false)

export const register: Register = (on, options) => {
  const delay = Number(options.delaySeconds)
  const delayMs = Math.max(0, Number.isFinite(delay) ? delay : 20) * 1000

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
      await update($, turn, () => ({ turnId, isLong: false }))
      $.clock.after(delayMs, () => {
        void update($, turn, now => (now?.turnId === turnId ? { turnId, isLong: true } : now))
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const turnId = e.turnId
    await update($, turn, now => (now?.turnId === turnId ? null : now))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, turn)
    const isLong = e.props.isWorking && now?.isLong === true
    const isShown = isLong || (await read($, isPreview))
    const rows = Math.min(11, e.props.maxRows - 3)

    if (e.props.hasSurvey || !isShown || rows < 7 || e.surface === 'mobile' || e.surface === 'vscode') {
      return next(e)
    }

    const { Client } = $.ui.resolve(e)

    return (
      <Client
        key="clawd-run"
        module="./game.tsx"
        props={{ rows, columns: e.props.bodyColumns, isWorking: e.props.isWorking }}
        height={rows}
        width="100%"
      />
    )
  })
}
