// Token Tank: a pixel-art tank above the prompt. Claude's turns feed the
// fish (token usage → energy → coins), successful edits, tests and commits pay
// a little extra, and the person picks the coins up off the tank floor.
//
// Layers: game/* is pure (state in, state out); this file is the adapter to
// `$` (store, turns, tool calls, the band, the pane); render/* draws the tank.
//
// The band shows while a long turn runs (as clawd-run did), or pinned by
// `/fish`. The pane (right side) is the shop, the fish and the settings.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { ShopTab, View } from '../types'
import type { DecorId, GameEvent, GameState, Outcome, RewardKind } from '../game/types'
import { applyTurn, effectiveTokens, LEVEL_UP_COST, PENDING_CAP, reward, XP_THRESHOLDS } from '../game/economy'
import { collect, dropFood, feed, FULL_ENOUGH, levelUp, pendingTotal, rename, startle } from '../game/fish'
import { DECOR, FOOD_PRICE, SPECIES, SPECIES_LIST } from '../game/species'
import { buyDecoration, buyFish, buyFood, MAX_DECOR, MAX_FISH, shopList } from '../game/shop'
import { appendLog, mergeStates, migrate } from '../game/state'
import { decorPortraitSvg, fishCentreAt, fishLayout, fishPortraitSvg, FISH_SCALES, laneOrder, PELLET_SHOW_MS, piles, TANK_H, tankSvg } from '../render/svg'
import { clock, decorName, describe, fmt, langOf, moodLine, refusalText, speciesName, tr } from './text'
import type { Lang } from './text'

const PANE = 'token-tank'
const STORE_KEY = 'game'
const BACKUP_KEY = 'game.backup.v2'
/** A turn this long shows the band by itself. */
const LONG_TURN_MS = 20_000

const game = atom({ plugin: 'token-tank', key: 'game' } as const, null as GameState | null)
const view = atom({ plugin: 'token-tank', key: 'view' } as const, 'shop' as View)
const shopTab = atom({ plugin: 'token-tank', key: 'shopTab' } as const, 'fish' as ShopTab)
const selectedId = atom({ plugin: 'token-tank', key: 'selectedId' } as const, null as string | null)
const isRenaming = atom({ plugin: 'token-tank', key: 'isRenaming' } as const, false)
const notice = atom({ plugin: 'token-tank', key: 'notice' } as const, null as string | null)
const turn = atom({ plugin: 'token-tank', key: 'turn' } as const, null as { turnId: string; isLong: boolean } | null)
const isPinned = atom({ plugin: 'token-tank', key: 'isPinned' } as const, false)
const lang = atom({ plugin: 'token-tank', key: 'lang' } as const, 'zh' as Lang)

// ---------------------------------------------------------------- persistence

/** The store, or nothing where there is none (the test kit). */
async function storeGet($: EngineInterface): Promise<unknown> {
  try {
    return await $.store.get(STORE_KEY)
  } catch {
    return undefined
  }
}

async function storeSet($: EngineInterface, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // no store here
  }
}

/** Claude's language: the `language` setting in ~/.claude/settings.json, else the shell's LANG. */
async function detectLang($: EngineInterface): Promise<Lang> {
  let setting: string | undefined
  try {
    // The row the /config menu shows as Language.
    const row = (await $.config.list()).find(r => r.key === 'language')
    if (row && typeof row.value === 'string' && row.value.trim() !== '') setting = row.value
  } catch {
    // no config rows here
  }
  try {
    if (setting !== undefined) throw new Error('known')
    const home = await $.env.get('HOME')
    if (home) {
      const text = await $.fs.read(`${home}/.claude/settings.json`)
      const parsed = JSON.parse(text) as { language?: unknown }
      if (typeof parsed.language === 'string') setting = parsed.language
    }
  } catch {
    // no settings file to read here
  }
  let envLang: string | undefined
  try {
    envLang = (await $.env.get('LANG')) ?? (await $.env.get('LC_ALL'))
  } catch {
    // no environment here
  }
  return langOf(setting, envLang)
}

/** The language to draw in: the game's setting when pinned, else Claude's. */
async function langNow($: EngineInterface, state: GameState | null): Promise<Lang> {
  const pinned = state?.settings.language
  if (pinned === 'zh' || pinned === 'en') return pinned
  return read($, lang)
}

async function load($: EngineInterface): Promise<GameState> {
  const now = await $.clock.now()
  const raw = await storeGet($)
  let { state } = migrate(raw, now)
  const { migratedFrom, isReset } = migrate(raw, now)
  // A fresh game in English names its first fish in English.
  if ((raw === undefined || isReset) && (await read($, lang)) === 'en') {
    state = { ...state, fish: state.fish.map(f => ({ ...f, name: SPECIES[f.species].en })) }
  }
  if (migratedFrom === 2) await storeSet($, BACKUP_KEY, raw)
  if (migratedFrom !== null || isReset || raw === undefined) await storeSet($, STORE_KEY, state)
  await update($, game, () => state)
  return state
}

/**
 * Applies one pure change to the newest state any session wrote, logs its
 * events, writes it back and redraws. The read-merge-write window is small
 * but not zero: two sessions pressing at the same instant may lose one press.
 */
