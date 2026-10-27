// The service (lib/service.mjs) and its GET (lib/client.mjs) with fakes in
// place of `$.http.fetch` and `$.clock`: only checked www.ptt.cc/bbs URLs go
// out, a body past the ceiling and a request past the timeout fail, requests
// wait their gap, a 429 holds everything; a view is read once within its TTL
// and again on a Refresh press; a lookup finds a board's spelling or says it
// is missing; a want is checked before it is served.

import { describe, expect, test } from 'claude-code/testing'

import { createGetHtml } from '../lib/client.mjs'
import { acceptWant, createPttService } from '../lib/service.mjs'
import { boardPage, row } from './fixtures/pages.mjs'

/** A clock the test moves: after/every fire when advanced past their time. */
function fakeClock() {
  let now = 1_700_000_000_000
  let timers: Array<{ at: number; fn: () => void; every: number | null; live: boolean }> = []
  const add = (ms: number, fn: () => void, every: number | null) => {
    const timer = { at: now + ms, fn, every, live: true }
    timers.push(timer)
    return { cancel: () => (timer.live = false) }
  }
  return {
    now: () => now,
    after: (ms: number, fn: () => void) => add(ms, fn, null),
    every: (ms: number, fn: () => void) => add(ms, fn, ms),
    async advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        now = due.at
        if (due.every === null) due.live = false
        else due.at += due.every
        due.fn()
        for (let i = 0; i < 5; i += 1) await Promise.resolve()
      }
      now = target
      timers = timers.filter((t) => t.live)
      for (let i = 0; i < 20; i += 1) await Promise.resolve()
    },
  }
}

const html = (text: string, status = 200, headers: Record<string, string> = {}) => ({ status, ok: status >= 200 && status < 300, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, text })

function serviceOf(routes: Record<string, any>) {
  const clock = fakeClock()
  const calls: string[] = []
  const published = new Map<string, any>()
  const fetch = async (url: string) => {
    calls.push(url.replace('https://www.ptt.cc', ''))
    const route = routes[url.replace('https://www.ptt.cc', '')]
    return typeof route === 'function' ? route() : route ?? html('', 404)
  }
  const service = createPttService({
    publish: (key: string, value: unknown) => (value === null ? published.delete(key) : published.set(key, value)),
    get: createGetHtml({ fetch, after: clock.after }),
    timers: { after: clock.after, every: clock.every },
    now: clock.now,
    version: '0.1.0',
  })
  service.configure({ enabled: true, refreshSeconds: 300 })
  const want = (fields: Record<string, unknown>) => {
    const value = acceptWant('want:session0001', { v: 1, boards: [], view: null, lookup: null, refreshAt: null, ...fields })
    expect(value).not.toBeNull()
    service.wanted('want:session0001', value)
  }
  return { clock, calls, published, service, want }
}

describe('the GET', () => {
  test('only checked www.ptt.cc/bbs URLs; a body past the ceiling, a dropped connection and a timeout fail', async () => {
    const clock = fakeClock()
    let answer: any = html('ok')
    const get = createGetHtml({ fetch: async () => answer, after: clock.after })
    for (const url of ['https://evil.example/bbs/A/index.html', 'http://www.ptt.cc/bbs/A/index.html', 'https://www.ptt.cc/bbs/A/search?q=author%3Ax&page=1', 'https://www.ptt.cc/bbs/../etc/index.html']) {
      await expect(get(url)).rejects.toMatchObject({ code: 'bad-request' })
    }
    expect((await get('https://www.ptt.cc/bbs/A/index.html')).body).toBe('ok')
    answer = html('x'.repeat(50))
    await expect(get('https://www.ptt.cc/bbs/A/index.html', { maxBytes: 10 })).rejects.toMatchObject({ code: 'too-large' })
    const failing = createGetHtml({ fetch: async () => Promise.reject(new Error('down')), after: clock.after })
    await expect(failing('https://www.ptt.cc/bbs/A/index.html')).rejects.toMatchObject({ code: 'network' })
    const hanging = createGetHtml({ fetch: () => new Promise(() => {}), after: clock.after })
    const pending = hanging('https://www.ptt.cc/bbs/A/index.html', { timeoutMs: 10_000 })
    await clock.advance(10_001)
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
  })
})

describe('the service', () => {
  test('a view: read once, within its TTL not again, on a Refresh press again; requests at least 1 s apart', async () => {
    const { clock, calls, published, want } = serviceOf({ '/bbs/A_Board/index.html': html(boardPage({ board: 'A_Board', rows: [row({ board: 'A_Board' })] })) })
    want({ view: { kind: 'board', board: 'A_Board', page: null } })
    await clock.advance(10)
    expect(published.get('board:A_Board:latest')?.state).toBe('ready')
    want({ view: { kind: 'board', board: 'A_Board', page: null } })
    await clock.advance(10)
    expect(calls.length).toBe(1)
    want({ view: { kind: 'board', board: 'A_Board', page: null }, refreshAt: clock.now() })
    await clock.advance(500)
    expect(calls.length).toBe(1) // the gap: not yet
    await clock.advance(600)
    expect(calls.length).toBe(2)
  })

  test('a lookup: found under the real spelling (and its latest page with it), or missing', async () => {
    const { clock, published, want } = serviceOf({ '/bbs/a_board/index.html': html(boardPage({ board: 'A_Board', rows: [row({ board: 'A_Board' })] })) })
    want({ lookup: 'a_board' })
    await clock.advance(10)
    expect(published.get('lookup:a_board')).toMatchObject({ state: 'found', name: 'A_Board' })
    expect(published.get('board:A_Board:latest')?.state).toBe('ready')
    want({ lookup: 'nope' })
    await clock.advance(1100)
    expect(published.get('lookup:nope')).toMatchObject({ state: 'missing', name: null })
  })

  test('a 429 holds every request for its Retry-After (60 s at least)', async () => {
    let first = true
    const { clock, calls, published, want } = serviceOf({
      '/bbs/A_Board/index.html': () => {
        if (first) {
          first = false
          return html('', 429, { 'retry-after': '5' })
        }
        return html(boardPage({ board: 'A_Board', rows: [row({ board: 'A_Board' })] }))
      },
      '/bbs/hotboards.html': html('<div class="b-ent"></div>'),
    })
    want({ view: { kind: 'board', board: 'A_Board', page: null } })
    await clock.advance(10)
    expect(published.get('board:A_Board:latest')).toMatchObject({ state: 'error', errorCode: 'throttled' })
    expect(published.get('status')?.blockedUntil).toBeGreaterThan(clock.now())
    want({ view: { kind: 'hot' } })
    await clock.advance(30_000)
    expect(calls.length).toBe(1)
    await clock.advance(31_000)
    expect(calls.length).toBe(2)
  })

  test('a want is checked: nothing but its own fields, boards and views of the right shape', () => {
    const ok = { v: 1, boards: ['A_Board'], view: { kind: 'board', board: 'A_Board', page: null, push: 30 }, lookup: null, refreshAt: null }
    expect(acceptWant('want:session0001', ok)).toMatchObject({ view: { push: 30 } })
    for (const bad of [{ ...ok, v: 2 }, { ...ok, extra: 1 }, { ...ok, boards: ['../x'] }, { ...ok, view: { kind: 'board', board: 'A_Board', page: null, push: 20 } }, { ...ok, view: { kind: 'article', board: 'A_Board', id: 'x' } }, { ...ok, lookup: 'has space' }]) {
      expect(acceptWant('want:session0001', bad)).toBeNull()
    }
    expect(acceptWant('want:x', ok)).toBeNull()
  })
})
