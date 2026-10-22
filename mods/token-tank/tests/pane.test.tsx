import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'token-tank',
  component: 'Pane',
  requestId: 'token-tank',
  props: { title: 'Token Tank', isFocused: false, bodyColumns: 30, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const BAND = (isWorking: boolean) =>
  ({
    plugin: 'token-tank',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 14, bodyColumns: 120, scroll: { offset: 0, bodyRows: 14 }, view: {} },
  }) as const

const USAGE = { input_tokens: 4000, output_tokens: 2000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, model: 'test' }
const turnDone = ($: any, turnId: string, usage = USAGE) => $.turn.complete({ turnId, answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage })

function setup(on: any) {
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  mock.env(on, { LANG: 'zh_TW.UTF-8' })
  on('command.register', () => ({ value: { command: 'fish' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: 'engine' }))
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return clock
}

test('/fish pins the band; coins minted by turns lie on the floor and are picked up there', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 6; i++) await turnDone($, `t${i}`)
  await turnDone($, 't0') // the same turn again must not pay twice

  // Not pinned, no long turn: the band is only what lies beneath.
  const idle = await $.ui.mount({ ...BAND(false), surface: 'desktop' })
  expect(await idle.find({ type: 'Svg' })).toBeUndefined()
  expect(await idle.find({ type: 'Text', text: /beneath/ })).toBeDefined()
  await idle.unmount()

  // @ts-ignore the command input type is too deep for tsc here
  const pinned = await $.command.run({ command: 'fish', args: '' } as never)
  expect(String((pinned as { text?: string }).text)).toMatch(/顯示/)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND(false), surface })
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /缸底有 \d+ 枚金幣/ })).toBeDefined()
    await ui.press({ key: 'coin-guppy-a' })
    await ui.press({ key: 'coin-clownfish-b' })
    expect(await ui.find({ type: 'Text', text: /魚還在累積能量/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /🪙 \d/ })).toBeDefined()
    await ui.unmount()
    await turnDone($, `again-${surface}`, { ...USAGE, output_tokens: 20000 })
  }

  // @ts-ignore
  await $.command.run({ command: 'fish', args: '' } as never)
  const off = await $.ui.mount({ ...BAND(false), surface: 'desktop' })
  expect(await off.find({ type: 'Svg' })).toBeUndefined()
  await off.unmount()
})

test('a long running turn shows the band by itself', async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 'long-1' })
  const early = await $.ui.mount({ ...BAND(true), surface: 'desktop' })
  expect(await early.find({ type: 'Svg' })).toBeUndefined()
  await early.unmount()
  await clock.advance(21_000)
  const late = await $.ui.mount({ ...BAND(true), surface: 'desktop' })
  expect(await late.find({ type: 'Svg' })).toBeDefined()
  await late.unmount()
  // A survey takes the band back.
  const survey = await $.ui.mount({ ...BAND(true), props: { ...BAND(true).props, hasSurvey: true }, surface: 'desktop' })
  expect(await survey.find({ type: 'Svg' })).toBeUndefined()
  await survey.unmount()
})

test('the narrow pane sells a fish, feeds it and flips a setting', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /🐟 2\/10/ })).toBeDefined()
  // A new game holds 150 coins: a guppy (80) is affordable, a second one is not.
  await ui.press({ key: 'buy-guppy' })
  expect(await ui.find({ type: 'Text', text: /🐟 3\/10/ })).toBeDefined()
  // With 70 coins left the guppy card offers no button, only the words.
  expect(await ui.find({ type: 'Button', key: 'buy-guppy' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /金幣不足/ })).toBeDefined()
  // Locked species show no name or art.
  expect(await ui.find({ type: 'Text', text: /錦鯉/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /？？？/ })).toBeDefined()

  await ui.press({ key: 'nav-fish' })
  await ui.press({ key: 'pick-guppy-a' })
  expect(await ui.find({ type: 'Text', text: /XP/ })).toBeDefined()
  await ui.press({ key: 'feed-guppy-a' })
  expect(await ui.find({ type: 'Text', text: /🍽 100%/ })).toBeDefined()

  await ui.press({ key: 'nav-settings' })
  await ui.press({ key: 'toggle-showBand' })
  await ui.unmount()
  // @ts-ignore
  await $.command.run({ command: 'fish', args: '' } as never)
  const band = await $.ui.mount({ ...BAND(false), surface: 'desktop' })
  expect(await band.find({ type: 'Svg' })).toBeUndefined()
  await band.unmount()
})

test('a passing test command pays a reward once per cooldown', async ($, on) => {
  setup(on)
  on('tool.call', (() => ({ result: { stdout: 'ok', stderr: '', interrupted: false } })) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // @ts-ignore the tool-call input type is too deep for tsc 5.6 to instantiate
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  // @ts-ignore
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  // Rewards are paid when the turn ends.
  await turnDone($, 'reward-turn', { ...USAGE, input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'nav-settings' })
  expect(await ui.find({ type: 'Text', text: /測試通過 1/ })).toBeDefined()
  // 150 to start + 8 for the one rewarded test run
  expect(await ui.find({ type: 'Text', text: /🪙 158/ })).toBeDefined()
  await ui.unmount()
})


test('a tap on the band drops food on open water and startles a fish on its lane', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // A few turns make the fish hungry enough to want food (a full fish keeps the pantry closed).
  for (let i = 0; i < 6; i++) await turnDone($, `h${i}`)
  // @ts-ignore
  await $.command.run({ command: 'fish', args: '' } as never)
  const ui = await $.ui.mount({ ...BAND(false), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /🍤 10/ })).toBeDefined()
  // The top-right corner: no fish lane starts there.
  await ui.press({ key: 'tap-14-0' })
  expect(await ui.find({ type: 'Text', text: /🍤 9/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /你撒了飼料/ })).toBeDefined()
  await ui.unmount()
})


test('with a non-Chinese LANG the words are English and the first fish get English names', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('command.register', () => ({ value: { command: 'fish' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Token Tank/ })).toBeDefined()
  await ui.press({ key: 'nav-fish' })
  expect(await ui.find({ type: 'Button', text: /Clownfish/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Feed all/ })).toBeDefined()
  await ui.unmount()
})
