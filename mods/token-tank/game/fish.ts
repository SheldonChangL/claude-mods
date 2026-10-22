// Creating fish and the player's per-fish actions: feed, collect, rename, level up.

import { LEVEL_UP_COST, MAX_LEVEL, XP_THRESHOLDS } from './economy'
import { SPECIES } from './species'
import type { Fish, GameState, Outcome, SpeciesId } from './types'
import { bump, refuse } from './util'

export const NAME_MAX = 12
const FEED_HUNGER = 30
const FEED_MOOD = 5

export function newFish(species: SpeciesId, now: number, idSeed: string): Fish {
  return {
    id: `${species}-${idSeed}`,
    species,
    name: SPECIES[species].zh,
    level: 1,
    xp: 0,
    hunger: 80,
    mood: 70,
    carry: 0,
    pending: 0,
    bornAt: now,
    lastFedAt: now,
    state: 'swim',
    since: now,
  }
}

/** How many fish rush to one pellet, hungriest first. */
export const EATERS_PER_PELLET = 3
/** A fish at or above this hunger ignores a pellet. */
export const FULL_ENOUGH = 70
export const PELLETS_KEEP = 6

/**
 * A click on open water: one portion of food drops there and the hungry fish
 * (under FULL_ENOUGH, hungriest first, at most EATERS_PER_PELLET) rush to it
 * and eat. With nobody hungry the food still drops and is wasted.
 */
export function dropFood(state: GameState, x: number, y: number, now: number): Outcome {
  if (state.fish.length === 0) return refuse(state, 'no-fish')
  if (state.food <= 0) return refuse(state, 'no-food')
  const eaters = [...state.fish]
    .filter((f) => f.hunger < FULL_ENOUGH)
    .sort((a, b) => a.hunger - b.hunger)
    .slice(0, EATERS_PER_PELLET)
    .map((f) => f.id)
  const fish = state.fish.map((f): Fish =>
    eaters.includes(f.id)
      ? { ...f, hunger: Math.min(100, f.hunger + FEED_HUNGER), mood: Math.min(100, f.mood + FEED_MOOD), state: 'feeding', since: now, lastFedAt: now }
      : f,
  )
  const pellet = { id: `pellet-${now}`, x: Math.round(x), y: Math.round(y), at: now, eaters }
  const next = bump(
    state,
    { fish, food: state.food - 1, pellets: [...state.pellets, pellet].slice(-PELLETS_KEEP), stats: { ...state.stats, feeds: state.stats.feeds + eaters.length } },
    now,
  )
  return { state: next, events: [{ kind: 'dropped', x: pellet.x, y: pellet.y, eaters }] }
}

/** A click on a fish: it darts off (the drawing plays it) and cheers up a little. */
export function startle(state: GameState, fishId: string, now: number): Outcome {
  const target = state.fish.find((f) => f.id === fishId)
  if (!target) return refuse(state, 'no-such-fish')
  const fish = state.fish.map((f): Fish => (f.id === fishId ? { ...f, state: 'startled', since: now, mood: Math.min(100, f.mood + 1) } : f))
  return { state: bump(state, { fish }, now), events: [{ kind: 'startled', fishId }] }
}

export function pendingTotal(state: GameState): number {
  return state.fish.reduce((n, f) => n + f.pending, 0)
}

/** The fish with the lowest hunger, or null for an empty tank. */
export function hungriest(state: GameState): Fish | null {
  let best: Fish | null = null
  for (const f of state.fish) if (!best || f.hunger < best.hunger) best = f
  return best
}

/** Feed one fish, or all (`null`); short on food, the hungriest eat first. */
export function feed(state: GameState, fishId: string | null, now: number): Outcome {
  const targets = fishId === null ? state.fish : state.fish.filter((f) => f.id === fishId)
  if (targets.length === 0) return refuse(state, fishId === null ? 'no-fish' : 'no-such-fish')
  if (state.food <= 0) return refuse(state, 'no-food')

  const count = Math.min(state.food, targets.length)
  const fedIds = new Set(
    [...targets].sort((a, b) => a.hunger - b.hunger).slice(0, count).map((f) => f.id),
  )
  const fish = state.fish.map((f): Fish =>
    fedIds.has(f.id)
      ? {
          ...f,
          hunger: Math.min(100, f.hunger + FEED_HUNGER),
          mood: Math.min(100, f.mood + FEED_MOOD),
          state: 'feeding',
          since: now,
          lastFedAt: now,
        }
      : f,
  )
  const next = bump(
    state,
    { fish, food: state.food - count, stats: { ...state.stats, feeds: state.stats.feeds + count } },
    now,
  )
  return { state: next, events: [{ kind: 'fed', fishId, count }] }
}

/** Move pending coins of one fish, or all (`null`), into the wallet. */
export function collect(state: GameState, fishId: string | null, now: number): Outcome {
  if (fishId !== null && !state.fish.some((f) => f.id === fishId)) return refuse(state, 'no-such-fish')
  let coins = 0
  const fish = state.fish.map((f): Fish => {
    if ((fishId !== null && f.id !== fishId) || f.pending <= 0) return f
    coins += f.pending
    return { ...f, pending: 0 }
  })
  if (coins <= 0) return refuse(state, 'nothing-to-collect')
  const s = state.stats
  const next = bump(
    state,
    {
      fish,
      coins: state.coins + coins,
      stats: { ...s, todayCoinsCollected: s.todayCoinsCollected + coins, totalCoinsCollected: s.totalCoinsCollected + coins },
    },
    now,
  )
  return { state: next, events: [{ kind: 'collected', fishId, coins }] }
}

/** Trimmed, at most NAME_MAX code points; null when nothing is left. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = Array.from(raw.trim()).slice(0, NAME_MAX).join('').trim()
  return name.length > 0 ? name : null
}

export function rename(state: GameState, fishId: string, name: string): Outcome {
  if (!state.fish.some((f) => f.id === fishId)) return refuse(state, 'no-such-fish')
  const clean = cleanName(name)
  if (clean === null) return refuse(state, 'empty-name')
  const fish = state.fish.map((f) => (f.id === fishId ? { ...f, name: clean } : f))
  return { state: bump(state, { fish }), events: [{ kind: 'renamed', fishId, name: clean }] }
}

export function levelUp(state: GameState, fishId: string, now: number): Outcome {
  const target = state.fish.find((f) => f.id === fishId)
  if (!target) return refuse(state, 'no-such-fish')
  if (target.level >= MAX_LEVEL) return refuse(state, 'max-level')
  if (target.xp < (XP_THRESHOLDS[target.level] ?? Infinity)) return refuse(state, 'not-enough-xp')
  const cost = LEVEL_UP_COST(target.level)
  if (state.coins < cost) return refuse(state, 'not-enough-coins')
  const level = target.level + 1
  const fish = state.fish.map((f): Fish =>
    f.id === fishId ? { ...f, level, state: 'happy', since: now } : f,
  )
  return { state: bump(state, { fish, coins: state.coins - cost }, now), events: [{ kind: 'levelUp', fishId, level }] }
}
