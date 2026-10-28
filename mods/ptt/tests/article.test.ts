// The article's body and pushes (lib/view.mjs): the body's Show all opens
// only the body and says how many lines it holds back; the pushes come a
// page of 30 at a time with Previous / Next under them, so the tree stays the
// same size however many pushes there are (all of them at once froze Desktop).

import { expect, test } from 'claude-code/testing'

import { createPttFeature } from '../lib/actions.mjs'
import { toFrame } from '../lib/frame.mjs'
import { PTT_KEYS, PTT_TEXT } from '../lib/view.mjs'
import { article, id } from './fixtures/values.mjs'
import { byKey, fakeElements, textOf, treeProblems, walk } from './helpers.ts'

const el = fakeElements()
const actions = new Proxy({}, { get: () => () => {} })
const feature = createPttFeature({ configured: true })
const ART = id(600, '101')
const pushCount = (tree: unknown) => walk(byKey(tree, PTT_KEYS.pushes)).filter((n: any) => /^ptt-push:\d+$/.test(n.props?.key ?? '')).length
const draw = (local: Record<string, unknown>, over: Record<string, unknown> = {}, surface = 'desktop') =>
  feature.render({ local: { view: 'article', board: 'Soft_Job', article: ART, ...local }, shared: { [`article:Soft_Job:${ART}`]: article('Soft_Job', ART, over) } }, el, toFrame({ surface, props: { bodyColumns: 60 } }), actions)

const pushKeys = (tree: unknown) => walk(byKey(tree, PTT_KEYS.pushes)).map((n: any) => n.props?.key).filter((k: string) => /^ptt-push:\d+$/.test(k ?? ''))

test('pushes a page at a time: 30 of 40, then Next; the second page 31–40 with Previous, keys by push', () => {
  for (const surface of ['terminal', 'desktop']) {
    const first = draw({}, {}, surface)
    expect(pushCount(first)).toBe(30)
    expect(textOf(byKey(first, PTT_KEYS.pushRange))).toBe('1–30 of 40')
    expect(byKey(first, PTT_KEYS.pushPrev)).toBeUndefined()
    expect(textOf(byKey(first, PTT_KEYS.pushNext))).toBe(PTT_TEXT.pushNext)
    // The paging row is the last thing in the pushes list.
    const list: any = byKey(first, PTT_KEYS.pushes)
    expect(list.props.children[list.props.children.length - 1].props.key).toBe(PTT_KEYS.pushPaging)
    const second = draw({ pushPage: 1 }, {}, surface)
    expect(pushKeys(second)).toEqual(Array.from({ length: 10 }, (_, i) => PTT_KEYS.push(30 + i)))
    expect(textOf(byKey(second, PTT_KEYS.pushRange))).toBe('31–40 of 40')
    expect(textOf(byKey(second, PTT_KEYS.pushPrev))).toBe(PTT_TEXT.pushPrev)
    expect(byKey(second, PTT_KEYS.pushNext)).toBeUndefined()
    // A page past the last shows the last.
    expect(textOf(byKey(draw({ pushPage: 9 }, {}, surface), PTT_KEYS.pushRange))).toBe('31–40 of 40')
    expect(treeProblems(first)).toEqual([])
    expect(treeProblems(second)).toEqual([])
  }
})

test('the body control opens only the body; the pushes keep their page', () => {
  const body = draw({ full: true })
  expect(textOf(byKey(body, PTT_KEYS.body)).split('\n').length).toBe(45)
  expect(textOf(byKey(body, PTT_KEYS.more))).toBe(PTT_TEXT.showLess)
  expect(pushCount(body)).toBe(30)
  const closed = draw({})
  expect(textOf(byKey(closed, PTT_KEYS.more))).toBe(PTT_TEXT.showMore(15))
  expect(textOf(byKey(closed, PTT_KEYS.body)).split('\n').length).toBe(30)
})

test('the tree does not grow with the pushes: 500 pushes draw no more than 40', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ tag: '推', user: `u${i}`, text: i % 3 ? `push ${i}` : `https://i.example.com/p${i}.jpg`, time: '10/28 08:31' }))
  const nodes = (tree: unknown) => walk(tree).length
  const small = nodes(draw({}, { pushes: many(40) }))
  for (const page of [0, 5, 16]) expect(nodes(draw({ pushPage: page }, { pushes: many(500) }))).toBeLessThanOrEqual(small + 2)
})

test('few pushes or a short body: no controls for them; pushes the service cut are said on the last page', () => {
  const short = draw({}, { body: 'one\ntwo', pushes: [{ tag: '推', user: 'u1', text: 'a', time: '10/14 09:10' }] })
  expect(byKey(short, PTT_KEYS.more)).toBeUndefined()
  expect(byKey(short, PTT_KEYS.pushPaging)).toBeUndefined()
  expect(byKey(draw({}, { pushesCut: 12 }), PTT_KEYS.pushesNote)).toBeUndefined()
  expect(textOf(byKey(draw({ pushPage: 1 }, { pushesCut: 12 }), PTT_KEYS.pushesNote))).toBe(PTT_TEXT.pushesCut(12))
})

test('a push with an https address draws it as a Link with its words around it; other pushes stay one Text', () => {
  const pushes = [
    { tag: '推', user: 'u1', text: 'https://i.example.com/ZbC.png 好看', time: '10/28 08:30' },
    { tag: '→', user: 'u2', text: '只是文字', time: '10/28 08:31' },
    { tag: '推', user: 'u3', text: 'http://i.example.com/old.jpg', time: '' },
  ]
  for (const surface of ['terminal', 'desktop']) {
    const tree = draw({}, { pushes }, surface)
    const first = byKey(tree, PTT_KEYS.push(0))
    expect(walk(first).filter((n: any) => n.type === 'Link').map((n: any) => n.props.href)).toEqual(['https://i.example.com/ZbC.png'])
    expect(textOf(first).replace(/\s+/g, ' ').trim()).toBe('推 u1 : 好看 10/28 08:30')
    expect(first.props.flexWrap).toBe('wrap')
    for (const index of [1, 2]) {
      const plain: any = byKey(tree, PTT_KEYS.push(index))
      expect(walk(plain).some((n: any) => n.type === 'Link')).toBe(false)
      expect(plain.props.flexWrap).toBeUndefined()
    }
    expect(treeProblems(tree)).toEqual([])
  }
})
