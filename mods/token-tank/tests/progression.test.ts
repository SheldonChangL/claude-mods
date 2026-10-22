import { expect, test } from 'claude-code/testing'

import { applyTurn } from '../game/economy'
import { ECONOMY } from '../game/economy.config'
import { collect, newFish, releaseFish } from '../game/fish'
import { baseSlots, MAX_TANK_LEVEL, nextSlot, slotCapacity, tankLevel, tankLevelFor, tankProgress } from '../game/progression'
import { buyFish, buySlot, isUnlocked, moveDecoration, shopList } from '../game/shop'
import { SPECIES, SPECIES_LIST } from '../game/species'
import { migrate, newGame } from '../game/state'
import type { Fish, GameState, Rarity, SpeciesId } from '../game/types'

const T0 = new Date(2026, 9, 21, 12, 0, 0).getTime()
const atLevel = (s: GameState, level: number): GameState => ({ ...s, lifetimeProducedCoins: ECONOMY.tankLevels[level - 1]! })

test('tank level follows lifetime coins through the anchors and never past the top', () => {
  expect(tankLevelFor(0)).toBe(1)
  expect(tankLevelFor(639)).toBe(4)
  expect(tankLevelFor(640)).toBe(5)
  expect(tankLevelFor(3_199)).toBe(9)
  expect(tankLevelFor(3_200)).toBe(10)
  expect(tankLevelFor(11_499)).toBe(17)
  expect(tankLevelFor(11_500)).toBe(18)
  expect(tankLevelFor(1e12)).toBe(MAX_TANK_LEVEL)
  expect(tankLevelFor(NaN)).toBe(1)
  expect(tankLevelFor(-50)).toBe(1)
  const t = ECONOMY.tankLevels
  for (let i = 1; i < t.length; i++) expect(t[i]! > t[i - 1]!).toBe(true)
  expect(tankProgress({ lifetimeProducedCoins: 800 })).toMatchObject({ level: 5, levelStart: 640, nextAt: 950 })
  expect(tankProgress({ lifetimeProducedCoins: 50_000 })).toMatchObject({ level: 18, nextAt: null, fraction: 1 })
})

test('base slots: Lv.1 3, Lv.5 5, Lv.10 7, Lv.18 10, never decreasing', () => {
  expect([baseSlots(1), baseSlots(5), baseSlots(10), baseSlots(18)]).toEqual([3, 5, 7, 10])
  for (let n = 2; n <= MAX_TANK_LEVEL; n++) expect(baseSlots(n) >= baseSlots(n - 1)).toBe(true)
  expect(slotCapacity(newGame(T0))).toBe(3)
})

