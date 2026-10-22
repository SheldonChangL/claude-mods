// The game's data lives in the plugin's state contract (types/index.d.ts),
// which must be self-contained; the game modules import it from here.
export type {
  SpeciesId, SpeciesSize, Rarity, Species, FishState, Fish, DecorId, Decoration, Theme, TankSize,
  Settings, Stats, LogEntry, Pellet, RewardKind, GameState, Usage, GameEvent, Outcome,
} from '../types'
