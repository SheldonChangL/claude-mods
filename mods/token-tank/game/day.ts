// The local calendar day, and rolling the `today*` counters over when it changes.

import type { GameState } from './types'

/** YYYY-MM-DD in the local time zone. */
export function dayKey(now: number): string {
  const d = new Date(now)
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Zero the `today*` counters when `now` falls on another day than `stats.todayKey`. */
export function rollDay(state: GameState, now: number): GameState {
  const key = dayKey(now)
  if (state.stats.todayKey === key) return state
  return {
    ...state,
    stats: {
      ...state.stats,
      todayKey: key,
      todayEffectiveTokens: 0,
      todayCoinsMinted: 0,
      todayCoinsCollected: 0,
      todayTurns: 0,
    },
  }
}
