// Git work for merge-desk. Pure: every call goes through the `Run` port the
// hooks module hands in, so nothing here touches `$`.

export type RunResult = { code: number; out: string; err: string }
export type Run = (
  argv: readonly string[],
  cwd: string,
  timeoutMs?: number,
) => Promise<RunResult>

import type { Branch, Preview, Snapshot } from '../types'
export type { Branch, Preview, Snapshot }

export type Step = { ok: true; text: string; sha?: string } | { ok: false; text: string }

const git = (run: Run, cwd: string, args: string[], timeoutMs?: number) =>
  run(['git', ...args], cwd, timeoutMs)

const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)

const firstLine = (r: RunResult) =>
  lines(r.err)[0] ?? lines(r.out)[0] ?? `git 結束碼 ${r.code}`

type Worktree = { path: string; branch: string | null }

export const worktrees = async (run: Run, cwd: string): Promise<Worktree[]> => {
  const r = await git(run, cwd, ['worktree', 'list', '--porcelain'])
  const list: Worktree[] = []
  for (const block of r.out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path) continue
    const ref = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null
    list.push({ path, branch: ref })
  }
  return list
}

const exists = async (run: Run, cwd: string, ref: string) =>
  (await git(run, cwd, ['rev-parse', '--verify', '-q', ref])).code === 0

const baseOf = async (run: Run, cwd: string): Promise<string | null> => {
  const head = await git(run, cwd, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  const fromRemote = head.code === 0 ? head.out.trim().replace(/^origin\//, '') : ''
  for (const name of [fromRemote, 'main', 'master']) {
    if (name && (await exists(run, cwd, `refs/heads/${name}`))) return name
  }
  return null
}

const counts = async (run: Run, cwd: string, left: string, right: string) => {
  const r = await git(run, cwd, ['rev-list', '--left-right', '--count', `${left}...${right}`])
  const [l, rr] = r.out.trim().split(/\s+/).map(Number)
  return { left: l || 0, right: rr || 0 }
}

export const conflicts = async (run: Run, dir: string) =>
  lines((await git(run, dir, ['diff', '--name-only', '--diff-filter=U'])).out)

export const snapshot = async (run: Run, cwd: string): Promise<Snapshot | string> => {
  const top = await git(run, cwd, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) return '這個資料夾不是 git repo'
  const base = await baseOf(run, cwd)
  if (!base) return '找不到 main 或 master 分支'
  const trees = await worktrees(run, cwd)
  const baseDir = trees.find(t => t.branch === base)?.path
  if (!baseDir) return `${base} 沒有在任何工作樹 checkout，請先在主資料夾切到 ${base}`

  const hasRemote = await exists(run, baseDir, `refs/remotes/origin/${base}`)
  const sync = hasRemote ? await counts(run, baseDir, base, `origin/${base}`) : { left: 0, right: 0 }
  const dirty = await git(run, baseDir, ['status', '--porcelain', '--untracked-files=no'])
  const merging = await exists(run, baseDir, 'MERGE_HEAD')
  let conflict: Snapshot['conflict'] = null
  if (merging) {
    const msg = await git(run, baseDir, ['rev-parse', '--git-path', 'MERGE_MSG'])
    const text = (await run(['cat', msg.out.trim()], baseDir)).out
    const branch = /Merge branch '([^']+)'/.exec(text)?.[1] ?? '(合併中)'
    conflict = { branch, files: await conflicts(run, baseDir) }
  }

  const refs = await git(run, baseDir, [
    'for-each-ref', 'refs/heads', '--sort=-committerdate',
    '--format=%(refname:short)%09%(committerdate:unix)',
  ])
  const branches: Branch[] = []
  for (const row of lines(refs.out)) {
    const [name, at] = row.split('\t')
    if (!name || name === base) continue
    const c = await counts(run, baseDir, base, name)
    if (c.right === 0) continue
    branches.push({
      name,
      ahead: c.right,
      behind: c.left,
      at: Number(at) * 1000,
      worktree: trees.find(t => t.branch === name)?.path ?? null,
    })
    if (branches.length >= 20) break
  }

  return {
    repo: baseDir.split('/').pop() ?? baseDir,
    base,
    baseDir,
    hasRemote,
    unpushed: sync.left,
    unpulled: sync.right,
    isDirty: !merging && lines(dirty.out).length > 0,
    conflict,
    branches,
  }
}

