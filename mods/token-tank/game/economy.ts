// Tokens → energy → coins (economy v0.3), fish levels, and the per-turn and reward transitions.
// Energy is shared by a weighted square root (production_i = energy × w_i / √Σw), then each
// fish's daily soft cap applies; tunables live in economy.config.ts.

import { dayKey, rollDay } from './day'
import { ECONOMY } from './economy.config'
import { SPECIES } from './species'
import type { Fish, FishState, GameEvent, GameState, Outcome, Rarity, RewardKind, SpeciesId, Usage } from './types'
import { bump, clamp, num, refuse } from './util'

export const PENDING_CAP = 80
export const MAX_LEVEL = 10
export const PROCESSED_TURNS_KEEP = 300
/** How long a transient state (spitCoin / feeding / happy) shows before the fish swims again. */
export const TRANSIENT_MS = 8000

/** Cumulative xp to reach level n is XP_THRESHOLDS[n - 1]; so XP_THRESHOLDS[level] is the next level's. */
export const XP_THRESHOLDS: readonly number[] = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]

export const REWARD_COOLDOWN_MS: Record<RewardKind, number> = { edit: 60_000, test: 180_000, commit: 300_000 }
export const REWARD_COINS: Record<RewardKind, number> = { edit: 2, test: 8, commit: 12 }

/** Usage fields as finite non-negative numbers; missing, negative, NaN and Infinity count as 0. */
function field(v: unknown): number {
  return Math.max(0, num(v, 0))
}

/** input + output×2 + cacheRead×0.02 + cacheWrite×1.25 (weights in ECONOMY.tokenWeights). */
export function effectiveTokens(u: Partial<Usage> | null | undefined): number {
  if (!u || typeof u !== 'object') return 0
  const w = ECONOMY.tokenWeights
  return (
    w.input * field(u.input_tokens) +
    w.output * field(u.output_tokens) +
    w.cacheRead * field(u.cache_read_input_tokens) +
    w.cacheWrite * field(u.cache_creation_input_tokens)
  )
}

/** (min(eff, 15000) + max(eff − 15000, 0) × 0.1) / 2500 — fractional, never negative. */
export function energyOf(effective: number): number {
  const e = Math.max(0, num(effective, 0))
  const { knee, overKnee, tokensPerEnergy } = ECONOMY.energy
  return (Math.min(e, knee) + overKnee * Math.max(e - knee, 0)) / tokensPerEnergy
}

export function rarityOf(species: SpeciesId): Rarity {
  return SPECIES[species]?.rarity ?? 'common'
}

/** w = rarity weight × levelBoost × hungerFactor × moodFactor. */
export function fishWeight(f: Pick<Fish, 'species' | 'level' | 'hunger' | 'mood'>): number {
  const w = ECONOMY.rarityWeight[rarityOf(f.species)] * levelBoost(f.level) * hungerFactor(f.hunger) * moodFactor(f.mood)
  return Number.isFinite(w) && w > 0 ? w : 0
}

/**
 * Weighted square-root split: production_i = energy × w_i / √Σw. Adding a fish of positive
 * weight never lowers the total (energy × √Σw); all zeros when there is nothing to share.
 */
export function allocate(energy: number, weights: readonly number[]): number[] {
  const e = num(energy, 0)
  const ws = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const total = ws.reduce((a, b) => a + b, 0)
  if (!(e > 0) || !(total > 0) || !Number.isFinite(total)) return ws.map(() => 0)
  const root = Math.sqrt(total)
  return ws.map((w) => (e * w) / root)
}

/**
 * The daily soft cap for one fish: the raw amount still under `quota` (after `used` raw today)
 * pays in full, the rest pays `factor`. Splitting a turn into smaller ones pays the same.
 */
export function applyQuota(raw: number, used: number, quota: number, factor: number = ECONOMY.overQuotaFactor): { credited: number; used: number; isOver: boolean } {
  const r = Math.max(0, num(raw, 0))
  const u = Math.max(0, num(used, 0))
  const room = Math.max(0, quota - u)
  const full = Math.min(r, room)
  return { credited: full + factor * (r - full), used: u + r, isOver: u + r > quota }
}

export function dailyQuotaOf(species: SpeciesId): number {
  return ECONOMY.dailyQuota[rarityOf(species)]
}

/** The fish's daily counter for `now`'s local day (reset on a new day). */
export function rollFishDay(f: Fish, now: number): Fish {
  const key = dayKey(now)
  return f.dailyKey === key ? f : { ...f, dailyKey: key, dailyRaw: 0 }
}

/** Whether the fish has used up today's full-rate quota. */
export function isOverQuota(f: Fish, now: number): boolean {
  const g = rollFishDay(f, now)
  return g.dailyRaw >= dailyQuotaOf(g.species)
}

/** 1 + boostPerLevel × (level − 1): +5 % a level since v0.3 (was +15 %, which let a levelled common rival a rare). */
export function levelBoost(level: number): number {
  const lv = clamp(Math.floor(num(level, 1)), 1, MAX_LEVEL)
  return 1 + ECONOMY.fishLevel.boostPerLevel * (lv - 1)
}

export function hungerFactor(hunger: number): number {
  return 0.5 + (0.5 * clamp(hunger, 0, 100)) / 100
}

export function moodFactor(mood: number): number {
  return 0.9 + (0.2 * clamp(mood, 0, 100)) / 100
}

