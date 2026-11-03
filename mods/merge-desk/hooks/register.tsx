import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Picked, Snapshot } from '../types'
import * as git from '../lib/git'
import type { Run, Step } from '../lib/git'
import { contextText, markPushed, newsText, record } from '../lib/ledger'
import type { Ledger } from '../lib/ledger'

const PANE = 'merge-desk'
const TITLE = 'Merge'
const LEDGER = 'ledger'

const snapA = atom({ plugin: 'merge-desk', key: 'snap' } as const, null)
const problemA = atom({ plugin: 'merge-desk', key: 'problem' } as const, null)
const pickedA = atom({ plugin: 'merge-desk', key: 'picked' } as const, null)
const previewA = atom({ plugin: 'merge-desk', key: 'preview' } as const, null)
const mergedA = atom({ plugin: 'merge-desk', key: 'merged' } as const, null)
const busyA = atom({ plugin: 'merge-desk', key: 'busy' } as const, null)
const noteA = atom({ plugin: 'merge-desk', key: 'note' } as const, null)
const toldA = atom({ plugin: 'merge-desk', key: 'told' } as const, 0)

type $ = EngineInterface

const port = ($: $): Run => async (argv, cwd, timeoutMs) => {
  const r = await $.process.run(argv, { cwd, timeoutMs: timeoutMs ?? 30_000 })
  return { code: r.exitCode, out: r.stdout, err: r.stderr }
}

const readLedger = async ($: $): Promise<Ledger> => {
  const v = await $.store.get(LEDGER)
  return v && typeof v === 'object' ? (v as Ledger) : {}
}

const refresh = async ($: $) => {
  const s = await git.snapshot(port($), await $.session.cwd())
  if (typeof s === 'string') {
    await update($, snapA, () => null)
    await update($, problemA, () => s)
  } else {
    await update($, snapA, () => s)
    await update($, problemA, () => null)
  }
  return typeof s === 'string' ? null : s
}

// Runs one step with the busy line up, then shows its outcome and refreshes.
const act = async ($: $, label: string, work: (s: Snapshot) => Promise<Step | null>) => {
  if (await read($, busyA)) return
  const s = await read($, snapA)
  if (!s) return
  await update($, busyA, () => label)
  try {
    const step = await work(s)
    if (step) await update($, noteA, () => ({ ok: step.ok, text: step.text }))
  } catch (err) {
    await update($, noteA, () => ({ ok: false, text: String(err).slice(0, 200) }))
  } finally {
    await refresh($).catch(() => null)
    await update($, busyA, () => null)
  }
}

const remember = async ($: $, s: Snapshot, branch: string, sha: string) => {
  const entry = { branch, base: s.base, sha, at: await $.clock.now(), pushed: false }
  await $.store.set(LEDGER, record(await readLedger($), s.baseDir, entry))
  await update($, mergedA, () => ({ branch, sha }))
}

const pick = async ($: $, picked: Picked | null) => {
  await update($, pickedA, () => picked)
  await update($, previewA, () => null)
  await update($, mergedA, () => null)
  await update($, noteA, () => null)
  const s = await read($, snapA)
  if (picked && s && !s.conflict) {
    const p = await git.preview(port($), s, picked.branch)
    await update($, previewA, () => p)
  }
}

const doMerge = ($: $, branch: string) =>
  act($, '合併中…', async s => {
    const step = await git.merge(port($), s, branch)
    if (step.ok && step.sha) await remember($, s, branch, step.sha)
    return step
  })

const doFinish = ($: $, branch: string) =>
  act($, '完成合併中…', async s => {
    const step = await git.finishMerge(port($), s)
    if (step.ok && step.sha) await remember($, s, branch, step.sha)
    return step
  })

const doPush = ($: $) =>
  act($, '推送中…', async s => {
    const step = await git.push(port($), s)
    if (step.ok) await $.store.set(LEDGER, markPushed(await readLedger($), s.baseDir))
    return step
  })

const doFetch = ($: $) =>
  act($, 'Fetch 中…', async s => {
    const r = await port($)(['git', 'fetch', 'origin', '--prune'], s.baseDir, 120_000)
    return r.code === 0 ? null : { ok: false, text: r.err.trim().split('\n')[0] ?? 'fetch 失敗' }
  })

