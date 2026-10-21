export type Narration = { id: number; text: string; time: string }
export type Diag = { steps: number; thinkingChars: number; textChars: number; asks: number; last: string }

declare module 'claude-code' {
  interface PluginState {
    'plain-narrator': {
      narrations: Narration[]
      isThinking: boolean
      diag: Diag
    }
  }
}
