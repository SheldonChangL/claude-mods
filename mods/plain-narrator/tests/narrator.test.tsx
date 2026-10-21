import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'plain-narrator',
  component: 'Pane',
  requestId: 'plain-narrator',
  props: {
    title: 'Claude 在做什麼',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('thinking is narrated by haiku into the pane, on every surface', async ($, on) => {
  const asked: string[] = []
  on('command.register', () => ({ value: { command: 'narrator' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', (_, e) => {
    asked.push(e.model)
    return {
      value: {
        isAnswered: true,
        text: 'Claude 正在研究要怎麼加旁白面板。',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('turn.step', async function* (_, e) {
    yield { kind: 'thinking', index: 0, text: 'Let me look at the pane API first.' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain
  }

  for (let i = 0; i < 20 && asked.length === 0; i++) await Promise.resolve()
  expect(asked[0]).toBe('haiku')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ type: 'Text', text: /旁白面板/ })
    expect(row?.text).toBe('Claude 正在研究要怎麼加旁白面板。')
    await ui.unmount()
  }
})

test('tool arguments reach haiku so it can tell the intent', async ($, on) => {
  const prompts: string[] = []
  on('command.register', () => ({ value: { command: 'narrator' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', (_, e) => {
    prompts.push(typeof e.prompt === 'string' ? e.prompt : '')
    return {
      value: {
        isAnswered: true,
        text: 'Claude 在找除錯紀錄。',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('turn.step', async function* (_, e) {
    yield { kind: 'tool', index: 0, id: 'tu1', name: 'Bash' }
    yield { kind: 'input', index: 0, json: '{"command":"ls ~/.claude/debug",' }
    yield { kind: 'input', index: 0, json: '"description":"Search debug logs"}' }
    yield { kind: 'stop', stopReason: 'tool_use', usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain
  }
  for (let i = 0; i < 20 && prompts.length === 0; i++) await Promise.resolve()

  expect(prompts[0]).toContain('Bash｜description=Search debug logs｜command=ls ~/.claude/debug')
})

test('the clear button empties the pane', async ($, on) => {
  on('command.register', () => ({ value: { command: 'narrator' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Claude 在整理檔案。',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: '我來整理一下檔案。' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 20 && !(await ui.find({ type: 'Text', text: /整理檔案/ })); i++) await Promise.resolve()
  expect((await ui.find({ type: 'Text', text: /整理檔案/ }))?.text).toBe('Claude 在整理檔案。')

  await ui.press({ key: 'narrator-clear' })
  for (let i = 0; i < 20 && (await ui.find({ type: 'Text', text: /整理檔案/ })); i++) await Promise.resolve()
  expect(await ui.find({ type: 'Text', text: /整理檔案/ })).toBeUndefined()
  await ui.unmount()
})
