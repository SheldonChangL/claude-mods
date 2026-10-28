// The article's two expand controls (lib/view.mjs): the body's Show all
// opens only the body and says how many lines it holds back; the pushes have
// their own control at the end of their list, saying how many more there
// are, and Show fewer pushes once open. Neither opens the other.

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

test('closed: the body shows 30 lines with its own Show all; 30 of 40 pushes, then Show 10 more pushes', () => {
  for (const surface of ['terminal', 'desktop']) {
    const tree = draw({}, {}, surface)
    expect(textOf(byKey(tree, PTT_KEYS.more))).toBe(PTT_TEXT.showMore(15))
    expect(textOf(byKey(tree, PTT_KEYS.body)).split('\n').length).toBe(30)
    expect(pushCount(tree)).toBe(30)
    expect(textOf(byKey(tree, PTT_KEYS.morePushes))).toBe('Show 10 more pushes')
    // The push control is the last thing in the pushes list.
    const list: any = byKey(tree, PTT_KEYS.pushes)
    expect(list.props.children[list.props.children.length - 1].props.key).toBe(`${PTT_KEYS.morePushes}:box`)
    expect(treeProblems(tree)).toEqual([])
  }
})

test('each control opens only its own part', () => {
  const body = draw({ full: true })
  expect(textOf(byKey(body, PTT_KEYS.body)).split('\n').length).toBe(45)
  expect(textOf(byKey(body, PTT_KEYS.more))).toBe(PTT_TEXT.showLess)
  expect(pushCount(body)).toBe(30)
  expect(textOf(byKey(body, PTT_KEYS.morePushes))).toBe('Show 10 more pushes')
  const pushes = draw({ allPushes: true })
  expect(pushCount(pushes)).toBe(40)
  expect(textOf(byKey(pushes, PTT_KEYS.morePushes))).toBe(PTT_TEXT.fewerPushes)
  expect(textOf(byKey(pushes, PTT_KEYS.body)).split('\n').length).toBe(30)
})

test('few pushes or a short body: no control for them; pushes cut by the service are said once all are open', () => {
  const short = draw({}, { body: 'one\ntwo', pushes: [{ tag: '推', user: 'u1', text: 'a', time: '10/14 09:10' }] })
  expect(byKey(short, PTT_KEYS.more)).toBeUndefined()
  expect(byKey(short, PTT_KEYS.morePushes)).toBeUndefined()
  const cut = draw({ allPushes: true }, { pushesCut: 12 })
  expect(textOf(byKey(cut, PTT_KEYS.pushesNote))).toBe(PTT_TEXT.pushesCut(12))
})
