// Links in a post (lib/links.mjs): every https address with a plain host is a
// Link (an image, a video, a page), split out of its line with the text
// around it kept; http, credentials, other schemes and over-long addresses
// stay text. Drawn by the article view on terminal and desktop.

import { describe, expect, test } from 'claude-code/testing'

import { createPttFeature } from '../lib/actions.mjs'
import { toFrame } from '../lib/frame.mjs'
import { isLinkAddress, segmentsOf } from '../lib/links.mjs'
import { PTT_KEYS } from '../lib/view.mjs'
import { article, id } from './fixtures/values.mjs'
import { byKey, fakeElements, treeProblems, walk } from './helpers.ts'

describe('which addresses are links', () => {
  test('any https address with a plain host; nothing else', () => {
    for (const yes of ['https://www.instagram.com/reel/AbCdEf/?srtk=Xyz123', 'https://i.imgur.com/AbC123.jpg', 'https://imgur.com/a/xyz', 'https://youtu.be/abc', 'https://example.com/page.html', 'https://host.example.com:8443/p?x=1#y']) {
      expect({ yes, ok: isLinkAddress(yes) }).toEqual({ yes, ok: true })
    }
    for (const no of ['http://i.imgur.com/a.jpg', 'https://user:pw@example.com/', 'https://a.example.com.evil@x.com/a', 'javascript:alert(1)', 'https://localhost/a', 'https://x.com/a ', `https://x.com/${'a'.repeat(2100)}`, null]) {
      expect({ no, ok: isLinkAddress(no as never) }).toEqual({ no, ok: false })
    }
  })

  test('a line split into text and links, trailing punctuation left as text', () => {
    expect(segmentsOf('https://www.instagram.com/reel/De9Abc/?srtk=M3A2')).toEqual([{ url: 'https://www.instagram.com/reel/De9Abc/?srtk=M3A2' }])
    expect(segmentsOf('影片：https://youtu.be/abc（備份）。')).toEqual([{ text: '影片：' }, { url: 'https://youtu.be/abc' }, { text: '（備份）。' }])
    expect(segmentsOf('see https://example.com/a.')).toEqual([{ text: 'see ' }, { url: 'https://example.com/a' }, { text: '.' }])
    expect(segmentsOf('http://i.imgur.com/old.jpg')).toEqual([{ text: 'http://i.imgur.com/old.jpg' }])
  })
})

test('the article draws every https address as a Link, on both surfaces; http stays text', () => {
  const el = fakeElements()
  const actions = new Proxy({}, { get: () => () => {} })
  const feature = createPttFeature({ configured: true })
  const ART = id(600, '101')
  const body = ['如題', 'https://www.instagram.com/reel/De9Abc/?srtk=M3A2', 'http://i.imgur.com/old.jpg', 'https://i.imgur.com/new.jpg'].join('\n')
  for (const surface of ['terminal', 'desktop']) {
    const tree = feature.render({ local: { view: 'article', board: 'Soft_Job', article: ART }, shared: { [`article:Soft_Job:${ART}`]: article('Soft_Job', ART, { body }) } }, el, toFrame({ surface, props: { bodyColumns: 80 } }), actions)
    const links = walk(byKey(tree, PTT_KEYS.body)).filter((n: any) => n.type === 'Link').map((n: any) => n.props.href)
    expect({ surface, links }).toEqual({ surface, links: ['https://www.instagram.com/reel/De9Abc/?srtk=M3A2', 'https://i.imgur.com/new.jpg'] })
    expect(treeProblems(tree)).toEqual([])
  }
})

test('long screens end with a Back of their own: the article with ↑ Top as well, the board in its paging row', () => {
  const el = fakeElements()
  const actions = new Proxy({}, { get: () => () => {} })
  const feature = createPttFeature({ configured: true })
  const ART = id(600, '101')
  for (const surface of ['terminal', 'desktop']) {
    const frame = toFrame({ surface, props: { bodyColumns: 60 } })
    const read = feature.render({ local: { view: 'article', board: 'Soft_Job', article: ART }, shared: { [`article:Soft_Job:${ART}`]: article('Soft_Job', ART) } }, el, frame, actions)
    const bottom = byKey(read, PTT_KEYS.bottom)
    expect(walk(bottom).filter((n: any) => n.type === 'Button').map((n: any) => n.props.key)).toEqual([PTT_KEYS.backBottom, PTT_KEYS.top])
    // The bottom row is the last thing drawn.
    const root: any = read
    const last = root.props.children[root.props.children.length - 1]
    expect(last.props.key).toBe(PTT_KEYS.bottom)
    const list = feature.render({ local: { view: 'board', board: 'Soft_Job' }, shared: {} }, el, frame, actions)
    expect(byKey(byKey(list, PTT_KEYS.paging), PTT_KEYS.backBottom)?.type).toBe('Button')
    expect(treeProblems(read)).toEqual([])
    expect(treeProblems(list)).toEqual([])
  }
})
