// PTT values as the mod's service publishes them (lib/service.mjs). Test data only: made-up boards' posts, names and text,
// never copied from PTT. Ids follow PTT's form M.<seconds>.A.<hex>.

import { T0 } from './time.mjs'

export const PTT_WIDTHS = Object.freeze([80, 50, 30])
const S0 = Math.floor(T0 / 1000)

export const id = (secondsAgo, hex = 'A1B') => `M.${S0 - secondsAgo}.A.${hex}`

export function post(n, over = {}) {
  return { id: id(n * 600, (0x100 + n).toString(16).toUpperCase().slice(-3)), title: `[問題] made-up question number ${n}`, author: `user${n}`, date: '10/14', push: String(n), mark: '', deleted: false, pinned: false, ...over }
}

/** A latest page: posts oldest first (as PTT lists them), a deleted row, one pinned row. */
export function boardPage(board, over = {}) {
  const items = [post(6), post(5, { push: '爆' }), { id: null, title: '(本文已被刪除) [someone]', author: '-', date: '10/14', push: '', mark: '', deleted: true, pinned: false }, post(3, { push: 'X1' }), post(2, { push: '' }), post(1, { title: '[心得] a made-up note \u001b[31mred​' }), post(900, { title: '[公告] made-up board rules', pinned: true, push: '', mark: 'M' })]
  return { v: 1, board, page: 'latest', index: 1837, prev: 1836, next: null, state: 'ready', errorCode: null, stale: false, fetchedAt: T0, lastAttempt: T0, items, ...over }
}

export function olderPage(board, n, over = {}) {
  return { v: 1, board, page: n, index: n, prev: n > 1 ? n - 1 : null, next: n + 1, state: 'ready', errorCode: null, stale: false, fetchedAt: T0, lastAttempt: T0, items: [post(40), post(41)], ...over }
}

export function article(board, articleId, over = {}) {
  const body = Array.from({ length: 45 }, (_, i) => `made-up line ${i + 1} of the article`).join('\n')
  const pushes = Array.from({ length: 40 }, (_, i) => ({ tag: i % 7 === 0 ? '噓' : i % 3 === 0 ? '→' : '推', user: `pusher${i}`, text: `made-up push ${i}`, time: '10/14 09:1' + (i % 10) }))
  return { v: 1, board, id: articleId, state: 'ready', errorCode: null, stale: false, fetchedAt: T0, lastAttempt: T0, url: `https://www.ptt.cc/bbs/${board}/${articleId}.html`, meta: { author: 'user1 (Made Up)', title: '[心得] a made-up note', time: 'Tue Oct 14 09:00:00 2026' }, body, bodyCut: false, pushes, pushesCut: 0, counts: { up: 28, down: 6, arrow: 6 }, ...over }
}

export const HOT = Object.freeze({ v: 1, state: 'ready', errorCode: null, stale: false, fetchedAt: T0, lastAttempt: T0, items: [{ name: 'Gossiping', users: 4806, category: '綜合', title: 'a made-up board title' }, { name: 'Soft_Job', users: 120, category: '工作', title: 'another made-up title' }, { name: 'Stock', users: 3000, category: '學術', title: 'a third one' }] })
