import { expect, mock, test } from 'claude-code/testing'

const band = (isWorking: boolean) => ({
  plugin: 'clawd-run',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const)

test('Clawd plays only once a turn has run long, and stops with it', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'clawd-run' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.turn.start({ text: 'refactor everything', turnId: `t-${surface}` })
    const ui = await $.ui.mount({ ...band(true), surface })
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()

    await clock.advance(19_000)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()

    await clock.advance(2_000)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /CLAWD/, in: 'clawd-run' })).toBeDefined()
    await ui.resize({ columns: 80, rows: 11 })
    await ui.advance(5_000)
    const hud = await ui.find({ type: 'Text', text: /CLAWD/, in: 'clawd-run' })
    expect(hud?.text).toMatch(/⏱ 0:05/)

    await $.turn.complete({ turnId: `t-${surface}`, answer: 'done', durationMs: 21_000, isAborted: false, reason: 'answer' })
    await ui.redraw(band(false).props)
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/clawd-run shows the game without a turn, and hides it again', async ($, on) => {
  on('command.register', () => ({ value: { command: 'clawd-run' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const shown = await $.command.run({ command: 'clawd-run', args: '' } as never)
  expect(JSON.stringify(shown)).toMatch(/playing/)
  const ui = await $.ui.mount({ ...band(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /preview/, in: 'clawd-run' })).toBeDefined()

  await $.command.run({ command: 'clawd-run', args: '' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('the arrows take over from the autopilot, which comes back when idle', async ($, on) => {
  on('command.register', () => ({ value: { command: 'clawd-run' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'clawd-run', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(false), surface })
    await ui.resize({ columns: 80, rows: 11 })
    await ui.advance(500)
    expect(await ui.find({ type: 'Text', text: /click to play/, in: 'clawd-run' })).toBeDefined()

    await ui.key({ key: 'right', in: 'clawd-run' })
    await ui.key({ key: 'up', in: 'clawd-run' })
    await ui.advance(100)
    expect(await ui.find({ type: 'Text', text: /← → run/, in: 'clawd-run' })).toBeDefined()

    await ui.advance(6_500)
    expect(await ui.find({ type: 'Text', text: /click to play/, in: 'clawd-run' })).toBeDefined()
    await ui.unmount()
  }
})
