// Small pure helpers shared by the engine modules. No `$`, no Node, no Math.random.

import type { GameEvent, GameState, Outcome } from './types'

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** A finite number, or `fallback`. */
export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** FNV-1a over the string's UTF-16 units, as a non-negative 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Where the n-th decoration lands on the tank floor (design coords 320 × 180). */
export function decorX(count: number, idSeed: string): number {
  return ((count * 37 + hashSeed(idSeed)) % 264) + 16
}
export const FLOOR_Y = 150

/** A new revision of `state` with `patch` applied; `now` (when given) becomes updatedAt. */
export function bump(state: GameState, patch: Partial<GameState>, now?: number): GameState {
  return {
    ...state,
    ...patch,
    revision: state.revision + 1,
    updatedAt: now === undefined ? state.updatedAt : now,
  }
}

export function refuse(state: GameState, reason: string): Outcome {
  return { state, events: [{ kind: 'refused', reason }] }
}

export function ok(state: GameState, events: GameEvent[]): Outcome {
  return { state, events }
}
