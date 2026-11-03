export type Branch = {
  name: string
  ahead: number
  behind: number
  at: number
  worktree: string | null
}

export type Snapshot = {
  repo: string
  base: string
  baseDir: string
  hasRemote: boolean
  unpushed: number
  unpulled: number
  isDirty: boolean
  conflict: { branch: string; files: string[] } | null
  branches: Branch[]
}

export type Preview = { branch: string; commits: string[]; more: number; stat: string }
export type Note = { ok: boolean; text: string }
export type Picked = { branch: string; worktree: string | null }
export type Merged = { branch: string; sha: string }

declare module 'claude-code' {
  interface PluginState {
    'merge-desk': {
      snap: Snapshot | null
      problem: string | null
      picked: Picked | null
      preview: Preview | null
      merged: Merged | null
      busy: string | null
      note: Note | null
      told: number
    }
  }
}
