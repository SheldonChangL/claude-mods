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
import { collect, dropFood, feed, levelUp, pendingTotal, rename, startle } from '../game/fish'
import { DECOR, FOOD_PRICE, SPECIES, SPECIES_LIST } from '../game/species'
import { buyDecoration, buyFish, buyFood, MAX_DECOR, MAX_FISH, shopList } from '../game/shop'
import { appendLog, mergeStates, migrate } from '../game/state'
import { decorPortraitSvg, fishCentreAt, fishLayout, fishPortraitSvg, PELLET_SHOW_MS, piles, TANK_H, tankSvg } from '../render/svg'
import { clock, describe, fmt, moodLine, refusalText } from './text'

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

async function load($: EngineInterface): Promise<GameState> {
  const now = await $.clock.now()
  const raw = await storeGet($)
  const { state, migratedFrom, isReset } = migrate(raw, now)
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
  let next = state
  for (const ev of events) {
    const text = describe(next, ev)
    if (text) next = appendLog(next, text, now)
  }
  const refused = events.find(ev => ev.kind === 'refused')
  await update($, notice, () => (refused && refused.kind === 'refused' ? refusalText(refused.reason) : null))
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
  const hit = state.fish.find((f, i) => {
    const l = fishLayout(f, i, n, W, renderedAt)
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
      {lines.length === 0 ? <Text dimColor>（空魚缸）</Text> : lines}
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
  const source = tankSvg(s, {
    isMotion: !s.settings.reduceMotion,
    showCoins: s.settings.showCoins,
    showBubbles: s.settings.showBubbles,
    selectedId: selected,
    now: d.now,
    width: W,
  })
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
          <Button key={`tap-${c}-${r}`} plain onPress={() => void tapTank($, X, Y, W, d.now)}>{TAP_LABEL}</Button>
        </Box>,
      )
    }
  }
  return (
    <Box flexDirection="column" width="100%">
      {Svg({ source, alt: `魚缸：${s.fish.map(f => f.name).join('、')}`, width: widthPx, height: heightPx })}
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
    <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      <Text color="yellow">🪙 {fmt(s.coins)}</Text>
      <Text dimColor={pending === 0}>{pending > 0 ? `缸底有 ${pending} 枚金幣，點它收取` : '魚還在累積能量'}</Text>
      <Text dimColor>點空水處撒飼料（🍤 {s.food}）</Text>
      {note && <Text color="yellow">{note}</Text>}
      {hungry > 0 && <Text color="yellow">❗ {hungry} 條魚餓了</Text>}
      {hungry > 0 && <Button key="band-feed" plain onPress={() => void commit($, (st, now) => feed(st, null, now))}>🍤 餵全部</Button>}
      <Button key="band-open" plain onPress={() => void $.ui.open({ id: PANE, title: 'Token Tank', focus: true })}>🐠 面板</Button>
      {last && <Text dimColor wrap="truncate-end">{last.text}</Text>}

    </Box>
  )
}

// ------------------------------------------------------------------ the pane

function paneHeader($: EngineInterface, d: Draw, current: View): RenderElement {
  const { Box, Text, Button } = d.el
  const s = d.state
  const go = (v: View) => () => void update($, view, () => v)
  const tab = (id: View, label: string) => (
    <Button key={`nav-${id}`} variant={current === id ? 'primary' : 'secondary'} onPress={go(id)}>{label}</Button>
  )
  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Text weight="bold" color="claude">🐠 水族箱</Text>
        <Text dimColor>Lv.{tankLevel(s)}</Text>
        <Text color="yellow">🪙 {fmt(s.coins)}</Text>
        <Text dimColor>🍤 {s.food}</Text>
        <Text dimColor>🐟 {s.fish.length}/{MAX_FISH}</Text>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {tab('shop', '🛒 商店')}
        {tab('fish', '🐟 魚')}
        {tab('settings', '⚙ 設定')}
      </Box>
    </Box>
  )
}

