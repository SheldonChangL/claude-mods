// Tokens → energy → coins, levels, and the per-turn and reward transitions.

import { rollDay } from './day'
import { SPECIES } from './species'
import type { Fish, FishState, GameEvent, GameState, Outcome, RewardKind, Usage } from './types'
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

const ENERGY_KNEE = 15000

export function effectiveTokens(u: Partial<Usage> | null | undefined): number {
  if (!u || typeof u !== 'object') return 0
  const f = (v: unknown) => Math.max(0, num(v, 0))
  return (
    f(u.input_tokens) +
    2 * f(u.output_tokens) +
    0.1 * f(u.cache_read_input_tokens) +
    1.25 * f(u.cache_creation_input_tokens)
  )
}

export function energyOf(effective: number): number {
  const e = Math.max(0, num(effective, 0))
  return (Math.min(e, ENERGY_KNEE) + 0.2 * Math.max(e - ENERGY_KNEE, 0)) / 1000
}

export function levelBoost(level: number): number {
  return 1 + 0.15 * (level - 1)
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

export function LEVEL_UP_COST(level: number): number {
  return 50 * level
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

  const fish = rolled.fish.map((f): Fish => {
    const rate = SPECIES[f.species]?.rate ?? 1
    const progress =
      f.carry + energy * rate * levelBoost(f.level) * hungerFactor(f.hunger) * moodFactor(f.mood)
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
      carry: progress - whole,
      pending: f.pending + coins,
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

  return { state: bump(rolled, { fish, stats, processedTurns }, now), events: [...mintedEvents, ...hungryEvents] }
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
