// Draws the tank as one SVG document (320 × 180 design pixels). On Desktop the
// Svg element shows it in a sandboxed frame where SMIL runs, so the fish swim,
// the coins spin and the bubbles rise without the plugin redrawing anything.
// The document is rebuilt only when the game state changes.

import type { Decoration, Fish, GameState, Theme } from '../game/types'
import { SPECIES } from '../game/species'
import { SPRITES } from './sprites'
import type { Sprite, SpriteFrame } from './sprites'

/** The design width the game's coordinates (decorations) are stored in. */
export const BASE_W = 320
export const TANK_H = 180
const FLOOR_Y = 150
/** How much larger than their pixels the fish are drawn, per tank height. */
export const FISH_SCALES = { s: 1.3, m: 1.6, l: 1.9 } as const
let FISH_SCALE = 1.6
/** The width of the tank being drawn, in design pixels: set by `tankSvg` from the room it has. */
let W = BASE_W

const THEMES: Record<Theme, { top: string; bottom: string; sand: string; sandDark: string; ray: string }> = {
  ocean: { top: '#0b2a4a', bottom: '#14456e', sand: '#d9b979', sandDark: '#b8964f', ray: '#8fd3ff' },
  wreck: { top: '#061a2b', bottom: '#0e3550', sand: '#8d7b5e', sandDark: '#5f5240', ray: '#6fb0d8' },
  reef: { top: '#0a3e5c', bottom: '#1c7a8e', sand: '#f0d9a0', sandDark: '#cbb06a', ray: '#b8f0ff' },
  abyss: { top: '#03070f', bottom: '#0a1a33', sand: '#3a3f55', sandDark: '#25293a', ray: '#5a7fcf' },
}

