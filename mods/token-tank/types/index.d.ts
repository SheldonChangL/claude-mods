
export type SpeciesId =
  | 'guppy'
  | 'clownfish'
  | 'angelfish'
  | 'koi'
  | 'puffer'
  | 'tang'
  | 'goldfish'
  | 'seahorse'
  | 'neon'
  | 'betta'
  | 'butterflyfish'
  | 'lionfish'
  | 'arowana'
  | 'discus'
  | 'oscar'
  | 'danio'
  | 'moorishidol'
  | 'parrotfish'
  | 'mandarin'
  | 'swordtail'
  | 'mola'

export type SpeciesSize = 's' | 'm' | 'l'

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export type Species = {
  id: SpeciesId
  /** Display names: Traditional Chinese first, English second. */
  zh: string
  en: string
  price: number
  rarity: Rarity
  /** The rarity's base weight in the tank's share of energy (economy v0.3); equals ECONOMY.rarityWeight[rarity]. */
  rate: number
  size: SpeciesSize
  /** The tank level (from lifetime produced coins) the shop sells it at. */
  unlockLevel: number
  /** @deprecated Same value as `unlockLevel` (a tank level since economy v0.3, no longer a fish count). */
  unlockAt: number
  /** Swim speed, cells per second at the design size, before level and mood. */
  speed: number
}

export type FishState = 'idle' | 'swim' | 'spitCoin' | 'feeding' | 'happy' | 'hungry' | 'startled'

export type Fish = {
  id: string
  species: SpeciesId
  name: string
  level: number
  xp: number
  /** 0..100 */
  hunger: number
  /** 0..100 */
  mood: number
  /** Coin progress below one coin, carried to the next turn. */
  carry: number
  /** Coins spat and not yet collected (at most PENDING_CAP). */
  pending: number
  /** Raw coin production (before the daily soft cap) on `dailyKey`; the cap is spent from it. */
  dailyRaw: number
  /** YYYY-MM-DD in local time of the day `dailyRaw` counts. */
  dailyKey: string
  bornAt: number
  lastFedAt: number
  /** The last event's state, for the drawing; `since` is its start time. */
  state: FishState
  since: number
}

export type DecorId = 'seaweed' | 'coral' | 'rock' | 'chest' | 'ruin' | 'anchor' | 'shell' | 'shipwreck' | 'anemone' | 'clam' | 'statue' | 'wheel'

export type Decoration = {
  id: string
  kind: DecorId
  /** Design coordinates on the 320 × 180 base: `x` the centre, `y` the baseline the sprite stands on. */
  x: number
  y: number
}

export type Theme = 'ocean' | 'wreck' | 'reef' | 'abyss'
export type TankSize = 's' | 'm' | 'l'

export type Settings = {
  theme: Theme
  tankSize: TankSize
  showCoins: boolean
  showBubbles: boolean
  reduceMotion: boolean
  /** Draw the tank above the prompt (where clawd-run used to run). */
  showBand: boolean
  /** The words' language: follow Claude, or pinned. */
  language: 'auto' | 'zh' | 'en'
}

export type Stats = {
  /** YYYY-MM-DD in local time of the day `today*` counts. */
  todayKey: string
  todayEffectiveTokens: number
  todayCoinsMinted: number
  todayCoinsCollected: number
  todayTurns: number
  totalEffectiveTokens: number
  totalCoinsMinted: number
  totalCoinsCollected: number
  totalTurns: number
  testsPassed: number
  commits: number
  edits: number
  feeds: number
}

export type LogEntry = { at: number; text: string }

/** Food dropped into the tank by a click: where, when, and which fish rushed to it. */
export type Pellet = { id: string; x: number; y: number; at: number; eaters: string[] }

export type RewardKind = 'edit' | 'test' | 'commit'

export type GameState = {
  schemaVersion: 3
  /** Economy v0.3 marker: a save without it is migrated once (lifetime coins, slots, daily caps). */
  economyVersion: 3
  /** ECONOMY_CONFIG_VERSION of the tuning the save last ran under. */
  economyConfigVersion: number
  /** Coins the fish produced from energy, ever (never lowered by collecting or spending; rewards not included). Sets the tank level. */
  lifetimeProducedCoins: number
  /** Extra fish slots bought with coins, on top of the tank level's base slots. */
  slotsBought: number
  /** Bumped on every write; a session that reads a newer one than it last saw merges. */
  revision: number
  coins: number
  /** Portions of fish food in the pantry. */
  food: number
  fish: Fish[]
  decorations: Decoration[]
  /** Species the player has owned at least once. */
  dex: SpeciesId[]
  stats: Stats
  settings: Settings
  /** Turn ids already credited, newest last, at most 300. */
  processedTurns: string[]
  log: LogEntry[]
  /** The last few pellets dropped, newest last (the drawing shows the fresh ones). */
  pellets: Pellet[]
  /** When each reward kind last paid, for its cooldown. */
  lastRewardAt: Partial<Record<RewardKind, number>>
  createdAt: number
  updatedAt: number
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** What one change to the state produced, for the log and the drawing. */
export type GameEvent =
  | { kind: 'minted'; fishId: string; coins: number; effective: number }
  | { kind: 'collected'; fishId: string | null; coins: number }
  | { kind: 'fed'; fishId: string | null; count: number }
  | { kind: 'dropped'; x: number; y: number; eaters: string[] }
  | { kind: 'startled'; fishId: string }
  | { kind: 'bought'; what: 'fish' | 'decor' | 'food' | 'slot'; id: string; price: number }
  | { kind: 'moved'; id: string; x: number; y: number }
  | { kind: 'levelUp'; fishId: string; level: number }
  | { kind: 'renamed'; fishId: string; name: string }
  | { kind: 'reward'; reward: RewardKind; coins: number }
  | { kind: 'hungry'; fishId: string }
  | { kind: 'refused'; reason: string }

export type Outcome = { state: GameState; events: GameEvent[] }

export type View = 'shop' | 'fish' | 'decor' | 'settings'
export type ShopTab = 'fish' | 'decor' | 'food'

declare module 'claude-code' {
  interface PluginState {
    'token-tank': {
      /** The game as this session last read or wrote it; null until loaded. */
      game: GameState | null
      view: View
      shopTab: ShopTab
      selectedId: string | null
      isRenaming: boolean
      /** A one-line notice under the tank (a refused action, a purchase). */
      notice: string | null
      /** The running main-loop turn and whether it has run long enough to show the band. */
      turn: { turnId: string; isLong: boolean } | null
      /** `/fish` keeps the band shown between turns. */
      isPinned: boolean
      /** The language the words are drawn in this session. */
      lang: 'zh' | 'en'
      /** The fish whose release awaits a second press. */
      confirmRelease: string | null
      /** The decoration the next tap on the tank places. */
      movingDecor: string | null
    }
  }
}
