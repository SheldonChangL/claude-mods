// Economy v0.3 tuning: every number the balance depends on, in one place.
// The shop, the purchase checks, the engine and scripts/simulate-economy.ts all
// read this object; change a value here and re-run the simulator.

import type { Rarity, SpeciesId } from './types'

/** Bump when a value below changes; saves record the version they last ran under. */
export const ECONOMY_CONFIG_VERSION = 1

export type SpeciesEconomy = { rarity: Rarity; price: number; unlockLevel: number }

export const ECONOMY = {
  /** effectiveTokens = Σ field × weight (turn.complete usage; the fields do not overlap). */
  tokenWeights: { input: 1, output: 2, cacheRead: 0.02, cacheWrite: 1.25 },
  /** energy = (min(eff, knee) + max(eff − knee, 0) × overKnee) / tokensPerEnergy */
  energy: { knee: 15_000, overKnee: 0.1, tokensPerEnergy: 2_500 },

  /** Base share weight of one fish; production_i = energy × w_i / √Σw. */
  rarityWeight: { common: 1, rare: 3, epic: 10, legendary: 32 } as Record<Rarity, number>,
  /** Raw coins a fish produces per local day at the full rate; past it, overQuotaFactor applies. */
  dailyQuota: { common: 120, rare: 360, epic: 960, legendary: 1_920 } as Record<Rarity, number>,
  overQuotaFactor: 0.2,
  /** Fish levels (xp-gated, bought with coins): production ×(1 + boostPerLevel·(lv − 1)); cost costPerLevel × lv × rarity weight. */
  fishLevel: { boostPerLevel: 0.05, costPerLevel: 50 },
  /** Allowed price band per rarity (checked by the tests). */
  priceBand: { common: [80, 300], rare: [500, 1_500], epic: [2_000, 5_000], legendary: [8_000, 15_000] } as Record<Rarity, readonly [number, number]>,

  species: {
    guppy: { rarity: 'common', price: 80, unlockLevel: 1 },
    neon: { rarity: 'common', price: 100, unlockLevel: 1 },
    clownfish: { rarity: 'common', price: 120, unlockLevel: 1 },
    danio: { rarity: 'common', price: 150, unlockLevel: 2 },
    swordtail: { rarity: 'common', price: 180, unlockLevel: 2 },
    goldfish: { rarity: 'common', price: 220, unlockLevel: 3 },
    betta: { rarity: 'common', price: 280, unlockLevel: 4 },
    tang: { rarity: 'rare', price: 500, unlockLevel: 5 },
    puffer: { rarity: 'rare', price: 550, unlockLevel: 5 },
    butterflyfish: { rarity: 'rare', price: 650, unlockLevel: 6 },
    angelfish: { rarity: 'rare', price: 750, unlockLevel: 7 },
    koi: { rarity: 'rare', price: 900, unlockLevel: 8 },
    seahorse: { rarity: 'rare', price: 1_050, unlockLevel: 8 },
    oscar: { rarity: 'rare', price: 1_200, unlockLevel: 9 },
    discus: { rarity: 'epic', price: 2_000, unlockLevel: 10 },
    mandarin: { rarity: 'epic', price: 2_400, unlockLevel: 11 },
    lionfish: { rarity: 'epic', price: 2_900, unlockLevel: 12 },
    moorishidol: { rarity: 'epic', price: 3_500, unlockLevel: 14 },
    parrotfish: { rarity: 'epic', price: 4_200, unlockLevel: 15 },
    arowana: { rarity: 'legendary', price: 8_000, unlockLevel: 18 },
    mola: { rarity: 'legendary', price: 12_000, unlockLevel: 18 },
  } as Record<SpeciesId, SpeciesEconomy>,

  /**
   * Lifetime produced coins to reach tank level n is tankLevels[n − 1].
   * Anchors: Lv.1 0, Lv.5 640, Lv.10 3,200, Lv.18 11,500; the rest interpolated, strictly increasing.
   */
  tankLevels: [0, 100, 250, 430, 640, 950, 1_350, 1_850, 2_450, 3_200, 4_000, 4_900, 5_900, 7_000, 8_150, 9_350, 10_400, 11_500] as readonly number[],
  /** Base fish slots at tank level n is baseSlots[n − 1] (Lv.1 3, Lv.5 5, Lv.10 7, Lv.18 10). */
  baseSlots: [3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10] as readonly number[],
  maxSlots: 10,
  /** Price of the n-th bought slot is slotPrices[n − 1]. */
  slotPrices: [300, 1_200, 3_000] as readonly number[],
  /** How many slots may be bought by tank level: [fromLevel, total buyable] pairs, ascending. */
  slotsBuyableFrom: [[1, 1], [5, 2], [10, 3]] as readonly (readonly [number, number])[],
} as const