export function levelForXp(xp: number): number {
  const x = Math.max(0, num(xp, 0))
  let lv = 1
  for (let n = 1; n <= MAX_LEVEL; n++) if (x >= (XP_THRESHOLDS[n - 1] ?? Infinity)) lv = n
  return lv
}

/** Xp still needed for the next level; 0 at the max level or when already enough. */
export function xpToNext(fish: Pick<Fish, 'level' | 'xp'>): number {
  if (fish.level >= MAX_LEVEL) return 0
  return Math.max(0, (XP_THRESHOLDS[fish.level] ?? Infinity) - fish.xp)
}

/** Coins to raise a fish from `level`: costPerLevel × level × its rarity weight (the gain scales with the weight too). */
export function levelUpCost(fish: Pick<Fish, 'species' | 'level'>): number {
  return ECONOMY.fishLevel.costPerLevel * fish.level * ECONOMY.rarityWeight[rarityOf(fish.species)]
}

/** @deprecated The common-rarity cost only; use levelUpCost(fish). */
export function LEVEL_UP_COST(level: number): number {
  return ECONOMY.fishLevel.costPerLevel * level
}

const TRANSIENT: FishState[] = ['spitCoin', 'feeding', 'happy']

export type TurnInput = { turnId: string; usage: Partial<Usage> | null | undefined; now: number }

export function applyTurn(state: GameState, { turnId, usage, now }: TurnInput): Outcome {
  if (state.processedTurns.includes(turnId)) return refuse(state, 'duplicate-turn')

  const processedTurns = [...state.processedTurns, turnId].slice(-PROCESSED_TURNS_KEEP)
  const rolled = rollDay(state, now)
  const effective = effectiveTokens(usage)
  if (effective <= 0) return { state: bump(rolled, { processedTurns }, now), events: [] }

  const energy = energyOf(effective)
  const mintedEvents: GameEvent[] = []
  const hungryEvents: GameEvent[] = []
  let minted = 0

  const today = rolled.fish.map((f) => rollFishDay(f, now))
  const raws = allocate(energy, today.map(fishWeight))

  const fish = today.map((f, i): Fish => {
    const { credited, used } = applyQuota(raws[i] ?? 0, f.dailyRaw, dailyQuotaOf(f.species))
    const progress = f.carry + credited
    const whole = Math.floor(progress)
    const coins = Math.min(whole, Math.max(0, PENDING_CAP - f.pending))
    const hunger = Math.max(0, f.hunger - Math.min(4, 1 + energy * 0.5))
    const mood = f.mood > 70 ? Math.max(70, f.mood - 1) : Math.min(70, f.mood + 1)

    let fishState = f.state
    let since = f.since
    if (coins > 0) {
      fishState = 'spitCoin'
      since = now
    }
    if (hunger < 25) {
      if (fishState !== 'hungry') since = now
      fishState = 'hungry'
      hungryEvents.push({ kind: 'hungry', fishId: f.id })
    } else if (coins === 0) {
      if ((TRANSIENT.includes(f.state) && now - f.since > TRANSIENT_MS) || f.state === 'hungry') {
        fishState = 'swim'
        since = now
      }
    }

    if (coins > 0) {
      minted += coins
      mintedEvents.push({ kind: 'minted', fishId: f.id, coins, effective })
    }

    return {
      ...f,
      // Coins past the pending cap are lost; the fraction below one coin is kept.
      carry: progress - whole,
      pending: f.pending + coins,
      dailyRaw: used,
      xp: f.xp + Math.round(energy * 10),
      hunger,
      mood,
      state: fishState,
      since,
    }
  })

  const s = rolled.stats
  const stats = {
    ...s,
    todayEffectiveTokens: s.todayEffectiveTokens + effective,
    totalEffectiveTokens: s.totalEffectiveTokens + effective,
    todayCoinsMinted: s.todayCoinsMinted + minted,
    totalCoinsMinted: s.totalCoinsMinted + minted,
    todayTurns: s.todayTurns + 1,
    totalTurns: s.totalTurns + 1,
  }

  const lifetimeProducedCoins = rolled.lifetimeProducedCoins + minted
  return {
    state: bump(rolled, { fish, stats, processedTurns, lifetimeProducedCoins }, now),
    events: [...mintedEvents, ...hungryEvents],
  }
}

export function reward(state: GameState, { kind, now }: { kind: RewardKind; now: number }): Outcome {
  const cooldown = REWARD_COOLDOWN_MS[kind]
  if (cooldown === undefined) return refuse(state, 'unknown-reward')
  const last = state.lastRewardAt[kind]
  if (last !== undefined && now - last < cooldown) return refuse(state, 'cooldown')

  const coins = REWARD_COINS[kind]
  const stats = { ...state.stats }
  if (kind === 'edit') stats.edits += 1
  else if (kind === 'test') stats.testsPassed += 1
  else stats.commits += 1

  const fish =
    kind === 'test'
      ? state.fish.map((f): Fish => ({ ...f, mood: Math.min(100, f.mood + 15), state: 'happy', since: now }))
      : state.fish

  const next = bump(
    state,
    { coins: state.coins + coins, stats, fish, lastRewardAt: { ...state.lastRewardAt, [kind]: now } },
    now,
  )
  return { state: next, events: [{ kind: 'reward', reward: kind, coins }] }
}