test('spending and collecting never lower the tank level', () => {
  let s = { ...newGame(T0), coins: 5000 }
  for (let i = 0; i < 40; i++) s = applyTurn(s, { turnId: `t${i}`, usage: { input_tokens: 15_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, now: T0 + i }).state
  const level = tankLevel(s)
  const lifetime = s.lifetimeProducedCoins
  expect(level > 1).toBe(true)
  s = collect(s, null, T0 + 100).state
  s = buySlot(s, T0 + 101).state
  s = buyFish(s, 'guppy', T0 + 102, 'z').state
  expect(s.lifetimeProducedCoins).toBe(lifetime)
  expect(tankLevel(s)).toBe(level)
})

test('buySlot: priced from config, gated by tank level, capped at 10', () => {
  const s = { ...newGame(T0), coins: 10_000 }
  const one = buySlot(s, T0)
  expect(one.events).toEqual([{ kind: 'bought', what: 'slot', id: 'slot-1', price: ECONOMY.slotPrices[0]! }])
  expect(one.state.coins).toBe(10_000 - ECONOMY.slotPrices[0]!)
  expect(one.state.slotsBought).toBe(1)
  expect(slotCapacity(one.state)).toBe(4)
  // Lv.1 allows one bought slot only.
  expect(buySlot(one.state, T0).events).toEqual([{ kind: 'refused', reason: 'slot-locked-level' }])
  expect(nextSlot(one.state)).toMatchObject({ reason: 'slot-locked-level', unlockLevel: 5 })
  const lv5 = atLevel(one.state, 5)
  const two = buySlot(lv5, T0)
  expect(two.state.slotsBought).toBe(2)
  expect(two.state.coins).toBe(lv5.coins - ECONOMY.slotPrices[1]!)
  expect(buySlot({ ...lv5, coins: 10 }, T0).events).toEqual([{ kind: 'refused', reason: 'not-enough-coins' }])
  // At Lv.18 the base alone is 10: nothing left to buy.
  expect(buySlot(atLevel(s, 18), T0).events).toEqual([{ kind: 'refused', reason: 'slots-max' }])
  expect(slotCapacity({ ...atLevel(s, 18), slotsBought: 3 })).toBe(10)
})

test('buyFish refuses with a clear reason: locked level, full tank, not enough coins', () => {
  const s = newGame(T0)
  expect(buyFish({ ...s, coins: 99_999 }, 'koi', T0, 'k').events).toEqual([{ kind: 'refused', reason: 'locked-level' }])
  const full = buyFish(buyFish({ ...s, coins: 1000 }, 'guppy', T0, 'x').state, 'guppy', T0, 'y')
  expect(full.events).toEqual([{ kind: 'refused', reason: 'tank-full' }])
  expect(full.state.fish.length).toBe(3)
  expect(buyFish({ ...s, coins: 10 }, 'guppy', T0, 'x').events).toEqual([{ kind: 'refused', reason: 'not-enough-coins' }])
  // The same press twice (same seed) charges once.
  const once = buyFish({ ...s, coins: 1000 }, 'neon', T0, 'p')
  const again = buyFish(once.state, 'neon', T0, 'p')
  expect(again.events).toEqual([{ kind: 'refused', reason: 'duplicate-purchase' }])
  expect(again.state.coins).toBe(1000 - SPECIES.neon.price)
})

test('shopList carries the same reason and unlock level buyFish uses', () => {
  const s = { ...atLevel(newGame(T0), 5), coins: 520 }
  const list = shopList(s)
  expect(list.length).toBe(SPECIES_LIST.length)
  const row = (id: SpeciesId) => list.find((x) => x.species === id)!
  expect(row('tang')).toMatchObject({ rarity: 'rare', price: SPECIES.tang.price, unlockLevel: 5, isUnlocked: true, reason: null })
  expect(row('koi')).toMatchObject({ isUnlocked: false, reason: 'locked-level', unlockLevel: SPECIES.koi.unlockLevel })
  expect(row('oscar').reason).toBe('locked-level')
  const poor = shopList({ ...s, coins: 100 })
  expect(poor.find((x) => x.species === 'tang')!.reason).toBe('not-enough-coins')
  const full = { ...s, fish: [...s.fish, ...['a', 'b', 'c'].map((i) => newFish('guppy', T0, i))] }
  expect(shopList(full).find((x) => x.species === 'tang')!.reason).toBe('tank-full')
  for (const x of list) expect(x.reason === null).toBe(buyFish(s, x.species, T0, 'chk').events[0]!.kind !== 'refused')
})

test('the catalogue: 21 species kept, rarity counts, positive prices inside each band', () => {
  const ids: SpeciesId[] = ['guppy', 'clownfish', 'tang', 'puffer', 'angelfish', 'koi', 'goldfish', 'seahorse', 'neon', 'betta', 'butterflyfish', 'lionfish', 'arowana', 'danio', 'swordtail', 'discus', 'mandarin', 'oscar', 'moorishidol', 'parrotfish', 'mola']
  expect(Object.keys(SPECIES).sort()).toEqual([...ids].sort())
  const count: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  for (const sp of SPECIES_LIST) {
    count[sp.rarity]++
    const [lo, hi] = ECONOMY.priceBand[sp.rarity]
    expect(sp.price >= lo && sp.price <= hi).toBe(true)
    expect(sp.price > 0).toBe(true)
    expect(sp.rate).toBe(ECONOMY.rarityWeight[sp.rarity])
    expect(sp.unlockAt).toBe(sp.unlockLevel)
  }
  expect(count).toEqual({ common: 7, rare: 7, epic: 5, legendary: 2 })
  expect(SPECIES.arowana.rarity).toBe('legendary')
  expect(SPECIES.mola.rarity).toBe('legendary')
  // Unlock levels follow the anchors: rare from Lv.5, epic from Lv.10, legendary at Lv.18.
  expect(Math.min(...SPECIES_LIST.filter((s) => s.rarity === 'rare').map((s) => s.unlockLevel))).toBe(5)
  expect(Math.min(...SPECIES_LIST.filter((s) => s.rarity === 'epic').map((s) => s.unlockLevel))).toBe(10)
  expect(Math.min(...SPECIES_LIST.filter((s) => s.rarity === 'legendary').map((s) => s.unlockLevel))).toBe(18)
  expect(isUnlocked(newGame(T0), 'guppy')).toBe(true)
})

test('releaseFish frees a slot, banks its pending coins and keeps the last fish', () => {
  const s = { ...newGame(T0), fish: newGame(T0).fish.map((f, i) => (i === 0 ? { ...f, pending: 7 } : f)) }
  const out = releaseFish(s, s.fish[0]!.id, T0)
  expect(out.state.fish.length).toBe(1)
  expect(out.state.coins).toBe(s.coins + 7)
  expect(out.events).toEqual([{ kind: 'collected', fishId: s.fish[0]!.id, coins: 7 }])
  expect(releaseFish(out.state, out.state.fish[0]!.id, T0).events).toEqual([{ kind: 'refused', reason: 'last-fish' }])
  expect(releaseFish(s, 'nope', T0).events).toEqual([{ kind: 'refused', reason: 'no-such-fish' }])
})

/** A schema-3 save written before economy v0.3: no economyVersion, lifetime, slots or daily fields. */
function preV03Save(): Record<string, unknown> {
  const g = newGame(T0 - 86_400_000)
  const fish: Partial<Fish>[] = [
    ['guppy', 'Bubbles', 4, 700], ['mola', '大翻車', 2, 150], ['arowana', 'Dragon', 1, 10], ['koi', 'Koi', 3, 400],
    ['discus', 'Disc', 1, 0], ['neon', 'Neo', 1, 0], ['tang', 'Dory', 2, 120], ['betta', 'Siam', 1, 50],
  ].map(([species, name, level, xp], i) => {
    const { dailyRaw: _d, dailyKey: _k, ...old } = newFish(species as SpeciesId, T0, `old${i}`, name as string)
    return { ...old, level: level as number, xp: xp as number, pending: 3 + i, carry: 0.25 }
  })
  const { economyVersion: _e, economyConfigVersion: _c, lifetimeProducedCoins: _l, slotsBought: _s, ...rest } = g
  return {
    ...rest,
    coins: 6_547,
    food: 33,
    fish,
    dex: ['guppy', 'mola', 'arowana', 'koi', 'discus', 'neon', 'tang', 'betta'],
    stats: { ...g.stats, totalCoinsMinted: 900, totalCoinsCollected: 850 },
  }
}

test('migration to v0.3 keeps coins, fish, names, levels, xp, pending, carry, food and decorations', () => {
  const raw = preV03Save()
  const m = migrate(raw, T0)
  expect(m.economyMigrated).toBe(true)
  expect(m.isFailed).toBe(false)
  expect(m.isReset).toBe(false)
  const s = m.state
  expect(s.economyVersion).toBe(3)
  expect(s.schemaVersion).toBe(3)
  expect(s.coins).toBe(6_547)
  expect(s.food).toBe(33)
  expect(s.decorations).toEqual((raw.decorations as unknown[]))
  expect(s.fish.length).toBe(8)
  const before = raw.fish as Fish[]
  s.fish.forEach((f, i) => {
    expect(f).toMatchObject({ id: before[i]!.id, species: before[i]!.species, name: before[i]!.name, level: before[i]!.level, xp: before[i]!.xp, pending: before[i]!.pending, carry: 0.25 })
    expect(f.dailyRaw).toBe(0)
  })
  // History: the coins the fish ever minted (rewards were never in it).
  expect(s.lifetimeProducedCoins).toBe(900)
  expect(tankLevel(s)).toBe(tankLevelFor(900))
  expect(s.slotsBought).toBe(0)
  // Legendaries kept although the tank is far below Lv.18; the dex is kept.
  expect(s.fish.some((f) => f.species === 'mola')).toBe(true)
  expect(s.dex.length).toBe(8)
})

test('migration is idempotent', () => {
  const once = migrate(preV03Save(), T0)
  const twice = migrate(JSON.parse(JSON.stringify(once.state)), T0)
  expect(twice.economyMigrated).toBe(false)
  expect(twice.state).toEqual(once.state)
  const thrice = migrate(JSON.parse(JSON.stringify(twice.state)), T0 + 1000)
  expect(thrice.state.lifetimeProducedCoins).toBe(once.state.lifetimeProducedCoins)
  expect(thrice.state.coins).toBe(once.state.coins)
})

test('an old tank over its slot capacity keeps every fish but cannot grow', () => {
  const s = migrate(preV03Save(), T0).state
  expect(baseSlots(tankLevel(s)) < 8).toBe(true)
  expect(slotCapacity(s)).toBe(8)
  const out = buyFish(s, 'guppy', T0, 'more')
  expect(out.events).toEqual([{ kind: 'refused', reason: 'tank-full' }])
  expect(out.state.fish.length).toBe(8)
  // A turn on the migrated save works and keeps the legendary producing.
  const t = applyTurn(s, { turnId: 'after', usage: { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, now: T0 })
  expect(t.state.fish.length).toBe(8)
  expect(t.state.lifetimeProducedCoins > s.lifetimeProducedCoins).toBe(true)
})

test('a migration that throws reports failure instead of handing back a game to save', () => {
  const hostile = { schemaVersion: 3, get fish(): unknown { throw new Error('corrupt') } }
  const m = migrate(hostile, T0)
  expect(m.isFailed).toBe(true)
  expect(m.economyMigrated).toBe(false)
  // A v2 save is converted to v0.3 in the same step.
  const v2 = migrate({ version: 2, coins: 10, fish: [{ id: 'g', species: 'guppy', xp: 0 }], decorations: [], totalEffectiveTokens: 0 }, T0)
  expect(v2.economyMigrated).toBe(true)
  expect(v2.state.economyVersion).toBe(3)
  expect(v2.state.fish[0]!.dailyKey.length).toBe(10)
})


test('a decoration moves where it is put, clamped to the water, and the save keeps the spot', () => {
  const s = newGame(T0)
  const id = s.decorations[0]!.id
  const moved = moveDecoration(s, id, 200, 120)
  expect(moved.events[0]).toMatchObject({ kind: 'moved', id, x: 200, y: 120 })
  expect(moved.state.decorations.find(d => d.id === id)).toMatchObject({ x: 200, y: 120 })
  const clamped = moveDecoration(s, id, -50, 999).state.decorations.find(d => d.id === id)!
  expect(clamped.x).toBe(8)
  expect(clamped.y).toBe(150)
  expect(moveDecoration(s, 'nope', 1, 1).events[0]).toMatchObject({ kind: 'refused', reason: 'unknown-decor' })
  expect(moveDecoration(s, id, Number.NaN, 1).events[0]).toMatchObject({ kind: 'refused', reason: 'bad-position' })
  const same = moveDecoration(moved.state, id, 200, 120)
  expect(same.state).toBe(moved.state)
})