/** A deterministic 0..1 from a string and a lane, so a redraw keeps each fish's path. */
export function hash01(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

function framePaths(frame: SpriteFrame): string {
  return frame.map(p => `<path fill="${p.fill}" d="${p.d}"/>`).join('')
}

/** One <symbol> per frame of one animation, ids `${name}-${anim}-${i}`. */
function symbols(name: string, anim: string): string {
  const sprite = SPRITES[name]
  if (!sprite) return ''
  const frames = sprite.frames[anim] ?? sprite.frames[Object.keys(sprite.frames)[0] ?? '']
  if (!frames) return ''
  return frames
    .map((f, i) => `<symbol id="${name}-${anim}-${i}" viewBox="0 0 ${sprite.w} ${sprite.h}" width="${sprite.w}" height="${sprite.h}">${framePaths(f)}</symbol>`)
    .join('')
}

/** A <use> whose href cycles over the animation's frames. */
function animatedUse(name: string, anim: string, dur: number, x: number, y: number, isMotion: boolean, extra = ''): string {
  const sprite = SPRITES[name]
  if (!sprite) return ''
  const n = (sprite.frames[anim] ?? sprite.frames[Object.keys(sprite.frames)[0] ?? ''])?.length ?? 0
  if (n === 0) return ''
  const first = `#${name}-${anim}-0`
  if (!isMotion || n === 1) return `<use href="${first}" x="${x}" y="${y}"/>`
  const values = Array.from({ length: n }, (_, i) => `#${name}-${anim}-${i}`).join(';')
  return `<use href="${first}" x="${x}" y="${y}"><animate attributeName="href" values="${values}" dur="${dur}s" ${extra} calcMode="discrete" repeatCount="indefinite"/></use>`
}

export type TankOptions = {
  isMotion: boolean
  showCoins: boolean
  showBubbles: boolean
  selectedId: string | null
  /** Milliseconds now, for one-shot effects (a fish that just spat). */
  now: number
  /** The tank's width in design pixels (height is always TANK_H); the element fills its slot. */
  width?: number
  /** The fish's size over their pixels (FISH_SCALES); the hit test must use the same. */
  fishScale?: number
}

/** Where a fish swims: its lane and the span it patrols, in design pixels. */
export type FishLayout = {
  /** The lane's centre line. */
  y: number
  x1: number
  x2: number
  /** One full trip there and back, seconds. */
  dur: number
  /** Where in the trip it starts, seconds (negative SMIL begin), for the drawing made at `now`. */
  begin: number
  /** The trip's own offset into wall-clock time, seconds: the phase is a function of the clock alone. */
  offset: number
  /** The drawn size (sprite × FISH_SCALE). */
  w: number
  h: number
  isHungry: boolean
}

export function fishLayout(fish: Fish, index: number, count: number, width = W, now = 0, scale = FISH_SCALE): FishLayout {
  const sp = SPECIES[fish.species]
  const sprite = SPRITES[fish.species]
  const w = (sprite?.w ?? 32) * scale
  const h = (sprite?.h ?? 24) * scale
  const laneTop = 18
  const laneBottom = FLOOR_Y - h - 6
  const y = laneTop + ((index + 0.5) / Math.max(count, 1)) * (laneBottom - laneTop) + (hash01(fish.id, 1) - 0.5) * 10
  const span = Math.min(width - 24 - w, (90 + hash01(fish.id, 2) * 130) * Math.max(1, width / BASE_W))
  const x1 = 8 + hash01(fish.id, 3) * Math.max(0, width - 16 - span - w)
  const x2 = x1 + span
  const isHungry = fish.state === 'hungry' || fish.hunger < 25
  const speed = sp.speed * (isHungry ? 0.55 : 1) * (0.9 + fish.mood / 500)
  const dur = Math.max(4, span / (speed * 8))
  // The phase is set by the clock, so a drawing made at any moment continues
  // the previous one's motion instead of starting the trip over.
  const offset = hash01(fish.id, 6) * dur
  const begin = -(((now / 1000 + offset) % dur + dur) % dur)
  return { y, x1, x2, dur, begin, offset, w, h, isHungry }
}

/** The fish's centre at wall-clock `nowMs`, on any drawing (the phase follows the clock). */
export function fishCentreAt(l: FishLayout, nowMs: number): { x: number; y: number } {
  const t = nowMs / 1000 + l.offset
  const phase = ((t % l.dur) + l.dur) % l.dur / l.dur
  const x = phase < 0.5 ? l.x1 + (l.x2 - l.x1) * phase * 2 : l.x2 - (l.x2 - l.x1) * (phase - 0.5) * 2
  // The sprite is centred on the moving point: half its width ahead of x1/x2.
  return { x: x + l.w / 2, y: l.y }
}

/** The fish in lane order, small species on top and large ones near the sand. */
export function laneOrder(fish: readonly Fish[]): Fish[] {
  const rank = { s: 0, m: 1, l: 2 } as const
  return [...fish].sort((a, b) => rank[SPECIES[a.species].size] - rank[SPECIES[b.species].size] || a.id.localeCompare(b.id))
}

/** The pellets still worth drawing: dropped in the last six seconds. */
export const PELLET_SHOW_MS = 4500

function fishMarkup(fish: Fish, index: number, count: number, o: TankOptions, state: GameState): string {
  const sprite: Sprite | undefined = SPRITES[fish.species]
  if (!sprite) return ''
  const l = fishLayout(fish, index, count, W, o.now)
  const { w, h, x1, x2, dur, isHungry } = l
  const y = l.y
  const bob = 2 + hash01(fish.id, 4) * 3
  const bobDur = 1.6 + hash01(fish.id, 5) * 1.2
  const bobBegin = (-((o.now / 1000) % bobDur)).toFixed(2)
  const frameDur = isHungry ? 0.9 : 0.45
  const justSpat = fish.state === 'spitCoin' && o.now - fish.since < 15000
  const anim = justSpat && sprite.frames.spit ? 'spit' : 'swim'
  const isSelected = o.selectedId === fish.id
  const begin = l.begin.toFixed(2)
  const body = `<g transform="scale(${FISH_SCALE})">${animatedUse(fish.species, anim, frameDur, -sprite.w / 2, -sprite.h / 2, o.isMotion)}</g>`
  const ring = isSelected ? `<rect x="${-w / 2 - 2}" y="${-h / 2 - 2}" width="${w + 4}" height="${h + 4}" fill="none" stroke="#ffe066" stroke-width="1" stroke-dasharray="2 2" rx="2"/>` : ''
  const hungryMark = isHungry ? `<text x="${w / 2 - 2}" y="${-h / 2 - 2}" font-family="monospace" font-size="9" fill="#ffd166" font-weight="bold">!</text>` : ''
  // A fish with coins waiting glows softly gold.
  const glow = fish.pending > 0 ? `<ellipse cx="0" cy="0" rx="${(w * 0.7).toFixed(0)}" ry="${(h * 0.75).toFixed(0)}" fill="url(#glow)">${o.isMotion ? '<animate attributeName="opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite"/>' : ''}</ellipse>` : ''
  if (!o.isMotion) {
    const xm = (x1 + x2) / 2 + w / 2
    return `<g transform="translate(${xm.toFixed(1)} ${y.toFixed(1)})">${glow}${body}${ring}${hungryMark}</g>`
  }
  const gid = `fish-${fish.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const dashX = (hash01(fish.id, 17) < 0.5 ? -1 : 1) * (40 + hash01(fish.id, 18) * 30)
  // A click on the fish (or a startle the plugin recorded): it darts off and up, then settles back.
  const startled = fish.state === 'startled' && o.now - fish.since < 1100
  // A redraw mid-dash continues it: the begin is however long ago the tap was.
  const dashBegin = startled ? `${(-(o.now - fish.since) / 1000).toFixed(2)}s;` : ''
  const dash =
    `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dashX.toFixed(0)} -14;${(dashX * 0.6).toFixed(0)} -6;0 0" keyTimes="0;0.25;0.6;1" dur="1.1s" begin="${dashBegin}${gid}.click" calcMode="spline" keySplines="0.1 0.8 0.3 1;0.4 0 0.6 1;0.4 0 0.6 1" fill="remove"/>` +
    `<animate attributeName="opacity" values="1;0.6;1" dur="0.3s" begin="${dashBegin}${gid}.click"/>`
  // A pellet this fish rushed to: it leaves its lane for the food, fast, and nibbles there.
  const pellet = [...state.pellets].reverse().find(p => p.eaters.includes(fish.id) && o.now - p.at < PELLET_SHOW_MS)
  let rush = ''
  if (pellet) {
    // The eaters gather around the food, each on its own side, noses in.
    const k = pellet.eaters.indexOf(fish.id)
    const side = k % 2 === 0 ? -1 : 1
    const depth = Math.ceil((k + 1) / 2)
    const gx = pellet.x + side * (depth * w * 0.55 + 4)
    const px = Math.max(w / 2, Math.min(W - w / 2, gx)) - w / 2
    const py = Math.max(h / 2 + 4, Math.min(FLOOR_Y - h / 2, pellet.y + 10 + (depth - 1) * 6)) - y
    const faces = side < 0 ? '1 1' : '-1 1'
    // How long ago the food dropped: a redraw continues the rush, or finds the fish already there.
    const ago = (o.now - pellet.at) / 1000
    const RUSH_AT = 0.5
    const RUSH_DUR = 0.6
    const isThere = ago >= RUSH_AT + RUSH_DUR
    const nibble = `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 -2;0 0" begin="${(RUSH_AT + RUSH_DUR - ago).toFixed(2)}s" dur="0.4s" repeatCount="6"/>`
    const lane = isThere
      ? `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">`
      : `<g transform="translate(${x1.toFixed(1)} 0)">` +
        `<animateTransform attributeName="transform" type="translate" values="${x1.toFixed(1)} 0;${x2.toFixed(1)} 0;${x1.toFixed(1)} 0" keyTimes="0;0.5;1" dur="${dur.toFixed(2)}s" begin="${begin}s" repeatCount="indefinite" calcMode="linear"/>` +
        `<animateTransform attributeName="transform" type="translate" to="${px.toFixed(1)} ${py.toFixed(1)}" begin="${(RUSH_AT - ago).toFixed(2)}s" dur="${RUSH_DUR}s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.4 1"/>`
    rush = nibble
    return (
      `<g transform="translate(0 ${y.toFixed(1)})">` +
      lane +
      rush +
      `${glow}<g id="${gid}" style="cursor:pointer">${dash}<g transform="scale(${faces})">${body}</g></g>` +
      `${ring}${hungryMark}</g></g>`
    )
  }
  return (
    `<g transform="translate(0 ${y.toFixed(1)})">` +
    `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 ${bob};0 0" dur="${bobDur.toFixed(2)}s" begin="${bobBegin}s" repeatCount="indefinite"/>` +
    `<g transform="translate(${x1.toFixed(1)} 0)">` +
    `<animateTransform attributeName="transform" type="translate" values="${x1.toFixed(1)} 0;${x2.toFixed(1)} 0;${x1.toFixed(1)} 0" keyTimes="0;0.5;1" dur="${dur.toFixed(2)}s" begin="${begin}s" repeatCount="indefinite" calcMode="linear"/>` +
    `${glow}<g id="${gid}" style="cursor:pointer">${dash}<g><animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" keyTimes="0;0.5;1" dur="${dur.toFixed(2)}s" begin="${begin}s" repeatCount="indefinite" calcMode="discrete"/>${body}</g></g>` +
    // the ring and the mark ride along inside the moving group, unflipped
    `${ring}${hungryMark}</g></g>`
  )
}

