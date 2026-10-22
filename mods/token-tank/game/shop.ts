// The shop: buying fish, fish slots, decorations and food.

import { ECONOMY } from './economy.config'
import { newFish } from './fish'
import { nextSlot, slotCapacity, tankLevel } from './progression'
import { DECOR, FOOD_PRICE, isDecorId, isSpeciesId, SPECIES, SPECIES_LIST } from './species'
import type { DecorId, Decoration, GameState, Outcome, Rarity, SpeciesId } from './types'
import { bump, decorX, FLOOR_Y, refuse } from './util'

/** The most fish any tank holds (ECONOMY.maxSlots); the current limit is slotCapacity(state). */
export const MAX_FISH = ECONOMY.maxSlots
export const MAX_DECOR = 8
/** Largest single food purchase. */
export const MAX_FOOD_BUY = 99

/** A species is for sale from its unlock tank level (owning one before, e.g. from an old save, does not unlock it). */
export function isUnlocked(state: GameState, species: SpeciesId): boolean {
  return tankLevel(state) >= SPECIES[species].unlockLevel
}

export type BuyFishBlock = 'locked-level' | 'tank-full' | 'not-enough-coins'

/** Why buying this species would be refused right now, or null when it would go through. */
export function fishBlock(state: GameState, species: SpeciesId): BuyFishBlock | null {
  const sp = SPECIES[species]
  if (!isUnlocked(state, species)) return 'locked-level'
  if (state.fish.length >= slotCapacity(state)) return 'tank-full'
  if (!(sp.price > 0) || state.coins < sp.price) return 'not-enough-coins'
  return null
}

export type ShopEntry = {
  species: SpeciesId
  rarity: Rarity
  price: number
  unlockLevel: number
  isUnlocked: boolean
  canAfford: boolean
  /** The first reason a purchase would be refused, or null when it can be bought now. */
  reason: BuyFishBlock | null
}

/** Every species in shop order (cheapest first) with what buyFish would decide. */
export function shopList(state: GameState): ShopEntry[] {
  return SPECIES_LIST.map((sp) => ({
    species: sp.id,
    rarity: sp.rarity,
    price: sp.price,
    unlockLevel: sp.unlockLevel,
    isUnlocked: isUnlocked(state, sp.id),
    canAfford: state.coins >= sp.price,
    reason: fishBlock(state, sp.id),
  }))
}

/** `base`, or `base-2`, `base-3`… whichever no existing id uses. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function buyFish(state: GameState, species: SpeciesId, now: number, idSeed: string, name?: string): Outcome {
  if (!isSpeciesId(species)) return refuse(state, 'unknown-species')
  const fish = newFish(species, now, idSeed, name)
  // The same press delivered twice (same species and seed) buys once.
  if (state.fish.some((f) => f.id === fish.id)) return refuse(state, 'duplicate-purchase')
  const block = fishBlock(state, species)
  if (block !== null) return refuse(state, block)
  const price = SPECIES[species].price
  const dex = state.dex.includes(species) ? state.dex : [...state.dex, species]
  const next = bump(state, { coins: state.coins - price, fish: [...state.fish, fish], dex }, now)
  return { state: next, events: [{ kind: 'bought', what: 'fish', id: fish.id, price }] }
}

/** Buy one more fish slot: refused at the slot maximum, before the tank level allows another, or short of coins. */
export function buySlot(state: GameState, now: number): Outcome {
  const offer = nextSlot(state)
  if (offer.reason !== null) return refuse(state, offer.reason)
  if (state.coins < offer.price) return refuse(state, 'not-enough-coins')
  const slotsBought = state.slotsBought + 1
  const next = bump(state, { coins: state.coins - offer.price, slotsBought }, now)
  return { state: next, events: [{ kind: 'bought', what: 'slot', id: `slot-${slotsBought}`, price: offer.price }] }
}

export function buyDecoration(state: GameState, kind: DecorId, now: number, idSeed: string): Outcome {
  if (!isDecorId(kind)) return refuse(state, 'unknown-decor')
  if (state.decorations.length >= MAX_DECOR) return refuse(state, 'decor-full')
  const price = DECOR[kind].price
  if (state.coins < price) return refuse(state, 'not-enough-coins')

  const decor: Decoration = {
    id: uniqueId(`${kind}-${idSeed}`, new Set(state.decorations.map((d) => d.id))),
    kind,
    x: decorX(state.decorations.length, idSeed),
    y: FLOOR_Y,
  }
  const next = bump(state, { coins: state.coins - price, decorations: [...state.decorations, decor] }, now)
  return { state: next, events: [{ kind: 'bought', what: 'decor', id: decor.id, price }] }
}

export function buyFood(state: GameState, count: number): Outcome {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FOOD_BUY) return refuse(state, 'bad-count')
  const price = count * FOOD_PRICE
  if (state.coins < price) return refuse(state, 'not-enough-coins')
  const next = bump(state, { coins: state.coins - price, food: state.food + count })
  return { state: next, events: [{ kind: 'bought', what: 'food', id: 'food', price }] }
}