const askClaude = async ($: $, branch: string, files: string[]) => {
  const s = await read($, snapA)
  if (!s) return
  void $.prompt.submit({
    text: `在 ${s.baseDir} 把 ${branch} 合併進 ${s.base} 時有衝突，請解決這些檔案的衝突並 git add（不要 commit、不要 push）：${files.join(', ')}`,
  })
}

const repoDirs = async ($: $) =>
  (await git.worktrees(port($), await $.session.cwd())).map(t => t.path)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'merge',
      description: 'Merge finished branches into main and push, step by step',
    })
    return next(e)
  })

  on('command.run', { command: 'merge' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: 'Merge pane opened.' }
  })

  // The first prompt of a conversation carries what was merged lately and what
  // still waits; a later one only what was merged since the model last heard.
  // (Not prompt.context: another plugin may answer that event without us.)
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    let text: string | null = null
    try {
      const told = await read($, toldA)
      const ledger = await readLedger($)
      if (told === 0) {
        const s = await git.snapshot(port($), await $.session.cwd())
        if (typeof s !== 'string') {
          text = contextText(ledger[s.baseDir] ?? [], s.branches.map(b => b.name), Date.now())
        }
      } else {
        text = newsText((await repoDirs($)).flatMap(d => ledger[d] ?? []).filter(x => x.at > told))
      }
      if (told === 0 || text) await update($, toldA, () => Date.now())
    } catch {
      text = null
    }
    return next(text ? { ...e, context: [...(e.context ?? []), text] } : e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snapA)
    const problem = await read($, problemA)
    const picked = await read($, pickedA)
    const busy = await read($, busyA)
    const note = await read($, noteA)
    const now = Date.now()

    const status = (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{busy ?? ' '}</Text>
        {note && <Text color={note.ok ? 'success' : 'error'}>{note.text}</Text>}
      </Box>
    )

    if (!s) {
      return (
        <Box flexDirection="column">
          <Text>{problem ?? '讀取中…'}</Text>
          <Box marginTop={1}>
            <Button key="refresh" onPress={() => void refresh($)}>重新整理</Button>
          </Box>
        </Box>
      )
    }

    const pushRow = s.hasRemote && s.unpushed > 0 && (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{s.base} 領先 origin {s.unpushed} 個 commit</Text>
        <Box>
          <Button key="push" onPress={() => void doPush($)}>{`推送 ${s.base}`}</Button>
        </Box>
      </Box>
    )

    if (!picked) {
      const ledger = (await $.store.get(LEDGER)) as Ledger | undefined
      const recent = (ledger?.[s.baseDir] ?? []).slice(0, 3)
      return (
        <Box flexDirection="column">
          <Text bold>{`${s.repo} → ${s.base}`}</Text>
          {s.unpulled > 0 && <Text color="warning">{`origin 有 ${s.unpulled} 個新 commit，先 pull`}</Text>}
          {s.isDirty && <Text color="warning">{`${s.base} 工作樹有未提交的修改`}</Text>}
          {pushRow}
          {s.conflict && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="error">{`合併 ${s.conflict.branch} 到一半，有衝突`}</Text>
              <Box>
                <Button key="open-conflict" onPress={() => void pick($, { branch: s.conflict!.branch, worktree: null })}>
                  處理衝突
                </Button>
              </Box>
            </Box>
          )}
          <Box marginTop={1}>
            <Text bold>{`待整合 · ${s.branches.length}`}</Text>
          </Box>
          {s.branches.length === 0 && <Text dimColor>沒有尚未併入的分支</Text>}
          {s.branches.map(b => (
            <Box key={`row:${b.name}`} flexDirection="column" marginTop={1}>
              <Box>
                <Button key={`b:${b.name}`} plain onPress={() => void pick($, { branch: b.name, worktree: b.worktree })}>
                  {b.name}
                </Button>
              </Box>
              <Text dimColor>
                {[`+${b.ahead} commits`, git.ago(b.at, now), b.behind > 0 ? `落後 ${s.base} ${b.behind}` : '', b.worktree ? 'worktree' : '']
                  .filter(Boolean).join(' · ')}
              </Text>
            </Box>
          ))}
          {recent.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>最近已整合</Text>
              {recent.map(r => (
                <Text key={`r:${r.branch}`} dimColor>
                  {`${r.branch}  ${r.sha} · ${git.ago(r.at, now)}${r.pushed ? '' : ' · 未推送'}`}
                </Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Button key="refresh" onPress={() => void refresh($)}>重新整理</Button>
            {s.hasRemote && <Button key="fetch" onPress={() => void doFetch($)}>Fetch</Button>}
          </Box>
          {status}
        </Box>
      )
    }

    const preview = await read($, previewA)
    const merged = await read($, mergedA)
    const conflict = s.conflict && s.conflict.branch === picked.branch ? s.conflict : null
    const back = (
      <Box>
        <Button key="back" plain dimColor onPress={() => void pick($, null)}>‹ 返回清單</Button>
      </Box>
    )

    if (conflict) {
      return (
        <Box flexDirection="column">
          <Text bold>{`${picked.branch} → ${s.base}`}</Text>
          {back}
          <Box marginTop={1}>
            <Text color="error">{`✕ 合併：衝突 ${conflict.files.length} 檔`}</Text>
          </Box>
          {conflict.files.map(f => <Text key={`f:${f}`} dimColor>{f}</Text>)}
          <Box marginTop={1}>
            <Button key="abort" onPress={() => void act($, '放棄合併中…', s2 => git.abortMerge(port($), s2))}>放棄合併</Button>
            <Button key="finish" onPress={() => void doFinish($, picked.branch)}>我改完了，繼續</Button>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>需要 AI 時才花 token：</Text>
          </Box>
          <Box>
            <Button key="ask" onPress={() => void askClaude($, picked.branch, conflict.files)}>請 Claude 解衝突</Button>
          </Box>
          {status}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>{`${picked.branch} → ${s.base}`}</Text>
        {back}
        <Box marginTop={1}>
          <Text bold>1 預覽</Text>
        </Box>
        {preview ? (
          <Box flexDirection="column">
            <Text dimColor>{preview.stat || '沒有檔案差異'}</Text>
            {preview.commits.map((c, i) => <Text key={`c:${i}`} dimColor>{c}</Text>)}
            {preview.more > 0 && <Text dimColor>{`… 另 ${preview.more} 則`}</Text>}
          </Box>
        ) : (
          <Text dimColor>{merged ? '—' : '讀取中…'}</Text>
        )}
        <Box marginTop={1}>
          <Text bold color={merged ? 'success' : undefined}>{merged ? '✓ 2 合併' : '2 合併'}</Text>
        </Box>
        {merged ? (
          <Text dimColor>{`已合併 --no-ff → ${merged.sha}`}</Text>
        ) : (
          <Box>
            <Button key="merge" variant="primary" onPress={() => void doMerge($, picked.branch)}>
              {`合併進 ${s.base}`}
            </Button>
          </Box>
        )}
        {s.hasRemote && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{s.unpushed === 0 && merged ? '✓ 3 推送' : '3 推送'}</Text>
            {s.unpushed > 0 ? (
              <Box flexDirection="column">
                <Text dimColor>{`origin/${s.base} 會前進 ${s.unpushed} 個 commit`}</Text>
                <Box>
                  <Button key="push" onPress={() => void doPush($)}>{`推送 ${s.base}`}</Button>
                </Box>
              </Box>
            ) : (
              <Text dimColor>{merged ? `已與 origin/${s.base} 同步` : '合併後再推送'}</Text>
            )}
          </Box>
        )}
        {merged && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>4 清理（可選）</Text>
            <Box>
              <Button
                key="clean"
                onPress={() => void act($, '清理中…', s2 => git.cleanUp(port($), s2, picked.branch, picked.worktree))}
              >
                {picked.worktree ? '移除 worktree 並刪除分支' : '刪除分支'}
              </Button>
            </Box>
            <Text dimColor>已記錄，下一個 AI 回合會知道</Text>
          </Box>
        )}
        {status}
      </Box>
    )
  })
}
