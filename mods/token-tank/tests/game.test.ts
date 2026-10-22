import { expect, test } from 'claude-code/testing'

import { applyTurn, effectiveTokens, energyOf, PENDING_CAP, reward } from '../game/economy'
import { collect, feed, levelUp, rename } from '../game/fish'
import { buyDecoration, buyFish, buyFood, isUnlocked } from '../game/shop'
import { appendLog, dayKey, mergeStates, migrate, newGame, rollDay } from '../game/state'
import type { GameState, Usage } from '../game/types'

const T0 = new Date(2026, 9, 21, 12, 0, 0).getTime()
const DAY = 86_400_000

function usage(input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  }
}
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s))
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
const withFish = (s: GameState, i: number, patch: Partial<GameState['fish'][number]>): GameState => ({
  ...s,
  fish: s.fish.map((f, j) => (j === i ? { ...f, ...patch } : f)),
})

test('effectiveTokens weighs each field and treats missing or bad fields as 0', async () => {
  expect(effectiveTokens(usage(1000, 500, 2000, 800))).toBe(3200)
  expect(effectiveTokens({ output_tokens: 100 } as Partial<Usage>)).toBe(200)
  expect(effectiveTokens({ input_tokens: NaN, output_tokens: Infinity, cache_read_input_tokens: 10 } as Usage)).toBe(1)
  expect(effectiveTokens(undefined)).toBe(0)
  expect(effectiveTokens(null)).toBe(0)
})

test('energy is linear to 15000 effective tokens, then a fifth as steep', async () => {
  expect(energyOf(1000)).toBe(1)
  expect(energyOf(15000)).toBe(15)
  expect(energyOf(20000)).toBe(16)
  expect(energyOf(0)).toBe(0)
})

test('applyTurn mints coins per fish into pending and keeps the fraction as carry', async () => {
  const s = newGame(T0)
  const { state, events } = applyTurn(s, { turnId: 't1', usage: usage(10000), now: T0 + 1000 })
  // guppy: 10 × 1.0 × 0.9 (hunger 80) × 1.04 (mood 70) = 9.36
  expect(state.fish[0]!.pending).toBe(9)
  expect(near(state.fish[0]!.carry, 0.36)).toBe(true)
  // clownfish: 10 × 1.15 × 0.936 = 10.764
  expect(state.fish[1]!.pending).toBe(10)
  expect(state.fish[0]!.state).toBe('spitCoin')
  expect(state.fish[0]!.xp).toBe(100)
  expect(state.fish[0]!.level).toBe(1)
  expect(events.filter((e) => e.kind === 'minted').length).toBe(2)
  expect(state.stats.totalCoinsMinted).toBe(19)
  expect(state.stats.todayTurns).toBe(1)
  expect(state.stats.totalEffectiveTokens).toBe(10000)
  expect(state.processedTurns).toEqual(['t1'])
  expect(state.revision).toBe(s.revision + 1)
  expect(state.coins).toBe(150)
})

test('small turns accumulate carry until a coin drops', async () => {
  let s = newGame(T0)
  const first = applyTurn(s, { turnId: 'small-0', usage: usage(100), now: T0 })
  expect(first.state.fish[0]!.pending).toBe(0)
  expect(first.state.fish[0]!.carry > 0).toBe(true)
  s = first.state
  let turns = 1
  while (s.fish[0]!.pending === 0 && turns < 30) {
    s = applyTurn(s, { turnId: `small-${turns}`, usage: usage(100), now: T0 + turns }).state
    turns++
  }
  expect(s.fish[0]!.pending).toBe(1)
  expect(turns > 5).toBe(true)
  expect(turns < 30).toBe(true)
})

test('a duplicate turnId is refused and credits nothing', async () => {
  const once = applyTurn(newGame(T0), { turnId: 'dup', usage: usage(5000), now: T0 }).state
  const twice = applyTurn(once, { turnId: 'dup', usage: usage(5000), now: T0 + 1 })
  expect(twice.state).toBe(once)
  expect(twice.events).toEqual([{ kind: 'refused', reason: 'duplicate-turn' }])
})

test('a turn with no usage only records the turnId', async () => {
  const s = newGame(T0)
  const { state, events } = applyTurn(s, { turnId: 'empty', usage: undefined, now: T0 })
  expect(events).toEqual([])
  expect(state.processedTurns).toEqual(['empty'])
  expect(state.fish[0]!.pending).toBe(0)
  expect(state.stats.totalTurns).toBe(0)
})

