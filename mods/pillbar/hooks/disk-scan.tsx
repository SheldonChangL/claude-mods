// The disk capsule's pane: what on this disk can go, largest first, each row
// with the command that frees it to copy. Read only: nothing here deletes.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DiskScan, Finding } from '../types'
import { SCAN_SCRIPT } from './scan-script'

export const DISK_PANE = 'pillbar-disk-scan'
const TITLE = '磁碟盤點'
/** Opening the pane within this long of a finished scan shows it rather than scanning again. */
const FRESH_MS = 10 * 60_000

const EMPTY: DiskScan = { status: 'idle', items: [], home: '', totalKb: 0, freeKb: 0, finishedAt: 0, error: '' }
const scan = atom({ plugin: 'pillbar', key: 'diskScan' } as const, EMPTY)

// The child dies with the module, so a reload starts this over as well.
let isScanning = false

const quote = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`

/** The command a person runs to free this item, or undefined when it is done in an app. */
export function commandFor(item: Finding): string | undefined {
  switch (item.kind) {
    case 'cargo':
      return `cargo clean --manifest-path ${quote(item.path.replace(/\/target$/, '/Cargo.toml'))}`
    case 'npm':
      return 'npm cache clean --force'
    case 'go':
      return 'go clean -cache'
    case 'pip':
      return 'pip3 cache purge'
    case 'brew':
      return 'brew cleanup -s'
    case 'docker':
      return 'docker system prune -a'
    case 'ollama':
      return 'ollama list'
    case 'avd':
      return undefined
    default:
      return `rm -rf ${quote(item.path)}`
  }
}

export const formatKb = (kb: number) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)}G` : `${Math.round(kb / 1024)}M`)

/** One ITEM line of the scan script, or null for anything else. */
export function parseItem(line: string): Finding | null {
  const [tag, tier, kb, kind, path, note] = line.split('\t')
  if (tag !== 'ITEM' || (tier !== 'safe' && tier !== 'check') || !path) return null
  return { tier, kb: Number(kb), kind: kind ?? 'rm', path, note: note ?? '' }
}

async function runScan($: EngineInterface) {
  if (isScanning) return
  isScanning = true
  const home = (await $.env.get('HOME')) ?? ''
  await update($, scan, (): DiskScan => ({ ...EMPTY, status: 'running', home }))
  try {
    let rest = ''
    for await (const piece of $.process.spawn({ argv: ['/bin/bash', '-c', SCAN_SCRIPT] })) {
      if (!('text' in piece) || piece.stream !== 'stdout') continue
      const lines = (rest + piece.text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('FREE\t')) {
          const [, total, free] = line.split('\t')
          await update($, scan, s => ({ ...s, totalKb: Number(total), freeKb: Number(free) }))
          continue
        }
        const item = parseItem(line)
        if (item) await update($, scan, s => ({ ...s, items: [...s.items, item] }))
      }
    }
    const finishedAt = await $.clock.now()
    await update($, scan, (s): DiskScan => ({ ...s, status: 'done', finishedAt }))
  } catch (error) {
    await update($, scan, (s): DiskScan => ({ ...s, status: 'failed', error: String(error) }))
  } finally {
    isScanning = false
  }
}

/** Opens the pane, scanning unless a scan runs or one finished a moment ago. */
export async function openDiskScan($: EngineInterface) {
  await $.ui.open({ id: DISK_PANE, title: TITLE })
  const last = await read($, scan)
  const isFresh = last.status === 'done' && (await $.clock.now()) - last.finishedAt < FRESH_MS
  if (!isScanning && !isFresh) void runScan($)
}

/** A scan a reload or restart cut off can never finish. */
export async function settleDiskScan($: EngineInterface) {
  if ((await read($, scan)).status === 'running' && !isScanning) {
    await update($, scan, (s): DiskScan => ({ ...s, status: 'failed', error: '上次掃描被中斷' }))
  }
}

const clock = (ms: number) => {
  const at = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function registerDiskScan(on: On) {
  on('ui.render', { component: 'Pane', requestId: DISK_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, scan)
    const short = (path: string) => (s.home && path.startsWith(s.home) ? `~${path.slice(s.home.length)}` : path)
    const used = s.totalKb ? Math.round(((s.totalKb - s.freeKb) / s.totalKb) * 100) : 0

    const section = (tier: Finding['tier'], heading: string) => {
      const rows = s.items.filter(item => item.tier === tier).sort((a, b) => b.kb - a.kb)
      const sum = rows.reduce((total, item) => total + item.kb, 0)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {heading}：{rows.length} 項，共 {formatKb(sum)}
          </Text>
          {rows.map(item => {
            const command = commandFor(item)
            // Narrow panes: the path gets a line of its own and gives way in the
            // middle; minWidth 0 lets the text shrink instead of pushing the button out.
            return (
              <Box flexDirection="row" gap={1} marginTop={1} key={`row:${item.path}`}>
                <Box flexShrink={0}>
                  <Text mono tabular bold>
                    {formatKb(item.kb).padStart(6)}
                  </Text>
                </Box>
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text wrap="truncate-middle">{short(item.path)}</Text>
                  <Box flexDirection="row" gap={1} alignItems="center">
                    <Box flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text dimColor size="footnote" wrap="truncate-end">
                        {item.note}
                      </Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Button
                        key={`copy:${item.path}`}
                        label={command ? '複製指令' : '複製路徑'}
                        onPress={press => {
                          const text = command ?? item.path
                          void $.ui.copy({ text, surface: press.surface }).then(copied =>
                            $.ui.toast(copied.isCopied ? `已複製：${text}` : `複製失敗：${copied.reason}`),
                          )
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    }

    const state =
      s.status === 'running'
        ? `掃描中…已找到 ${s.items.length} 項`
        : s.status === 'done'
          ? `${clock(s.finishedAt)} 掃描完成`
          : s.status === 'failed'
            ? `掃描失敗：${s.error}`
            : '還沒掃描'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
          <Box flexDirection="column" flexShrink={1} minWidth={0}>
            <Text bold wrap="truncate-end">
              {s.totalKb ? `可用 ${formatKb(s.freeKb)}／已用 ${used}%` : '可用空間未知'}
            </Text>
            <Text dimColor size="footnote" wrap="truncate-end">
              {state}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Button
              key="rescan"
              label={s.status === 'running' ? '掃描中' : '重新掃描'}
              dimColor={s.status === 'running'}
              onPress={() => void runScan($)}
            />
          </Box>
        </Box>
        <Text dimColor size="footnote">
          只列出大小與清理指令，不會刪除任何東西。
        </Text>
        {s.items.length > 0 && section('safe', '可安全刪除')}
        {s.items.length > 0 && section('check', '需要你確認')}
      </Box>
    )
  })
}
