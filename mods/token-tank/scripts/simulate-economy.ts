// Economy v0.3 simulator. Run from the mod folder:  npx tsx scripts/simulate-economy.ts
//
// Drives the real engine (game/*) through scripted players and writes
//   docs/economy/daily/<activity>-<workload>.csv   one row per scenario-day
//   docs/economy/scenarios.json                     one summary per scenario
//   docs/economy/legacy-vs-new.json                 the old formula next to the new one
//   docs/economy-balance-report.md                  tables, target checks, final parameters
// Everything is deterministic: the only randomness is a PRNG seeded from the scenario name.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyQuota, applyTurn, effectiveTokens, energyOf, fishWeight, levelUpCost, MAX_LEVEL, XP_THRESHOLDS } from '../game/economy'
import { ECONOMY, ECONOMY_CONFIG_VERSION } from '../game/economy.config'
import { collect, feed, levelUp, releaseFish } from '../game/fish'
import { baseSlots, MAX_TANK_LEVEL, nextSlot, slotCapacity, slotsBuyable, tankLevel } from '../game/progression'
import { buyFish, buyFood, buySlot, isUnlocked } from '../game/shop'
import { FOOD_PRICE, SPECIES, SPECIES_LIST } from '../game/species'
import { newGame } from '../game/state'
import type { Fish, GameEvent, GameState, Rarity, SpeciesId, Usage } from '../game/types'
import { hashSeed } from '../game/util'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'economy')
const SEED = 'token-tank-economy-v0.3'
const DAYS = 60
const HORIZONS = [7, 30, 60] as const
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary']

// ---------------------------------------------------------------- inputs (ASSUMED)

/**
 * ASSUMED per-turn usage samples (main-loop turn.complete, fields do not overlap). They are not
 * measured from real sessions: the Desktop and small samples were given with the task, the
 * high/low cache-read samples are invented to bracket them. Every turn is jittered ±20 % per field.
 */
const WORKLOADS = {
  desktop: { label: 'Desktop large context (ASSUMED)', sample: { input_tokens: 3000, output_tokens: 1500, cache_read_input_tokens: 250_000, cache_creation_input_tokens: 5000 } },
  small: { label: 'Small context (ASSUMED)', sample: { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 1000 } },
  highCache: { label: 'High cache read (ASSUMED)', sample: { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 3000 } },
  lowCache: { label: 'Low cache read (ASSUMED)', sample: { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 3000 } },
  mixed: { label: 'Mixed: per turn 35 % desktop, 35 % small, 15 % high, 15 % low (ASSUMED)', sample: null },
} as const
type WorkloadId = keyof typeof WORKLOADS
const WORKLOAD_IDS = Object.keys(WORKLOADS) as WorkloadId[]

const ACTIVITY = [8, 20, 40, 80] as const
type StrategyId = 'A' | 'B' | 'C' | 'D'
const STRATEGIES: Record<StrategyId, string> = {
  A: 'Cheapest First',
  B: 'Most Expensive Affordable',
  C: 'Balanced',
  D: 'ROI Optimized',
}
type CollectMode = 'turn' | 'daily' | 'irregular'
const COLLECT: Record<CollectMode, string> = {
  turn: 'after every turn',
  daily: 'once a day (22:00)',
  irregular: 'irregular (~3 visits a day at random turns)',
}

// ---------------------------------------------------------------- helpers

