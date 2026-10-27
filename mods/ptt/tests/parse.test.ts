// The parsers (lib/parse.mjs) over synthetic pages shaped like PTT's
// (tests/fixtures/pages.mjs: made-up boards, titles, users and text, never
// copied from PTT), and the URLs the client may ask (lib/client.mjs).

import { describe, expect, test } from 'claude-code/testing'

import { articleUrl, boardUrl, searchUrl } from '../lib/client.mjs'
import { boardNameOf, decodeEntities, parseArticle, parseBoardPage, parseHotBoards, parseSearchPage } from '../lib/parse.mjs'
import { articlePage, boardPage, hotPage, push, row, searchPage } from './fixtures/pages.mjs'

describe('board pages', () => {
  test('rows, deleted and pinned rows, push values; the latest page numbers itself from its ‹ 上頁 link', () => {
    const html = boardPage({
      prev: 41,
      rows: [row({ push: '爆', title: '[閒聊] 一' }), row({ id: 'M.1700000002.A.DEF', push: 'X1', title: '[問題] 二' }), row({ deleted: '(本文已被刪除) [someone]' }), row({ id: 'M.1700000003.A.123', push: '' })],
      pinned: [row({ id: 'M.1700000004.A.456', title: '[公告] 板規', mark: 'M' })],
    })
    const page = parseBoardPage(html, { latest: true })
    expect([page.board, page.index, page.prev, page.next]).toEqual(['TestBoard', 42, 41, null])
    expect(page.items.map((item: any) => [item.push, item.deleted, item.pinned])).toEqual([['爆', false, false], ['X1', false, false], ['', true, false], ['', false, false], ['', false, true]])
    expect(page.items[0].title).toBe('[閒聊] 一')
    expect(boardNameOf(html)).toBe('TestBoard')
  })

  test('a page whose markup is not a board page is bad-shape', () => {
    expect(() => parseBoardPage('<html><body>nothing here</body></html>', { latest: true })).toThrow()
  })

  test('a push-count search page pages the other way: page 1 newest, prev older', () => {
    const page = parseSearchPage(searchPage({ older: 4, newer: 2, rows: [row({ push: '12' })] }), { page: 3 })
    expect([page.index, page.prev, page.next]).toEqual([3, 4, 2])
    expect(page.items[0].pinned).toBe(false)
  })
})

describe('articles and hot boards', () => {
  test('meta, body up to the 發信站 footer, pushes with the time only, counts', () => {
    const html = articlePage({ body: '第一行\n第二行\n', after: push('推', 'bob_02', '讚', '1.2.3.4 10/21 10:01') + push('噓', 'eve_03', '不', '10/21 10:02') + push('→', 'bob_02', '嗯', '10/21 10:03') })
    const article = parseArticle(html)
    expect(article.meta).toEqual({ author: 'alice01 (Alice)', title: '[閒聊] 測試文章', time: 'Tue Oct 21 10:00:00 2025' })
    expect(article.body.startsWith('第一行\n第二行')).toBe(true)
    expect(article.body).not.toContain('發信站')
    expect(article.pushes.map((p: any) => [p.tag, p.user, p.time])).toEqual([['推', 'bob_02', '10/21 10:01'], ['噓', 'eve_03', '10/21 10:02'], ['→', 'bob_02', '10/21 10:03']])
    expect(article.counts).toEqual({ up: 1, down: 1, arrow: 1 })
  })

  test('hot boards: name, users, category, title', () => {
    expect(parseHotBoards(hotPage([{ name: 'BoardOne', users: '12', category: '綜合', title: '熱門' }]))).toEqual([{ name: 'BoardOne', users: 12, category: '綜合', title: '熱門' }])
  })

  test('entities decode; control characters never survive', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &#39;b&#39; &#x4e2d;')).toBe("<a> & 'b' 中")
    const html = boardPage({ rows: [row({ title: 'T\u001b[2J<b>itle</b>' })] })
    expect(parseBoardPage(html, { latest: true }).items[0].title).toBe('T[2Jitle')
  })
})

describe('URLs: www.ptt.cc/bbs only, built from checked parts', () => {
  test('board, page, article, search', () => {
    expect(boardUrl('Soft_Job')).toBe('https://www.ptt.cc/bbs/Soft_Job/index.html')
    expect(boardUrl('Soft_Job', 7)).toBe('https://www.ptt.cc/bbs/Soft_Job/index7.html')
    expect(articleUrl('Soft_Job', 'M.1700000001.A.ABC')).toBe('https://www.ptt.cc/bbs/Soft_Job/M.1700000001.A.ABC.html')
    expect(searchUrl('Soft_Job', 30, 2)).toBe('https://www.ptt.cc/bbs/Soft_Job/search?page=2&q=recommend%3A30')
    for (const bad of [() => boardUrl('../x'), () => boardUrl('A', 0), () => articleUrl('A', 'x'), () => searchUrl('A', 20)]) expect(bad).toThrow()
  })
})
