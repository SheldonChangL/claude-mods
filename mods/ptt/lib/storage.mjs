// The favourite boards, kept in the plugin store (ctx.storage, key
// `favorites`): every session of this user on this machine shares them, and
// they outlive /clear and restarts. A board's name and when it was last
// looked at (seconds), nothing else.
//
//   { v: 1, boards: [{ name, lastSeen }] }   at most 30, in the person's order
//
// The store is not atomic: two sessions changing the list at the same moment
// can lose one change. Each change reads the list again right before writing.

import { FAVORITES_MAX } from './model.mjs'
import { normalizeFavorites } from './state.mjs'

export const STORAGE_KEY = 'favorites'

export async function readFavorites(ctx) {
  const raw = await ctx.storage.get(STORAGE_KEY)
  return normalizeFavorites(raw && typeof raw === 'object' && raw.v === 1 ? raw.boards : [])
}

/** Applies `change(list) -> list` to the stored list and writes it; returns the list written. */
export async function changeFavorites(ctx, change) {
  const current = await readFavorites(ctx)
  const next = normalizeFavorites(change(current)).slice(0, FAVORITES_MAX)
  await ctx.storage.set(STORAGE_KEY, { v: 1, boards: next })
  return next
}

export const hasBoard = (list, name) => list.some((favorite) => favorite.name.toLowerCase() === String(name).toLowerCase())

/** Moves `name` one place up (-1) or down (+1). */
export function moved(list, name, step) {
  const index = list.findIndex((favorite) => favorite.name === name)
  const target = index + step
  if (index < 0 || target < 0 || target >= list.length) return list
  const out = list.slice()
  ;[out[index], out[target]] = [out[target], out[index]]
  return out
}
