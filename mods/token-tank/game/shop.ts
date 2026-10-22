// The shop: buying fish, decorations and food.

import { newFish } from './fish'
import { DECOR, FOOD_PRICE, isDecorId, isSpeciesId, SPECIES, SPECIES_LIST } from './species'
import type { DecorId, Decoration, GameState, Outcome, SpeciesId } from './types'
import { bump, decorX, FLOOR_Y, refuse } from './util'

export const MAX_FISH = 10
export const MAX_DECOR = 8
/** Largest single food purchase. */
export const MAX_FOOD_BUY = 99

/** A species is for sale once the tank holds `unlockAt` fish, and forever once in the dex. */
export function isUnlocked(state: GameState, species: SpeciesId): boolean {
  if (state.dex.includes(species)) return true
  return state.fish.length >= SPECIES[species].unlockAt
}

export function shopList(state: GameState): { species: SpeciesId; isUnlocked: boolean; canAfford: boolean }[] {
  return SPECIES_LIST.map((sp) => ({
    species: sp.id,
    isUnlocked: isUnlocked(state, sp.id),
    canAfford: state.coins >= sp.price,
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
  if (!isUnlocked(state, species)) return refuse(state, 'locked')
  if (state.fish.length >= MAX_FISH) return refuse(state, 'tank-full')
  const price = SPECIES[species].price
  if (state.coins < price) return refuse(state, 'not-enough-coins')

  const born = newFish(species, now, idSeed, name)
  const fish = { ...born, id: uniqueId(born.id, new Set(state.fish.map((f) => f.id))) }
  const dex = state.dex.includes(species) ? state.dex : [...state.dex, species]
  const next = bump(state, { coins: state.coins - price, fish: [...state.fish, fish], dex }, now)
  return { state: next, events: [{ kind: 'bought', what: 'fish', id: fish.id, price }] }
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
