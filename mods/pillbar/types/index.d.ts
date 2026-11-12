export type Bytes = { used: number; total: number }

/** One reading of the machine, from bin/sysprobe.mjs. */
export type SysSample = { cpu: number; mem: Bytes; disk: Bytes; at: number }

/** One rate-limit window as the engine reports it. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** The live context window: its size, and its fill once a response reported one. */
export type Context = { tokens?: number; window: number; percent?: number }

/** Why the system meters have no reading. */
export type ProbeStatus = 'starting' | 'live' | 'failed'

/** One cleanup candidate the disk scan found (hooks/scan-script.ts). */
export type Finding = {
  /** safe: rebuilds itself; check: the person decides. */
  tier: 'safe' | 'check'
  kb: number
  /** Picks the cleanup command: rm, cargo, npm, go, pip, brew, docker, ollama, avd. */
  kind: string
  path: string
  note: string
}

/** The disk scan behind the disk capsule: read only, nothing is deleted. */
export type DiskScan = {
  status: 'idle' | 'running' | 'done' | 'failed'
  items: Finding[]
  home: string
  totalKb: number
  freeKb: number
  finishedAt: number
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    pillbar: {
      sys: SysSample | null
      probe: ProbeStatus
      windows: Window[]
      context: Context | null
      isHidden: boolean
      diskScan: DiskScan
    }
  }
}
