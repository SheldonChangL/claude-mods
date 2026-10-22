// Tank level (from lifetime produced coins) and fish slots. Pure; numbers in economy.config.ts.

import { ECONOMY } from './economy.config'
import type { GameState } from './types'
import { num } from './util'

export const MAX_TANK_LEVEL = ECONOMY.tankLevels.length

/** Tank level for a lifetime produced coin count: 1..MAX_TANK_LEVEL. Bad input counts as 0. */
export function tankLevelFor(lifetime: number): number {
  const c = Math.max(0, num(lifetime, 0))
  let lv = 1
  for (let n = 1; n <= MAX_TANK_LEVEL; n++) if (c >= (ECONOMY.tankLevels[n - 1] ?? Infinity)) lv = n
  return lv
}

export function tankLevel(state: Pick<GameState, 'lifetimeProducedCoins'>): number {
  return tankLevelFor(state.lifetimeProducedCoins)
}

export type TankProgress = {
  level: number
  lifetime: number
  /** Lifetime coins at which this level started. */
  levelStart: number
  /** Lifetime coins the next level needs; null at the top level. */
  nextAt: number | null
  /** 0..1 through this level (1 at the top). */
  fraction: number
}

export function tankProgress(state: Pick<GameState, 'lifetimeProducedCoins'>): TankProgress {
  const lifetime = Math.max(0, num(state.lifetimeProducedCoins, 0))
  const level = tankLevelFor(lifetime)
  const levelStart = ECONOMY.tankLevels[level - 1] ?? 0
  const next = ECONOMY.tankLevels[level]
  const nextAt = next === undefined ? null : next
  const fraction = nextAt === null ? 1 : (lifetime - levelStart) / (nextAt - levelStart)
  return { level, lifetime, levelStart, nextAt, fraction }
}

/** Fish slots the tank level gives for free. */
export function baseSlots(level: number): number {
  const lv = Math.min(MAX_TANK_LEVEL, Math.max(1, Math.floor(num(level, 1))))
  return Math.min(ECONOMY.maxSlots, ECONOMY.baseSlots[lv - 1] ?? ECONOMY.maxSlots)
}

/** How many slots may have been bought in total at this tank level. */
export function slotsBuyable(level: number): number {
  let n = 0
  for (const [from, total] of ECONOMY.slotsBuyableFrom) if (level >= from) n = total
  return Math.min(n, ECONOMY.slotPrices.length)
}

/**
 * min(maxSlots, base + bought), but never fewer than the fish already in the tank
 * (a save from before slots keeps every fish it had).
 */
export function slotCapacity(state: Pick<GameState, 'lifetimeProducedCoins' | 'slotsBought' | 'fish'>): number {
  const bought = Math.max(0, Math.floor(num(state.slotsBought, 0)))
  const cap = Math.min(ECONOMY.maxSlots, baseSlots(tankLevel(state)) + bought)
  return Math.max(cap, state.fish.length)
}

export type SlotOffer =
  | { reason: null; price: number }
  | { reason: 'slots-max' | 'slot-locked-level'; price: number | null; unlockLevel: number | null }

/** The next slot for sale and its price, or why none is. */
export function nextSlot(state: Pick<GameState, 'lifetimeProducedCoins' | 'slotsBought' | 'fish'>): SlotOffer {
  const level = tankLevel(state)
  const bought = Math.max(0, Math.floor(num(state.slotsBought, 0)))
  const price = ECONOMY.slotPrices[bought] ?? null
  if (baseSlots(level) + bought >= ECONOMY.maxSlots || price === null) return { reason: 'slots-max', price: null, unlockLevel: null }
  if (bought >= slotsBuyable(level)) {
    const from = ECONOMY.slotsBuyableFrom.find(([, total]) => total > bought)
    return { reason: 'slot-locked-level', price, unlockLevel: from ? from[0] : null }
  }
  return { reason: null, price }
}