test('pending stops at PENDING_CAP', async () => {
  const s = withFish(newGame(T0), 0, { pending: PENDING_CAP - 2 })
  const { state, events } = applyTurn(s, { turnId: 'cap', usage: usage(15000), now: T0 })
  expect(state.fish[0]!.pending).toBe(PENDING_CAP)
  const minted = events.find((e) => e.kind === 'minted' && e.fishId === s.fish[0]!.id)
  expect(minted).toEqual({ kind: 'minted', fishId: s.fish[0]!.id, coins: 2, effective: 15000 })
  const full = applyTurn(state, { turnId: 'cap2', usage: usage(15000), now: T0 + 1 })
  expect(full.state.fish[0]!.pending).toBe(PENDING_CAP)
  expect(full.events.some((e) => e.kind === 'minted' && e.fishId === s.fish[0]!.id)).toBe(false)
})

test('a fish below 25 hunger turns hungry and says so', async () => {
  const s = withFish(newGame(T0), 0, { hunger: 26 })
  const { state, events } = applyTurn(s, { turnId: 'h', usage: usage(4000), now: T0 })
  expect(state.fish[0]!.state).toBe('hungry')
  expect(events.filter((e) => e.kind === 'hungry').length).toBe(1)
})

test('collect moves one fish or all fish into the wallet', async () => {
  const s = applyTurn(newGame(T0), { turnId: 't', usage: usage(10000), now: T0 }).state
  const one = collect(s, s.fish[0]!.id, T0 + 5)
  expect(one.state.coins).toBe(159)
  expect(one.state.fish[0]!.pending).toBe(0)
  expect(one.state.fish[1]!.pending).toBe(10)
  expect(one.events).toEqual([{ kind: 'collected', fishId: s.fish[0]!.id, coins: 9 }])
  const all = collect(s, null, T0 + 5)
  expect(all.state.coins).toBe(169)
  expect(all.state.stats.totalCoinsCollected).toBe(19)
  expect(all.state.stats.todayCoinsCollected).toBe(19)
  expect(collect(all.state, null, T0 + 6).events).toEqual([{ kind: 'refused', reason: 'nothing-to-collect' }])
})

test('feed needs food, and short on food feeds the hungriest first', async () => {
  const empty = { ...newGame(T0), food: 0 }
  const refused = feed(empty, null, T0)
  expect(refused.state).toBe(empty)
  expect(refused.events).toEqual([{ kind: 'refused', reason: 'no-food' }])

  const s = { ...withFish(newGame(T0), 1, { hunger: 10 }), food: 1 }
  const { state, events } = feed(s, null, T0 + 1)
  expect(state.food).toBe(0)
  expect(state.fish[1]!.hunger).toBe(40)
  expect(state.fish[1]!.state).toBe('feeding')
  expect(state.fish[0]!.hunger).toBe(80)
  expect(state.stats.feeds).toBe(1)
  expect(events).toEqual([{ kind: 'fed', fishId: null, count: 1 }])
})

test('buyFish checks unlocks, price and dex', async () => {
  const s = newGame(T0)
  expect(isUnlocked(s, 'tang')).toBe(true)
  expect(isUnlocked(s, 'angelfish')).toBe(false)
  expect(buyFish(s, 'angelfish', T0, 'x').events).toEqual([{ kind: 'refused', reason: 'locked' }])
  expect(buyFish(s, 'tang', T0, 'x').events).toEqual([{ kind: 'refused', reason: 'not-enough-coins' }])

  const rich = { ...s, coins: 1000 }
  const { state, events } = buyFish(rich, 'tang', T0, 'x')
  expect(state.coins).toBe(800)
  expect(state.fish.length).toBe(3)
  expect(state.fish[2]!.id).toBe('tang-x')
  expect(state.fish[2]!.name).toBe('藍倒吊')
  expect(state.dex).toEqual(['guppy', 'clownfish', 'tang'])
  expect(events).toEqual([{ kind: 'bought', what: 'fish', id: 'tang-x', price: 200 }])
  // Owned once, always for sale.
  const dexOnly = { ...newGame(T0), fish: [], dex: newGame(T0).dex.concat(['koi' as const]) }
  expect(isUnlocked(dexOnly, 'koi')).toBe(true)
})

test('buyDecoration and buyFood charge and place', async () => {
  const s = newGame(T0)
  const d = buyDecoration(s, 'coral', T0, 'q')
  expect(d.state.coins).toBe(60)
  const placed = d.state.decorations[3]
  expect(placed!.kind).toBe('coral')
  expect(placed!.y).toBe(150)
  expect(placed!.x >= 16 && placed!.x < 280).toBe(true)
  const f = buyFood(s, 4)
  expect(f.state.food).toBe(14)
  expect(f.state.coins).toBe(130)
  expect(buyFood(s, 0).events[0]!.kind).toBe('refused')
})

