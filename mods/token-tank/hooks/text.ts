// Every word the person reads, in Traditional Chinese and English. The
// language follows Claude's (the `language` setting, else the shell's LANG):
// Chinese stays Chinese, anything else is English; the settings can pin one.
import type { DecorId, GameEvent, GameState, RewardKind, Species } from '../game/types'
import { DECOR, SPECIES } from '../game/species'

export type Lang = 'zh' | 'en'

type Pair = { zh: string; en: string }

export const S = {
  title: { zh: '🐠 水族箱', en: '🐠 Token Tank' },
  loading: { zh: '水族箱載入中……', en: 'Loading the tank…' },
  emptyTank: { zh: '（空魚缸）', en: '(an empty tank)' },
  tankAlt: { zh: '魚缸：', en: 'Tank: ' },
  accumulating: { zh: '魚還在累積能量', en: 'The fish are gathering energy' },
  coinsOnFloor: { zh: '缸底有 {n} 枚金幣，點它收取', en: '{n} coins lie on the sand, tap them to collect' },
  tapToFeed: { zh: '點空水處撒飼料（🍤 {n}）', en: 'Tap open water to drop food (🍤 {n})' },
  hungryCount: { zh: '❗ {n} 條魚餓了', en: '❗ {n} fish are hungry' },
  feedAll: { zh: '🍤 餵全部', en: '🍤 Feed all' },
  panel: { zh: '🐠 面板', en: '🐠 Panel' },
  tabShop: { zh: '🛒 商店', en: '🛒 Shop' },
  tabFish: { zh: '🐟 魚', en: '🐟 Fish' },
  tabSettings: { zh: '⚙ 設定', en: '⚙ Settings' },
  shopFish: { zh: '魚種', en: 'Fish' },
  shopDecor: { zh: '裝飾', en: 'Decor' },
  shopFood: { zh: '飼料', en: 'Food' },
  buy: { zh: '購買', en: 'Buy' },
  place: { zh: '放入', en: 'Place' },
  lockedAt: { zh: '🔒 {n} 條魚', en: '🔒 {n} fish' },
  moreLocked: { zh: '還有 {n} 種魚未解鎖，養更多魚就會出現。', en: '{n} more species are locked; keep more fish and they appear.' },
  mystery: { zh: '？？？', en: '???' },
  rarity0: { zh: '普通', en: 'Common' },
  rarity1: { zh: '稀有', en: 'Rare' },
  rarity2: { zh: '史詩', en: 'Epic' },
  rarity3: { zh: '傳說', en: 'Legendary' },
  rateShort: { zh: '產幣 {r}×', en: 'coins {r}×' },
  notEnough: { zh: '金幣不足', en: 'Not enough coins' },
  owned: { zh: '已放 {n} 個', en: '{n} placed' },
  foodStock: { zh: '庫存 {n} 份', en: '{n} in stock' },
  placed: { zh: '已放 {n}', en: '{n} placed' },
  decorCount: { zh: '裝飾 {n}/{max}', en: 'Decorations {n}/{max}' },
  foodLine: { zh: ' / 份 · 庫存 {n}', en: ' each · {n} in stock' },
  foodWord: { zh: '飼料', en: 'Food' },
  buyFood1: { zh: '買 1 份', en: 'Buy 1' },
  buyFood10: { zh: '買 10 份', en: 'Buy 10' },
  foodHelp: { zh: '餵食：飽食度 +30、心情 +5。飽食度越高，吐的金幣越多。', en: 'Feeding: hunger +30, mood +5. A fuller fish spits more coins.' },
  noFishYet: { zh: '魚缸是空的，到商店買一條魚吧。', en: 'The tank is empty. Buy a fish in the shop.' },
  rateLine: { zh: '產幣 ×{rate} · 缸底 {pending}/{cap}', en: 'coin rate ×{rate} · on the sand {pending}/{cap}' },
  feed: { zh: '🍤 餵食', en: '🍤 Feed' },
  nextCoin: { zh: '下一枚 {p}%', en: 'next coin {p}%' },
  allFull: { zh: '魚都吃飽了（🍤 {n}）', en: 'The fish are all full (🍤 {n})' },
  levelUp: { zh: '⬆ 升級', en: '⬆ Level up' },
  rename: { zh: '✏️ 改名', en: '✏️ Rename' },
  renamePlaceholder: { zh: '新名字，Enter 確定（最多 12 字）', en: 'New name, Enter to confirm (12 characters max)' },
  on: { zh: '開', en: 'On' },
  off: { zh: '關', en: 'Off' },
  theme: { zh: '主題', en: 'Theme' },
  themeOcean: { zh: '經典海洋', en: 'Classic ocean' },
  themeWreck: { zh: '沉船遺跡', en: 'Shipwreck' },
  themeReef: { zh: '珊瑚花園', en: 'Coral garden' },
  themeAbyss: { zh: '夜光深海', en: 'Glowing abyss' },
  tankHeight: { zh: '魚缸高度', en: 'Tank height' },
  sizeS: { zh: '矮', en: 'Short' },
  sizeM: { zh: '中', en: 'Medium' },
  sizeL: { zh: '高', en: 'Tall' },
  language: { zh: '語言', en: 'Language' },
  langAuto: { zh: '跟著 Claude', en: 'Follow Claude' },
  langZh: { zh: '中文', en: '中文' },
  langEn: { zh: 'English', en: 'English' },
  setBand: { zh: '長任務時在輸入框上方出現魚缸', en: 'Show the tank above the prompt during long turns' },
  setCoins: { zh: '顯示缸底金幣', en: 'Show coins on the sand' },
  setBubbles: { zh: '泡泡效果', en: 'Bubbles' },
  setMotion: { zh: '簡化動畫（低效能模式）', en: 'Reduced motion (low-power mode)' },
  help: { zh: '點魚缸的空水處撒飼料，餓的魚會衝過去吃；點魚牠會逃開。/fish 顯示或收起魚缸；/fish collect 收全部金幣；/fish feed 餵全部。', en: 'Tap open water to drop food and the hungry fish rush to it; tap a fish and it darts off. /fish shows or hides the tank; /fish collect takes every coin; /fish feed feeds every fish.' },
  stats: { zh: '📊 統計', en: '📊 Stats' },
  statsToday: { zh: '今日 Token {t} · 產幣 {m} · 收集 {c} · 回合 {r}', en: 'Today: tokens {t} · minted {m} · collected {c} · turns {r}' },
  statsTotal: { zh: '累計 Token {t} · 產幣 {m} · 收集 {c}', en: 'All time: tokens {t} · minted {m} · collected {c}' },
  statsMore: { zh: '測試通過 {tests} · Commit {commits} · 修改 {edits} · 餵食 {feeds} · 魚冊 {dex}/{all}', en: 'Tests passed {tests} · commits {commits} · edits {edits} · feeds {feeds} · species {dex}/{all}' },
  log: { zh: '📜 紀錄', en: '📜 Log' },
  cmdDescription: { zh: '顯示或收起代幣魚缸；/fish panel 開面板、/fish collect 收金幣、/fish feed 餵魚', en: 'Show or hide the Token Tank; /fish panel opens the panel, /fish collect takes the coins, /fish feed feeds the fish' },
  cmdCollected: { zh: '收了 {n} 枚金幣。', en: 'Collected {n} coins.' },
  cmdNothing: { zh: '沒有金幣可以收。', en: 'No coins to collect.' },
  cmdFed: { zh: '餵過了。', en: 'Fed.' },
  cmdPanel: { zh: '面板打開了。', en: 'Panel opened.' },
  cmdShown: { zh: '魚缸顯示在輸入框上方。再打一次 /fish 收起。', en: 'The tank is above the prompt. /fish again hides it.' },
  cmdHidden: { zh: '魚缸收起了（長任務時會自己出現）。', en: 'The tank is hidden (it shows by itself during long turns).' },
  turnNoCoins: { zh: 'Claude 用了 {t} 有效 Token，魚還在累積能量。', en: 'Claude used {t} effective tokens; the fish are gathering energy.' },
  turnCoins: { zh: 'Claude 用了 {t} 有效 Token，魚吐出了 {n} 枚金幣！', en: 'Claude used {t} effective tokens and the fish spat {n} coins!' },
  aFish: { zh: '魚', en: 'a fish' },
  allFish: { zh: '全部的魚', en: 'all the fish' },
  decorWord: { zh: '裝飾', en: 'a decoration' },
} satisfies Record<string, Pair>