function shopView($: EngineInterface, d: Draw, tab: ShopTab): RenderElement {
  const { Box, Text, Button } = d.el
  const s = d.state
  const Svg = (d.el as { Svg?: (p: Record<string, unknown>) => RenderElement }).Svg
  const showArt = d.surface !== 'terminal' && Svg && d.columns >= 36
  const tabs: [ShopTab, string][] = [['fish', '魚種'], ['decor', '裝飾'], ['food', '飼料']]
  let body: RenderElement
  if (tab === 'fish') {
    body = (
      <Box flexDirection="column" gap={0}>
        {shopList(s).map(({ species, isUnlocked, canAfford }) => {
          const sp = SPECIES[species]
          return (
            <Box key={`shop-${species}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
              {!isUnlocked ? <Text dimColor weight="bold">？</Text> : showArt && Svg ? Svg({ source: fishPortraitSvg(species, 28), alt: sp.zh, width: 28, height: 21 }) : <Text>🐟</Text>}
              <Text dimColor={!isUnlocked}>{isUnlocked ? sp.zh : '？？？'}</Text>
              <Text color="yellow">🪙 {sp.price}</Text>
              {isUnlocked ? (
                <Button key={`buy-${species}`} variant={canAfford ? 'primary' : 'secondary'} dimColor={!canAfford} onPress={() => void commit($, (st, now) => buyFish(st, species, now, `${now}`))}>購買</Button>
              ) : (
                <Text dimColor>🔒 養到 {sp.unlockAt} 條</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  } else if (tab === 'decor') {
    const kinds = Object.keys(DECOR) as DecorId[]
    body = (
      <Box flexDirection="column" gap={0}>
        {kinds.map(kind => (
          <Box key={`shop-${kind}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            {showArt && Svg ? Svg({ source: decorPortraitSvg(kind, 28), alt: DECOR[kind].zh, width: 28, height: 28 }) : <Text>🪸</Text>}
            <Text>{DECOR[kind].zh}</Text>
            <Text color="yellow">🪙 {DECOR[kind].price}</Text>
            <Text dimColor>已放 {s.decorations.filter(x => x.kind === kind).length}</Text>
            <Button key={`buy-${kind}`} variant={s.coins >= DECOR[kind].price ? 'primary' : 'secondary'} dimColor={s.coins < DECOR[kind].price} onPress={() => void commit($, (st, now) => buyDecoration(st, kind, now, `${now}`))}>放入</Button>
          </Box>
        ))}
        <Text dimColor>裝飾 {s.decorations.length}/{MAX_DECOR}</Text>
      </Box>
    )
  } else {
    body = (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text>飼料 <Text color="yellow">🪙 {FOOD_PRICE}</Text><Text dimColor> / 份 · 庫存 {s.food}</Text></Text>
          <Button key="buy-food-1" onPress={() => void commit($, st => buyFood(st, 1))}>買 1 份</Button>
          <Button key="buy-food-10" variant="primary" onPress={() => void commit($, st => buyFood(st, 10))}>買 10 份</Button>
        </Box>
        <Text dimColor wrap="wrap">餵食：飽食度 +30、心情 +5。飽食度越高，吐的金幣越多。</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {tabs.map(([id, label]) => (
          <Button key={`tab-${id}`} variant={tab === id ? 'secondary' : undefined} plain={tab === id ? undefined : true} onPress={() => void update($, shopTab, () => id)}>{label}</Button>
        ))}
      </Box>
      {body}
    </Box>
  )
}

function fishView($: EngineInterface, d: Draw, selected: string | null, renaming: boolean): RenderElement {
  const { Box, Text, Button } = d.el
  const Input = (d.el as { Input?: (p: Record<string, unknown>) => RenderElement }).Input
  const s = d.state
  const barW = Math.max(40, Math.min(120, (d.columns - 24) * 6))
  if (s.fish.length === 0) return <Text dimColor>魚缸是空的，到商店買一條魚吧。</Text>
  return (
    <Box flexDirection="column" gap={0}>
      {s.fish.map(f => {
        const sp = SPECIES[f.species]
        const isOpen = f.id === selected
        const nextXp = XP_THRESHOLDS[f.level] ?? null
        const canLevel = nextXp !== null && f.xp >= nextXp && s.coins >= LEVEL_UP_COST(f.level)
        return (
          <Box key={`fish-${f.id}`} flexDirection="column" gap={0}>
            <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
              <Button key={`pick-${f.id}`} plain onPress={() => void update($, selectedId, cur => (cur === f.id ? null : f.id))}>{isOpen ? '▾' : '▸'} {f.name}</Button>
              <Text dimColor>{sp.zh} Lv.{f.level}</Text>
              <Text color={f.hunger < 25 ? 'yellow' : undefined}>🍽 {Math.round(f.hunger)}%</Text>
              <Text>🙂 {Math.round(f.mood)}%</Text>
              {f.pending > 0 && <Text color="yellow">🪙 {f.pending}</Text>}
            </Box>
            {isOpen && (
              <Box flexDirection="column" gap={0} paddingLeft={2}>
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor>XP</Text>
                  {bar(d, nextXp === null ? 1 : (f.xp - (XP_THRESHOLDS[f.level - 1] ?? 0)) / Math.max(1, nextXp - (XP_THRESHOLDS[f.level - 1] ?? 0)), '#4cc9f0', barW)}
                  <Text dimColor>{nextXp === null ? 'MAX' : `${fmt(f.xp)}/${fmt(nextXp)}`}</Text>
                </Box>
                <Text dimColor wrap="wrap">產幣 ×{(sp.rate * (1 + 0.15 * (f.level - 1))).toFixed(2)} · 缸底 {f.pending}/{PENDING_CAP}</Text>
                <Text color="pink" wrap="wrap">❤ {moodLine(s, f.id)}</Text>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  <Button key={`feed-${f.id}`} onPress={() => void commit($, (st, now) => feed(st, f.id, now))}>🍤 餵食</Button>
                  <Button key={`level-${f.id}`} variant={canLevel ? 'primary' : 'secondary'} dimColor={!canLevel} onPress={() => void commit($, (st, now) => levelUp(st, f.id, now))}>⬆ 升級{nextXp === null ? '' : ` ${LEVEL_UP_COST(f.level)}🪙`}</Button>
                  <Button key={`rename-${f.id}`} onPress={() => void update($, isRenaming, v => !v)}>✏️ 改名</Button>
                </Box>
                {renaming && Input && (
                  <Box flexDirection="column">
                    {Input({
                      key: `name-${f.id}`,
                      placeholder: '新名字，Enter 確定（最多 12 字）',
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
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="feed-all" onPress={() => void commit($, (st, now) => feed(st, null, now))}>🍤 餵全部</Button>
      </Box>
    </Box>
  )
}

function settingsView($: EngineInterface, d: Draw): RenderElement {
  const { Box, Text, Button } = d.el
  const s = d.state
  const st = s.stats
  const set = (patch: Partial<GameState['settings']>) =>
    void commit($, (state, now) => ({ state: { ...state, settings: { ...state.settings, ...patch }, revision: state.revision + 1, updatedAt: now }, events: [] }))
  const toggle = (key: 'showCoins' | 'showBubbles' | 'reduceMotion' | 'showBand', label: string) => (
    <Box key={`set-${key}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
      <Button key={`toggle-${key}`} variant={s.settings[key] ? 'primary' : 'secondary'} onPress={() => set({ [key]: !s.settings[key] })}>{s.settings[key] ? '開' : '關'}</Button>
      <Text>{label}</Text>
    </Box>
  )
  const themes: [GameState['settings']['theme'], string][] = [['ocean', '經典海洋'], ['wreck', '沉船遺跡'], ['reef', '珊瑚花園'], ['abyss', '夜光深海']]
  return (
    <Box flexDirection="column" gap={0}>
      <Text dimColor>主題</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {themes.map(([id, label]) => (
          <Button key={`theme-${id}`} variant={s.settings.theme === id ? 'primary' : 'secondary'} onPress={() => set({ theme: id })}>{label}</Button>
        ))}
      </Box>
      <Text dimColor>魚缸高度</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {(['s', 'm', 'l'] as const).map(size => (
          <Button key={`size-${size}`} variant={s.settings.tankSize === size ? 'primary' : 'secondary'} onPress={() => set({ tankSize: size })}>{size === 's' ? '矮' : size === 'm' ? '中' : '高'}</Button>
        ))}
      </Box>
      {toggle('showBand', '長任務時在輸入框上方出現魚缸')}
      {toggle('showCoins', '顯示缸底金幣')}
      {toggle('showBubbles', '泡泡效果')}
      {toggle('reduceMotion', '簡化動畫（低效能模式）')}
      <Text dimColor wrap="wrap">點魚缸的空水處撒飼料，餓的魚會衝過去吃；點魚牠會逃開。/fish 顯示或收起魚缸；/fish collect 收全部金幣；/fish feed 餵全部。</Text>
      <Text weight="bold">📊 統計</Text>
      <Text wrap="wrap">今日 Token {fmt(st.todayEffectiveTokens)} · 產幣 {fmt(st.todayCoinsMinted)} · 收集 {fmt(st.todayCoinsCollected)} · 回合 {fmt(st.todayTurns)}</Text>
      <Text dimColor wrap="wrap">累計 Token {fmt(st.totalEffectiveTokens)} · 產幣 {fmt(st.totalCoinsMinted)} · 收集 {fmt(st.totalCoinsCollected)}</Text>
      <Text dimColor wrap="wrap">測試通過 {fmt(st.testsPassed)} · Commit {fmt(st.commits)} · 修改 {fmt(st.edits)} · 餵食 {fmt(st.feeds)} · 魚冊 {s.dex.length}/{SPECIES_LIST.length}</Text>
      {s.log.length > 0 && <Text weight="bold">📜 紀錄</Text>}
      {s.log.slice(-5).reverse().map((e, i) => (
        <Box key={`log-${i}`} flexDirection="row" gap={1}>
          <Text dimColor>{clock(e.at)}</Text>
          <Text wrap="truncate-end">{e.text}</Text>
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fish', description: '顯示或收起代幣魚缸；/fish panel 開面板、/fish collect 收金幣、/fish feed 餵魚' })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'fish' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (arg === 'collect') {
      const events = await commit($, (st, now) => collect(st, null, now))
      const got = events.find(ev => ev.kind === 'collected')
      return { text: got && got.kind === 'collected' ? `收了 ${got.coins} 枚金幣。` : '沒有金幣可以收。' }
    }
    if (arg === 'feed') {
      await commit($, (st, now) => feed(st, null, now))
      return { text: '餵過了。' }
    }
    if (arg === 'panel' || arg === 'shop') {
      await $.ui.open({ id: PANE, title: 'Token Tank', focus: true })
      return { text: '面板打開了。' }
    }
    const shown = await update($, isPinned, was => !was)
    await $.ui.invalidate('ui.render')
    return { text: shown ? '魚缸顯示在輸入框上方。再打一次 /fish 收起。' : '魚缸收起了（長任務時會自己出現）。' }
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
    const events = await commit($, (st, now) => applyTurn(st, { turnId: e.turnId, usage, now }))
    const minted = events.filter(ev => ev.kind === 'minted').reduce((n, ev) => n + (ev.kind === 'minted' ? ev.coins : 0), 0)
    const now = await $.clock.now()
    if (effective > 0 && minted === 0 && !events.some(ev => ev.kind === 'refused')) {
      await update($, game, st => (st ? appendLog(st, `Claude 用了 ${fmt(effective)} 有效 Token，魚還在累積能量。`, now) : st))
    } else if (minted > 0) {
      await update($, game, st => (st ? appendLog(st, `Claude 用了 ${fmt(effective)} 有效 Token，魚吐出了 ${minted} 枚金幣！`, now) : st))
    }
    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    const command = e.tool === 'Bash' ? (e as { command?: string }).command : undefined
    const kind = rewardFor(e.tool, command, Boolean((ran as { isError?: boolean }).isError) || 'deny' in ran)
    if (kind) await commit($, (st, now) => reward(st, { kind, now }))
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
    const d: Draw = { el, surface: e.surface, columns, maxRows: e.props.maxRows ?? 0, state, now }
    // The tank sits above whatever the plugins beneath draw (pillbar hugs the prompt).
    const below = await next(e)
    return (
      <Box flexDirection="column">
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
          <Text dimColor>水族箱載入中……</Text>
        </Box>
      )
    }
    const columns = e.props.bodyColumns || e.viewport?.columns || 60
    const d: Draw = { el, surface: e.surface, columns, maxRows: 0, state, now }
    return (
      <Box flexDirection="column" gap={0} paddingX={1}>
        {paneHeader($, d, current)}
        {note && <Text color="yellow" wrap="wrap">{note}</Text>}
        {current === 'shop' ? shopView($, d, tab) : current === 'fish' ? fishView($, d, selected, renaming) : settingsView($, d)}
      </Box>
    )
  })
}