test('levelUp needs the next threshold of xp and 50 × level coins', async () => {
  const s = { ...withFish(newGame(T0), 0, { xp: 99 }), coins: 50 }
  const id = s.fish[0]!.id
  expect(levelUp(s, id, T0).events).toEqual([{ kind: 'refused', reason: 'not-enough-xp' }])
  const xpOk = withFish(s, 0, { xp: 100 })
  expect(levelUp({ ...xpOk, coins: 49 }, id, T0).events).toEqual([{ kind: 'refused', reason: 'not-enough-coins' }])
  const { state, events } = levelUp(xpOk, id, T0)
  expect(state.fish[0]!.level).toBe(2)
  expect(state.coins).toBe(0)
  expect(state.fish[0]!.state).toBe('happy')
  expect(events).toEqual([{ kind: 'levelUp', fishId: id, level: 2 }])
  const maxed = withFish(xpOk, 0, { level: 10, xp: 99999 })
  expect(levelUp(maxed, id, T0).events).toEqual([{ kind: 'refused', reason: 'max-level' }])
})

test('rename trims, caps at 12 code points and refuses empty', async () => {
  const s = newGame(T0)
  const id = s.fish[0]!.id
  expect(rename(s, id, '  小藍  ').state.fish[0]!.name).toBe('小藍')
  expect(rename(s, id, '🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟').state.fish[0]!.name).toBe('🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟🐟')
  expect(rename(s, id, '   ').events).toEqual([{ kind: 'refused', reason: 'empty-name' }])
})

test('reward pays, then cools down', async () => {
  const s = newGame(T0)
  const a = reward(s, { kind: 'edit', now: T0 })
  expect(a.state.coins).toBe(152)
  expect(a.state.stats.edits).toBe(1)
  const b = reward(a.state, { kind: 'edit', now: T0 + 30_000 })
  expect(b.state).toBe(a.state)
  expect(b.events).toEqual([{ kind: 'refused', reason: 'cooldown' }])
  expect(reward(a.state, { kind: 'edit', now: T0 + 61_000 }).state.coins).toBe(154)

  const t = reward(s, { kind: 'test', now: T0 })
  expect(t.state.coins).toBe(158)
  expect(t.state.fish[0]!.mood).toBe(85)
  expect(t.state.fish[0]!.state).toBe('happy')
  expect(t.state.stats.testsPassed).toBe(1)
  expect(reward(t.state, { kind: 'test', now: T0 + 179_000 }).events[0]!.kind).toBe('refused')
  expect(reward(s, { kind: 'commit', now: T0 }).state.coins).toBe(162)
})

test('migrate v2 keeps coins, fish, xp, pending and carry, and maps level', async () => {
  const v2 = {
    version: 2,
    coins: 345,
    fish: [
      { id: 'g1', species: 'guppy', name: '小藍', xp: 350, hunger: 60, carry: 0.4, pending: 7 },
      { id: 'x1', species: 'shark', name: 'Jaws', xp: 20, hunger: 50, carry: 0, pending: 3 },
    ],
    decorations: ['coral', 'castle'],
    totalEffectiveTokens: 9000,
  }
  const { state, migratedFrom, isReset } = migrate(v2, T0)
  expect(migratedFrom).toBe(2)
  expect(isReset).toBe(false)
  expect(state.schemaVersion).toBe(3)
  expect(state.coins).toBe(345)
  expect(state.fish.length).toBe(2)
  expect(state.fish[0]).toMatchObject({ id: 'g1', name: '小藍', xp: 350, level: 3, hunger: 60, carry: 0.4, pending: 7, mood: 70 })
  expect(state.fish[1]).toMatchObject({ id: 'x1', species: 'guppy', name: 'Jaws', xp: 20, level: 1, pending: 3 })
  expect(state.decorations.length).toBe(1)
  expect(state.decorations[0]!.kind).toBe('coral')
  expect(state.stats.totalEffectiveTokens).toBe(9000)
  expect(state.dex).toEqual(['guppy'])
})