/** The animation a decoration plays: its sway where it has one, else its idle or closed frame. */
function decorAnim(kind: string): string {
  const frames = SPRITES[kind]?.frames ?? {}
  return ['sway', 'idle', 'closed'].find(a => a in frames) ?? Object.keys(frames)[0] ?? 'idle'
}

/** Food falling from where the person clicked, then sinking to the sand. */
function pelletMarkup(state: GameState, o: TankOptions): string {
  let out = ''
  for (const p of state.pellets) {
    if (o.now - p.at >= PELLET_SHOW_MS) continue
    const x = Math.max(4, Math.min(W - 4, p.x))
    const y = Math.max(6, Math.min(FLOOR_Y - 4, p.y))
    const ago = ((o.now - p.at) / 1000).toFixed(2)
    const fall = o.isMotion
      ? `<animateTransform attributeName="transform" type="translate" values="${x} 2;${x} ${y};${x} ${FLOOR_Y - 4}" keyTimes="0;0.2;1" dur="4s" begin="-${ago}s" fill="freeze" calcMode="spline" keySplines="0.3 0 0.7 1;0.2 0 0.8 1"/>` +
        `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.35;1" dur="4s" begin="-${ago}s" fill="freeze"/>`
      : ''
    out += `<g transform="translate(${x} ${y})">${fall}<g transform="scale(2)">${animatedUse('pellet', 'idle', 1, -2, -2, false)}</g></g>`
  }
  return out
}