export type Key = keyof typeof S

/** The words for `key`, with `{name}` fields filled from `vars`. */
export function tr(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let out: string = S[key][lang]
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  return out
}

export const speciesName = (sp: Species, lang: Lang) => (lang === 'zh' ? sp.zh : sp.en)
export const decorName = (kind: DecorId, lang: Lang) => (lang === 'zh' ? DECOR[kind].zh : DECOR[kind].en)

const fishName = (state: GameState, id: string | null, lang: Lang) =>
  id ? state.fish.find(f => f.id === id)?.name ?? tr(lang, 'aFish') : tr(lang, 'allFish')

export function describe(state: GameState, e: GameEvent, lang: Lang): string | null {
  const zh = lang === 'zh'
  switch (e.kind) {
    case 'minted':
      return zh ? `${fishName(state, e.fishId, lang)}吐出了 ${e.coins} 枚金幣！` : `${fishName(state, e.fishId, lang)} spat ${e.coins} coins!`
    case 'collected':
      return zh ? `你收集了 ${e.coins} 枚金幣。` : `You collected ${e.coins} coins.`
    case 'dropped': {
      const names = e.eaters.map(id => fishName(state, id, lang)).join(zh ? '、' : ', ')
      if (e.eaters.length === 0) return zh ? '你撒了飼料，但沒有魚餓到想吃。' : 'You dropped food, but no fish was hungry enough.'
      return zh ? `你撒了飼料，${names}衝過去吃了。` : `You dropped food and ${names} rushed to it.`
    }
    case 'startled':
      return null
    case 'fed':
      if (e.fishId) return zh ? `你餵了${fishName(state, e.fishId, lang)}。` : `You fed ${fishName(state, e.fishId, lang)}.`
      return zh ? `你餵了 ${e.count} 條魚。` : `You fed ${e.count} fish.`
    case 'bought': {
      if (e.what === 'fish') {
        const sp = SPECIES[e.id as keyof typeof SPECIES]
        const name = sp ? speciesName(sp, lang) : e.id
        return zh ? `你買了一條${name}，花了 ${e.price} 金幣。` : `You bought a ${name} for ${e.price} coins.`
      }
      if (e.what === 'decor') {
        const kind = (e.id in DECOR ? e.id : state.decorations.find(d => d.id === e.id)?.kind) as DecorId | undefined
        const name = kind ? decorName(kind, lang) : tr(lang, 'decorWord')
        return zh ? `你放了${name}進魚缸，花了 ${e.price} 金幣。` : `You placed ${name} in the tank for ${e.price} coins.`
      }
      return zh ? `你買了飼料，花了 ${e.price} 金幣。` : `You bought food for ${e.price} coins.`
    }
    case 'levelUp':
      return zh ? `${fishName(state, e.fishId, lang)}升到 Lv.${e.level}！` : `${fishName(state, e.fishId, lang)} reached Lv.${e.level}!`
    case 'renamed':
      return zh ? `魚改名為「${e.name}」。` : `A fish is now called “${e.name}”.`
    case 'reward':
      return REWARD_TEXT[e.reward][lang](e.coins)
    case 'hungry':
      return zh ? `${fishName(state, e.fishId, lang)}餓了，游得慢了。` : `${fishName(state, e.fishId, lang)} is hungry and swims slowly.`
    case 'refused':
      return null
  }
}