test('migrate survives garbage: reset for unknown shapes, sanitize for broken v3', async () => {
  for (const raw of ['hello', 42, [1, 2], { foo: 1 }, { version: 7 }]) {
    const m = migrate(raw, T0)
    expect(m.isReset).toBe(true)
    expect(m.state.fish.length).toBe(2)
  }
  const fresh = migrate(undefined, T0)
  expect(fresh.isReset).toBe(false)
  expect(fresh.state.coins).toBe(150)

  const broken = {
    schemaVersion: 3,
    coins: NaN,
    food: -4,
    fish: [{ species: 'koi', hunger: 500, mood: -3, pending: 1000, carry: 'x', level: 99 }, null, 'fish'],
    decorations: [{ kind: 'rock' }, { kind: 'castle' }],
    log: 'nope',
    processedTurns: [1, 'a'],
    stats: { totalTurns: 'many' },
    settings: { theme: 'lava' },
  }
  const { state, isReset } = migrate(broken, T0)
  expect(isReset).toBe(false)
  expect(state.coins).toBe(0)
  expect(state.food).toBe(0)
  expect(state.fish.length).toBe(1)
  expect(state.fish[0]).toMatchObject({ species: 'koi', hunger: 100, mood: 0, pending: PENDING_CAP, carry: 0, level: 10 })
  expect(state.decorations.length).toBe(1)
  expect(state.log).toEqual([])
  expect(state.processedTurns).toEqual(['a'])
  expect(state.stats.totalTurns).toBe(0)
  expect(state.settings.theme).toBe('ocean')
  expect(state.dex).toEqual(['koi'])

  const many = { ...newGame(T0), fish: Array.from({ length: 15 }, (_, i) => ({ ...newGame(T0).fish[0], id: `f${i}` })) }
  expect(migrate(many, T0).state.fish.length).toBe(10)
})

test('rollDay zeroes today* on a new day and keeps totals', async () => {
  const played = applyTurn(newGame(T0), { turnId: 'd', usage: usage(3000), now: T0 }).state
  expect(played.stats.todayKey).toBe(dayKey(T0))
  expect(rollDay(played, T0 + 1000)).toBe(played)
  const next = rollDay(played, T0 + DAY)
  expect(next.stats.todayKey).toBe(dayKey(T0 + DAY))
  expect(next.stats.todayTurns).toBe(0)
  expect(next.stats.todayEffectiveTokens).toBe(0)
  expect(next.stats.todayCoinsMinted).toBe(0)
  expect(next.stats.totalTurns).toBe(1)
  // applyTurn rolls the day itself.
  const after = applyTurn(played, { turnId: 'd2', usage: usage(3000), now: T0 + DAY }).state
  expect(after.stats.todayTurns).toBe(1)
  expect(after.stats.totalTurns).toBe(2)
})

test('engine functions never mutate their input', async () => {
  const s = applyTurn(newGame(T0), { turnId: 'm0', usage: usage(10000), now: T0 }).state
  const before = clone(s)
  applyTurn(s, { turnId: 'm1', usage: usage(20000, 3000), now: T0 + DAY })
  feed(s, null, T0)
  collect(s, null, T0)
  buyFish({ ...s, coins: 999 }, 'tang', T0, 'z')
  buyDecoration(s, 'shell', T0, 'z')
  levelUp(s, s.fish[0]!.id, T0)
  rename(s, s.fish[0]!.id, 'Bob')
  reward(s, { kind: 'test', now: T0 })
  appendLog(s, 'hi', T0)
  migrate(s, T0 + DAY)
  expect(s).toEqual(before)
})

test('appendLog keeps the newest 50 without bumping revision', async () => {
  let s = newGame(T0)
  for (let i = 0; i < 60; i++) s = appendLog(s, `line ${i}`, T0 + i)
  expect(s.log.length).toBe(50)
  expect(s.log[49]!.text).toBe('line 59')
  expect(s.revision).toBe(1)
})

test('mergeStates unions processed turns and takes the newer base', async () => {
  const base = newGame(T0)
  const a = applyTurn(base, { turnId: 'a', usage: usage(1000), now: T0 + 1 }).state
  const b1 = applyTurn(base, { turnId: 'b', usage: usage(1000), now: T0 + 2 }).state
  const b2 = applyTurn(b1, { turnId: 'c', usage: usage(1000), now: T0 + 3 }).state
  const m = mergeStates(a, b2)
  expect(m.processedTurns).toEqual(['b', 'c', 'a'])
  expect(m.revision).toBe(b2.revision + 1)
  expect(m.fish.length).toBe(2)
  // Merged state still refuses the turns either side saw.
  expect(applyTurn(m, { turnId: 'a', usage: usage(1000), now: T0 + 4 }).events[0]!.kind).toBe('refused')
})
