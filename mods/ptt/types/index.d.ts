// ptt state contract. The engine holds these values for the session
// (`$.state`), keyed `{ plugin: 'ptt', key }`; `claude plugin validate`
// checks every `$.state` reference in hooks/main.mjs against this file.
//
// Self-contained on purpose: no import, no reference directive.

/** JSON data as `$.state` / `$.store` carry it. */
export type PttJson = string | number | boolean | null | PttJson[] | { [key: string]: PttJson }

declare module 'claude-code' {
  interface PluginState {
    ptt: {
      /** The screen shown, what is typed, a copy of your boards (lib/state.mjs). */
      local: PttJson
    }
  }
}
