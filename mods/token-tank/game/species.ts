// The catalogue: fish species, decorations and food prices. Pure data.

import { ECONOMY } from './economy.config'
import type { DecorId, Species, SpeciesId } from './types'

/** What a species looks like; its rarity, price and unlock level come from ECONOMY.species. */
const LOOKS: Record<SpeciesId, Pick<Species, 'zh' | 'en' | 'size' | 'speed'>> = {
  guppy: { zh: '孔雀魚', en: 'Guppy', size: 's', speed: 3.2 },
  clownfish: { zh: '小丑魚', en: 'Clownfish', size: 's', speed: 2.8 },
  tang: { zh: '藍倒吊', en: 'Blue Tang', size: 's', speed: 3.0 },
  puffer: { zh: '河豚', en: 'Puffer', size: 's', speed: 1.6 },
  angelfish: { zh: '神仙魚', en: 'Angelfish', size: 'm', speed: 2.2 },
  koi: { zh: '錦鯉', en: 'Koi', size: 'm', speed: 1.9 },
  goldfish: { zh: '金魚', en: 'Goldfish', size: 's', speed: 2.0 },
  seahorse: { zh: '海馬', en: 'Seahorse', size: 'm', speed: 1.2 },
  neon: { zh: '霓虹燈魚', en: 'Neon Tetra', size: 's', speed: 3.6 },
  betta: { zh: '鬥魚', en: 'Betta', size: 'm', speed: 2.0 },
  butterflyfish: { zh: '蝴蝶魚', en: 'Butterflyfish', size: 's', speed: 2.6 },
  lionfish: { zh: '獅子魚', en: 'Lionfish', size: 'm', speed: 1.4 },
  arowana: { zh: '龍魚', en: 'Arowana', size: 'l', speed: 2.4 },
  danio: { zh: '斑馬魚', en: 'Zebra Danio', size: 's', speed: 3.8 },
  swordtail: { zh: '劍尾魚', en: 'Swordtail', size: 's', speed: 3.1 },
  discus: { zh: '七彩神仙魚', en: 'Discus', size: 'm', speed: 1.8 },
  mandarin: { zh: '麒麟魚', en: 'Mandarinfish', size: 's', speed: 1.5 },
  oscar: { zh: '地圖魚', en: 'Oscar', size: 'm', speed: 2.1 },
  moorishidol: { zh: '鐮魚', en: 'Moorish Idol', size: 'm', speed: 2.3 },
  parrotfish: { zh: '鸚哥魚', en: 'Parrotfish', size: 'm', speed: 2.0 },
  mola: { zh: '曼波魚', en: 'Ocean Sunfish', size: 'l', speed: 1.0 },
}

function speciesOf(id: SpeciesId): Species {
  const eco = ECONOMY.species[id]
  return {
    id,
    ...LOOKS[id],
    price: eco.price,
    rarity: eco.rarity,
    rate: ECONOMY.rarityWeight[eco.rarity],
    unlockLevel: eco.unlockLevel,
    unlockAt: eco.unlockLevel,
  }
}

export const SPECIES: Record<SpeciesId, Species> = Object.fromEntries(
  (Object.keys(LOOKS) as SpeciesId[]).map((id) => [id, speciesOf(id)]),
) as Record<SpeciesId, Species>

/** In shop order: cheapest first (ties: lower unlock level first). */
export const SPECIES_LIST: Species[] = Object.values(SPECIES).sort((a, b) => a.price - b.price || a.unlockLevel - b.unlockLevel)

export const DECOR: Record<DecorId, { zh: string; en: string; price: number }> = {
  seaweed: { zh: '海草', en: 'Seaweed', price: 30 },
  shell: { zh: '貝殼', en: 'Shell', price: 40 },
  rock: { zh: '岩石', en: 'Rock', price: 60 },
  coral: { zh: '珊瑚', en: 'Coral', price: 90 },
  anchor: { zh: '船錨', en: 'Anchor', price: 150 },
  chest: { zh: '寶箱', en: 'Treasure Chest', price: 250 },
  ruin: { zh: '遺跡', en: 'Ruin', price: 400 },
  anemone: { zh: '海葵', en: 'Anemone', price: 120 },
  clam: { zh: '珍珠貝', en: 'Giant Clam', price: 180 },
  wheel: { zh: '船舵', en: "Ship's Wheel", price: 220 },
  statue: { zh: '石像', en: 'Stone Statue', price: 350 },
  shipwreck: { zh: '沉船', en: 'Shipwreck', price: 600 },
}

/** Price of one portion of food. */
export const FOOD_PRICE = 5

export function isSpeciesId(v: unknown): v is SpeciesId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIES, v)
}

export function isDecorId(v: unknown): v is DecorId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DECOR, v)
}