function prng(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function jitter(u: Usage, r: () => number): Usage {
  const j = (v: number) => Math.round(v * (0.8 + 0.4 * r()))
  return {
    input_tokens: j(u.input_tokens),
    output_tokens: j(u.output_tokens),
    cache_read_input_tokens: j(u.cache_read_input_tokens),
    cache_creation_input_tokens: j(u.cache_creation_input_tokens),
  }
}

function sampleUsage(w: WorkloadId, r: () => number): Usage {
  const def = WORKLOADS[w].sample
  if (def) return jitter(def, r)
  const x = r()
  const pick: Exclude<WorkloadId, 'mixed'> = x < 0.35 ? 'desktop' : x < 0.7 ? 'small' : x < 0.85 ? 'highCache' : 'lowCache'
  return jitter(WORKLOADS[pick].sample, r)
}

/** Local time `hour` on day `d` of the run (DST-safe: built from calendar fields). */
function at(d: number, hour: number, minute = 0): number {
  return new Date(2026, 10, 2 + d, hour, minute, 0, 0).getTime()
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round = (v: number, p = 1) => Math.round(v * 10 ** p) / 10 ** p
const weightOf = (sp: SpeciesId) => ECONOMY.rarityWeight[SPECIES[sp].rarity]

// ---------------------------------------------------------------- the player's model of income

type FishSpec = Pick<Fish, 'species' | 'level'>

/**
 * Expected coins per day from a tank, as a player reasoning about the published rules would
 * estimate it: typical hunger 85 / mood 70, the observed energy per turn and turns per day,
 * each fish's daily soft cap. Used by the ROI strategy and to report marginal payback.
 */
function estimateDaily(fish: FishSpec[], energyPerTurn: number, turnsPerDay: number): number {
  const ws = fish.map((f) => fishWeight({ species: f.species, level: f.level, hunger: 85, mood: 70 }))
  const total = ws.reduce((a, b) => a + b, 0)
  if (!(total > 0) || !(energyPerTurn > 0)) return 0
  const root = Math.sqrt(total)
  let sum = 0
  fish.forEach((f, i) => {
    const raw = (energyPerTurn * turnsPerDay * ws[i]!) / root
    sum += applyQuota(raw, 0, ECONOMY.dailyQuota[SPECIES[f.species].rarity]).credited
  })
  return sum
}

// ---------------------------------------------------------------- one scenario

type Purchase = { day: number; what: string; price: number }
type FishRecord = { id: string; species: SpeciesId; rarity: Rarity; day: number; price: number; marginalDays: number | null; own: number; paidDay: number | null }

type DayRow = {
  day: number
  minted: number
  lifetime: number
  collected: number
  balance: number
  fish: number
  byRarity: Record<Rarity, number>
  tankLevel: number
  capacity: number
  purchases: string
  share: Record<Rarity, number>
  overQuotaFish: number
  spent: number
  foodSpent: number
  roi: number
}

type Scenario = { activity: number; workload: WorkloadId; strategy: StrategyId; collectMode: CollectMode }

type Summary = Scenario & {
  id: string
  day1Minted: number
  day2Minted: number
  day1Fish: number
  day1Balance: number
  firstRareDay: number | null
  firstEpicDay: number | null
  firstLegendaryDay: number | null
  tenFishDay: number | null
  allSpeciesOwnedDay: number | null
  maxLevelDay: number | null
  horizons: Record<string, { lifetime: number; balance: number; tankLevel: number; capacity: number; fish: Record<Rarity, number>; roi: number; avgDailyLast7: number; speciesOwned: number; goalsLeft: string[] }>
  highPricePaybacks: { species: SpeciesId; rarity: Rarity; day: number; price: number; marginalDays: number | null; ownPaidAfterDays: number | null }[]
  softCapDays: number
}

function goalsLeft(s: GameState): string[] {
  const left: string[] = []
  const owned = new Set(s.dex)
  const notOwned = SPECIES_LIST.filter((sp) => !owned.has(sp.id))
  if (notOwned.length > 0) left.push(`${notOwned.length} species never owned`)
  if (!s.fish.some((f) => SPECIES[f.species].rarity === 'legendary')) left.push('no legendary in the tank')
  if (tankLevel(s) < MAX_TANK_LEVEL) left.push(`tank Lv.${tankLevel(s)} < ${MAX_TANK_LEVEL}`)
  if (slotCapacity(s) < ECONOMY.maxSlots) left.push(`${slotCapacity(s)}/${ECONOMY.maxSlots} slots`)
  const weak = s.fish.filter((f) => SPECIES[f.species].rarity === 'common' || SPECIES[f.species].rarity === 'rare').length
  if (weak > 0) left.push(`${weak} common/rare fish to upgrade`)
  const low = s.fish.filter((f) => f.level < MAX_LEVEL).length
  if (low > 0) left.push(`${low} fish below Lv.${MAX_LEVEL}`)
  return left
}

function runScenario(sc: Scenario): { summary: Summary; rows: DayRow[] } {
  const id = `${sc.activity}t-${sc.workload}-${sc.strategy}-${sc.collectMode}`
  const r = prng(`${SEED}/${sc.activity}/${sc.workload}/${sc.collectMode}`)
  const rAct = prng(`${SEED}/act/${sc.activity}/${sc.collectMode}`)
  let s: GameState = newGame(at(0, 8))
  const records = new Map<string, FishRecord>()
  const rows: DayRow[] = []
  const purchases: Purchase[] = []
  let spent = 0
  let foodSpent = 0
  let seq = 0
  // The player's running picture of a turn's energy (last ~2 days).
  let energyAvg = energyOf(effectiveTokens(sampleUsage(sc.workload, prng(`${SEED}/probe/${sc.workload}`))))
  const firsts: Record<Rarity, number | null> = { common: 1, rare: null, epic: null, legendary: null }
  let tenFishDay: number | null = null
  let allSpeciesDay: number | null = null
  let maxLevelDay: number | null = null
  let softCapDays = 0

  const apply = (out: { state: GameState; events: GameEvent[] }): boolean => {
    s = out.state
    return !out.events.some((e) => e.kind === 'refused')
  }

  const fishSpecs = (): FishSpec[] => s.fish.map((f) => ({ species: f.species, level: f.level }))
  const est = (fish: FishSpec[]) => estimateDaily(fish, energyAvg, sc.activity)

  function recordFish(day: number, fishId: string, species: SpeciesId, price: number, before: FishSpec[]) {
    const after = fishSpecs()
    const gain = est(after) - est(before)
    records.set(fishId, {
      id: fishId, species, rarity: SPECIES[species].rarity, day, price,
      marginalDays: gain > 0 ? price / gain : null, own: 0, paidDay: null,
    })
    const rar = SPECIES[species].rarity
    if (firsts[rar] === null) firsts[rar] = day
  }

  function buy(day: number, now: number, species: SpeciesId, replace: Fish | null): boolean {
    const before = fishSpecs()
    if (replace && !apply(releaseFish(s, replace.id, now))) return false
    const price = SPECIES[species].price
    const ok = apply(buyFish(s, species, now, `${day}-${seq++}`))
    if (!ok) return false
    spent += price
    const born = s.fish[s.fish.length - 1]!
    purchases.push({ day, what: replace ? `${species}(replaces ${replace.species})` : species, price })
    recordFish(day, born.id, species, price, before)
    return true
  }

  function slot(day: number, now: number): boolean {
    const offer = nextSlot(s)
    if (offer.reason !== null || s.coins < offer.price) return false
    if (!apply(buySlot(s, now))) return false
    spent += offer.price
    purchases.push({ day, what: `slot#${s.slotsBought}`, price: offer.price })
    return true
  }

  function tend(now: number) {
    // Feed every fish under 60 back over 70, buying food in 20s when the pantry runs out.
    for (const f0 of [...s.fish].sort((a, b) => a.hunger - b.hunger)) {
      let guard = 0
      while ((s.fish.find((f) => f.id === f0.id)?.hunger ?? 100) < 60 && guard++ < 4) {
        if (s.food <= 0) {
          const n = Math.min(20, Math.floor(s.coins / FOOD_PRICE))
          if (n <= 0 || !apply(buyFood(s, n))) return
          foodSpent += n * FOOD_PRICE
        }
        if (!apply(feed(s, f0.id, now))) return
      }
    }
  }

  function levelUps(now: number, reserve: number) {
    for (let guard = 0; guard < 40; guard++) {
      const ready = s.fish
        .filter((f) => f.level < MAX_LEVEL && f.xp >= (XP_THRESHOLDS[f.level] ?? Infinity))
        .sort((a, b) => fishWeight(b) - fishWeight(a))[0]
      if (!ready) return
      const cost = levelUpCost(ready)
      if (s.coins - cost < reserve) return
      if (!apply(levelUp(s, ready.id, now))) return
      spent += cost
    }
  }

  const unlocked = () => SPECIES_LIST.filter((sp) => isUnlocked(s, sp.id))
  const free = () => slotCapacity(s) - s.fish.length
  /**
   * What the player is saving for when the tank is full: the next slot if one is for sale,
   * else the cheapest unlocked species of a higher rarity than its weakest fish (0: nothing).
   */
  const savingFor = (): number => {
    if (free() > 0) return 0
    const offer = nextSlot(s)
    if (offer.reason === null) return offer.price
    const w = weakest()
    const up = w ? unlocked().find((sp) => weightOf(sp.id) > weightOf(w.species)) : undefined
    return up ? up.price : 0
  }
  /** The fish whose loss costs least: lowest rarity weight, then lowest level. */
  const weakest = (): Fish | null =>
    [...s.fish].sort((a, b) => weightOf(a.species) - weightOf(b.species) || a.level - b.level)[0] ?? null

  function strategyA(day: number, now: number) {
    for (let guard = 0; guard < 20; guard++) {
      if (free() > 0) {
        const sp = unlocked()[0]
        if (!sp || s.coins < sp.price || !buy(day, now, sp.id, null)) break
      } else if (!slot(day, now)) break
    }
    levelUps(now, 0)
  }

  function strategyB(day: number, now: number) {
    for (let guard = 0; guard < 20; guard++) {
      const affordable = unlocked().filter((sp) => sp.price <= s.coins)
      const best = affordable[affordable.length - 1]
      if (free() > 0) {
        if (!best || !buy(day, now, best.id, null)) break
      } else if (slot(day, now)) {
        continue
      } else {
        const w = weakest()
        if (!best || !w || weightOf(best.id) <= weightOf(w.species) || !buy(day, now, best.id, w)) break
      }
    }
    levelUps(now, savingFor())
  }

  function strategyC(day: number, now: number) {
    const budget = () => 0.6 * s.coins
    for (let guard = 0; guard < 20; guard++) {
      const list = unlocked()
      const topRarity = Math.max(...list.filter((sp) => sp.price <= budget()).map((sp) => sp.rate), 0)
      // Within the best rarity it can afford with 60 % of the wallet, the cheapest species.
      const pick = list.find((sp) => sp.rate === topRarity && sp.price <= budget())
      if (free() > 0) {
        if (!pick || !buy(day, now, pick.id, null)) break
        continue
      }
      const offer = nextSlot(s)
      if (offer.reason === null && offer.price <= budget()) {
        if (!slot(day, now)) break
        continue
      }
      const w = weakest()
      if (pick && w && pick.rate >= 2 * weightOf(w.species)) {
        if (!buy(day, now, pick.id, w)) break
        continue
      }
      break
    }
    levelUps(now, Math.max(Math.round(0.3 * s.coins), savingFor()))
  }

  function strategyD(day: number, now: number) {
    for (let guard = 0; guard < 20; guard++) {
      type Option = { cost: number; gain: number; run: () => boolean }
      const options: Option[] = []
      const base = fishSpecs()
      const baseEst = est(base)
      const w = weakest()
      const offer = nextSlot(s)
      for (const sp of unlocked()) {
        const add: FishSpec = { species: sp.id, level: 1 }
        if (free() > 0) {
          options.push({ cost: sp.price, gain: est([...base, add]) - baseEst, run: () => buy(day, now, sp.id, null) })
        } else {
          if (w && weightOf(sp.id) > weightOf(w.species)) {
            const rest = s.fish.filter((f) => f.id !== w.id).map((f) => ({ species: f.species, level: f.level }))
            options.push({ cost: sp.price, gain: est([...rest, add]) - baseEst, run: () => buy(day, now, sp.id, w) })
          }
          if (offer.reason === null) {
            options.push({ cost: offer.price + sp.price, gain: est([...base, add]) - baseEst, run: () => slot(day, now) && buy(day, now, sp.id, null) })
          }
        }
      }
      for (const f of s.fish) {
        if (f.level >= MAX_LEVEL || f.xp < (XP_THRESHOLDS[f.level] ?? Infinity)) continue
        const up = s.fish.map((g) => ({ species: g.species, level: g.id === f.id ? g.level + 1 : g.level }))
        options.push({
          cost: levelUpCost(f),
          gain: est(up) - baseEst,
          run: () => {
            const c = levelUpCost(f)
            const ok = apply(levelUp(s, f.id, now))
            if (ok) spent += c
            return ok
          },
        })
      }
      const ranked = options
        .filter((o) => o.gain > 0)
        .map((o) => ({ ...o, payback: o.cost / o.gain }))
        .filter((o) => o.payback <= 60)
        .sort((a, b) => a.payback - b.payback)
      const best = ranked[0]
      if (!best) break
      const choice = best.cost <= s.coins ? best : ranked.find((o) => o.cost <= s.coins && o.payback <= best.payback * 1.5)
      if (!choice || !choice.run()) break
    }
  }

  function act(day: number, now: number) {
    if (s.fish.some((f) => f.pending > 0)) {
      const before = s.coins
      apply(collect(s, null, now))
      collectedToday += s.coins - before
    }
    tend(now)
    if (sc.strategy === 'A') strategyA(day, now)
    else if (sc.strategy === 'B') strategyB(day, now)
    else if (sc.strategy === 'C') strategyC(day, now)
    else strategyD(day, now)
  }

  let collectedToday = 0
  const energyWindow: number[] = []

  for (let d = 0; d < DAYS; d++) {
    const day = d + 1
    collectedToday = 0
    const lifetimeStart = s.lifetimeProducedCoins
    const spentStart = spent
    const purchasesStart = purchases.length
    const mintedByRarity: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
    const span = 12 * 60 // turns spread over 09:00–21:00
    let anyOver = new Set<string>()

    for (let t = 0; t < sc.activity; t++) {
      const now = at(d, 9, Math.floor((t * span) / sc.activity))
      const usage = sampleUsage(sc.workload, r)
      energyWindow.push(energyOf(effectiveTokens(usage)))
      if (energyWindow.length > sc.activity * 2) energyWindow.shift()
      energyAvg = energyWindow.reduce((a, b) => a + b, 0) / energyWindow.length
      const out = applyTurn(s, { turnId: `${id}-${d}-${t}`, usage, now })
      s = out.state
      for (const e of out.events) {
        if (e.kind !== 'minted') continue
        const f = s.fish.find((x) => x.id === e.fishId)
        if (!f) continue
        mintedByRarity[SPECIES[f.species].rarity] += e.coins
        const rec = records.get(f.id)
        if (rec) {
          rec.own += e.coins
          if (rec.paidDay === null && rec.own >= rec.price) rec.paidDay = day
        }
      }
      for (const f of s.fish) if (f.dailyRaw > ECONOMY.dailyQuota[SPECIES[f.species].rarity]) anyOver.add(f.id)
      const visit = sc.collectMode === 'turn' || (sc.collectMode === 'irregular' && rAct() < 3 / sc.activity)
      if (visit) act(day, now + 1000)
    }
    if (sc.collectMode === 'daily') act(day, at(d, 22))
    if (sc.collectMode === 'irregular' && collectedToday === 0 && rAct() < 0.5) act(day, at(d, 22))

    const byRarity: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
    for (const f of s.fish) byRarity[SPECIES[f.species].rarity]++
    const minted = s.lifetimeProducedCoins - lifetimeStart
    const share = Object.fromEntries(RARITIES.map((k) => [k, minted > 0 ? round(mintedByRarity[k] / minted, 3) : 0])) as Record<Rarity, number>
    if (anyOver.size > 0) softCapDays++
    if (tenFishDay === null && s.fish.length >= 10) tenFishDay = day
    if (allSpeciesDay === null && s.dex.length >= SPECIES_LIST.length) allSpeciesDay = day
    if (maxLevelDay === null && tankLevel(s) >= MAX_TANK_LEVEL) maxLevelDay = day
    rows.push({
      day,
      minted,
      lifetime: s.lifetimeProducedCoins,
      collected: collectedToday,
      balance: s.coins,
      fish: s.fish.length,
      byRarity,
      tankLevel: tankLevel(s),
      capacity: slotCapacity(s),
      purchases: purchases.slice(purchasesStart).map((p) => p.what).join(' '),
      share,
      overQuotaFish: anyOver.size,
      spent: spent - spentStart,
      foodSpent,
      roi: spent > 0 ? round(s.lifetimeProducedCoins / spent, 3) : 0,
    })
    void spentStart
    if (HORIZONS.includes(day as 7 | 30 | 60)) horizonState.set(day, { s, spent })
  }

  const horizons: Summary['horizons'] = {}
  for (const h of HORIZONS) {
    const hs = horizonState.get(h)!
    const fishBy: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
    for (const f of hs.s.fish) fishBy[SPECIES[f.species].rarity]++
    const last7 = rows.slice(Math.max(0, h - 7), h)
    horizons[`day${h}`] = {
      lifetime: hs.s.lifetimeProducedCoins,
      balance: hs.s.coins,
      tankLevel: tankLevel(hs.s),
      capacity: slotCapacity(hs.s),
      fish: fishBy,
      roi: hs.spent > 0 ? round(hs.s.lifetimeProducedCoins / hs.spent, 3) : 0,
      avgDailyLast7: round(last7.reduce((a, x) => a + x.minted, 0) / Math.max(1, last7.length), 0),
      speciesOwned: hs.s.dex.length,
      goalsLeft: goalsLeft(hs.s),
    }
  }
  horizonState.clear()

  const summary: Summary = {
    ...sc,
    id,
    day1Minted: rows[0]!.minted,
    day2Minted: rows[1]!.minted,
    day1Fish: rows[0]!.fish,
    day1Balance: rows[0]!.balance,
    firstRareDay: firsts.rare,
    firstEpicDay: firsts.epic,
    firstLegendaryDay: firsts.legendary,
    tenFishDay,
    allSpeciesOwnedDay: allSpeciesDay,
    maxLevelDay,
    horizons,
    highPricePaybacks: [...records.values()]
      .filter((x) => x.rarity === 'epic' || x.rarity === 'legendary')
      .map((x) => ({ species: x.species, rarity: x.rarity, day: x.day, price: x.price, marginalDays: x.marginalDays === null ? null : round(x.marginalDays, 1), ownPaidAfterDays: x.paidDay === null ? null : x.paidDay - x.day })),
    softCapDays,
  }
  return { summary, rows }
}
const horizonState = new Map<number, { s: GameState; spent: number }>()

// ---------------------------------------------------------------- the old formula (P0)

/**
 * Economy before v0.3, re-implemented from the replaced code for comparison only:
 * eff = in + 2·out + 0.1·cacheRead + 1.25·cacheWrite; energy = (min(eff,15000) + 0.2·over)/1000;
 * each fish mints energy × rate × levelBoost × hunger × mood (linear in fish count), species
 * unlock by fish count, 10 fish max, old price/rate table. Player: 40 turns/day, collects every
 * turn, feeds hungry fish (hunger < 25), buys the most expensive affordable unlocked species.
 */
const LEGACY_SPECIES: Record<SpeciesId, { price: number; rate: number; unlockAt: number }> = {
  guppy: { price: 80, rate: 1.0, unlockAt: 0 }, clownfish: { price: 120, rate: 1.15, unlockAt: 0 },
  tang: { price: 200, rate: 1.4, unlockAt: 2 }, puffer: { price: 300, rate: 1.6, unlockAt: 2 },
  angelfish: { price: 400, rate: 1.9, unlockAt: 3 }, koi: { price: 600, rate: 2.3, unlockAt: 4 },
  goldfish: { price: 800, rate: 2.7, unlockAt: 5 }, seahorse: { price: 1200, rate: 3.2, unlockAt: 6 },
  neon: { price: 100, rate: 1.1, unlockAt: 1 }, betta: { price: 250, rate: 1.5, unlockAt: 2 },
  butterflyfish: { price: 500, rate: 2.1, unlockAt: 4 }, lionfish: { price: 900, rate: 2.9, unlockAt: 5 },
  arowana: { price: 1500, rate: 3.6, unlockAt: 7 }, danio: { price: 90, rate: 1.05, unlockAt: 1 },
  swordtail: { price: 160, rate: 1.3, unlockAt: 2 }, discus: { price: 450, rate: 2.0, unlockAt: 3 },
  mandarin: { price: 700, rate: 2.5, unlockAt: 4 }, oscar: { price: 850, rate: 2.8, unlockAt: 5 },
  moorishidol: { price: 1000, rate: 3.0, unlockAt: 6 }, parrotfish: { price: 1300, rate: 3.4, unlockAt: 6 },
  mola: { price: 2000, rate: 4.2, unlockAt: 8 },
}

function legacyEffective(u: Usage): number {
  return u.input_tokens + 2 * u.output_tokens + 0.1 * u.cache_read_input_tokens + 1.25 * u.cache_creation_input_tokens
}
function legacyEnergy(e: number): number {
  return (Math.min(e, 15000) + 0.2 * Math.max(e - 15000, 0)) / 1000
}

type LegacyResult = { effective: number; energy: number; day1Minted: number; day2Minted: number; dailyFromDay2: number; day1Fish: number; day1Balance: number; allUnlockedAffordableDay: number | null }

function legacySim(u: Usage, turnsPerDay: number, days: number): LegacyResult {
  type LF = { species: SpeciesId; hunger: number; mood: number; carry: number }
  const fish: LF[] = [{ species: 'guppy', hunger: 80, mood: 70, carry: 0 }, { species: 'clownfish', hunger: 80, mood: 70, carry: 0 }]
  let coins = 150
  let food = 10
  const effective = legacyEffective(u)
  const energy = legacyEnergy(effective)
  const minted: number[] = []
  let day1Fish = 0
  let day1Balance = 0
  let allDay: number | null = null
  const ids = Object.keys(LEGACY_SPECIES) as SpeciesId[]
  for (let d = 0; d < days; d++) {
    let m = 0
    for (let t = 0; t < turnsPerDay; t++) {
      for (const f of fish) {
        const progress = f.carry + energy * LEGACY_SPECIES[f.species].rate * (0.5 + f.hunger / 200) * (0.9 + (0.2 * f.mood) / 100)
        const whole = Math.floor(progress)
        f.carry = progress - whole
        m += whole
        coins += whole
        f.hunger = Math.max(0, f.hunger - Math.min(4, 1 + energy * 0.5))
        f.mood = f.mood > 70 ? Math.max(70, f.mood - 1) : Math.min(70, f.mood + 1)
      }
      for (const f of fish) {
        if (f.hunger >= 25) continue
        if (food <= 0 && coins >= 5 * 20) { coins -= 100; food += 20 }
        if (food > 0) { food--; f.hunger = Math.min(100, f.hunger + 30) }
      }
      for (let guard = 0; guard < 10 && fish.length < 10; guard++) {
        const pick = ids.filter((id) => fish.length >= LEGACY_SPECIES[id].unlockAt && LEGACY_SPECIES[id].price <= coins)
          .sort((a, b) => LEGACY_SPECIES[b].price - LEGACY_SPECIES[a].price)[0]
        if (!pick) break
        coins -= LEGACY_SPECIES[pick].price
        fish.push({ species: pick, hunger: 80, mood: 70, carry: 0 })
      }
      if (allDay === null && ids.every((id) => fish.length >= LEGACY_SPECIES[id].unlockAt && coins >= LEGACY_SPECIES[id].price)) allDay = d + 1
    }
    minted.push(m)
    if (d === 0) { day1Fish = fish.length; day1Balance = coins }
  }
  return {
    effective, energy: round(energy, 3), day1Minted: minted[0]!, day2Minted: minted[1]!,
    dailyFromDay2: round(minted.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, minted.length - 1), 0),
    day1Fish, day1Balance, allUnlockedAffordableDay: allDay,
  }
}

// ---------------------------------------------------------------- run everything

function csvRow(sc: Summary, row: DayRow): string {
  return [
    sc.strategy, sc.collectMode, row.day, row.minted, row.lifetime, row.collected, row.balance, row.fish,
    row.byRarity.common, row.byRarity.rare, row.byRarity.epic, row.byRarity.legendary,
    row.tankLevel, row.capacity, `"${row.purchases}"`,
    row.share.common, row.share.rare, row.share.epic, row.share.legendary,
    row.overQuotaFish, row.spent, row.foodSpent, row.roi,
  ].join(',')
}
const CSV_HEAD = 'strategy,collect,day,minted,lifetime,collected,balance,fish,common,rare,epic,legendary,tankLevel,slots,purchases,shareCommon,shareRare,shareEpic,shareLegendary,fishOverSoftCap,spentToday,foodSpentTotal,roiCumulative'

function main() {
  mkdirSync(join(OUT, 'daily'), { recursive: true })
  const started = Date.now()
  const summaries: Summary[] = []
  for (const activity of ACTIVITY) {
    for (const workload of WORKLOAD_IDS) {
      const lines = [CSV_HEAD]
      for (const strategy of Object.keys(STRATEGIES) as StrategyId[]) {
        for (const collectMode of Object.keys(COLLECT) as CollectMode[]) {
          const { summary, rows } = runScenario({ activity, workload, strategy, collectMode })
          summaries.push(summary)
          for (const row of rows) lines.push(csvRow(summary, row))
        }
      }
      writeFileSync(join(OUT, 'daily', `${activity}t-${workload}.csv`), lines.join('\n') + '\n')
    }
  }
  writeFileSync(join(OUT, 'scenarios.json'), JSON.stringify({ seed: SEED, configVersion: ECONOMY_CONFIG_VERSION, days: DAYS, scenarios: summaries }, null, 1) + '\n')

  // Old vs new: the same Desktop/small samples, no jitter, the old sim's player (B, every turn, 40/day).
  const compare = (['desktop', 'small'] as const).map((w) => {
    const u = WORKLOADS[w].sample
    const legacy = legacySim(u, 40, 7)
    const now = summaries.find((x) => x.activity === 40 && x.workload === w && x.strategy === 'B' && x.collectMode === 'turn')!
    return {
      workload: w,
      usage: u,
      legacy,
      v03: {
        effective: effectiveTokens(u),
        energy: round(energyOf(effectiveTokens(u)), 3),
        day1Minted: now.day1Minted,
        day2Minted: now.day2Minted,
        day1Fish: now.day1Fish,
        day1Balance: now.day1Balance,
        firstRareDay: now.firstRareDay,
        firstEpicDay: now.firstEpicDay,
        firstLegendaryDay: now.firstLegendaryDay,
        allSpeciesOwnedDay: now.allSpeciesOwnedDay,
      },
    }
  })
  writeFileSync(join(OUT, 'legacy-vs-new.json'), JSON.stringify(compare, null, 1) + '\n')
  writeFileSync(join(ROOT, 'docs', 'economy-balance-report.md'), report(summaries, compare))
  console.log(`${summaries.length} scenarios × ${DAYS} days in ${((Date.now() - started) / 1000).toFixed(1)} s → docs/economy/, docs/economy-balance-report.md`)
  printTargets(summaries)
}

// ---------------------------------------------------------------- report

const REF_ACTIVITY = 40
const REF_WORKLOADS: WorkloadId[] = ['desktop']
const fmtDay = (d: number | null) => (d === null ? '—' : String(d))
const fmtN = (n: number) => Math.round(n).toLocaleString('en-US')

function pick(all: Summary[], f: Partial<Scenario>): Summary[] {
  return all.filter((x) => (Object.keys(f) as (keyof Scenario)[]).every((k) => x[k] === f[k]))
}

type Check = { target: string; result: string; ok: boolean }

function checks(all: Summary[]): Check[] {
  const ref = all.filter((x) => x.activity === REF_ACTIVITY && REF_WORKLOADS.includes(x.workload))
  const range = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null)
    const missing = xs.length - v.length
    return { min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, med: median(v), missing }
  }
  /** Met when the median lies in the band; the share of scenarios inside it is reported too. */
  const band = (xs: (number | null)[], lo: number, hi: number) => {
    const inside = xs.filter((x) => x !== null && x >= lo && x <= hi).length
    const v = xs.filter((x): x is number => x !== null)
    // A scenario that never reaches the milestone counts as later than any day.
    const all = [...v, ...xs.filter((x) => x === null).map(() => Infinity)]
    const med = median(all)
    return { ok: med !== null && med >= lo && med <= hi, share: `${inside}/${xs.length} in band` }
  }
  const refRich = ref.filter((x) => x.strategy !== 'A')
  const rare = range(refRich.map((x) => x.firstRareDay))
  const epic = range(refRich.map((x) => x.firstEpicDay))
  const leg = range(refRich.map((x) => x.firstLegendaryDay))
  const pay = ref.filter((x) => x.strategy !== 'A').flatMap((x) => x.highPricePaybacks.map((p) => p.marginalDays)).filter((x): x is number => x !== null)
  const payLeg = ref.filter((x) => x.strategy !== 'A').flatMap((x) => x.highPricePaybacks.filter((p) => p.rarity === 'legendary').map((p) => p.marginalDays)).filter((x): x is number => x !== null)
  const payMed = median(pay)
  const day1Max = Math.max(...all.map((x) => x.day1Fish))
  const day1Ref = range(pick(all, { activity: 40, workload: 'desktop' }).map((x) => x.day1Minted))
  const twoDay = all.filter((x) => x.activity <= 40 && x.allSpeciesOwnedDay !== null && x.allSpeciesOwnedDay <= 2)
  const goals60 = all.filter((x) => x.horizons.day60!.goalsLeft.length === 0)
  // Cheapest First vs the best other strategy, same activity/workload/collect, day 60 lifetime.
  let aWins = 0
  let groups = 0
  for (const x of all.filter((y) => y.strategy === 'A')) {
    const others = all.filter((y) => y.activity === x.activity && y.workload === x.workload && y.collectMode === x.collectMode && y.strategy !== 'A')
    groups++
    if (x.horizons.day60!.lifetime > Math.max(...others.map((o) => o.horizons.day60!.lifetime))) aWins++
  }
  return [
    { target: 'Day 1: no scenario can hold 10 fish', result: `max fish at end of day 1 = ${day1Max}`, ok: day1Max < 10 },
    { target: 'Day 1 income well below the old thousands (Desktop, 40 turns)', result: `day-1 minted ${fmtN(day1Ref.min ?? 0)}–${fmtN(day1Ref.max ?? 0)} (old: see table above)`, ok: (day1Ref.max ?? 0) < 1000 },
    ...([['First Rare ≈ day 1–5 (ref: 40 turns, Desktop, strategies B–D × 3 collection modes, median)', rare, (x: Summary) => x.firstRareDay, 1, 5],
      ['First Epic ≈ day 5–15 (same reference, median)', epic, (x: Summary) => x.firstEpicDay, 5, 15],
      ['First Legendary ≈ day 15–35 (same reference, median)', leg, (x: Summary) => x.firstLegendaryDay, 15, 35]] as const).map(([target, rg, f, lo, hi]) => {
      const b = band(refRich.map(f), lo, hi)
      return { target, result: `day ${fmtDay(rg.min)}–${fmtDay(rg.max)}, median ${fmtDay(rg.med)}${rg.missing ? `, ${rg.missing} never` : ''}; ${b.share}`, ok: b.ok }
    }),
    { target: 'Epic/Legendary marginal payback ≈ 10–30 days (reference, median)', result: `median ${payMed === null ? '—' : round(payMed, 1)} d over ${pay.length} purchases (min ${pay.length ? round(Math.min(...pay), 1) : '—'}, max ${pay.length ? round(Math.max(...pay), 1) : '—'}); legendary only: median ${payLeg.length ? round(median(payLeg)!, 1) : '—'} d over ${payLeg.length}`, ok: payMed !== null && payMed >= 10 && payMed <= 30 },
    { target: '≤ 40 turns/day cannot own every species within 2 days', result: `${twoDay.length} scenarios did`, ok: twoDay.length === 0 },
    { target: 'Goals remain after 60 days', result: `${all.length - goals60.length}/${all.length} scenarios still have goals at day 60`, ok: goals60.length === 0 },
    { target: 'Cheapest First does not dominate long-term', result: `A has the highest day-60 lifetime in ${aWins}/${groups} matched groups`, ok: aWins <= groups * 0.25 },
  ]
}

