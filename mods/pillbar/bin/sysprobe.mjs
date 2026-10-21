// Prints one JSON line of machine load every <interval> ms until killed.
import os from 'node:os'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const interval = Math.max(1000, Number(process.argv[2]) || 3000)
const isMac = process.platform === 'darwin'
const diskPath = isMac && fs.existsSync('/System/Volumes/Data') ? '/System/Volumes/Data' : '/'

const cpuTimes = () =>
  os.cpus().reduce(
    (acc, { times: t }) => ({
      idle: acc.idle + t.idle,
      total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
    }),
    { idle: 0, total: 0 },
  )

// Activity Monitor's "Memory Used": wired + active + compressed pages.
const macUsedBytes = () => {
  const out = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8' })
  const pageSize = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384)
  const pages = label => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0)
  return (pages('Pages wired down') + pages('Pages active') + pages('Pages occupied by compressor')) * pageSize
}

const memory = () => {
  const total = os.totalmem()
  let used = total - os.freemem()
  if (isMac) {
    try {
      used = macUsedBytes()
    } catch {}
  }
  return { used, total }
}

const disk = () => {
  const s = fs.statfsSync(diskPath)
  const total = s.blocks * s.bsize
  return { used: total - s.bavail * s.bsize, total }
}

let last = cpuTimes()
const sample = () => {
  const now = cpuTimes()
  const total = now.total - last.total
  const cpu = total > 0 ? (1 - (now.idle - last.idle) / total) * 100 : 0
  last = now
  const line = { cpu: Math.round(cpu * 10) / 10, mem: memory(), disk: disk(), at: Date.now() }
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

setTimeout(sample, 500)
setInterval(sample, interval)
process.stdout.on('error', () => process.exit(0))