const REWARD_TEXT: Record<RewardKind, Record<Lang, (coins: number) => string>> = {
  edit: { zh: coins => `Claude 改好了程式，魚缸多了 ${coins} 枚金幣。`, en: coins => `Claude edited the code: ${coins} coins for the tank.` },
  test: { zh: coins => `測試通過！魚心情上升，魚缸多了 ${coins} 枚金幣。`, en: coins => `Tests passed! The fish cheer up and the tank earns ${coins} coins.` },
  commit: { zh: coins => `Git commit 完成，魚缸多了 ${coins} 枚金幣。`, en: coins => `Git commit made: ${coins} coins for the tank.` },
}

const REFUSALS: Record<string, Pair> = {
  'duplicate-turn': { zh: '這個回合已經算過了。', en: 'This turn was already counted.' },
  'no-food': { zh: '沒有飼料了，到商店買一些。', en: 'No food left; buy some in the shop.' },
  'nothing-to-collect': { zh: '現在沒有金幣可以收。', en: 'No coins to collect right now.' },
  'not-enough-coins': { zh: '金幣不夠。', en: 'Not enough coins.' },
  'tank-full': { zh: '魚缸滿了（最多 10 條魚）。', en: 'The tank is full (10 fish at most).' },
  'decor-full': { zh: '裝飾太多了（最多 8 個）。', en: 'Too many decorations (8 at most).' },
  'locked': { zh: '這種魚還沒解鎖，養更多魚就會開放。', en: 'This species is locked; keep more fish to unlock it.' },
  'max-level': { zh: '已經是最高等級了。', en: 'Already at the top level.' },
  'not-enough-xp': { zh: '經驗值還不夠升級。', en: 'Not enough XP to level up.' },
  'no-such-fish': { zh: '找不到這條魚。', en: 'No such fish.' },
  'bad-name': { zh: '名字要 1 到 12 個字。', en: 'A name is 1 to 12 characters.' },
  'cooldown': { zh: '獎勵冷卻中。', en: 'The reward is cooling down.' },
  'no-fish': { zh: '魚缸裡沒有魚。', en: 'There are no fish in the tank.' },
  'empty-name': { zh: '名字不能是空的（最多 12 個字）。', en: 'The name cannot be empty (12 characters max).' },
  'unknown-species': { zh: '沒有這種魚。', en: 'No such species.' },
  'unknown-decor': { zh: '沒有這種裝飾。', en: 'No such decoration.' },
  'unknown-reward': { zh: '沒有這種獎勵。', en: 'No such reward.' },
  'bad-count': { zh: '數量不對。', en: 'Bad count.' },
  'all-full': { zh: '魚都吃飽了，飼料留著。', en: 'The fish are all full; the food is kept.' },
}

