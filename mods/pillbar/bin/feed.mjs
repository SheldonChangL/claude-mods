// pillbar's feed: one JSON line per reading on stdout, read by the hooks.
//   {"type":"sys","cpu":19,"mem":{"used":…,"total":…},"disk":{"used":…,"total":…},"at":ms,"source":"daemon"|"local"}
//   {"type":"quota","fiveHour":{percentUsed,resetsAt}|null,"sevenDay":…,"scoped":[…],"state":"ok"|"error","errorCode":…,"fetchedAt":ms|null}
//   {"type":"source","source":"daemon"|"local","quota":true|false}
//
// It prefers the JetDeck daemon (a separate mod) when it is loaded: one sampler and
// one plan-usage read for every session, the sign-in token read by the
// daemon alone and never seen here. It runs JetDeck's own tap (which starts
// the daemon and keeps it alive while this feed lives), switches the daemon's
// Vitals and Quota services on, and forwards `vitals/now` and `quota/now`.
// A field the daemon has no reading for, or no daemon at all (JetDeck not
// found, a daemon without the service, the tap failing), is sampled here.
//
// Usage: node feed.mjs [intervalMs]   (the local sampling interval; 3000 by default)

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const interval = Math.max(1000, Number(process.argv[2]) || 3000)
const isMac = process.platform === 'darwin'
const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`)
const warn = (message) => process.stderr.write(`pillbar feed: ${message}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
process.stdout.on('error', () => process.exit(0))

// ---- Local sampling ---------------------------------------------------------

const diskPath = isMac && fs.existsSync('/System/Volumes/Data') ? '/System/Volumes/Data' : '/'

const cpuTimes = () =>
  os.cpus().reduce((acc, { times: t }) => ({ idle: acc.idle + t.idle, total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq }), { idle: 0, total: 0 })

let lastCpu = cpuTimes()
function localCpu() {
  const now = cpuTimes()
  const total = now.total - lastCpu.total
  const cpu = total > 0 ? (1 - (now.idle - lastCpu.idle) / total) * 100 : 0
  lastCpu = now
  return Math.round(cpu * 10) / 10
}

// Activity Monitor's "Memory Used": wired + active + compressed pages.
function localMemory() {
  const total = os.totalmem()
  if (isMac) {
    try {
      const out = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 3000 })
      const pageSize = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384)
      const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0)
      return { used: (pages('Pages wired down') + pages('Pages active') + pages('Pages occupied by compressor')) * pageSize, total }
    } catch {}
  }
  return { used: total - os.freemem(), total }
}

/** Used as total less what is available, so free space reads as Finder's. */
function localDisk() {
  const s = fs.statfsSync(diskPath)
  const total = s.blocks * s.bsize
  return { used: total - s.bavail * s.bsize, total }
}

function startLocal() {
  const tick = () => say({ type: 'sys', cpu: localCpu(), mem: localMemory(), disk: localDisk(), at: Date.now(), source: 'local' })
  const first = setTimeout(tick, 500)
  const every = setInterval(tick, interval)
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}

// ---- The JetDeck daemon -----------------------------------------------------

/** The plugin folders the session loads (the env, else ~/.claude/settings.json's env block). */
function pluginDirs() {
  let list = process.env.CLAUDE_CODE_PLUGIN_DIRS
  if (!list) {
    try {
      list = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))?.env?.CLAUDE_CODE_PLUGIN_DIRS
    } catch {}
  }
  return String(list ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((d) => d.replace(/^~(?=$|\/)/, os.homedir()))
}

/** JetDeck's folder: PILLBAR_JETDECK_DIR, else the plugin folder named jetdeck that has a tap. */
function findJetdeck() {
  const candidates = [process.env.PILLBAR_JETDECK_DIR, ...pluginDirs()].filter(Boolean)
  for (const dir of candidates) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
      if (manifest?.name === 'jetdeck' && fs.existsSync(path.join(dir, 'daemon', 'src', 'tap.mjs'))) return dir
    } catch {}
  }
  return null
}