function printTargets(all: Summary[]) {
  for (const c of checks(all)) console.log(`${c.ok ? 'PASS' : 'MISS'}  ${c.target}: ${c.result}`)
}

function report(all: Summary[], compare: { workload: string; legacy: LegacyResult; v03: Record<string, unknown> }[]): string {
  const L: string[] = []
  L.push('# Token Tank economy v0.3 — balance report', '')
  L.push(`Generated by \`npx tsx scripts/simulate-economy.ts\` (seed \`${SEED}\`, config version ${ECONOMY_CONFIG_VERSION}). Do not edit by hand; change \`game/economy.config.ts\` and re-run.`, '')
  L.push('**No runtime verification:** every number here comes from the pure engine driven by scripted players. The per-turn usage samples are ASSUMED (see below), not measured from real sessions.', '')

  L.push('## Formulas', '')
  L.push('- effectiveTokens = input + output×2 + cacheRead×0.02 + cacheWrite×1.25')
  L.push('- energy = (min(eff, 15,000) + max(eff − 15,000, 0)×0.1) / 2,500')
  L.push('- w_i = rarityWeight × levelBoost(1 + 0.15·(lv−1)) × hungerFactor(0.5–1.0) × moodFactor(0.9–1.1); production_i = energy × w_i / √Σw')
  L.push(`- Daily soft cap per fish (raw coins, local day): ${RARITIES.map((k) => `${k} ${fmtN(ECONOMY.dailyQuota[k])}`).join(', ')}; past it ×${ECONOMY.overQuotaFactor}`)
  L.push('- Pending cap 80 coins per fish (uncollected coins past it are lost); rewards (edit/test/commit) pay coins but never lifetime coins.', '')

  L.push('## Assumed inputs', '')
  L.push('| workload | input | output | cache read | cache write | effective | energy/turn |', '|---|---:|---:|---:|---:|---:|---:|')
  for (const w of WORKLOAD_IDS) {
    const u = WORKLOADS[w].sample
    if (!u) { L.push(`| ${WORKLOADS[w].label} | | | | | | |`); continue }
    L.push(`| ${WORKLOADS[w].label} | ${fmtN(u.input_tokens)} | ${fmtN(u.output_tokens)} | ${fmtN(u.cache_read_input_tokens)} | ${fmtN(u.cache_creation_input_tokens)} | ${fmtN(effectiveTokens(u))} | ${round(energyOf(effectiveTokens(u)), 2)} |`)
  }
  L.push('', 'Each turn jitters every field ±20 %. Turns are spread evenly over 09:00–21:00 local time. Activity 8/20/40/80 turns a day; 60 simulated days (the 7- and 30-day results are the same runs read at those days: no strategy knows the horizon).', '')
  L.push('Players: every visit collects, feeds any fish under 60 hunger back over 70 (buying food in 20s), then shops:', '')
  L.push('- **A Cheapest First** — fills free slots with the cheapest unlocked species, buys slots when full, never replaces a fish; levels fish with spare coins.')
  L.push('- **B Most Expensive Affordable** — fills free slots with the most expensive species it can afford; when full buys a slot, else replaces its weakest fish with a higher-rarity one.')
  L.push('- **C Balanced** — spends at most 60 % of the wallet per purchase on the cheapest species of the best rarity that fits; slots under the same rule; replaces a fish only for ≥ 2× its rarity weight; keeps 30 % in reserve when levelling.')
  L.push('- **D ROI Optimized** — ranks every option (new fish, slot + fish, replacement, fish level-up) by price ÷ estimated extra coins a day, buys the best one or saves for it unless an affordable option is within 1.5× of its payback.')
  L.push('', 'Collection: every turn, once a day at 22:00, or irregular (each turn 3/turns-per-day chance; a day without a visit gets a 50 % evening visit).', '')

  L.push('## Old vs new (P0 reproduction)', '')
  L.push('Old = the replaced formula re-implemented in the simulator (cacheRead×0.1, /1000, ×0.2 past the knee, linear in fish count, unlock by fish count). Same player as the earlier study: 40 turns/day, collect every turn, buy the most expensive affordable species; no jitter on the old side.', '')
  L.push('| | Desktop old | Desktop v0.3 | Small old | Small v0.3 |', '|---|---:|---:|---:|---:|')
  const d = compare.find((c) => c.workload === 'desktop')!
  const sm = compare.find((c) => c.workload === 'small')!
  const v = (c: typeof d, k: string) => { const x = c.v03[k]; return typeof x === 'number' ? (Number.isInteger(x) ? fmtN(x) : String(x)) : x === null ? '—' : String(x) }
  L.push(`| effective tokens / turn | ${fmtN(d.legacy.effective)} | ${v(d, 'effective')} | ${fmtN(sm.legacy.effective)} | ${v(sm, 'effective')} |`)
  L.push(`| energy / turn | ${d.legacy.energy} | ${v(d, 'energy')} | ${sm.legacy.energy} | ${v(sm, 'energy')} |`)
  L.push(`| day-1 coins minted | ${fmtN(d.legacy.day1Minted)} | ${v(d, 'day1Minted')} | ${fmtN(sm.legacy.day1Minted)} | ${v(sm, 'day1Minted')} |`)
  L.push(`| day-2 coins minted | ${fmtN(d.legacy.day2Minted)} | ${v(d, 'day2Minted')} | ${fmtN(sm.legacy.day2Minted)} | ${v(sm, 'day2Minted')} |`)
  L.push(`| fish at end of day 1 | ${d.legacy.day1Fish} | ${v(d, 'day1Fish')} | ${sm.legacy.day1Fish} | ${v(sm, 'day1Fish')} |`)
  L.push(`| wallet at end of day 1 | ${fmtN(d.legacy.day1Balance)} | ${v(d, 'day1Balance')} | ${fmtN(sm.legacy.day1Balance)} | ${v(sm, 'day1Balance')} |`)
  L.push(`| every species unlocked & affordable / owned | day ${fmtDay(d.legacy.allUnlockedAffordableDay)} | day ${v(d, 'allSpeciesOwnedDay')} | day ${fmtDay(sm.legacy.allUnlockedAffordableDay)} | day ${v(sm, 'allSpeciesOwnedDay')} |`)
  L.push(`| first rare / epic / legendary | — | day ${v(d, 'firstRareDay')} / ${v(d, 'firstEpicDay')} / ${v(d, 'firstLegendaryDay')} | — | day ${v(sm, 'firstRareDay')} / ${v(sm, 'firstEpicDay')} / ${v(sm, 'firstLegendaryDay')} |`)
  L.push('', 'Earlier study for reference: Desktop day 1 7,483 then ~8,370/day, 10 fish and 6,547 coins after day 1; small day 1 2,755 then ~3,450/day.', '')

  L.push('## Balance targets', '')
  L.push(`Reference profile: ${REF_ACTIVITY} turns/day, ${REF_WORKLOADS.join(' + ')} workloads, all collection modes.`, '')
  L.push('| target | result | |', '|---|---|---|')
  for (const c of checks(all)) L.push(`| ${c.target} | ${c.result} | ${c.ok ? 'met' : '**missed**'} |`)
  L.push('')

  L.push('## Milestones by activity and workload (strategy D, collect every turn / once a day)', '')
  L.push('| turns/day | workload | day-1 coins | first rare | first epic | first legendary | Lv day 7 | Lv day 30 | Lv day 60 | lifetime day 60 | coins/day (days 54–60) |', '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const a of ACTIVITY) for (const w of WORKLOAD_IDS) {
    const t = pick(all, { activity: a, workload: w, strategy: 'D', collectMode: 'turn' })[0]!
    const dd = pick(all, { activity: a, workload: w, strategy: 'D', collectMode: 'daily' })[0]!
    const both = (f: (x: Summary) => number | null) => `${fmtDay(f(t))} / ${fmtDay(f(dd))}`
    L.push(`| ${a} | ${w} | ${fmtN(t.day1Minted)} / ${fmtN(dd.day1Minted)} | ${both((x) => x.firstRareDay)} | ${both((x) => x.firstEpicDay)} | ${both((x) => x.firstLegendaryDay)} | ${both((x) => x.horizons.day7!.tankLevel)} | ${both((x) => x.horizons.day30!.tankLevel)} | ${both((x) => x.horizons.day60!.tankLevel)} | ${fmtN(t.horizons.day60!.lifetime)} / ${fmtN(dd.horizons.day60!.lifetime)} | ${fmtN(t.horizons.day60!.avgDailyLast7)} / ${fmtN(dd.horizons.day60!.avgDailyLast7)} |`)
  }
  L.push('')

  L.push(`## Strategies at ${REF_ACTIVITY} turns/day (Desktop), by collection mode`, '')
  L.push('| strategy | collect | day-1 coins | first R / E / L | day 7: lifetime · Lv · fish c/r/e/l | day 30 | day 60 | ROI day 60 | soft-cap days |', '|---|---|---:|---|---|---|---|---:|---:|')
  for (const st of Object.keys(STRATEGIES) as StrategyId[]) for (const cm of Object.keys(COLLECT) as CollectMode[]) {
    const x = pick(all, { activity: REF_ACTIVITY, workload: 'desktop', strategy: st, collectMode: cm })[0]!
    const h = (k: string) => { const y = x.horizons[k]!; return `${fmtN(y.lifetime)} · Lv${y.tankLevel} · ${y.fish.common}/${y.fish.rare}/${y.fish.epic}/${y.fish.legendary}` }
    L.push(`| ${st} ${STRATEGIES[st]} | ${cm} | ${fmtN(x.day1Minted)} | ${fmtDay(x.firstRareDay)} / ${fmtDay(x.firstEpicDay)} / ${fmtDay(x.firstLegendaryDay)} | ${h('day7')} | ${h('day30')} | ${h('day60')} | ${x.horizons.day60!.roi} | ${x.softCapDays} |`)
  }
  L.push('')

  L.push('## Strategy comparison over everything (day-60 lifetime coins, median across workloads × collection modes)', '')
  L.push('| turns/day | A | B | C | D |', '|---:|---:|---:|---:|---:|')
  for (const a of ACTIVITY) {
    const cells = (Object.keys(STRATEGIES) as StrategyId[]).map((st) => fmtN(median(pick(all, { activity: a, strategy: st }).map((x) => x.horizons.day60!.lifetime)) ?? 0))
    L.push(`| ${a} | ${cells.join(' | ')} |`)
  }
  L.push('')

  L.push('## High-price fish payback (epic and legendary purchases)', '')
  L.push('Marginal payback = price ÷ (estimated tank coins/day after − before), estimated at the moment of purchase with the observed energy per turn. Own payback = days until that fish itself minted its price (it overstates the value, because a new fish also lowers its tank-mates\' share).', '')
  L.push('| turns/day | workload | purchases | marginal payback median (min–max) d | own payback median d |', '|---:|---|---:|---|---:|')
  for (const a of ACTIVITY) for (const w of ['desktop', 'small', 'mixed'] as WorkloadId[]) {
    const ps = pick(all, { activity: a, workload: w }).filter((x) => x.strategy !== 'A').flatMap((x) => x.highPricePaybacks)
    const m = ps.map((p) => p.marginalDays).filter((x): x is number => x !== null)
    const o = ps.map((p) => p.ownPaidAfterDays).filter((x): x is number => x !== null)
    L.push(`| ${a} | ${w} | ${ps.length} | ${m.length ? `${round(median(m)!, 1)} (${round(Math.min(...m), 1)}–${round(Math.max(...m), 1)})` : '—'} | ${o.length ? round(median(o)!, 1) : '—'} |`)
  }
  L.push('')

  L.push('## Final parameters (game/economy.config.ts)', '')
  L.push('| species | rarity | weight | price | unlock Lv | daily soft cap |', '|---|---|---:|---:|---:|---:|')
  for (const sp of SPECIES_LIST) L.push(`| ${sp.id} (${sp.zh}) | ${sp.rarity} | ${sp.rate} | ${fmtN(sp.price)} | ${sp.unlockLevel} | ${fmtN(ECONOMY.dailyQuota[sp.rarity])} |`)
  L.push('', '| tank Lv | lifetime coins | base slots | slots buyable |', '|---:|---:|---:|---:|')
  for (let n = 1; n <= MAX_TANK_LEVEL; n++) L.push(`| ${n} | ${fmtN(ECONOMY.tankLevels[n - 1]!)} | ${baseSlots(n)} | ${slotsBuyable(n)} |`)
  L.push('', `Slot prices (1st, 2nd, 3rd bought): ${ECONOMY.slotPrices.map(fmtN).join(', ')}; capacity = min(${ECONOMY.maxSlots}, base + bought), never below the fish already kept.`)
  L.push(`Token weights ${JSON.stringify(ECONOMY.tokenWeights)}, energy ${JSON.stringify(ECONOMY.energy)}, over-cap factor ${ECONOMY.overQuotaFactor}.`, '')
  L.push(TUNING_LOG)
  return L.join('\n') + '\n'
}