/** Where a fish's coin pile lies on the floor, in design pixels (its left edge). */
export function pileX(fish: Fish, index: number, count: number, width = W): number {
  const slot = (width - 60) / Math.max(count, 1)
  return Math.round(24 + index * slot + hash01(fish.id, 16) * Math.max(0, slot - 52))
}

export type Pile = { fishId: string; name: string; x: number; coins: number }

/** The coin piles on the floor, one per fish that has coins waiting, left to right. */
export function piles(state: GameState, width: number): Pile[] {
  const n = state.fish.length
  return state.fish
    .map((f, i) => ({ fishId: f.id, name: f.name, x: pileX(f, i, n, width), coins: f.pending }))
    .filter(p => p.coins > 0)
    .sort((a, b) => a.x - b.x)
}

/** The piles on the sand, and a coin falling from any fish that just spat. */
function floorCoins(state: GameState, o: TankOptions): string {
  if (!o.showCoins) return ''
  let out = ''
  const n = state.fish.length
  state.fish.forEach((f, i) => {
    if (f.pending <= 0) return
    const x = pileX(f, i, n)
    const shown = f.pending >= 30 ? 3 : f.pending >= 10 ? 2 : 1
    for (let k = 0; k < shown; k++) {
      const cx = x + k * 9
      const cy = FLOOR_Y - 11 - (k === 1 ? 5 : 0)
      const begin = -(hash01(f.id + k, 7) * 0.8).toFixed(2)
      out += `<g transform="translate(${cx} ${cy})">${animatedUse('coin', 'spin', 0.9, 0, 0, o.isMotion, `begin="${begin}s"`)}</g>`
    }
    if (f.pending > 1) out += `<text x="${x + shown * 9 + 3}" y="${FLOOR_Y - 2}" font-family="monospace" font-size="8" fill="#ffe066" stroke="#1a1a2e" stroke-width="2" paint-order="stroke">×${f.pending}</text>`
    // A coin that just left the fish drops to the pile.
    if (f.state === 'spitCoin' && o.now - f.since < 15000 && o.isMotion) {
      const laneTop = 18
      const sprite = SPRITES[f.species]
      const h = sprite?.h ?? 24
      const laneBottom = FLOOR_Y - h - 6
      const y = laneTop + ((i + 0.5) / Math.max(n, 1)) * (laneBottom - laneTop)
      out += `<g transform="translate(${x} ${y.toFixed(1)})"><animateTransform attributeName="transform" type="translate" values="${x} ${y.toFixed(1)};${x} ${FLOOR_Y - 11}" dur="1.6s" begin="0.3s" fill="freeze" calcMode="spline" keySplines="0.3 0 0.7 1"/>${animatedUse('coin', 'spin', 0.5, 0, 0, true)}</g>`
    }
  })
  return out
}

