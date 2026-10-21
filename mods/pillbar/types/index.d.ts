export type Bytes = { used: number; total: number }

/** One reading of the machine, from bin/sysprobe.mjs. */
export type SysSample = { cpu: number; mem: Bytes; disk: Bytes; at: number }

/** One rate-limit window as the engine reports it. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** The live context window: its size, and its fill once a response reported one. */
export type Context = { tokens?: number; window: number; percent?: number }

/** Why the system meters have no reading. */
export type ProbeStatus = 'starting' | 'live' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    pillbar: {
      sys: SysSample | null
      probe: ProbeStatus
      windows: Window[]
      context: Context | null
      isHidden: boolean
    }
  }
}
