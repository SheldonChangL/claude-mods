import { expect, test } from 'claude-code/testing'

import {
  allocate, applyQuota, applyTurn, effectiveTokens, energyOf, fishWeight, isOverQuota, levelBoost, levelUpCost, PENDING_CAP, reward,
} from '../game/economy'
import { ECONOMY } from '../game/economy.config'
import { collect, newFish } from '../game/fish'
import { dayKey, mergeStates, newGame } from '../game/state'
import type { Fish, GameState, SpeciesId, Usage } from '../game/types'

const T0 = new Date(2026, 9, 21, 12, 0, 0).getTime()
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

function usage(input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite }
}
/** A fish with neutral factors: full (hunger 100 → ×1.0), mood 50 (×1.0), level 1 (×1.0). */
function calm(species: SpeciesId, id: string, patch: Partial<Fish> = {}): Fish {
  return { ...newFish(species, T0, id), hunger: 100, mood: 50, ...patch }
}
function tank(fish: Fish[], patch: Partial<GameState> = {}): GameState {
  return { ...newGame(T0), fish, ...patch }
}

test('effective tokens weigh input 1, output 2, cache read 0.02, cache write 1.25', () => {
  expect(effectiveTokens(usage(1000))).toBe(1000)
  expect(effectiveTokens(usage(0, 1000))).toBe(2000)
  expect(effectiveTokens(usage(0, 0, 1000))).toBe(20)
  expect(effectiveTokens(usage(0, 0, 0, 1000))).toBe(1250)
  // The old Desktop sample (37,250 under the old weights) is 17,250 now; the small one 3,550.
  expect(effectiveTokens(usage(3000, 1500, 250_000, 5000))).toBe(17_250)
  expect(effectiveTokens(usage(500, 300, 60_000, 1000))).toBe(3_550)
})

test('energy is linear to the 15,000 knee, a tenth as steep past it', () => {
  expect(energyOf(0)).toBe(0)
  expect(energyOf(1_000)).toBe(0.4)
  expect(energyOf(15_000)).toBe(6)
  expect(near(energyOf(37_250), (15_000 + 22_250 * 0.1) / 2500)).toBe(true)
  expect(near(energyOf(100_000), 9.4)).toBe(true)
  // Just past the knee every extra token is worth a tenth.
  expect(near(energyOf(15_001) - energyOf(15_000), 0.1 / 2500)).toBe(true)
  expect(energyOf(-5)).toBe(0)
  expect(energyOf(NaN)).toBe(0)
  expect(energyOf(Infinity)).toBe(0)
})

test('a huge cache read barely moves energy', () => {
  const heavy = energyOf(effectiveTokens(usage(0, 0, 1_000_000)))
  expect(near(heavy, (15_000 + 5_000 * 0.1) / 2500)).toBe(true)
  // A million cache-read tokens are worth 20,000 plain input tokens (the old weights made them 100,000).
  expect(heavy).toBe(energyOf(20_000))
  expect(heavy < 7).toBe(true)
})

test('incomplete or broken usage counts as zero, field by field', () => {
  expect(effectiveTokens(undefined)).toBe(0)
  expect(effectiveTokens(null)).toBe(0)
  expect(effectiveTokens({} as Partial<Usage>)).toBe(0)
  expect(effectiveTokens({ input_tokens: -100, output_tokens: 10 } as Partial<Usage>)).toBe(20)
  expect(effectiveTokens({ input_tokens: NaN, output_tokens: Infinity, cache_read_input_tokens: -Infinity, cache_creation_input_tokens: 8 } as Usage)).toBe(10)
  expect(effectiveTokens({ input_tokens: '400' as unknown as number })).toBe(0)
  // A turn with broken usage mints nothing but is still recorded once.
  const { state, events } = applyTurn(newGame(T0), { turnId: 'bad', usage: { input_tokens: NaN } as Usage, now: T0 })
  expect(events).toEqual([])
  expect(state.processedTurns).toEqual(['bad'])
  expect(state.lifetimeProducedCoins).toBe(0)
})

test('one fish makes energy × √w; many fish share energy × w_i / √Σw', () => {
  expect(allocate(5, [4])).toEqual([10])
  const out = allocate(6, [1, 3, 10, 32])
  const root = Math.sqrt(46)
  expect(out.map((x) => near(x, 0)).some(Boolean)).toBe(false)
  expect(near(out[0]!, 6 / root)).toBe(true)
  expect(near(out[3]!, (6 * 32) / root)).toBe(true)
  expect(near(out.reduce((a, b) => a + b, 0), 6 * root)).toBe(true)
  // Same input, same output.
  expect(allocate(6, [1, 3, 10, 32])).toEqual(out)
  // Nothing to share: empty tank, zero energy, bad weights.
  expect(allocate(5, [])).toEqual([])
  expect(allocate(0, [1, 2])).toEqual([0, 0])
  expect(allocate(5, [0, NaN, -3])).toEqual([0, 0, 0])
  expect(allocate(NaN, [1])).toEqual([0])
})

