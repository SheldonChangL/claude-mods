export type LongTurn = { turnId: string; isLong: boolean }
// what the running turn has used: every response's tokens, and dollars when
// the host keeps a cost ledger
export type Spend = { tokens: number; usd: number | null }

declare module 'claude-code' {
  interface PluginState {
    'clawd-run': { turn: LongTurn | null; isPreview: boolean; spend: Spend }
  }
}