async function commit($: EngineInterface, change: (state: GameState, now: number) => Outcome): Promise<GameEvent[]> {
  const now = await $.clock.now()
  const mine = (await read($, game)) ?? (await load($))
  const stored = migrate(await storeGet($), now).state
  const base = stored.revision > mine.revision ? mergeStates(mine, stored) : mine
  const { state, events } = change(base, now)
  const L = await langNow($, base)
  let next = state
  for (const ev of events) {
    const text = describe(next, ev, L)
    if (text) next = appendLog(next, text, now)
  }
  const refused = events.find(ev => ev.kind === 'refused')
  await update($, notice, () => (refused && refused.kind === 'refused' ? refusalText(refused.reason, L) : null))
  if (next !== base) await storeSet($, STORE_KEY, next)
  await update($, game, () => next)
  return events
}

// ------------------------------------------------------------- tool rewards

const TEST_COMMAND = /(^|[\s;&|])(pytest|vitest|jest|mocha|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test|bun test|node --test|claude plugin test|make test|dotnet test|mvn test|gradle test|phpunit|rspec)\b/
const COMMIT_COMMAND = /(^|[\s;&|])git\s+(-\S+\s+)*commit\b/

function rewardFor(tool: string, command: string | undefined, isError: boolean): RewardKind | null {
  if (isError) return null
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Bash' && command) {
    if (COMMIT_COMMAND.test(command)) return 'commit'
    if (TEST_COMMAND.test(command)) return 'test'
  }
  return null
}

// ------------------------------------------------------------------ drawing

type Draw = {
  el: ReturnType<EngineInterface['ui']['resolve']>
  lang: Lang
  surface: string
  columns: number
  /** Rows the site allows (the band's maxRows); 0 when unknown. */
  maxRows: number
  state: GameState
  now: number
}

/**
 * The tap grid's cell: TAP_W columns wide, a row tall. The label is em
 * spaces (one em each in the Desktop's proportional font, so about 14 px):
 * enough of them that a button overlaps the next cell, and a press anywhere
 * lands on the top-most button whose cell starts at or before it.
 */
const TAP_W = 8
const TAP_LABEL = '\u2003'.repeat(7)

/**
 * A tap on the tank at design pixel (X, Y), `renderedAt` being when the
 * drawing started: on a fish it darts off; on open water a pellet drops.
 */
async function tapTank($: EngineInterface, X: number, Y: number, W: number, renderedAt: number): Promise<void> {
  const state = await read($, game)
  if (!state) return
  const now = await $.clock.now()
  const n = state.fish.length
  const hit = laneOrder(state.fish).find((f, i) => {
    const l = fishLayout(f, i, n, W, renderedAt, FISH_SCALES[state.settings.tankSize])
    const c = fishCentreAt(l, now)
    return Math.abs(X - c.x) <= l.w * 0.7 && Math.abs(Y - c.y) <= l.h * 0.8
  })
  if (hit) await commit($, (st, at) => startle(st, hit.id, at))
  else await commit($, (st, at) => dropFood(st, X, Y, at))
  // Once the pellet is gone, draw the lanes again (the drawing continues, nothing replays).
  $.clock.after(PELLET_SHOW_MS + 150, () => {
    void update($, game, st => (st ? { ...st } : st))
  })
}

/** Rewards earned by tool calls in the running turn, paid at its end (module memory). */
const pendingRewards: RewardKind[] = []

/** The last tank drawing, reused while nothing of the tank changed (module memory; a reload starts over). */
let tankCache: { key: string; source: string; renderedAt: number } | null = null

/** The band's tank is as wide as the band; its size picks the aspect (width ÷ height). */
const ASPECT: Record<GameState['settings']['tankSize'], number> = { s: 9, m: 6.5, l: 4.5 }
/** Desktop cell estimates: one monospace column and one row in CSS pixels. */
const PX_PER_COL = 8
const PX_PER_ROW = 22

function tankLevel(state: GameState): number {
  const minted = state.stats.totalCoinsMinted
  return Math.min(50, 1 + Math.floor(Math.sqrt(minted / 40)))
}