let requests = 0
/** One protocol request over the daemon's socket. */
function rpc(socket, method, params) {
  const body = JSON.stringify({ v: 2, id: `pb${++requests}`, method, params })
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 5000 }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => {
        try {
          const answer = JSON.parse(text)
          answer.ok ? resolve(answer.result) : reject(Object.assign(new Error(answer.error?.code ?? 'error'), { code: answer.error?.code }))
        } catch {
          reject(new Error('bad answer'))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

/** A vitals/now snapshot as a sys line; fields it has no reading for are sampled here. */
function sysFromVitals(v) {
  const cpu = v?.cpu?.state === 'ok' && Number.isFinite(v.cpu.usedPercent) ? v.cpu.usedPercent : localCpu()
  const mem = v?.memory?.state === 'ok' && v.memory.totalBytes > 0 ? { used: v.memory.usedBytes, total: v.memory.totalBytes } : localMemory()
  const volumes = v?.disks?.state === 'ok' && Array.isArray(v.disks.volumes) ? v.disks.volumes : []
  const vol = volumes.find((d) => d.role === 'home') ?? volumes.find((d) => d.role === 'root')
  const disk = vol && vol.totalBytes > 0 ? { used: vol.totalBytes - vol.availableBytes, total: vol.totalBytes } : localDisk()
  return { type: 'sys', cpu, mem, disk, at: Number.isFinite(v?.sampledAt) ? v.sampledAt : Date.now(), source: 'daemon' }
}

function quotaLine(q) {
  if (!q || q.v !== 1) return null
  return { type: 'quota', fiveHour: q.fiveHour ?? null, sevenDay: q.sevenDay ?? null, scoped: Array.isArray(q.scoped) ? q.scoped : [], state: q.state, errorCode: q.errorCode ?? null, fetchedAt: q.fetchedAt ?? null }
}

/**
 * Runs JetDeck's tap until it exits. Resolves `{ ready }`: whether the daemon
 * answered at all (a tap that never got ready counts toward falling back).
 */
function runDaemon(root) {
  return new Promise((resolve) => {
    const tap = spawn(process.execPath, [path.join(root, 'daemon', 'src', 'tap.mjs'), '--protocol', '2'], { cwd: '/', stdio: ['ignore', 'pipe', 'ignore'] })
    let ready = false
    let localSys = null // the daemon has no vitals: sample here meanwhile
    let tail = ''
    const onReady = async (line) => {
      ready = true
      const caps = Array.isArray(line.daemon?.capabilities) ? line.daemon.capabilities : []
      const hasVitals = caps.includes('vitals')
      const hasQuota = caps.includes('quota')
      say({ type: 'source', source: 'daemon', quota: hasQuota })
      const { socket, client } = line
      try {
        if (hasVitals) {
          await rpc(socket, 'shared.subscribe', { client, namespace: 'vitals', key: 'now' })
          await rpc(socket, 'vitals.configure', { client, config: { enabled: true, refreshSeconds: 5 } })
          const now = await rpc(socket, 'shared.get', { namespace: 'vitals', key: 'now' })
          if (now?.value) say(sysFromVitals(now.value))
        } else localSys = startLocal()
        if (hasQuota) {
          await rpc(socket, 'shared.subscribe', { client, namespace: 'quota', key: 'now' })
          await rpc(socket, 'quota.configure', { client, config: { enabled: true, refreshSeconds: 60 } })
          const now = await rpc(socket, 'shared.get', { namespace: 'quota', key: 'now' })
          const q = quotaLine(now?.value)
          if (q) say(q)
        }
      } catch (error) {
        warn(`daemon setup failed (${error.code ?? error.message})`)
        tap.kill()
      }
    }
    tap.stdout.setEncoding('utf8')
    tap.stdout.on('data', (chunk) => {
      const lines = (tail + chunk).split('\n')
      tail = lines.pop() ?? ''
      for (const text of lines) {
        let line
        try {
          line = JSON.parse(text)
        } catch {
          continue
        }
        if (line.type === 'ready') void onReady(line)
        else if (line.type === 'event' && line.event === 'shared.changed' && line.key === 'now') {
          if (line.namespace === 'vitals' && line.value) say(sysFromVitals(line.value))
          if (line.namespace === 'quota') {
            const q = quotaLine(line.value)
            if (q) say(q)
          }
        } else if (line.type === 'error') warn(`tap: ${String(line.message).slice(0, 200)}`)
      }
    })
    tap.on('error', () => {})
    tap.on('exit', () => {
      localSys?.()
      resolve({ ready })
    })
  })
}

// ---- Main -------------------------------------------------------------------

const root = findJetdeck()
if (!root) {
  say({ type: 'source', source: 'local', quota: false })
  startLocal()
} else {
  let misses = 0
  for (;;) {
    const { ready } = await runDaemon(root)
    misses = ready ? 0 : misses + 1
    if (misses < 3) {
      await sleep(ready ? 1000 : 2000)
      continue
    }
    // The daemon will not come up: sample here for a minute, then try again.
    say({ type: 'source', source: 'local', quota: false })
    const stop = startLocal()
    await sleep(60_000)
    stop()
    misses = 0
  }
}
