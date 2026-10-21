export type EntryKind = 'narration' | 'question' | 'answer'
export type Entry = { id: number; kind: EntryKind; text: string; time: string; model?: string; pending?: boolean }
export type Diag = { steps: number; thinkingChars: number; textChars: number; asks: number; last: string }

declare module 'claude-code' {
  interface PluginState {
    'plain-narrator': {
      feed: Entry[]
      isThinking: boolean
      diag: Diag
      chatModel: string
      draft: string
    }
  }
}
