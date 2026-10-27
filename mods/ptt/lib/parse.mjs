// PTT's web pages (www.ptt.cc/bbs) read into plain values. Pure (no Node
// API): a board's article list, one article with its pushes, the hot boards.
//
// The markup is PTT's own server-rendered HTML; it is read with regular
// expressions over the few classes the pages are known to use (r-ent, nrec,
// btn-group-paging, article-metaline, push, b-ent), tolerant of whitespace
// and of attribute order where that is cheap. A page none of that is found
// in is `bad-shape` (a challenge page, a changed layout), never a guess.
//
// Every string handed back is plain text: tags stripped, entities decoded,
// control and bidi-override characters removed (an article body keeps its
// line breaks, nothing else does) and each field cut to a fixed length.

import { ARTICLE_ID, BOARD, PTT_LIMITS as L, PttError } from './config.mjs'

const NAMED = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lsaquo: '‹', rsaquo: '›' })

/** HTML entities decoded: the named ones PTT uses and every numeric one (an invalid code point is dropped). */
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});/g, (whole, name) => {
    if (name[0] !== '#') return Object.hasOwn(NAMED, name) ? NAMED[name] : whole
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
    return String.fromCodePoint(code)
  })
}

/** Markup removed: scripts and styles with their content, comments, then every tag. */
const stripTags = (html) =>
  String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')

// C0 and C1 controls (tab and newline are handled apart), DEL, and the
// bidi marks, overrides and isolates that could reorder what a pane shows.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g

/** At most `max` code points (a surrogate pair is never split). */
function cap(text, max) {
  if (text.length <= max) return text
  return Array.from(text).slice(0, max).join('')
}

/** One line of plain text: no tags, entities decoded, no control characters, trimmed, at most `max`. */
export function plain(html, max) {
  const text = decodeEntities(stripTags(html)).replace(/\r\n?|\n|\t/g, ' ').replace(CONTROL, '').trim()
  return cap(text, max).trim()
}

/** Multi-line plain text: as plain(), but line breaks kept (\r\n and \r become \n). */
function plainLines(html) {
  return decodeEntities(stripTags(html)).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(CONTROL, '')
}

