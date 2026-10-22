// The catalogue: fish species, decorations and food prices. Pure data.

import type { DecorId, Species, SpeciesId } from './types'

export const SPECIES: Record<SpeciesId, Species> = {
  guppy: { id: 'guppy', zh: '孔雀魚', en: 'Guppy', price: 80, rate: 1.0, size: 's', unlockAt: 0, speed: 3.2 },
  clownfish: { id: 'clownfish', zh: '小丑魚', en: 'Clownfish', price: 120, rate: 1.15, size: 's', unlockAt: 0, speed: 2.8 },
  tang: { id: 'tang', zh: '藍倒吊', en: 'Blue Tang', price: 200, rate: 1.4, size: 's', unlockAt: 2, speed: 3.0 },
  puffer: { id: 'puffer', zh: '河豚', en: 'Puffer', price: 300, rate: 1.6, size: 's', unlockAt: 2, speed: 1.6 },
  angelfish: { id: 'angelfish', zh: '神仙魚', en: 'Angelfish', price: 400, rate: 1.9, size: 'm', unlockAt: 3, speed: 2.2 },
  koi: { id: 'koi', zh: '錦鯉', en: 'Koi', price: 600, rate: 2.3, size: 'm', unlockAt: 4, speed: 1.9 },
  goldfish: { id: 'goldfish', zh: '金魚', en: 'Goldfish', price: 800, rate: 2.7, size: 's', unlockAt: 5, speed: 2.0 },
  seahorse: { id: 'seahorse', zh: '海馬', en: 'Seahorse', price: 1200, rate: 3.2, size: 'm', unlockAt: 6, speed: 1.2 },
  neon: { id: 'neon', zh: '霓虹燈魚', en: 'Neon Tetra', price: 100, rate: 1.1, size: 's', unlockAt: 1, speed: 3.6 },
  betta: { id: 'betta', zh: '鬥魚', en: 'Betta', price: 250, rate: 1.5, size: 'm', unlockAt: 2, speed: 2.0 },
  butterflyfish: { id: 'butterflyfish', zh: '蝴蝶魚', en: 'Butterflyfish', price: 500, rate: 2.1, size: 's', unlockAt: 4, speed: 2.6 },
  lionfish: { id: 'lionfish', zh: '獅子魚', en: 'Lionfish', price: 900, rate: 2.9, size: 'm', unlockAt: 5, speed: 1.4 },
  arowana: { id: 'arowana', zh: '龍魚', en: 'Arowana', price: 1500, rate: 3.6, size: 'l', unlockAt: 7, speed: 2.4 },
}

/** In shop order: cheapest first. */
export const SPECIES_LIST: Species[] = Object.values(SPECIES).sort((a, b) => a.price - b.price)

export const DECOR: Record<DecorId, { zh: string; en: string; price: number }> = {
  seaweed: { zh: '海草', en: 'Seaweed', price: 30 },
  shell: { zh: '貝殼', en: 'Shell', price: 40 },
  rock: { zh: '岩石', en: 'Rock', price: 60 },
  coral: { zh: '珊瑚', en: 'Coral', price: 90 },
  anchor: { zh: '船錨', en: 'Anchor', price: 150 },
  chest: { zh: '寶箱', en: 'Treasure Chest', price: 250 },
  ruin: { zh: '遺跡', en: 'Ruin', price: 400 },
}

/** Price of one portion of food. */
export const FOOD_PRICE = 5

export function isSpeciesId(v: unknown): v is SpeciesId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIES, v)
}

export function isDecorId(v: unknown): v is DecorId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DECOR, v)
}