/** Tuning history, kept by hand next to the code that produced it. */
const TUNING_LOG = `## Tuning log

Every step re-ran all 240 scenarios. Token and allocation formulas never changed; only the tunables did.
"Ref" = 40 turns/day, strategies B–D × 3 collection modes (medians; "never" = not within 60 days).

| step | change | first rare / epic / legendary (ref median) | epic+legendary marginal payback (median) | verdict |
|---|---|---|---|---|
| 1 | Spec weights 1/3/8/16; old fish levels (+15 %/lv, 50×lv coins); rares 500–1,500, epics 2,000–5,000, legendaries 10k/15k; slots 400/1,500/4,000; ref Desktop+Mixed | 10 / 57.5 / never | 149 d (7 buys) | Fish level-ups (+135 % for 2,250 coins) ate every saving and let a levelled common rival a rare |
| 2 | Fish level +5 %/lv, cost 50 × lv × rarity weight; players B/C keep savings for their next upgrade before levelling | 6 / 22 / 45.5 | 29.5 d | Better; rares/epics still slow, legendaries rarely bought |
| 3 | Prices to the low end of each band (rares 500–1,200, epics 2,000–4,200, legendaries 8,000/12,000); slots 300/1,200/3,000; legendary weight 28 | 5 / 23 / 44 | 30.7 d (legendary 43.6 d) | Under √S a weight unit is worth the same coins in every tier, so legendary price/weight must come down |
| 4 | Epic weight 10, legendary 32; reference narrowed to the Desktop workload of section 一 (Mixed stays in the tables) | 5 / 17 / 38 | 20.8 d (legendary 40.4 d) | Kept |
| 5 | Epic 12, legendary 36 | 5 / 17 / 37 | 17.9 d (legendary 39.9 d) | No timing gain (first epic is gated by saving through the rare phase, not by ROI); reverted to step 4 |

Known misses at the final step, not tuned away on purpose:
- First epic / legendary medians sit a few days past the target bands because once-a-day collectors are held to 80 coins per fish per day by PENDING_CAP (kept at 80 by decision) and the Balanced player spends at most 60 % of its wallet at once. Every-turn and irregular B/D players are inside or at the edge of the bands.
- A legendary bought into a tank already full of levelled epics has a marginal payback near 40 days at 40 turns/day: with production ∝ √Σw the gain of one more weight unit falls as the tank grows. Its own production repays it in about two weeks.
- Small-context workloads earn about a quarter of the Desktop energy per turn, so every milestone arrives roughly 3–4× later for them (see the milestone table).
`

main()