function bar(d: Draw, ratio: number, color: string, widthPx: number): RenderElement {
  const { Svg, Text } = d.el as { Svg?: (p: { source: string; alt: string; width: number; height: number }) => RenderElement; Text: (p: Record<string, unknown>) => RenderElement }
  const r = Math.max(0, Math.min(1, ratio))
  if (d.surface === 'desktop' && Svg) {
    const w = widthPx
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="8" viewBox="0 0 ${w} 8"><rect x="0" y="1" width="${w}" height="6" rx="3" fill="rgba(127,127,127,0.22)"/><rect x="0" y="1" width="${Math.max(0, w * r).toFixed(1)}" height="6" rx="3" fill="${color}"/></svg>`
    return Svg({ source: src, alt: `${Math.round(r * 100)}%`, width: w, height: 8 })
  }
  const cells = Math.max(6, Math.floor(widthPx / 8))
  const on = Math.round(cells * r)
  return Text({ children: '━'.repeat(on) + '─'.repeat(cells - on), color, dimColor: false })
}

/** The terminal's tank: text fish on their lines, the coin piles as buttons on the floor. */
function textTank($: EngineInterface, d: Draw, selected: string | null): RenderElement {
  const { Box, Text, Button } = d.el
  const s = d.state
  const cols = Math.max(20, Math.min(d.columns - 4, 100))
  const t = Math.floor(d.now / 1000)
  const lines = s.fish.map((f, i) => {
    const span = cols - 6
    const phase = (t * (2 + (i % 3)) + i * 7) % (span * 2)
    const x = phase < span ? phase : span * 2 - phase
    const glyph = phase < span ? '><>' : '<><'
    return <Text key={`l${i}`} color={f.id === selected ? 'yellow' : 'cyan'}>{' '.repeat(x)}{glyph}</Text>
  })
  const list = piles(s, 320)
  let used = 0
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={cols + 4}>
      {lines.length === 0 ? <Text dimColor>{tr(d.lang, 'emptyTank')}</Text> : lines}
      <Box flexDirection="row">
        {list.length === 0 && <Text dimColor>{' '}</Text>}
        {list.map(p => {
          const at = Math.min(cols - 6, Math.max(used, Math.round((p.x / 320) * cols)))
          const label = p.coins > 1 ? `🪙×${p.coins}` : '🪙'
          const pad = at - used
          used = at + label.length + 1
          return (
            <Box key={`pile-${p.fishId}`} paddingLeft={pad}>
              <Button key={`coin-${p.fishId}`} plain onPress={() => void commit($, (st, now) => collect(st, p.fishId, now))}>{label}</Button>
            </Box>
          )
        })}
      </Box>
      <Text dimColor>{'~'.repeat(cols)}</Text>
    </Box>
  )
}

/**
 * The tank with its coins. On Desktop the SVG fills the whole width (no pixel
 * width given, a wide aspect), the piles lie on the sand and a plain coin
 * button sits over each one (absolute, anchored to the floor), so the person
 * picks the coins up where they lie.
 */
function tankBlock($: EngineInterface, d: Draw, aspect: number, selected: string | null): RenderElement {
  const { Box, Button } = d.el
  const Svg = (d.el as { Svg?: (p: Record<string, unknown>) => RenderElement }).Svg
  const s = d.state
  if (d.surface === 'terminal' || !Svg) return textTank($, d, selected)
  // Explicit pixels: a sized Svg box matches the drawn image, so the coins sit on the sand.
  const widthPx = Math.max(240, Math.round(d.columns * PX_PER_COL))
  const roomPx = d.maxRows > 0 ? Math.max(120, (d.maxRows - 3) * PX_PER_ROW) : 400
  const heightPx = Math.round(Math.min(widthPx / aspect, roomPx))
  const W = Math.round((TANK_H * widthPx) / heightPx)
  // The band is drawn again whenever any plugin's band changes (pillbar samples
  // every few seconds). The same drawing is handed back while nothing of the
  // tank changed, so the Desktop keeps the image and its animation running
  // instead of swapping (and flashing) it.
  // Only what the drawing shows goes into the key: a turn that changed the
  // coins or the stats alone must not make a new image (and a flash).
  const fishKey = s.fish
    .map(f => {
      const spitting = f.state === 'spitCoin' && d.now - f.since < 15000
      const startled = f.state === 'startled' && d.now - f.since < 1100
      return `${f.id}:${f.species}:${f.name}:${f.hunger < 25 ? 'h' : ''}:${f.pending}:${spitting ? 's' : ''}${startled ? 'd' : ''}`
    })
    .join(',')
  const decorKey = s.decorations.map(x => `${x.kind}@${x.x}`).join(',')
  const pelletKey = s.pellets.filter(p => d.now - p.at < PELLET_SHOW_MS).map(p => p.id).join(',')
  const key = [W, widthPx, heightPx, selected ?? '', s.settings.theme, s.settings.showCoins, s.settings.showBubbles, s.settings.reduceMotion, s.settings.tankSize, fishKey, decorKey, pelletKey].join('|')
  let drawing = tankCache
  if (!drawing || drawing.key !== key) {
    drawing = {
      key,
      renderedAt: d.now,
      source: tankSvg(s, {
        isMotion: !s.settings.reduceMotion,
        showCoins: s.settings.showCoins,
        showBubbles: s.settings.showBubbles,
        selectedId: selected,
        now: d.now,
        width: W,
        fishScale: FISH_SCALES[s.settings.tankSize],
      }),
    }
    tankCache = drawing
  }
  const mode = s.settings.renderMode
  // The tiny test: a 1 KB drawing with one moving dot, to tell size from mechanism.
  const source = mode === 'tiny'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TANK_H}" width="${W}" height="${TANK_H}"><rect width="${W}" height="${TANK_H}" fill="#14456e"/><circle cy="90" r="8" fill="#ffd166"><animate attributeName="cx" values="20;${W - 20};20" dur="8s" begin="${(-((d.now / 1000) % 8)).toFixed(2)}s" repeatCount="indefinite"/></circle></svg>`
    : drawing.source
  const renderedAt = drawing.renderedAt
  const cols = Math.max(20, d.columns)
  const rows = Math.max(3, Math.round(heightPx / PX_PER_ROW))
  // The tap grid: invisible plain buttons over the water, TAP_W columns wide
  // and a row tall each, so a press says roughly where (the Desktop sends no
  // pointer events to a Client, and nothing crosses out of the Svg).
  const taps: RenderElement[] = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c * TAP_W < cols; c++) {
      const X = ((c + 0.5) * TAP_W) / cols * W
      const Y = ((r + 0.5) / rows) * TANK_H
      taps.push(
        <Box key={`tap-${c}-${r}`} position="absolute" left={c * TAP_W} top={r}>
          <Button key={`tap-${c}-${r}`} plain onPress={() => void tapTank($, X, Y, W, renderedAt)}>{TAP_LABEL}</Button>
        </Box>,
      )
    }
  }
  return (
    <Box key="tank" flexDirection="column" width="100%">
      <Box key="tank-image">
        {Svg({ source, alt: tr(d.lang, 'tankAlt') + s.fish.map(f => f.name).join(d.lang === 'zh' ? '、' : ', '), width: widthPx, height: heightPx, isInteractive: mode === 'frame' ? true : undefined })}
      </Box>
      {taps}
      {piles(s, W).map(p => (
        <Box key={`pile-${p.fishId}`} position="absolute" left={Math.min(cols - 5, Math.round((p.x / W) * cols))} bottom={1}>
          <Button key={`coin-${p.fishId}`} plain onPress={() => void commit($, (st, now) => collect(st, p.fishId, now))}>{p.coins > 1 ? `🪙×${p.coins}` : '🪙'}</Button>
        </Box>
      ))}
    </Box>
  )
}

