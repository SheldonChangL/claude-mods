import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'merge-desk',
  component: 'Pane',
  requestId: 'merge-desk',
  props: {
    title: 'Merge',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// A repo with main checked out at /r and one finished branch in a worktree.
const fakeGit = (log: string[]) => (argv: readonly string[]) => {
  const a = argv.slice(1).join(' ')
  log.push(a)
  const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  const no = { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  if (a === 'rev-parse --show-toplevel') return ok('/r\n')
  if (a.startsWith('symbolic-ref')) return no
  if (a === 'rev-parse --verify -q refs/heads/main') return ok('x')
  if (a === 'rev-parse --verify -q refs/remotes/origin/main') return ok('x')
  if (a === 'rev-parse --verify -q MERGE_HEAD') return no
  if (a === 'worktree list --porcelain')
    return ok('worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /wt\nHEAD 2\nbranch refs/heads/claude/quota\n')
  if (a === 'rev-list --left-right --count main...origin/main') return ok(log.includes('merge --no-ff --no-edit claude/quota') ? '2\t0' : '0\t0')
  if (a === 'rev-list --left-right --count main...claude/quota') return ok(log.includes('merge --no-ff --no-edit claude/quota') ? '1\t0' : '0\t4')
  if (a.startsWith('status')) return ok('')
  if (a.startsWith('for-each-ref')) return ok('claude/quota\t1700000000\n')
  if (a.startsWith('log --format=%s')) return ok('feat: retry\ntest: 429\n')
  if (a.startsWith('diff --shortstat')) return ok(' 6 files changed, 142 insertions(+), 37 deletions(-)\n')
  if (a.startsWith('merge --no-ff')) return ok('')
  if (a === 'rev-parse --short HEAD') return ok('5e6f7a8\n')
  return no
}

test('list, pick a branch, merge it, and record it', async ($, on) => {
  const log: string[] = []
  const stored: Record<string, unknown> = {}
  on('command.register', () => ({ value: { command: 'merge' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/r' }))
  on('process.run', (_, e) => ({ value: fakeGit(log)(e.argv) }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1700000500000 }))

  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'merge', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /待整合/ }))?.text).toBe('待整合 · 1')
  await ui.press({ key: 'b:claude/quota' })
  expect((await ui.find({ type: 'Text', text: /檔/ }))?.text).toBe('6 檔 +142 −37')

  await ui.press({ key: 'merge' })
  expect((await ui.find({ type: 'Text', text: /已合併 --no-ff/ }))?.text).toBe('已合併 --no-ff → 5e6f7a8')
  expect(log).toContain('merge --no-ff --no-edit claude/quota')
  const ledger = stored['ledger'] as Record<string, { branch: string; sha: string }[]>
  expect(ledger['/r']?.[0]?.sha).toBe('5e6f7a8')
  expect(await ui.find({ key: 'push' })).toBeTruthy()
  await ui.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    expect(await other.find({ type: 'Text', text: /3 推送/ })).toBeTruthy()
    await other.unmount()
  }
})