function decorMarkup(d: Decoration, o: TankOptions): string {
  const sprite = SPRITES[d.kind]
  if (!sprite) return ''
  const anim = decorAnim(d.kind)
  // Decorations are placed on the base width; they spread over a wider tank.
  const x = Math.max(0, Math.min(W - sprite.w, (d.x * W) / BASE_W - sprite.w / 2))
  const y = d.y - sprite.h + 4
  const dur = 1.2 + hash01(d.id, 8) * 0.8
  return animatedUse(d.kind, anim, dur, x, y, o.isMotion)
}

function bubbles(o: TankOptions, seed: string): string {
  if (!o.showBubbles) return ''
  let out = ''
  const count = Math.max(5, Math.round((7 * W) / BASE_W))
  for (let i = 0; i < count; i++) {
    const x = 20 + hash01(seed + i, 9) * (W - 40)
    const r = 1 + hash01(seed + i, 10) * 2
    const dur = 5 + hash01(seed + i, 11) * 5
    const begin = (-(((o.now / 1000 + hash01(seed + i, 12) * dur) % dur + dur) % dur)).toFixed(2)
    if (!o.isMotion) {
      out += `<circle cx="${x.toFixed(1)}" cy="${(40 + hash01(seed + i, 13) * 100).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#bfe9ff" stroke-opacity="0.6"/>`
      continue
    }
    out += `<circle cx="${x.toFixed(1)}" cy="${FLOOR_Y}" r="${r.toFixed(1)}" fill="none" stroke="#bfe9ff" stroke-opacity="0.7"><animate attributeName="cy" values="${FLOOR_Y};6" dur="${dur.toFixed(1)}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x.toFixed(1)};${(x + 4).toFixed(1)};${x.toFixed(1)}" dur="2s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.7;0.7;0" keyTimes="0;0.8;1" dur="${dur.toFixed(1)}s" begin="${begin}s" repeatCount="indefinite"/></circle>`
  }
  return out
}

function rays(theme: Theme, o: TankOptions): string {
  const t = THEMES[theme]
  let out = ''
  const count = Math.max(2, Math.round(W / 80))
  for (let i = 0; i < count; i++) {
    const x = 40 + i * 70
    const anim = o.isMotion ? `<animate attributeName="opacity" values="0.05;0.16;0.05" dur="${(4 + i).toFixed(0)}s" repeatCount="indefinite"/>` : ''
    out += `<polygon points="${x},0 ${x + 26},0 ${x + 60},${FLOOR_Y} ${x + 10},${FLOOR_Y}" fill="${t.ray}" opacity="0.1">${anim}</polygon>`
  }
  return out
}

