// Words for the log and the pane. Traditional Chinese, as the person reads.
import type { GameEvent, GameState, RewardKind } from '../game/types'
import { DECOR, SPECIES } from '../game/species'

const fishName = (state: GameState, id: string | null) => (id ? state.fish.find(f => f.id === id)?.name ?? '魚' : '全部的魚')

export function describe(state: GameState, e: GameEvent, effective?: number): string | null {
  switch (e.kind) {
    case 'minted':
      return `${fishName(state, e.fishId)}吐出了 ${e.coins} 枚金幣！`
    case 'collected':
      return `你收集了 ${e.coins} 枚金幣。`
    case 'dropped':
      return e.eaters.length > 0 ? `你撒了飼料，${e.eaters.map(id => fishName(state, id)).join('、')}衝過去吃了。` : '你撒了飼料，但沒有魚餓到想吃。'
    case 'startled':
      return null
    case 'fed':
      return e.fishId ? `你餵了${fishName(state, e.fishId)}。` : `你餵了 ${e.count} 條魚。`
    case 'bought':
      if (e.what === 'fish') return `你買了一條${SPECIES[e.id as keyof typeof SPECIES]?.zh ?? e.id}，花了 ${e.price} 金幣。`
      if (e.what === 'decor') {
        const kind = (e.id in DECOR ? e.id : state.decorations.find(d => d.id === e.id)?.kind) as keyof typeof DECOR | undefined
        return `你放了${kind ? DECOR[kind].zh : '裝飾'}進魚缸，花了 ${e.price} 金幣。`
      }
      return `你買了飼料，花了 ${e.price} 金幣。`
    case 'levelUp':
      return `${fishName(state, e.fishId)}升到 Lv.${e.level}！`
    case 'renamed':
      return `魚改名為「${e.name}」。`
    case 'reward':
      return REWARD_TEXT[e.reward](e.coins)
    case 'hungry':
      return `${fishName(state, e.fishId)}餓了，游得慢了。`
    case 'refused':
      return null
  }
}

const REWARD_TEXT: Record<RewardKind, (coins: number) => string> = {
  edit: coins => `Claude 改好了程式，魚缸多了 ${coins} 枚金幣。`,
  test: coins => `測試通過！魚心情上升，魚缸多了 ${coins} 枚金幣。`,
  commit: coins => `Git commit 完成，魚缸多了 ${coins} 枚金幣。`,
}

export const REFUSALS: Record<string, string> = {
  'duplicate-turn': '這個回合已經算過了。',
  'no-food': '沒有飼料了，到商店買一些。',
  'nothing-to-collect': '現在沒有金幣可以收。',
  'not-enough-coins': '金幣不夠。',
  'tank-full': '魚缸滿了（最多 10 條魚）。',
  'decor-full': '裝飾太多了（最多 8 個）。',
  'locked': '這種魚還沒解鎖，養更多魚就會開放。',
  'max-level': '已經是最高等級了。',
  'not-enough-xp': '經驗值還不夠升級。',
  'no-such-fish': '找不到這條魚。',
  'bad-name': '名字要 1 到 12 個字。',
  'cooldown': '獎勵冷卻中。',
  'no-fish': '魚缸裡沒有魚。',
  'empty-name': '名字不能是空的（最多 12 個字）。',
  'unknown-species': '沒有這種魚。',
  'unknown-decor': '沒有這種裝飾。',
  'unknown-reward': '沒有這種獎勵。',
  'bad-count': '數量不對。',
}

export function refusalText(reason: string): string {
  return REFUSALS[reason] ?? `做不到：${reason}`
}

export function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function moodLine(state: GameState, fishId: string): string {
  const f = state.fish.find(x => x.id === fishId)
  if (!f) return ''
  if (f.hunger < 25) return '肚子好餓，游不太動……餵我一點吧。'
  if (f.state === 'happy') return '今天很有精神！剛剛因為測試通過特別開心。'
  if (f.state === 'spitCoin') return '剛剛吐出了金幣，記得收走喔。'
  if (f.mood >= 85) return '心情超好，游來游去停不下來。'
  if (f.mood >= 60) return '心情不錯，正在悠哉地巡視魚缸。'
  return '有點無聊，Claude 多做點事吧。'
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
