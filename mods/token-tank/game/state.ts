// A new game, loading (migrate + sanitize) whatever `$.store` held, the log, and merging sessions.

import { dayKey, rollDay } from './day'
import { levelForXp, MAX_LEVEL, PENDING_CAP, PROCESSED_TURNS_KEEP } from './economy'
import { cleanName, newFish } from './fish'
import { MAX_DECOR, MAX_FISH } from './shop'
import { isDecorId, isSpeciesId, SPECIES } from './species'
import type {
  Decoration, Fish, FishState, GameState, LogEntry, RewardKind, Settings, SpeciesId, Stats, TankSize, Theme,
} from './types'
import { clamp, decorX, FLOOR_Y, num } from './util'

export { dayKey, rollDay }

export const LOG_KEEP = 50

const FISH_STATES: FishState[] = ['idle', 'swim', 'spitCoin', 'feeding', 'happy', 'hungry', 'startled']
const THEMES: Theme[] = ['ocean', 'wreck', 'reef', 'abyss']
const TANK_SIZES: TankSize[] = ['s', 'm', 'l']
const REWARD_KINDS: RewardKind[] = ['edit', 'test', 'commit']

const DEFAULT_SETTINGS: Settings = {
  theme: 'ocean', tankSize: 'm', showCoins: true, showBubbles: true, reduceMotion: false, showBand: true,
}

function emptyStats(now: number): Stats {
  return {
    todayKey: dayKey(now),
    todayEffectiveTokens: 0, todayCoinsMinted: 0, todayCoinsCollected: 0, todayTurns: 0,
    totalEffectiveTokens: 0, totalCoinsMinted: 0, totalCoinsCollected: 0, totalTurns: 0,
    testsPassed: 0, commits: 0, edits: 0, feeds: 0,
  }
}

export function newGame(now: number): GameState {
  return {
    schemaVersion: 3,
    revision: 1,
    coins: 150,
    food: 10,
    fish: [newFish('guppy', now, 'a'), newFish('clownfish', now, 'b')],
    decorations: [
      { id: 'seaweed-1', kind: 'seaweed', x: 40, y: FLOOR_Y },
      { id: 'rock-1', kind: 'rock', x: 150, y: FLOOR_Y },
      { id: 'seaweed-2', kind: 'seaweed', x: 260, y: FLOOR_Y },
    ],
    dex: ['guppy', 'clownfish'],
    stats: emptyStats(now),
    settings: { ...DEFAULT_SETTINGS },
    processedTurns: [],
    log: [],
    pellets: [],
    lastRewardAt: {},
    createdAt: now,
    updatedAt: now,
  }
}

// ---------- sanitize ----------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const nonNeg = (v: unknown, d: number) => Math.max(0, num(v, d))
const count = (v: unknown, d: number) => Math.floor(nonNeg(v, d))
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  list.includes(v as T) ? (v as T) : d
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

function sanitizeFish(raw: unknown, i: number, now: number, taken: Set<string>): Fish | null {
  if (!isObj(raw)) return null
  const species: SpeciesId = isSpeciesId(raw.species) ? raw.species : 'guppy'
  let id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `${species}-m${i}`
  while (taken.has(id)) id = `${id}-x`
  taken.add(id)
  const xp = nonNeg(raw.xp, 0)
  const carry = nonNeg(raw.carry, 0)
  return {
    id,
    species,
    name: cleanName(raw.name) ?? SPECIES[species].zh,
    level: clamp(Math.floor(num(raw.level, levelForXp(xp))), 1, MAX_LEVEL),
    xp,
    hunger: clamp(num(raw.hunger, 80), 0, 100),
    mood: clamp(num(raw.mood, 70), 0, 100),
    carry: carry - Math.floor(carry),
    pending: clamp(Math.floor(num(raw.pending, 0)), 0, PENDING_CAP),
    bornAt: num(raw.bornAt, now),
    lastFedAt: num(raw.lastFedAt, now),
    state: oneOf(raw.state, FISH_STATES, 'swim'),
    since: num(raw.since, now),
  }
}