test('more fish earn more, with diminishing returns', () => {
  let prevTotal = 0
  let prevGain = Infinity
  for (let n = 1; n <= 10; n++) {
    const total = allocate(6, Array(n).fill(1)).reduce((a, b) => a + b, 0)
    const gain = total - prevTotal
    expect(gain > 0).toBe(true)
    expect(gain < prevGain).toBe(true)
    prevTotal = total
    prevGain = gain
  }
})

test('adding a fish of any positive weight never lowers the tank total', () => {
  // A fixed pseudo-random sweep (no Math.random).
  let x = 12345
  const next = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let i = 0; i < 200; i++) {
    const ws = Array.from({ length: 1 + Math.floor(next() * 9) }, () => 0.01 + next() * 40)
    const before = allocate(6, ws).reduce((a, b) => a + b, 0)
    const after = allocate(6, [...ws, 0.01 + next() * 40]).reduce((a, b) => a + b, 0)
    expect(after >= before).toBe(true)
  }
})

test('commons cannot win by numbers: ten commons earn less than one legendary', () => {
  const w = ECONOMY.rarityWeight
  const tenCommons = allocate(6, Array(10).fill(w.common)).reduce((a, b) => a + b, 0)
  const oneLegendary = allocate(6, [w.legendary])[0]!
  expect(tenCommons < oneLegendary).toBe(true)
  // In a shared tank the rarer fish takes a share proportional to its weight.
  const shared = allocate(6, [w.common, w.rare, w.epic, w.legendary])
  expect(shared[1]! / shared[0]!).toBe(w.rare)
  expect(shared[3]! / shared[2]!).toBe(w.legendary / w.epic)
  expect(w.common < w.rare && w.rare < w.epic && w.epic < w.legendary).toBe(true)
})

test('fish weight = rarity weight × level × hunger × mood, and levelling costs scale with rarity', () => {
  expect(fishWeight({ species: 'guppy', level: 1, hunger: 100, mood: 50 })).toBe(1)
  expect(fishWeight({ species: 'mola', level: 1, hunger: 100, mood: 50 })).toBe(ECONOMY.rarityWeight.legendary)
  expect(near(fishWeight({ species: 'tang', level: 10, hunger: 0, mood: 100 }), 3 * levelBoost(10) * 0.5 * 1.1)).toBe(true)
  expect(near(levelBoost(10), 1.45)).toBe(true)
  expect(levelUpCost({ species: 'guppy', level: 1 })).toBe(50)
  expect(levelUpCost({ species: 'mola', level: 2 })).toBe(50 * 2 * ECONOMY.rarityWeight.legendary)
})

test('daily soft caps per rarity: full rate up to the quota, 0.2× past it', () => {
  const q = ECONOMY.dailyQuota
  expect([q.common, q.rare, q.epic, q.legendary]).toEqual([120, 360, 960, 1920])
  for (const quota of [q.common, q.rare, q.epic, q.legendary]) {
    expect(applyQuota(quota, 0, quota)).toEqual({ credited: quota, used: quota, isOver: false })
    const over = applyQuota(quota + 100, 0, quota)
    expect(near(over.credited, quota + 20)).toBe(true)
    expect(over.isOver).toBe(true)
  }
  // Already over: everything pays 0.2.
  expect(near(applyQuota(10, 500, 120).credited, 2)).toBe(true)
  // A turn that crosses the quota is split at it.
  const cross = applyQuota(10, 115, 120)
  expect(near(cross.credited, 5 + 0.2 * 5)).toBe(true)
  expect(cross.used).toBe(125)
})

test('many small turns pay exactly what one big turn pays, across the quota', () => {
  const big = applyQuota(300, 0, 120).credited
  let used = 0
  let paid = 0
  for (let i = 0; i < 300; i++) {
    const r = applyQuota(1, used, 120)
    used = r.used
    paid += r.credited
  }
  expect(near(paid, big, 1e-9)).toBe(true)
  expect(used).toBe(300)
  // Uneven pieces too.
  const pieces = [7.5, 100, 13.25, 0.25, 79, 100]
  let u2 = 0
  let p2 = 0
  for (const piece of pieces) {
    const r = applyQuota(piece, u2, 120)
    u2 = r.used
    p2 += r.credited
  }
  expect(near(p2, applyQuota(300, 0, 120).credited, 1e-9)).toBe(true)
})