function sand(theme: Theme): string {
  const t = THEMES[theme]
  let dots = ''
  const count = Math.round((26 * W) / BASE_W)
  for (let i = 0; i < count; i++) {
    const x = hash01('sand' + i, 14) * W
    const y = FLOOR_Y + 4 + hash01('sand' + i, 15) * 22
    dots += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="2" height="1" fill="${t.sandDark}"/>`
  }
  return `<rect x="0" y="${FLOOR_Y}" width="${W}" height="${TANK_H - FLOOR_Y}" fill="${t.sand}"/><rect x="0" y="${FLOOR_Y}" width="${W}" height="2" fill="${t.sandDark}" opacity="0.5"/>${dots}`
}

/** The whole tank. `widthPx` sizes the element; the drawing scales with it. */
export function tankSvg(state: GameState, o: TankOptions): string {
  W = Math.max(200, Math.round(o.width ?? BASE_W))
  FISH_SCALE = o.fishScale ?? FISH_SCALES.m
  const theme = state.settings.theme
  const t = THEMES[theme]
  const speciesShown = [...new Set(state.fish.map(f => f.species))]
  const decorShown = [...new Set(state.decorations.map(d => d.kind))]
  const defs =
    speciesShown.map(s => symbols(s, 'swim') + (state.fish.some(f => f.species === s && f.state === 'spitCoin') ? symbols(s, 'spit') : '')).join('') +
    decorShown.map(k => symbols(k, decorAnim(k))).join('') +
    (o.showCoins && state.fish.some(f => f.pending > 0) ? symbols('coin', 'spin') : '') +
    (state.pellets.some(p => o.now - p.at < PELLET_SHOW_MS) ? symbols('pellet', 'idle') : '')
  const fish = laneOrder(state.fish).map((f, i) => fishMarkup(f, i, state.fish.length, o, state)).join('')
  const decor = state.decorations.map(d => decorMarkup(d, o)).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TANK_H}" width="${W * 4}" height="${TANK_H * 4}" shape-rendering="crispEdges" style="image-rendering:pixelated">` +
    `<defs><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.top}"/><stop offset="1" stop-color="${t.bottom}"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="#ffd166" stop-opacity="0.45"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>${defs}</defs>` +
    `<rect width="${W}" height="${TANK_H}" fill="url(#water)"/>` +
    rays(theme, o) +
    sand(theme) +
    decor +
    floorCoins(state, o) +
    pelletMarkup(state, o) +
    bubbles(o, state.createdAt.toString()) +
    fish +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${TANK_H - 1}" fill="none" stroke="#9ad9ff" stroke-opacity="0.35"/>` +
    `</svg>`
  )
}

/** One decoration, first frame, for the shop. */
export function decorPortraitSvg(kind: string, px: number): string {
  const sprite = SPRITES[kind]
  if (!sprite) return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"/>`
  const anim = Object.keys(sprite.frames)[0] ?? ''
  const frame = sprite.frames[anim]?.[0] ?? []
  const scale = Math.min(px / sprite.w, px / sprite.h)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sprite.w} ${sprite.h}" width="${Math.round(sprite.w * scale)}" height="${Math.round(sprite.h * scale)}" shape-rendering="crispEdges">${framePaths(frame)}</svg>`
}

/** One fish, first swim frame, for a card or a list row. */
export function fishPortraitSvg(species: string, px: number): string {
  const sprite = SPRITES[species]
  if (!sprite) return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"/>`
  const frame = sprite.frames.swim?.[0] ?? []
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sprite.w} ${sprite.h}" width="${px}" height="${Math.round((px * sprite.h) / sprite.w)}" shape-rendering="crispEdges">${framePaths(frame)}</svg>`
}

export const escapeSvgText = esc