function sanitizeDecor(raw: unknown, i: number, taken: Set<string>): Decoration | null {
  if (!isObj(raw) || !isDecorId(raw.kind)) return null
  let id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `${raw.kind}-m${i}`
  while (taken.has(id)) id = `${id}-x`
  taken.add(id)
  return {
    id,
    kind: raw.kind,
    x: clamp(num(raw.x, decorX(i, id)), 0, 320),
    y: clamp(num(raw.y, FLOOR_Y), 0, 180),
  }
}

/** Any object → a valid GameState: bad numbers fall back to defaults, ranges are clamped, lists capped. */
export function sanitize(raw: Obj, now: number): GameState {
  const fishIds = new Set<string>()
  const fish = arr(raw.fish)
    .map((f, i) => sanitizeFish(f, i, now, fishIds))
    .filter((f): f is Fish => f !== null)
    .slice(0, MAX_FISH)

  const decorIds = new Set<string>()
  const decorations = arr(raw.decorations)
    .map((d, i) => sanitizeDecor(d, i, decorIds))
    .filter((d): d is Decoration => d !== null)
    .slice(0, MAX_DECOR)

  const dex: SpeciesId[] = []
  for (const s of [...arr(raw.dex), ...fish.map((f) => f.species)]) {
    if (isSpeciesId(s) && !dex.includes(s)) dex.push(s)
  }

  const rs = isObj(raw.stats) ? raw.stats : {}
  const base = emptyStats(now)
  const stats: Stats = {
    todayKey: typeof rs.todayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rs.todayKey) ? rs.todayKey : base.todayKey,
    todayEffectiveTokens: nonNeg(rs.todayEffectiveTokens, 0),
    todayCoinsMinted: count(rs.todayCoinsMinted, 0),
    todayCoinsCollected: count(rs.todayCoinsCollected, 0),
    todayTurns: count(rs.todayTurns, 0),
    totalEffectiveTokens: nonNeg(rs.totalEffectiveTokens, 0),
    totalCoinsMinted: count(rs.totalCoinsMinted, 0),
    totalCoinsCollected: count(rs.totalCoinsCollected, 0),
    totalTurns: count(rs.totalTurns, 0),
    testsPassed: count(rs.testsPassed, 0),
    commits: count(rs.commits, 0),
    edits: count(rs.edits, 0),
    feeds: count(rs.feeds, 0),
  }

  const st = isObj(raw.settings) ? raw.settings : {}
  const settings: Settings = {
    theme: oneOf(st.theme, THEMES, DEFAULT_SETTINGS.theme),
    tankSize: oneOf(st.tankSize, TANK_SIZES, DEFAULT_SETTINGS.tankSize),
    showCoins: bool(st.showCoins, DEFAULT_SETTINGS.showCoins),
    showBubbles: bool(st.showBubbles, DEFAULT_SETTINGS.showBubbles),
    reduceMotion: bool(st.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    showBand: bool(st.showBand, DEFAULT_SETTINGS.showBand),
  }

  const processedTurns = arr(raw.processedTurns)
    .filter((t): t is string => typeof t === 'string')
    .slice(-PROCESSED_TURNS_KEEP)

  const log: LogEntry[] = arr(raw.log)
    .filter((e): e is Obj => isObj(e) && typeof e.text === 'string')
    .map((e) => ({ at: num(e.at, now), text: e.text as string }))
    .slice(-LOG_KEEP)

  const lr = isObj(raw.lastRewardAt) ? raw.lastRewardAt : {}
  const lastRewardAt: GameState['lastRewardAt'] = {}
  for (const k of REWARD_KINDS) {
    const v = lr[k]
    if (typeof v === 'number' && Number.isFinite(v)) lastRewardAt[k] = v
  }

  return {
    schemaVersion: 3,
    revision: Math.max(1, Math.floor(num(raw.revision, 1))),
    coins: count(raw.coins, 0),
    food: count(raw.food, 0),
    fish,
    decorations,
    dex,
    stats,
    settings,
    processedTurns,
    log,
    pellets: arr(raw.pellets).filter(isObj).map((p, i) => ({ id: typeof p.id === 'string' ? p.id : `pellet-${i}`, x: num(p.x, 160), y: num(p.y, 60), at: num(p.at, 0), eaters: arr(p.eaters).filter((e): e is string => typeof e === 'string') })).slice(-6),
    lastRewardAt,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  }
}