test('applyTurn spends the quota from raw production and keeps the fraction in carry', () => {
  // One calm guppy (w = 1) with 119 raw coins already made today; energy 6 → raw 6 this turn.
  const g = calm('guppy', 'g', { dailyRaw: 119, dailyKey: dayKey(T0) })
  const { state } = applyTurn(tank([g]), { turnId: 'q', usage: usage(15_000), now: T0 })
  const f = state.fish[0]!
  // 1 at the full rate + 5 × 0.2 = 2.0 credited
  expect(f.dailyRaw).toBe(125)
  expect(f.pending).toBe(2)
  expect(near(f.carry, 0)).toBe(true)
  expect(isOverQuota(f, T0)).toBe(true)
  expect(state.lifetimeProducedCoins).toBe(2)
})

test('the daily quota resets at local midnight and not before', () => {
  const late = new Date(2026, 9, 21, 23, 59, 0).getTime()
  const early = new Date(2026, 9, 22, 0, 1, 0).getTime()
  const g = calm('guppy', 'g', { dailyRaw: 500, dailyKey: dayKey(late) })
  const same = applyTurn(tank([g]), { turnId: 'a', usage: usage(15_000), now: late }).state.fish[0]!
  expect(same.dailyRaw).toBe(506)
  expect(same.dailyKey).toBe(dayKey(late))
  const next = applyTurn(tank([g]), { turnId: 'b', usage: usage(15_000), now: early }).state.fish[0]!
  expect(next.dailyKey).toBe(dayKey(early))
  expect(next.dailyRaw).toBe(6)
  // Full rate again after midnight: 6 coins, not 1.2.
  expect(next.pending).toBe(6)
  expect(isOverQuota(g, early)).toBe(false)
})

test('fractions are never lost over thousands of tiny turns', () => {
  let s = tank([calm('guppy', 'g')])
  const n = 2000
  for (let i = 0; i < n; i++) {
    s = applyTurn(s, { turnId: `t${i}`, usage: usage(25), now: T0 + i }).state
    s = { ...s, fish: s.fish.map((f) => ({ ...f, hunger: 100, mood: 50 })) }
    if (s.fish[0]!.pending >= PENDING_CAP - 1) s = collect(s, null, T0 + i).state
  }
  // 25 tokens = 0.01 energy; one calm guppy makes 0.01 a turn → 20 coins over 2000 turns.
  const f = s.fish[0]!
  const total = s.lifetimeProducedCoins + f.carry
  expect(near(total, 20, 1e-6)).toBe(true)
  expect(f.carry >= 0 && f.carry < 1).toBe(true)
})

test('a repeated turn.complete pays once and does not spend quota twice', () => {
  const once = applyTurn(newGame(T0), { turnId: 'dup', usage: usage(15_000), now: T0 }).state
  const twice = applyTurn(once, { turnId: 'dup', usage: usage(15_000), now: T0 + 1 })
  expect(twice.state).toBe(once)
  expect(twice.events).toEqual([{ kind: 'refused', reason: 'duplicate-turn' }])
  expect(twice.state.fish[0]!.dailyRaw).toBe(once.fish[0]!.dailyRaw)
})

test('collecting twice in a row pays once; the lifetime count never drops', () => {
  const s = applyTurn(newGame(T0), { turnId: 'c', usage: usage(15_000), now: T0 }).state
  const a = collect(s, null, T0 + 1)
  const b = collect(a.state, null, T0 + 2)
  expect(b.events).toEqual([{ kind: 'refused', reason: 'nothing-to-collect' }])
  expect(b.state.coins).toBe(a.state.coins)
  expect(a.state.lifetimeProducedCoins).toBe(s.lifetimeProducedCoins)
})

test('rewards pay coins but never lifetime produced coins', () => {
  const r = reward(newGame(T0), { kind: 'commit', now: T0 })
  expect(r.state.coins).toBe(162)
  expect(r.state.lifetimeProducedCoins).toBe(0)
})

test('two sessions merge to the larger lifetime, slots and same-day quota use', () => {
  const base = newGame(T0)
  const a = applyTurn(base, { turnId: 'a', usage: usage(15_000), now: T0 + 1 }).state
  const b = { ...applyTurn(applyTurn(base, { turnId: 'b', usage: usage(15_000), now: T0 + 2 }).state, { turnId: 'c', usage: usage(15_000), now: T0 + 3 }).state, slotsBought: 1 }
  const m = mergeStates(a, b)
  expect(m.lifetimeProducedCoins).toBe(Math.max(a.lifetimeProducedCoins, b.lifetimeProducedCoins))
  expect(m.slotsBought).toBe(1)
  expect(m.fish[0]!.dailyRaw).toBe(Math.max(a.fish[0]!.dailyRaw, b.fish[0]!.dailyRaw))
  const m2 = mergeStates(b, a)
  expect(m2.fish[0]!.dailyRaw).toBe(m.fish[0]!.dailyRaw)
})
