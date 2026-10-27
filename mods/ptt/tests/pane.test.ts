// The ptt mod as a session runs it: the real plugin, the engine's
// `$.http.fetch` answered by a test hook beneath it with synthetic pages
// (tests/fixtures/pages.mjs), on terminal and desktop. Nothing is fetched
// before /ptt; every request is a GET of www.ptt.cc/bbs with the over18
// cookie and the mod's user agent, one at a time; adding a board checks it
// with PTT; a board, its push-count filter and an article draw; the boards
// outlive the pane in the plugin store. And the screens drawn pure, every
// state at 80 / 50 / 30 columns, against the engine's tree rules.

import { describe, expect, mock, test } from 'claude-code/testing'

import { toFrame } from '../lib/frame.mjs'
import { createPttFeature } from '../lib/actions.mjs'
import { boardKey, searchKey } from '../lib/model.mjs'
import { INITIAL } from '../lib/state.mjs'
import { PTT_KEYS, PTT_TEXT, PUSH_STYLE } from '../lib/view.mjs'
import { articlePage, boardPage, hotPage, row, searchPage } from './fixtures/pages.mjs'
import { article, boardPage as boardValue, HOT, id, post, PTT_WIDTHS } from './fixtures/values.mjs'
import { byKey, fakeElements, textOf, treeProblems, walk } from './helpers.ts'

const SURFACES = ['terminal', 'desktop'] as const
const ARTICLE = 'M.1700000009.A.AAA'

function site() {
  const routes: Record<string, string> = {
    '/bbs/soft_job/index.html': boardPage({ board: 'Soft_Job', prev: 1836, rows: [row({ board: 'Soft_Job', id: 'M.1700000001.A.ABC', push: '爆', title: '[心得] made-up one' }), row({ board: 'Soft_Job', id: ARTICLE, push: '12', title: '[問題] made-up two' })] }),
    '/bbs/Soft_Job/index.html': boardPage({ board: 'Soft_Job', prev: 1836, rows: [row({ board: 'Soft_Job', id: 'M.1700000001.A.ABC', push: '爆', title: '[心得] made-up one' }), row({ board: 'Soft_Job', id: ARTICLE, push: '12', title: '[問題] made-up two' })] }),
    '/bbs/Soft_Job/search?page=1&q=recommend%3A30': searchPage({ board: 'Soft_Job', push: 30, older: 2, rows: [row({ board: 'Soft_Job', id: 'M.1700000001.A.ABC', push: '爆', title: '[心得] made-up one' })] }),
    [`/bbs/Soft_Job/${ARTICLE}.html`]: articlePage({ board: 'Soft_Job', id: ARTICLE, title: '[問題] made-up two', body: '第一行\nhttps://i.imgur.com/AbC123.jpg\n' }),
    '/bbs/hotboards.html': hotPage([{ name: 'Soft_Job', users: '120', category: '工作', title: 'made-up' }]),
  }
  const calls: Array<{ url: string; init: any }> = []
  return {
    calls,
    answer: async (_$: unknown, e: any) => {
      calls.push({ url: e.url, init: e.init })
      const path = String(e.url).replace('https://www.ptt.cc', '')
      const text = routes[path]
      return { value: text ? { status: 200, ok: true, headers: { 'content-type': 'text/html; charset=utf-8' }, text } : { status: 404, ok: false, headers: { 'content-type': 'text/html' }, text: '' } }
    },
  }
}