/** The one-line status under the band's tank. */
function bandRow($: EngineInterface, d: Draw, note: string | null): RenderElement {
  const { Box, Text, Button } = d.el
  const s = d.state
  const pending = pendingTotal(s)
  const hungry = s.fish.filter(f => f.hunger < 25).length
  const last = s.log[s.log.length - 1]
  return (
    <Box key="token-tank-row" flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      <Text color="yellow">🪙 {fmt(s.coins)}</Text>
      <Text dimColor={pending === 0}>{pending > 0 ? tr(d.lang, 'coinsOnFloor', { n: pending }) : tr(d.lang, 'accumulating')}</Text>
      <Text dimColor>{s.fish.some(f => f.hunger < FULL_ENOUGH) ? tr(d.lang, 'tapToFeed', { n: s.food }) : tr(d.lang, 'allFull', { n: s.food })}</Text>
      {note && <Text color="yellow">{note}</Text>}
      {hungry > 0 && <Text color="yellow">{tr(d.lang, 'hungryCount', { n: hungry })}</Text>}
      {hungry > 0 && <Button key="band-feed" plain onPress={() => void commit($, (st, now) => feed(st, null, now))}>{tr(d.lang, 'feedAll')}</Button>}
      <Button key="band-open" plain onPress={() => void $.ui.open({ id: PANE, title: 'Token Tank', focus: true })}>{tr(d.lang, 'panel')}</Button>
      {last && <Text dimColor wrap="truncate-end">{last.text}</Text>}

    </Box>
  )
}

// ------------------------------------------------------------------ the pane
//
// Airy, like the Desktop's own panels: fixed columns that line up, a blank
// line between rows, plain text links instead of boxed buttons (the pointer
// shows them), and the chosen tab or option marked with a dot.

/** A link-like button: plain text, dim when it does nothing right now. */
function link(d: Draw, key: string, label: string, onPress: () => void, isOff = false): RenderElement {
  const { Button } = d.el
  return (
    <Button key={key} plain dimColor={isOff || undefined} onPress={onPress}>
      {label}
    </Button>
  )
}

/** One choice in a row of options: the chosen one is a dot and bold text, the others links. */
function choice(d: Draw, key: string, label: string, isChosen: boolean, onPress: () => void): RenderElement {
  const { Text } = d.el
  if (isChosen) return <Text weight="semibold">● {label}</Text>
  return link(d, key, `○ ${label}`, onPress)
}

function paneHeader($: EngineInterface, d: Draw, current: View): RenderElement {
  const { Box, Text } = d.el
  const s = d.state
  const go = (v: View) => () => void update($, view, () => v)
  const tab = (id: View, label: string) => (current === id ? <Text weight="semibold">{label}</Text> : link(d, `nav-${id}`, label, go(id)))
  return (
    <Box flexDirection="column" gap={1} marginBottom={1}>
      <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
        <Text weight="bold" color="claude">{tr(d.lang, 'title')}</Text>
        <Text dimColor>Lv.{tankLevel(s)}</Text>
      </Box>
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        <Text color="yellow">🪙 {fmt(s.coins)}</Text>
        <Text dimColor>🍤 {s.food}</Text>
        <Text dimColor>🐟 {s.fish.length}/{MAX_FISH}</Text>
      </Box>
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {tab('shop', tr(d.lang, 'tabShop'))}
        {tab('fish', tr(d.lang, 'tabFish'))}
        {tab('settings', tr(d.lang, 'tabSettings'))}
      </Box>
    </Box>
  )
}

const COL_THUMB = 5
const COL_NAME = 11
const COL_PRICE = 8
/** Locked species shown in the shop: the next few to unlock; the rest are one line. */
const LOCKED_SHOWN = 2