// ---------- migrate ----------

export type Migrated = { state: GameState; migratedFrom: number | null; isReset: boolean }

/** v2: `{version:2, coins, fish:[{id,species,name,xp,hunger,carry,pending}], decorations:[string], totalEffectiveTokens}`. */
function fromV2(raw: Obj, now: number): GameState {
  const fish = arr(raw.fish).filter(isObj).map((f) => {
    const xp = nonNeg(f.xp, 0)
    // Unknown species become guppies; the name and xp stay.
    return { ...f, species: isSpeciesId(f.species) ? f.species : 'guppy', xp, level: levelForXp(xp), mood: 70 }
  })
  const decorations = arr(raw.decorations)
    .filter(isDecorId)
    .map((kind, i) => ({ id: `${kind}-v2-${i}`, kind, x: decorX(i, `${kind}-v2-${i}`), y: FLOOR_Y }))
  const fresh = newGame(now)
  return sanitize(
    {
      revision: 1,
      coins: raw.coins,
      food: fresh.food,
      fish,
      decorations,
      stats: { totalEffectiveTokens: raw.totalEffectiveTokens },
      createdAt: now,
      updatedAt: now,
    },
    now,
  )
}

export function migrate(raw: unknown, now: number): Migrated {
  if (raw === undefined || raw === null) return { state: newGame(now), migratedFrom: null, isReset: false }
  if (isObj(raw) && raw.schemaVersion === 3) {
    return { state: rollDay(sanitize(raw, now), now), migratedFrom: null, isReset: false }
  }
  if (isObj(raw) && raw.version === 2) return { state: fromV2(raw, now), migratedFrom: 2, isReset: false }
  return { state: newGame(now), migratedFrom: null, isReset: true }
}

// ---------- log ----------

export function appendLog(state: GameState, text: string, now: number): GameState {
  return { ...state, log: [...state.log, { at: now, text }].slice(-LOG_KEEP) }
}

// ---------- merge ----------

/**
 * Merge two sessions' copies. The higher revision is the base (ties: `mine`); processedTurns are
 * unioned; coins take the max; fish merge by id (fields from the side updated later, pending the max).
 *
 * Limitations — this is a heuristic, not a CRDT:
 * - coins = max: a spend on one side and an earn on the other loses one of them.
 * - pending = max: a collect on one side plus a mint on the other can pay the same coins twice.
 * - fish only on one side are kept (there is no "remove fish" op), capped at MAX_FISH.
 * - food, decorations, stats, settings, lastRewardAt come from the base alone.
 */
export function mergeStates(mine: GameState, theirs: GameState): GameState {
  const [base, other] = theirs.revision > mine.revision ? [theirs, mine] : [mine, theirs]
  const otherNewer = other.updatedAt > base.updatedAt

  const seen = new Set(base.processedTurns)
  const processedTurns = [...base.processedTurns, ...other.processedTurns.filter((t) => !seen.has(t))]
    .slice(-PROCESSED_TURNS_KEEP)

  const otherById = new Map(other.fish.map((f) => [f.id, f]))
  const baseIds = new Set(base.fish.map((f) => f.id))
  const fish = [
    ...base.fish.map((b) => {
      const o = otherById.get(b.id)
      if (!o) return b
      const winner = otherNewer ? o : b
      return { ...winner, pending: Math.max(b.pending, o.pending) }
    }),
    ...other.fish.filter((f) => !baseIds.has(f.id)),
  ].slice(0, MAX_FISH)

  const dex = [...base.dex, ...other.dex.filter((s) => !base.dex.includes(s))]

  return {
    ...base,
    revision: Math.max(mine.revision, theirs.revision) + 1,
    coins: Math.max(mine.coins, theirs.coins),
    fish,
    dex,
    processedTurns,
    updatedAt: Math.max(mine.updatedAt, theirs.updatedAt),
  }
}
