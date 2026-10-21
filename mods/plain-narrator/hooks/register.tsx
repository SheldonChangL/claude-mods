import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diag, Narration } from '../types'

const PANE = 'plain-narrator'
const narrations = atom({ plugin: 'plain-narrator', key: 'narrations' } as const, [])
const isThinking = atom({ plugin: 'plain-narrator', key: 'isThinking' } as const, false)
const EMPTY_DIAG: Diag = { steps: 0, thinkingChars: 0, textChars: 0, asks: 0, last: '尚未呼叫' }
const diag = atom({ plugin: 'plain-narrator', key: 'diag' } as const, EMPTY_DIAG)

// 最多每幾毫秒問一次 Haiku，避免思考串流時狂打 API
const MIN_GAP_MS = 7000
const BUFFER_CHARS = 4000

const SYSTEM = [
  '你是旁白員。使用者在旁邊看一個 AI 程式助手（Claude）工作，看不懂它的內部思考。',
  '你會收到 Claude 最近寫出的文字（思考片段若有也會附上），以及它準備使用的工具與參數（例如要跑的指令、要讀的檔案）。',
  '從工具參數推斷它的意圖，例如「在找某個設定檔」「在跑測試確認有沒有壞掉」，不要只說它要用某個工具。',
  '請用繁體中文、白話、像對非工程師朋友說明的口吻，用 1～3 句話說明：',
  'Claude 現在正在想什麼、打算做什麼、為什麼。',
  '不要逐字複述，不要用條列，不要加開場白，不要猜測沒出現的內容。',
].join('\n')

// 模組層變數：reload 時重來即可
let buffer = ''
let unsent = false
let lastAskAt = 0
let inFlight = false
let nextId = 1

const clip = (s: string, n: number) => (s.length > n ? s.slice(-n) : s)

// 工具參數裡最能說明意圖的欄位，依序取有值的
const ARG_KEYS = ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'skill', 'action']

function describeTool(name: string, json: string): string {
  let args: unknown
  try {
    args = JSON.parse(json)
  } catch {
    return `[準備使用工具：${name}]`
  }
  if (args === null || typeof args !== 'object') return `[準備使用工具：${name}]`
  const parts: string[] = []
  for (const key of ARG_KEYS) {
    const v = (args as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim() !== '') parts.push(`${key}=${v.trim().slice(0, 300)}`)
  }

  return parts.length === 0 ? `[準備使用工具：${name}]` : `[準備使用工具：${name}｜${parts.join('｜')}]`
}

async function ask($: EngineInterface) {
  if (inFlight || !unsent || buffer.trim() === '') return
  inFlight = true
  unsent = false
  lastAskAt = Date.now()
  const snapshot = buffer
  await update($, diag, d => ({ ...d, asks: d.asks + 1, last: '詢問中…' }))
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: `以下是 Claude 最近的內部活動：\n\n<activity>\n${snapshot}\n</activity>\n\n請用白話說明它現在在做什麼。`,
      maxTokens: 300,
      effort: 'low',
      timeoutMs: 20000,
    })
    if (r.isAnswered && r.text.trim() !== '') {
      const d = new Date()
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      const item: Narration = { id: nextId++, text: r.text.trim(), time }
      await update($, narrations, list => [...list, item].slice(-30))
      await update($, diag, d => ({ ...d, last: '成功' }))
    } else {
      const why = r.isAnswered ? 'Haiku 回了空字串' : r.reason === 'api-error' ? `api-error ${r.status ?? ''}` : r.reason
      await update($, diag, d => ({ ...d, last: `失敗：${why}` }))
    }
  } catch (err) {
    await update($, diag, d => ({ ...d, last: `例外：${String(err)}` }))
  } finally {
    inFlight = false
  }
  // 問的期間又有新內容且已過節流時間，就再補一次
  if (unsent && Date.now() - lastAskAt >= MIN_GAP_MS) void ask($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'narrator',
      description: '打開「Claude 在做什麼」面板',
    })
    void $.ui.open({ id: PANE, title: 'Claude 在做什麼' })

    return next(e)
  })

  on('command.run', { command: 'narrator' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude 在做什麼' })

    return { text: '「Claude 在做什麼」面板已開啟。' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      buffer = ''
      unsent = false
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // 只旁白主對話；subagent 與其他 step 原樣放行
    if (e.agentId !== undefined) return yield* next(e)

    let sawThinking = false
    let thinkingChars = 0
    let textChars = 0
    const tools = new Map<number, { name: string; json: string }>()
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking' && chunk.text !== '') {
        if (!sawThinking) {
          sawThinking = true
          void update($, isThinking, () => true)
        }
        thinkingChars += chunk.text.length
        buffer = clip(buffer + chunk.text, BUFFER_CHARS)
        unsent = true
        if (Date.now() - lastAskAt >= MIN_GAP_MS) void ask($)
      } else if (chunk.kind === 'text' && chunk.text !== '') {
        // 思考內容拿不到時（例如被省略），改用 Claude 寫出來的文字旁白
        textChars += chunk.text.length
        buffer = clip(buffer + chunk.text, BUFFER_CHARS)
        unsent = true
        if (Date.now() - lastAskAt >= MIN_GAP_MS) void ask($)
      } else if (chunk.kind === 'tool') {
        tools.set(chunk.index, { name: chunk.name, json: '' })
      } else if (chunk.kind === 'input') {
        const t = tools.get(chunk.index)
        if (t) t.json += chunk.json
      } else if (chunk.kind === 'stop' && tools.size > 0) {
        // 參數要等整段 JSON 收完才解析得了，所以在回應結束時一次寫入
        for (const t of tools.values()) buffer = clip(`${buffer}\n${describeTool(t.name, t.json)}\n`, BUFFER_CHARS)
        unsent = true
        if (Date.now() - lastAskAt >= MIN_GAP_MS) void ask($)
      }
      yield chunk
    }
    void update($, diag, d => ({
      ...d,
      steps: d.steps + 1,
      thinkingChars: d.thinkingChars + thinkingChars,
      textChars: d.textChars + textChars,
    }))
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isThinking, () => false)
      void ask($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, narrations)
    const thinking = await read($, isThinking)
    const d = await read($, diag)
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 5) / 3))
    const shown = list.slice(-room).reverse()

    return (
      <Box flexDirection="column" gap={1}>
        {/* 固定節點：只換文字，避免 terminal pane 因結構改變而失去鍵盤 */}
        <Box flexDirection="row" gap={2}>
          <Button
            key="narrator-clear"
            dimColor
            onPress={() => {
              void update($, narrations, () => [])
              void update($, diag, () => EMPTY_DIAG)
            }}
          >
            清除
          </Button>
          <Text dimColor>{thinking ? 'Claude 思考中…' : ' '}</Text>
        </Box>
        {shown.length === 0 && <Text dimColor>Claude 開始思考後，這裡會用白話說明它在做什麼。</Text>}
        {shown.map((n, i) => (
          <Box key={String(n.id)} flexDirection="column">
            <Text dimColor>{n.time}</Text>
            <Text dimColor={i > 0}>{n.text}</Text>
          </Box>
        ))}
        <Text dimColor>
          診斷：step {d.steps}・思考 {d.thinkingChars} 字・文字 {d.textChars} 字・詢問 {d.asks} 次・{d.last}
        </Text>
      </Box>
    )
  })
}