/** How wide one shop card is, in cells, and how many fit a row. */
const CARD_W = 24
function cardsPerRow(columns: number): number {
  if (columns >= CARD_W * 4 + 6) return 4
  if (columns >= CARD_W * 3 + 4) return 3
  if (columns >= CARD_W * 2 + 2) return 2
  return 1
}

/** A species' rarity, by how many fish the tank must hold before the shop lists it. */
function rarityKey(unlockAt: number): 'rarity0' | 'rarity1' | 'rarity2' | 'rarity3' {
  return unlockAt <= 1 ? 'rarity0' : unlockAt <= 4 ? 'rarity1' : unlockAt <= 6 ? 'rarity2' : 'rarity3'
}

type Card = {
  key: string
  /** The tile's SVG, or null for a mystery. */
  art: ((px: number) => string) | null
  name: string
  sub: string
  price: number
  /** The action link, or the dim words that stand in for it. */
  action: { key: string; label: string; onPress: () => void } | string
}

/** One product: a vertical card in a grid, or a horizontal strip when only one fits a row. */
function productCard(d: Draw, c: Card, perRow: number): RenderElement {
  const { Box, Text } = d.el
  const Svg = (d.el as { Svg?: (p: Record<string, unknown>) => RenderElement }).Svg
  const showArt = d.surface !== 'terminal' && Svg
  const action = typeof c.action === 'string' ? <Text dimColor>{c.action}</Text> : link(d, c.action.key, `${c.action.label} ›`, c.action.onPress)
  if (perRow === 1) {
    const tile = 64
    return (
      <Box key={c.key} flexDirection="row" gap={2} alignItems="center" borderStyle="round" borderDimColor paddingX={1}>
        <Box width={9} alignItems="center">
          {c.art && showArt && Svg ? Svg({ source: c.art(tile), alt: c.name, width: tile, height: Math.round(tile * 0.72) }) : <Text dimColor>{c.art ? '🐟' : '?'}</Text>}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text weight="semibold" wrap="truncate-end">{c.name}</Text>
          <Text dimColor wrap="truncate-end">{c.sub}</Text>
          <Box flexDirection="row" gap={2} alignItems="center">
            <Text color="yellow">🪙 {c.price}</Text>
            {action}
          </Box>
        </Box>
      </Box>
    )
  }
  const tile = 120
  return (
    <Box key={c.key} flexDirection="column" alignItems="center" gap={0} width={CARD_W} borderStyle="round" borderDimColor paddingX={1} paddingY={0}>
      {c.art && showArt && Svg ? Svg({ source: c.art(tile), alt: c.name, width: tile, height: Math.round(tile * 0.72) }) : <Text dimColor>{c.art ? '🐟' : '?'}</Text>}
      <Text weight="semibold" wrap="truncate-end">{c.name}</Text>
      <Text dimColor wrap="truncate-end">{c.sub}</Text>
      <Text color="yellow" weight="semibold">🪙 {c.price}</Text>
      {action}
    </Box>
  )
}

function shopView($: EngineInterface, d: Draw, tab: ShopTab): RenderElement {
  const { Box, Text } = d.el
  const s = d.state
  const perRow = cardsPerRow(d.columns)
  const tabs: [ShopTab, string][] = [['fish', tr(d.lang, 'shopFish')], ['decor', tr(d.lang, 'shopDecor')], ['food', tr(d.lang, 'shopFood')]]
  let cards: Card[] = []
  let footer: RenderElement | null = null
  if (tab === 'fish') {
    const list = shopList(s)
    const lockedAll = list.filter(x => !x.isUnlocked)
    const shown = list.filter(x => x.isUnlocked).concat(lockedAll.slice(0, LOCKED_SHOWN))
    const hidden = lockedAll.length - Math.min(LOCKED_SHOWN, lockedAll.length)
    cards = shown.map(({ species, isUnlocked, canAfford }) => {
      const sp = SPECIES[species]
      return {
        key: `shop-${species}`,
        art: isUnlocked ? (px: number) => fishPortraitSvg(species, px, true) : null,
        name: isUnlocked ? speciesName(sp, d.lang) : tr(d.lang, 'mystery'),
        sub: `${tr(d.lang, rarityKey(sp.unlockAt))} · ${tr(d.lang, 'rateShort', { r: sp.rate.toFixed(1) })}`,
        price: sp.price,
        action: !isUnlocked
          ? tr(d.lang, 'lockedAt', { n: sp.unlockAt })
          : !canAfford
            ? tr(d.lang, 'notEnough')
            : { key: `buy-${species}`, label: tr(d.lang, 'buy'), onPress: () => void commit($, (st, now) => buyFish(st, species, now, `${now}`, d.lang === 'en' ? sp.en : undefined)) },
      }
    })
    if (hidden > 0) footer = <Text dimColor wrap="wrap">{tr(d.lang, 'moreLocked', { n: hidden })}</Text>
  } else if (tab === 'decor') {
    const kinds = (Object.keys(DECOR) as DecorId[]).sort((a, b) => DECOR[a].price - DECOR[b].price)
    cards = kinds.map(kind => {
      const have = s.decorations.filter(x => x.kind === kind).length
      const canAfford = s.coins >= DECOR[kind].price
      return {
        key: `shop-${kind}`,
        art: (px: number) => decorPortraitSvg(kind, px, true),
        name: decorName(kind, d.lang),
        sub: tr(d.lang, 'owned', { n: have }),
        price: DECOR[kind].price,
        action: !canAfford ? tr(d.lang, 'notEnough') : { key: `buy-${kind}`, label: tr(d.lang, 'place'), onPress: () => void commit($, (st, now) => buyDecoration(st, kind, now, `${now}`)) },
      }
    })
    footer = <Text dimColor>{tr(d.lang, 'decorCount', { n: s.decorations.length, max: MAX_DECOR })}</Text>
  } else {
    cards = [
      {
        key: 'shop-food-1',
        art: (px: number) => decorPortraitSvg('pellet', px, true),
        name: tr(d.lang, 'foodWord'),
        sub: tr(d.lang, 'foodStock', { n: s.food }),
        price: FOOD_PRICE,
        action: s.coins < FOOD_PRICE ? tr(d.lang, 'notEnough') : { key: 'buy-food-1', label: tr(d.lang, 'buyFood1'), onPress: () => void commit($, st => buyFood(st, 1)) },
      },
      {
        key: 'shop-food-10',
        art: (px: number) => decorPortraitSvg('pellet', px, true),
        name: `${tr(d.lang, 'foodWord')} ×10`,
        sub: tr(d.lang, 'foodStock', { n: s.food }),
        price: FOOD_PRICE * 10,
        action: s.coins < FOOD_PRICE * 10 ? tr(d.lang, 'notEnough') : { key: 'buy-food-10', label: tr(d.lang, 'buyFood10'), onPress: () => void commit($, st => buyFood(st, 10)) },
      },
    ]
    footer = <Text dimColor wrap="wrap">{tr(d.lang, 'foodHelp')}</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {tabs.map(([id, label]) => (tab === id ? <Text weight="semibold">{label}</Text> : link(d, `tab-${id}`, label, () => void update($, shopTab, () => id))))}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {cards.map(c => productCard(d, c, perRow))}
      </Box>
      {footer}
    </Box>
  )
}

