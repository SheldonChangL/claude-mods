// The record of what merge-desk integrated, and the few lines the model is
// told about it, so it never has to rescan git to find out.

export type Entry = { branch: string; base: string; sha: string; at: number; pushed: boolean }
export type Ledger = Record<string, Entry[]>

const KEEP = 10
const FRESH_MS = 14 * 24 * 3600_000

export const record = (ledger: Ledger, dir: string, entry: Entry): Ledger => ({
  ...ledger,
  [dir]: [entry, ...(ledger[dir] ?? []).filter(e => e.branch !== entry.branch)].slice(0, KEEP),
})

export const markPushed = (ledger: Ledger, dir: string): Ledger => ({
  ...ledger,
  [dir]: (ledger[dir] ?? []).map(e => ({ ...e, pushed: true })),
})

const day = (at: number) => {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const line = (e: Entry) =>
  `${e.branch} → ${e.base} ${e.sha} ${day(e.at)}${e.pushed ? ' 已推送' : ' 未推送'}`

// For the first message of a conversation: recent merges and what still waits.
export const contextText = (entries: Entry[], pending: string[], now: number) => {
  const recent = entries.filter(e => now - e.at < FRESH_MS).slice(0, 5)
  if (recent.length === 0 && pending.length === 0) return null
  const out = ['merge-desk（使用者在面板上手動整合分支；以下已完成，不必再用 git 檢查）']
  for (const e of recent) out.push(`- 已併入：${line(e)}`)
  if (pending.length > 0) out.push(`- 尚未併入：${pending.slice(0, 5).join(', ')}${pending.length > 5 ? ' …' : ''}`)
  return out.join('\n')
}

// For a later prompt in the same conversation: only what happened since.
export const newsText = (entries: Entry[]) =>
  entries.length === 0
    ? null
    : `merge-desk：使用者剛在面板上完成 ${entries.map(line).join('；')}。不必再檢查。`