function stub(on: any) {
  const opened: string[] = []
  on('session.start', async () => ({ cwd: '/' }))
  on('session.end', async (_$: unknown, e: any) => ({ sessionId: e.sessionId }))
  on('command.register', async (_$: unknown, e: any) => ({ value: { command: e.name } }))
  on('ui.open', async (_$: unknown, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$: unknown, e: any) => {
    opened.splice(opened.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: opened.map((id) => ({ id, title: 'PTT', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.copy', async () => ({ value: { isCopied: true } }))
  return opened
}

const props = (columns: number) => ({ title: 'PTT', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} })

for (const surface of SURFACES) {
  test(`${surface}: nothing is fetched until /ptt; add, open, filter, read; every request a checked GET of www.ptt.cc/bbs`, async ($: any, on: any) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 1, 0, 0) })
    // The plugin store, answered here so the test can read what the mod kept.
    const kept = new Map<string, unknown>()
    on('store.get', async (_$: unknown, e: any) => ({ value: kept.get(e.key) }))
    on('store.set', async (_$: unknown, e: any) => {
      kept.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined }
    })
    const opened = stub(on)
    const ptt = site()
    on('http.fetch', ptt.answer as never)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(ptt.calls.length).toBe(0)

    const reply = await $.command.run({ command: 'ptt', args: '' })
    expect(reply?.text ?? reply).toContain('PTT: pane opened.')
    expect(opened).toEqual(['ptt'])
    const ui = await $.ui.mount({ plugin: 'ptt', component: 'Pane', requestId: 'ptt', surface, props: props(80) })
    const settle = async () => {
      for (let i = 0; i < 6; i += 1) await clock.advance(1100)
      await ui.redraw()
    }
    expect((await ui.find({ key: PTT_KEYS.noBoards }))?.text).toContain(PTT_TEXT.noBoards)
    // Opening the pane with no boards reads nothing.
    expect(ptt.calls.length).toBe(0)

    await ui.input({ key: PTT_KEYS.addInput, text: 'soft_job' })
    await settle()
    expect((await ui.find({ key: PTT_KEYS.note }))?.text).toContain('Added Soft_Job.')
    expect((await ui.find({ key: PTT_KEYS.openFavorite('Soft_Job') }))?.text).toContain('Soft_Job')

    await ui.press({ key: PTT_KEYS.openFavorite('Soft_Job') })
    await settle()
    expect((await ui.find({ key: PTT_KEYS.openPost(ARTICLE) }))?.text).toContain('[問題] made-up two')
    expect((await ui.find({ key: `${PTT_KEYS.post(ARTICLE)}:lead` }))?.text).toContain('12')

    await ui.press({ key: PTT_KEYS.filter(30) })
    await settle()
    expect((await ui.find({ key: PTT_KEYS.pageLabel }))?.text).toContain('30+ · newest')
    expect(await ui.find({ key: PTT_KEYS.openPost(ARTICLE) })).toBeUndefined()

    await ui.press({ key: PTT_KEYS.filter(null) })
    await settle()
    await ui.press({ key: PTT_KEYS.openPost(ARTICLE) })
    await settle()
    expect((await ui.find({ key: PTT_KEYS.heading }))?.text).toContain('[問題] made-up two')

    const paths = ptt.calls.map((call) => call.url.replace('https://www.ptt.cc', ''))
    expect(paths).toContain('/bbs/soft_job/index.html')
    expect(paths).toContain('/bbs/Soft_Job/search?page=1&q=recommend%3A30')
    expect(paths).toContain(`/bbs/Soft_Job/${ARTICLE}.html`)
    for (const call of ptt.calls) {
      expect(call.url.startsWith('https://www.ptt.cc/bbs/')).toBe(true)
      expect(call.init?.method ?? 'GET').toBe('GET')
      expect(call.init?.headers?.cookie).toBe('over18=1')
      expect(call.init?.headers?.['user-agent']).toMatch(/^ptt-mod\/0\.1\.0 /)
      expect(call.init?.body).toBeUndefined()
    }
    // The boards are in the plugin store.
    expect(kept.get('favorites')).toMatchObject({ v: 1, boards: [{ name: 'Soft_Job' }] })

    await ui.unmount()
    const closed = await $.command.run({ command: 'ptt', args: 'close' })
    expect(closed?.text ?? closed).toContain('PTT: pane closed.')
  })
}

test('a board PTT does not have is not added; the reason is said under the field', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 1, 0, 0) })
  mock.store(on)
  stub(on)
  const ptt = site()
  on('http.fetch', ptt.answer as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'ptt', args: '' })
  const ui = await $.ui.mount({ plugin: 'ptt', component: 'Pane', requestId: 'ptt', surface: 'desktop', props: props(50) })
  await ui.input({ key: PTT_KEYS.addInput, text: 'NoSuchBoard' })
  for (let i = 0; i < 4; i += 1) await clock.advance(1100)
  await ui.redraw()
  expect((await ui.find({ key: PTT_KEYS.note }))?.text).toContain('PTT has no board named NoSuchBoard.')
  expect(await ui.find({ key: PTT_KEYS.noBoards })).toBeDefined()
  await ui.unmount()
})