function fishView($: EngineInterface, d: Draw, selected: string | null, renaming: boolean): RenderElement {
  const { Box, Text } = d.el
  const Input = (d.el as { Input?: (p: Record<string, unknown>) => RenderElement }).Input
  const Svg = (d.el as { Svg?: (p: Record<string, unknown>) => RenderElement }).Svg
  const s = d.state
  const showArt = d.surface !== 'terminal' && Svg
  const barW = Math.max(60, Math.min(160, (d.columns - 16) * 6))
  if (s.fish.length === 0) return <Text dimColor>{tr(d.lang, 'noFishYet')}</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {s.fish.map(f => {
        const sp = SPECIES[f.species]
        const isOpen = f.id === selected
        const nextXp = XP_THRESHOLDS[f.level] ?? null
        const canLevel = nextXp !== null && f.xp >= nextXp && s.coins >= LEVEL_UP_COST(f.level)
        const xpRatio = nextXp === null ? 1 : (f.xp - (XP_THRESHOLDS[f.level - 1] ?? 0)) / Math.max(1, nextXp - (XP_THRESHOLDS[f.level - 1] ?? 0))
        return (
          <Box key={`fish-${f.id}`} flexDirection="column" gap={0}>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Box width={COL_THUMB} alignItems="center">{showArt && Svg ? Svg({ source: fishPortraitSvg(f.species, 30), alt: speciesName(sp, d.lang), width: 30, height: 22 }) : <Text>🐟</Text>}</Box>
              <Box width={COL_NAME}>{link(d, `pick-${f.id}`, `${f.name} ${isOpen ? '▾' : '▸'}`, () => void update($, selectedId, cur => (cur === f.id ? null : f.id)))}</Box>
              <Text dimColor>Lv.{f.level}</Text>
              <Text color={f.hunger < 25 ? 'yellow' : undefined} dimColor={f.hunger >= 25}>🍽 {Math.round(f.hunger)}%</Text>
              {f.pending > 0 && <Text color="yellow">🪙 {f.pending}</Text>}
            </Box>
            {isOpen && (
              <Box flexDirection="column" gap={0} paddingLeft={COL_THUMB + 1} marginTop={1}>
                <Text dimColor>{speciesName(sp, d.lang)} · {tr(d.lang, 'rateLine', { rate: (sp.rate * (1 + 0.15 * (f.level - 1))).toFixed(2), pending: f.pending, cap: PENDING_CAP })}</Text>
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor>XP</Text>
                  {bar(d, xpRatio, '#4cc9f0', barW)}
                  <Text dimColor>{nextXp === null ? 'MAX' : `${fmt(f.xp)}/${fmt(nextXp)}`}</Text>
                </Box>
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor>🙂</Text>
                  {bar(d, f.mood / 100, '#4cc9f0', barW)}
                  <Text dimColor>{Math.round(f.mood)}%</Text>
                </Box>
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor>🪙</Text>
                  {bar(d, f.carry, '#e9b949', barW)}
                  <Text dimColor>{tr(d.lang, 'nextCoin', { p: Math.round(f.carry * 100) })}</Text>
                </Box>
                <Text color="pink" wrap="wrap">❤ {moodLine(s, f.id, d.lang)}</Text>
                <Box flexDirection="row" columnGap={3} rowGap={0} flexWrap="wrap" marginTop={1}>
                  {link(d, `feed-${f.id}`, `${tr(d.lang, 'feed')} ›`, () => void commit($, (st, now) => feed(st, f.id, now)), s.food <= 0)}
                  {link(d, `level-${f.id}`, `${tr(d.lang, 'levelUp')}${nextXp === null ? '' : ` ${LEVEL_UP_COST(f.level)}🪙`} ›`, () => void commit($, (st, now) => levelUp(st, f.id, now)), !canLevel)}
                  {link(d, `rename-${f.id}`, `${tr(d.lang, 'rename')} ›`, () => void update($, isRenaming, v => !v))}
                </Box>
                {renaming && Input && (
                  <Box flexDirection="column" marginTop={1}>
                    {Input({
                      key: `name-${f.id}`,
                      placeholder: tr(d.lang, 'renamePlaceholder'),
                      onSubmit: (value: string) => {
                        void commit($, st => rename(st, f.id, value)).then(() => update($, isRenaming, () => false))
                      },
                    })}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )
      })}
      <Box marginTop={1}>{link(d, 'feed-all', `${tr(d.lang, 'feedAll')} ›`, () => void commit($, (st, now) => feed(st, null, now)), s.food <= 0)}</Box>
    </Box>
  )
}

function settingsView($: EngineInterface, d: Draw): RenderElement {
  const { Box, Text } = d.el
  const s = d.state
  const st = s.stats
  const set = (patch: Partial<GameState['settings']>) =>
    void commit($, (state, now) => ({ state: { ...state, settings: { ...state.settings, ...patch }, revision: state.revision + 1, updatedAt: now }, events: [] }))
  const toggle = (key: 'showCoins' | 'showBubbles' | 'reduceMotion' | 'showBand', label: string) => (
    <Box key={`set-${key}`} flexDirection="row" gap={2} alignItems="center">
      {link(d, `toggle-${key}`, s.settings[key] ? '● ' + tr(d.lang, 'on') : '○ ' + tr(d.lang, 'off'), () => set({ [key]: !s.settings[key] }))}
      <Text dimColor={!s.settings[key]}>{label}</Text>
    </Box>
  )
  const themes: [GameState['settings']['theme'], string][] = [['ocean', tr(d.lang, 'themeOcean')], ['wreck', tr(d.lang, 'themeWreck')], ['reef', tr(d.lang, 'themeReef')], ['abyss', tr(d.lang, 'themeAbyss')]]
  const group = (label: string, body: RenderElement) => (
    <Box flexDirection="column" gap={0}>
      <Text dimColor>{label}</Text>
      {body}
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      {group(tr(d.lang, 'theme'), (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {themes.map(([id, label]) => choice(d, `theme-${id}`, label, s.settings.theme === id, () => set({ theme: id })))}
        </Box>
      ))}
      {group(tr(d.lang, 'tankHeight'), (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {(['s', 'm', 'l'] as const).map(size => choice(d, `size-${size}`, tr(d.lang, size === 's' ? 'sizeS' : size === 'm' ? 'sizeM' : 'sizeL'), s.settings.tankSize === size, () => set({ tankSize: size })))}
        </Box>
      ))}
      {group(tr(d.lang, 'renderMode'), (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {(['image', 'frame', 'tiny'] as const).map(m => choice(d, `mode-${m}`, tr(d.lang, m === 'image' ? 'modeImage' : m === 'frame' ? 'modeFrame' : 'modeTiny'), s.settings.renderMode === m, () => set({ renderMode: m })))}
        </Box>
      ))}
      {group(tr(d.lang, 'language'), (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {(['auto', 'zh', 'en'] as const).map(l => choice(d, `lang-${l}`, tr(d.lang, l === 'auto' ? 'langAuto' : l === 'zh' ? 'langZh' : 'langEn'), s.settings.language === l, () => set({ language: l })))}
        </Box>
      ))}
      <Box flexDirection="column" gap={0}>
        {toggle('showBand', tr(d.lang, 'setBand'))}
        {toggle('showCoins', tr(d.lang, 'setCoins'))}
        {toggle('showBubbles', tr(d.lang, 'setBubbles'))}
        {toggle('reduceMotion', tr(d.lang, 'setMotion'))}
      </Box>
      <Text dimColor wrap="wrap">{tr(d.lang, 'help')}</Text>
      {group(tr(d.lang, 'stats'), (
        <Box flexDirection="column" gap={0}>
          <Text wrap="wrap">{tr(d.lang, 'statsToday', { t: fmt(st.todayEffectiveTokens), m: fmt(st.todayCoinsMinted), c: fmt(st.todayCoinsCollected), r: fmt(st.todayTurns) })}</Text>
          <Text dimColor wrap="wrap">{tr(d.lang, 'statsTotal', { t: fmt(st.totalEffectiveTokens), m: fmt(st.totalCoinsMinted), c: fmt(st.totalCoinsCollected) })}</Text>
          <Text dimColor wrap="wrap">{tr(d.lang, 'statsMore', { tests: fmt(st.testsPassed), commits: fmt(st.commits), edits: fmt(st.edits), feeds: fmt(st.feeds), dex: s.dex.length, all: SPECIES_LIST.length })}</Text>
        </Box>
      ))}
      {s.log.length > 0 && group(tr(d.lang, 'log'), (
        <Box flexDirection="column" gap={0}>
          {s.log.slice(-5).reverse().map((e, i) => (
            <Box key={`log-${i}`} flexDirection="row" gap={1}>
              <Text dimColor>{clock(e.at)}</Text>
              <Text wrap="truncate-end">{e.text}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const L = await detectLang($)
    await update($, lang, () => L)
    await $.command.register({ name: 'fish', description: tr(L, 'cmdDescription') })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'fish' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    const L = await langNow($, await read($, game))
    if (arg === 'collect') {
      const events = await commit($, (st, now) => collect(st, null, now))
      const got = events.find(ev => ev.kind === 'collected')
      return { text: got && got.kind === 'collected' ? tr(L, 'cmdCollected', { n: got.coins }) : tr(L, 'cmdNothing') }
    }
    if (arg === 'feed') {
      await commit($, (st, now) => feed(st, null, now))
      return { text: tr(L, 'cmdFed') }
    }
    if (arg === 'panel' || arg === 'shop') {
      await $.ui.open({ id: PANE, title: 'Token Tank', focus: true })
      return { text: tr(L, 'cmdPanel') }
    }
    const shown = await update($, isPinned, was => !was)
    await $.ui.invalidate('ui.render')
    return { text: shown ? tr(L, 'cmdShown') : tr(L, 'cmdHidden') }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const turnId = e.turnId
      await update($, turn, () => ({ turnId, isLong: false }))
      $.clock.after(LONG_TURN_MS, () => {
        void update($, turn, cur => (cur?.turnId === turnId ? { turnId, isLong: true } : cur))
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Only the main loop pays: a subagent's usage is part of the same work.
    if (e.agentId !== undefined) return done
    const usage = e.usage
    const effective = effectiveTokens(usage)
    const rewards = pendingRewards.splice(0)
    const events = await commit($, (st, now) => {
      let out = applyTurn(st, { turnId: e.turnId, usage, now })
      // The turn's rewards, each under its own cooldown, in one write.
      for (const kind of rewards) {
        const paid = reward(out.state, { kind, now })
        out = { state: paid.state, events: [...out.events, ...paid.events] }
      }
      return out
    })
    const minted = events.filter(ev => ev.kind === 'minted').reduce((n, ev) => n + (ev.kind === 'minted' ? ev.coins : 0), 0)
    const now = await $.clock.now()
    const L = await langNow($, await read($, game))
    if (effective > 0 && minted === 0 && !events.some(ev => ev.kind === 'refused')) {
      await update($, game, st => (st ? appendLog(st, tr(L, 'turnNoCoins', { t: fmt(effective) }), now) : st))
    } else if (minted > 0) {
      await update($, game, st => (st ? appendLog(st, tr(L, 'turnCoins', { t: fmt(effective), n: minted }), now) : st))
    }
    return done
  })

  // Rewards wait for the end of the turn: one write and one redraw per turn,
  // not one per tool call (every band redraw costs the Desktop a repaint).
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    const command = e.tool === 'Bash' ? (e as { command?: string }).command : undefined
    const kind = rewardFor(e.tool, command, Boolean((ran as { isError?: boolean }).isError) || 'deny' in ran)
    if (kind) pendingRewards.push(kind)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, game)
    const cur = await read($, turn)
    const pinned = await read($, isPinned)
    const note = await read($, notice)
    const isLong = e.props.isWorking && cur?.isLong === true
    const isShown = state?.settings.showBand !== false && (pinned || isLong)
    if (e.props.hasSurvey || !state || !isShown || e.surface === 'mobile' || e.surface === 'vscode') return next(e)
    const el = $.ui.resolve(e)
    const { Box } = el
    const now = await $.clock.now()
    const columns = e.props.bodyColumns || e.viewport?.columns || 80
    const d: Draw = { el, lang: await langNow($, state), surface: e.surface, columns, maxRows: e.props.maxRows ?? 0, state, now }
    // The tank sits above whatever the plugins beneath draw (pillbar hugs the prompt).
    const below = await next(e)
    return (
      <Box key="token-tank-stack" flexDirection="column">
        {tankBlock($, d, ASPECT[state.settings.tankSize], null)}
        {bandRow($, d, note)}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const state = await read($, game)
    const [current, tab, selected, note, renaming] = await Promise.all([read($, view), read($, shopTab), read($, selectedId), read($, notice), read($, isRenaming)])
    const now = await $.clock.now()
    if (!state) {
      return (
        <Box padding={1}>
          <Text dimColor>{tr(await read($, lang), 'loading')}</Text>
        </Box>
      )
    }
    const columns = e.props.bodyColumns || e.viewport?.columns || 60
    const d: Draw = { el, lang: await langNow($, state), surface: e.surface, columns, maxRows: 0, state, now }
    return (
      <Box flexDirection="column" gap={0} paddingX={1} paddingTop={1}>
        {paneHeader($, d, current)}
        {note && <Text color="yellow" wrap="wrap">{note}</Text>}
        {current === 'shop' ? shopView($, d, tab) : current === 'fish' ? fishView($, d, selected, renaming) : settingsView($, d)}
      </Box>
    )
  })
}