/** A tag's attributes as { name: value } (double- or single-quoted values). */
function attributesOf(text) {
  const out = {}
  for (const match of String(text).matchAll(/([A-Za-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[match[1].toLowerCase()] = match[2] ?? match[3]
  return out
}
const hasClass = (attrs, name) => typeof attrs.class === 'string' && attrs.class.split(/\s+/).includes(name)

/** The inner HTML of the first `<div class="... name ...">` (up to its first </div>: PTT nests none there). */
function divText(html, name) {
  const re = new RegExp(`<div\\s+class\\s*=\\s*"(?:[^"]*\\s)?${name}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</div\\s*>`, 'i')
  const match = re.exec(html)
  return match ? match[1] : null
}

/** The inner HTML of the first `<span class="... name ...">`. */
function spanText(html, name) {
  const re = new RegExp(`<span\\s+class\\s*=\\s*"(?:[^"]*\\s)?${name}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</span\\s*>`, 'i')
  const match = re.exec(html)
  return match ? match[1] : null
}

const BOARD_PATH = /^\/bbs\/([A-Za-z0-9_-]{1,12})\/index(\d*)\.html$/

/**
 * The board a page belongs to, as PTT spells it: the first
 * `<a class="board" href="/bbs/<Name>/index.html">` (the top bar). null when absent.
 */
export function boardNameOf(html) {
  for (const match of String(html ?? '').matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = attributesOf(match[1])
    if (!hasClass(attrs, 'board') || typeof attrs.href !== 'string') continue
    const path = BOARD_PATH.exec(attrs.href)
    if (path && path[2] === '' && BOARD.test(path[1])) return path[1]
  }
  return null
}

/** The paging buttons: { found, number (from href) | null, disabled } for 上頁 and 下頁. */
function pagingOf(html) {
  const out = { prev: { found: false, number: null, disabled: true }, next: { found: false, number: null, disabled: true } }
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = attributesOf(match[1])
    if (!hasClass(attrs, 'btn')) continue
    const label = plain(match[2], 20)
    const which = label.includes('上頁') ? 'prev' : label.includes('下頁') ? 'next' : null
    if (!which || out[which].found) continue
    const path = typeof attrs.href === 'string' ? BOARD_PATH.exec(attrs.href) : null
    const number = path && path[2] !== '' ? Number(path[2]) : null
    out[which] = { found: true, number: Number.isSafeInteger(number) && number > 0 ? number : null, disabled: hasClass(attrs, 'disabled') || !attrs.href }
  }
  return out
}

const PUSH_VALUE = /^(爆|X[0-9X]|[1-9][0-9]?)$/
const ROW = /<div\s+class\s*=\s*"r-ent"\s*>/gi
const SEPARATOR = /<div\s+class\s*=\s*"r-list-sep"\s*>/i
const ROW_SPAN = 8000 // a row's markup is about 1.5 KB; past this it is not one row

/** One `r-ent` row. */
function rowOf(chunk, pinned) {
  const titleHtml = divText(chunk, 'title') ?? ''
  const link = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(titleHtml)
  let id = null
  let title
  let deleted
  if (link) {
    const href = attributesOf(link[1]).href ?? ''
    const file = /^\/bbs\/[A-Za-z0-9_-]{1,12}\/([^/]+)\.html$/.exec(href)
    id = file && ARTICLE_ID.test(file[1]) ? file[1] : null
    title = plain(link[2], L.titleChars)
    deleted = false
  } else {
    title = plain(titleHtml, L.titleChars)
    deleted = true
  }
  const push = plain(divText(chunk, 'nrec') ?? '', L.shortChars)
  return {
    id,
    title,
    author: plain(divText(chunk, 'author') ?? '', L.nameChars),
    date: plain(divText(chunk, 'date') ?? '', L.shortChars),
    push: PUSH_VALUE.test(push) ? push : '',
    mark: plain(divText(chunk, 'mark') ?? '', L.shortChars),
    deleted,
    pinned,
  }
}

/**
 * A board's article list page (index.html or indexN.html).
 * @param {string} html
 * @param {{ latest?: boolean, page?: number | null }} [options]  latest: the board's index.html; page: the N asked for
 * @returns {{ board: string, index: number, prev: number | null, next: number | null, items: object[] }}
 */
export function parseBoardPage(html, { latest = false, page = null } = {}) {
  const text = String(html ?? '')
  const board = boardNameOf(text)
  const at = text.search(/btn-group-paging/)
  const paging = pagingOf(at >= 0 ? text.slice(at, at + 4000) : '')
  if (!board || !/r-list-container/.test(text) || (!paging.prev.found && !paging.next.found)) throw new PttError('bad-shape')
  let index
  let prev
  let next
  if (latest) {
    prev = paging.prev.disabled ? null : paging.prev.number
    index = prev !== null ? prev + 1 : 1
    next = null
  } else {
    const fromLinks = paging.prev.number !== null && !paging.prev.disabled ? paging.prev.number + 1 : paging.next.number !== null && !paging.next.disabled ? paging.next.number - 1 : 1
    index = Number.isSafeInteger(page) && page > 0 ? page : fromLinks
    prev = index > 1 ? index - 1 : null
    next = paging.next.disabled ? null : index + 1
  }
  // Rows are read only after r-list-container, and never inside a script.
  const list = text.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
  const from = list.search(/r-list-container/)
  const separator = latest ? list.search(SEPARATOR) : -1
  const starts = [...list.matchAll(ROW)].map((match) => match.index).filter((index) => index > from)
  const items = []
  for (let i = 0; i < starts.length && items.length < L.itemsMax; i += 1) {
    const start = starts[i]
    let end = Math.min(i + 1 < starts.length ? starts[i + 1] : list.length, start + ROW_SPAN)
    if (separator > start && separator < end) end = separator
    items.push(rowOf(list.slice(start, end), separator >= 0 && start > separator))
  }
  return { board, index, prev, next, items }
}

const PUSH_TAGS = new Set(['推', '噓', '→'])
const PUSH_DIV = /<div\s+class\s*=\s*"push(?:\s[^"]*)?"\s*>([\s\S]*?)<\/div\s*>/gi
const METALINE = /<div\s+class\s*=\s*"article-metaline(?:-right)?"\s*>([\s\S]*?)<\/div\s*>/gi
const FOOTER = /^※ 發信站[:：]/

/**
 * One article page.
 * @returns {{ meta: { author, title, time }, body: string, bodyCut: boolean, pushes: object[], counts: { up, down, arrow } }}
 */
/**
 * A push-count search page (searchUrl): the rows as on a board page, the
 * paging the other way round. PTT numbers search pages from the newest
 * (page 1): `‹ 上頁` goes to an older page (a higher number), `下頁 ›` to a
 * newer one. Returned as a board page reads: `prev` the older page, `next`
 * the newer one (null on page 1), `index` this page.
 */
export function parseSearchPage(html, { page = null } = {}) {
  const text = String(html ?? '')
  const index = Number.isSafeInteger(page) && page > 0 ? page : 1
  const { board, items } = parseBoardPage(text, { latest: false, page: index })
  const at = text.search(/btn-group-paging/)
  const links = { prev: null, next: null }
  for (const match of (at >= 0 ? text.slice(at, at + 4000) : '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = attributesOf(match[1])
    if (!hasClass(attrs, 'btn') || hasClass(attrs, 'disabled') || typeof attrs.href !== 'string') continue
    const label = plain(match[2], 20)
    const which = label.includes('上頁') ? 'prev' : label.includes('下頁') ? 'next' : null
    const number = /\/search\?page=(\d{1,6})&/.exec(decodeEntities(attrs.href))
    if (which && links[which] === null && number) links[which] = Number(number[1])
  }
  return { board, index, prev: links.prev, next: links.next, items: items.map((item) => ({ ...item, pinned: false })) }
}

export function parseArticle(html) {
  const text = String(html ?? '')
  const open = /<div\s+id\s*=\s*"main-content"[^>]*>/i.exec(text)
  if (!open) throw new PttError('bad-shape')
  let main = text.slice(open.index + open[0].length)
  const close = main.search(/<div\s+id\s*=\s*"article-polling"|<div\s+id\s*=\s*"footer|<script\b/i)
  if (close >= 0) main = main.slice(0, close)

  const meta = { author: '', title: '', time: '' }
  main = main.replace(METALINE, (_whole, inner) => {
    const tag = plain(spanText(inner, 'article-meta-tag') ?? '', 8)
    const value = spanText(inner, 'article-meta-value') ?? ''
    if (tag === '作者' && !meta.author) meta.author = plain(value, L.metaChars)
    else if (tag === '標題' && !meta.title) meta.title = plain(value, L.metaChars)
    else if (tag === '時間' && !meta.time) meta.time = plain(value, L.metaChars)
    return ''
  })

  const pushes = []
  const counts = { up: 0, down: 0, arrow: 0 }
  main = main.replace(PUSH_DIV, (_whole, inner) => {
    const tagHtml = spanText(inner, 'push-tag')
    if (tagHtml === null) return '' // a warning box (檔案過大 ...), not a push
    const raw = plain(tagHtml, 4)
    const tag = PUSH_TAGS.has(raw) ? raw : '→'
    const content = plain(spanText(inner, 'push-content') ?? '', L.pushTextChars + 2).replace(/^:\s?/, '')
    const when = plain(spanText(inner, 'push-ipdatetime') ?? '', 64)
    const trailing = /(\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?)$/.exec(when)
    pushes.push({ tag, user: plain(spanText(inner, 'push-userid') ?? '', L.nameChars), text: cap(content.trimEnd(), L.pushTextChars), time: trailing ? trailing[1] : cap(when, L.shortChars) })
    if (tag === '推') counts.up += 1
    else if (tag === '噓') counts.down += 1
    else counts.arrow += 1
    return ''
  })

  const lines = plainLines(main).split('\n')
  const footer = lines.findIndex((line) => FOOTER.test(line))
  const kept = footer >= 0 ? lines.slice(0, footer) : lines
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
  while (kept.length && kept[0].trim() === '') kept.shift()
  let body = kept.join('\n')
  let bodyCut = false
  if (body.length > L.bodyChars) {
    body = cap(body, L.bodyChars)
    bodyCut = true
  }
  return { meta, body, bodyCut, pushes, counts }
}

const HOT_ROW = /<div\s+class\s*=\s*"b-ent"\s*>\s*<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi

/**
 * PTT's hot boards, in page order, at most hotMax.
 * @returns {{ name, users: number | null, category, title }[]}
 */
export function parseHotBoards(html) {
  const items = []
  for (const match of String(html ?? '').matchAll(HOT_ROW)) {
    if (items.length >= L.hotMax) break
    const attrs = attributesOf(match[1])
    const path = hasClass(attrs, 'board') && typeof attrs.href === 'string' ? BOARD_PATH.exec(attrs.href) : null
    if (!path || path[2] !== '') continue
    const inner = match[2]
    const name = plain(divText(inner, 'board-name') ?? '', L.nameChars)
    if (!BOARD.test(name)) continue
    const users = plain(divText(inner, 'board-nuser') ?? '', L.shortChars)
    items.push({ name, users: /^\d{1,9}$/.test(users) ? Number(users) : null, category: plain(divText(inner, 'board-class') ?? '', L.categoryChars), title: plain(divText(inner, 'board-title') ?? '', L.titleChars) })
  }
  if (items.length === 0) throw new PttError('bad-shape')
  return items
}
