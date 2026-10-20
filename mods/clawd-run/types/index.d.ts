export type LongTurn = { turnId: string; isLong: boolean }

declare module 'claude-code' {
  interface PluginState {
    'clawd-run': { turn: LongTurn | null; isPreview: boolean }
  }
}