export function refusalText(reason: string, lang: Lang): string {
  return REFUSALS[reason]?.[lang] ?? (lang === 'zh' ? `做不到：${reason}` : `Cannot: ${reason}`)
}

export function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function moodLine(state: GameState, fishId: string, lang: Lang): string {
  const f = state.fish.find(x => x.id === fishId)
  if (!f) return ''
  const zh = lang === 'zh'
  if (f.hunger < 25) return zh ? '肚子好餓，游不太動……餵我一點吧。' : 'So hungry I can hardly swim… feed me a little.'
  if (f.state === 'happy') return zh ? '今天很有精神！剛剛因為測試通過特別開心。' : 'Full of energy today! The tests passing made me happy.'
  if (f.state === 'spitCoin') return zh ? '剛剛吐出了金幣，記得收走喔。' : 'I just spat a coin; remember to pick it up.'
  if (f.mood >= 85) return zh ? '心情超好，游來游去停不下來。' : 'In a great mood, swimming all over the place.'
  if (f.mood >= 60) return zh ? '心情不錯，正在悠哉地巡視魚缸。' : 'Feeling fine, patrolling the tank at leisure.'
  return zh ? '有點無聊，Claude 多做點事吧。' : 'A bit bored; Claude, do some more work.'
}

/** Claude's language: Chinese when the `language` setting or LANG says so, else English. */
export function langOf(setting: string | undefined, envLang: string | undefined): Lang {
  const s = (setting ?? '').toLowerCase()
  if (/中文|chinese|^zh|zh[-_]/.test(s)) return 'zh'
  if (s.trim() !== '') return 'en'
  return /^zh/i.test(envLang ?? '') ? 'zh' : 'en'
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