const shortstat = (text: string) => {
  const n = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0)
  const files = n(/(\d+) files? changed/)
  return files === 0 ? '' : `${files} 檔 +${n(/(\d+) insertion/)} −${n(/(\d+) deletion/)}`
}

export const preview = async (run: Run, s: Snapshot, branch: string): Promise<Preview> => {
  const log = await git(run, s.baseDir, ['log', '--format=%s', `${s.base}..${branch}`])
  const all = lines(log.out)
  const stat = await git(run, s.baseDir, ['diff', '--shortstat', `${s.base}...${branch}`])
  return {
    branch,
    commits: all.slice(0, 3),
    more: Math.max(0, all.length - 3),
    stat: shortstat(stat.out),
  }
}

const head = async (run: Run, dir: string) =>
  (await git(run, dir, ['rev-parse', '--short', 'HEAD'])).out.trim()

export const merge = async (run: Run, s: Snapshot, branch: string): Promise<Step> => {
  if (s.isDirty) return { ok: false, text: `${s.base} 的工作樹有未提交的修改，先處理再合併` }
  const r = await git(run, s.baseDir, ['merge', '--no-ff', '--no-edit', branch], 120_000)
  if (r.code === 0) return { ok: true, text: '已合併', sha: await head(run, s.baseDir) }
  if (await exists(run, s.baseDir, 'MERGE_HEAD')) return { ok: false, text: '有衝突' }
  return { ok: false, text: firstLine(r) }
}

export const finishMerge = async (run: Run, s: Snapshot): Promise<Step> => {
  const files = await conflicts(run, s.baseDir)
  for (const f of files) {
    const body = await run(['cat', f], s.baseDir)
    if (/^(<{7}|>{7}) /m.test(body.out)) return { ok: false, text: `${f} 還有衝突標記` }
  }
  if (files.length > 0) await git(run, s.baseDir, ['add', '--', ...files])
  const r = await git(run, s.baseDir, ['commit', '--no-edit'])
  if (r.code !== 0) return { ok: false, text: firstLine(r) }
  return { ok: true, text: '已完成合併', sha: await head(run, s.baseDir) }
}

export const abortMerge = async (run: Run, s: Snapshot): Promise<Step> => {
  const r = await git(run, s.baseDir, ['merge', '--abort'])
  return r.code === 0 ? { ok: true, text: '已放棄合併' } : { ok: false, text: firstLine(r) }
}

export const push = async (run: Run, s: Snapshot): Promise<Step> => {
  const r = await git(run, s.baseDir, ['push', 'origin', s.base], 180_000)
  return r.code === 0 ? { ok: true, text: `已推送 ${s.base}` } : { ok: false, text: firstLine(r) }
}

export const cleanUp = async (run: Run, s: Snapshot, branch: string, worktree: string | null): Promise<Step> => {
  if (worktree) {
    const w = await git(run, s.baseDir, ['worktree', 'remove', worktree])
    if (w.code !== 0) return { ok: false, text: firstLine(w) }
  }
  const r = await git(run, s.baseDir, ['branch', '-d', branch])
  if (r.code !== 0) return { ok: false, text: firstLine(r) }
  return { ok: true, text: worktree ? '已移除 worktree 並刪除分支' : '已刪除分支' }
}

export const ago = (at: number, now: number) => {
  const m = Math.round((now - at) / 60_000)
  if (m < 60) return `${Math.max(1, m)} 分鐘前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小時前`
  const d = Math.round(h / 24)
  return d === 1 ? '昨天' : `${d} 天前`
}