test('/ptt with anything but close says how to use it', async ($: any, on: any) => {
  mock.clock(on)
  mock.store(on)
  stub(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const reply = await $.command.run({ command: 'ptt', args: 'nope' })
  expect(reply?.text ?? reply).toContain('Usage: /ptt')
})

// ---- the screens, pure -------------------------------------------------------------

describe('every screen, both surfaces, 80 / 50 / 30', () => {
  const el = fakeElements()
  const noop = () => {}
  const actions = new Proxy({}, { get: () => noop })
  const feature = createPttFeature({ configured: true })
  const draw = (local: unknown, shared: Record<string, unknown>, columns: number, surface: string) => feature.render({ local, shared }, el, toFrame({ surface, props: { bodyColumns: columns } }), actions)
  const ART = id(600, '101')
  const FAVS = [{ name: 'Soft_Job', lastSeen: 1 }, { name: 'Stock', lastSeen: 0 }]
  const SHARED = { [boardKey('Soft_Job', null)]: boardValue('Soft_Job'), [`article:Soft_Job:${ART}`]: article('Soft_Job', ART), hot: HOT, [searchKey('Soft_Job', 30, null)]: { ...boardValue('Soft_Job', { items: [post(7, { push: '45' })] }), push: 30 } }
  const screens: Array<[string, unknown]> = [
    ['home empty', INITIAL],
    ['home', { favorites: FAVS }],
    ['manage', { view: 'manage', favorites: FAVS }],
    ['hot', { view: 'hot', favorites: FAVS }],
    ['board', { view: 'board', board: 'Soft_Job', favorites: FAVS }],
    ['board filtered', { view: 'board', board: 'Soft_Job', push: 30 }],
    ['article', { view: 'article', board: 'Soft_Job', article: ART }],
    ['article full', { view: 'article', board: 'Soft_Job', article: ART, full: true }],
  ]
  for (const surface of SURFACES) {
    for (const columns of PTT_WIDTHS) {
      test(`${surface} ${columns}: valid trees, no labelled glyph Button, Links only to ptt.cc or an image`, () => {
        for (const [name, local] of screens) {
          const tree = draw(local, SHARED, columns, surface)
          expect({ name, problems: treeProblems(tree) }).toEqual({ name, problems: [] })
          expect({ name, labelled: walk(tree).filter((n: any) => n.type === 'Button' && n.props.plain && n.props.label !== undefined).map((n: any) => n.props.key) }).toEqual({ name, labelled: [] })
          const links = walk(tree).filter((n: any) => n.type === 'Link').map((n: any) => n.props.href)
          expect({ name, ok: links.every((href: string) => href.startsWith('https://www.ptt.cc/bbs/') || /^https:\/\//.test(href)) }).toEqual({ name, ok: true })
        }
      })
    }
  }

  test('a push line in PTT colours: 推 bright, 噓 and → red, the user bright yellow, the text yellow, the time dim', () => {
    const tree = draw({ view: 'article', board: 'Soft_Job', article: ART }, SHARED, 80, 'desktop')
    const pushes = (article('Soft_Job', ART) as any).pushes
    const parts = (i: number) => walk(byKey(tree, PTT_KEYS.push(i))).filter((n: any) => n.type === 'Text').slice(1)
    for (const tag of ['推', '噓', '→']) {
      const i = pushes.findIndex((p: any) => p.tag === tag)
      expect(i).toBeGreaterThanOrEqual(0)
      const [tagText, user, body, time] = parts(i)
      expect({ tag, style: tagText.props }).toMatchObject({ tag, style: PUSH_STYLE.tag[tag as '推'] })
      expect(user.props).toMatchObject({ color: 'warning', bold: true })
      expect(body.props).toMatchObject({ color: 'warning' })
      expect(time.props).toMatchObject({ dimColor: true })
    }
    expect(PUSH_STYLE.tag['噓']).toMatchObject({ color: 'error' })
    expect(PUSH_STYLE.tag['→']).toMatchObject({ color: 'error' })
    expect(PUSH_STYLE.tag['推'].color).toBeUndefined()
  })

  test('a row: the push count in its colour outside the title Button; both lines one hover group', () => {
    const tree = draw({ view: 'board', board: 'Soft_Job', favorites: FAVS }, SHARED, 80, 'desktop')
    const key = PTT_KEYS.openPost(post(5).id)
    expect(textOf(byKey(tree, `${PTT_KEYS.post(post(5).id)}:lead`))).toBe('爆')
    expect(textOf(byKey(tree, key))).toBe('[問題] made-up question number 5')
    expect(byKey(tree, `${key}:sub`).props.hover.scope).toBe(byKey(tree, key).props.hover.scope)
  })
})
