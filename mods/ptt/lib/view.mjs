// PTT view: pure. ({ local, shared }, el, frame, actions, options) -> tree.
// Five screens: home, hot boards, manage, a board's posts, an article. The
// design (the README's "The pane") is a narrow pane first, Claude
// Desktop's: one field with its own Add, quiet text controls, and lists of
// rows where each row is two lines of text and one small `›` at its end, so
// a screen shows many boards or posts, not many buttons.
//
//   home                                    board
//   [Add a board: Soft_Job        | Add]    [‹ Back]  Gossiping          ↻
//                                           爆 [問卦] a title              ›
//   YOUR BOARDS   Hot boards  Manage  ↻        user12 · 10/27
//   Gossiping                  12 new  ›    38 [新聞] another              ›
//   [問卦] the newest title                    news99 · 10/27
//                                           [‹ Older]    latest
//
// Everything PTT says (titles, names, text) is other people's text: it goes
// through clip / sanitizeText, bounded, and is drawn as plain text, never a
// Link (the article's own ptt.cc address is the one Link).

import { sanitizeText } from './sanitize.mjs'
import { EmptyState } from './ui/empty-state.mjs'
import { slot } from './ui/keys.mjs'
import { layoutFor, linkOpens } from './ui/layout.mjs'
import { action, clip, text } from './ui/primitives.mjs'
import { Loading } from './ui/status.mjs'
import { TEXT } from './ui/tokens.mjs'
import { hasLinkAddress, segmentsOf } from './links.mjs'
import { articleOf, boardOf, hotOf, newestFirst, newPosts, PUSH_FILTERS, statusOf } from './model.mjs'
import { normalizeLocal, pushShown } from './state.mjs'

export const PTT_KEYS = Object.freeze({
  root: 'ptt-root',
  empty: 'ptt-empty',
  note: 'ptt-note',
  bar: 'ptt-bar',
  heading: 'ptt-heading',
  // home
  addInput: 'ptt-add-input',
  boardsHead: 'ptt-boards-head',
  controls: 'ptt-controls',
  hot: 'ptt-hot',
  manage: 'ptt-manage',
  refresh: 'ptt-refresh',
  boards: 'ptt-boards',
  noBoards: 'ptt-no-boards',
  favorite: (name) => `ptt-fav:${name}`,
  openFavorite: (name) => `ptt-open:${name}`,
  // manage
  done: 'ptt-done',
  manageRow: (name) => `ptt-row:${name}`,
  up: (name) => `ptt-up:${name}`,
  down: (name) => `ptt-down:${name}`,
  remove: (name) => `ptt-remove:${name}`,
  // hot, board, article
  back: 'ptt-back',
  backBottom: 'ptt-back-bottom',
  bottom: 'ptt-bottom',
  top: 'ptt-top',
  hotList: 'ptt-hot-list',
  hotRow: (name) => `ptt-hot-row:${name}`,
  hotOpen: (name) => `ptt-hot-open:${name}`,
  hotAdd: (name) => `ptt-hot-add:${name}`,
  addThis: 'ptt-add-this',
  posts: 'ptt-posts',
  post: (id) => `ptt-post:${id}`,
  openPost: (id) => `ptt-open-post:${id}`,
  deleted: (index) => `ptt-deleted:${index}`,
  paging: 'ptt-paging',
  filters: 'ptt-filters',
  filter: (push) => `ptt-filter:${push ?? 'all'}`,
  older: 'ptt-older',
  newer: 'ptt-newer',
  pageLabel: 'ptt-page-label',
  copyLink: 'ptt-copy-link',
  link: 'ptt-link',
  meta: 'ptt-meta',
  body: 'ptt-body',
  bodyPart: (index) => `ptt-body-part:${index}`,
  image: (index) => `ptt-image:${index}`,
  more: 'ptt-more',
  pushesHead: 'ptt-pushes-head',
  pushes: 'ptt-pushes',
  push: (index) => `ptt-push:${index}`,
  pushesNote: 'ptt-pushes-note',
})

export const PTT_TEXT = Object.freeze({
  unconfigured: "PTT isn't configured.",
  unconfiguredHint: 'It reads www.ptt.cc\'s public web pages; no account, nothing is posted.',
  addPlaceholder: 'Add a board: Soft_Job',
  add: 'Add',
  hot: 'Hot boards',
  manage: 'Manage',
  refresh: 'Refresh',
  boards: 'Your boards',
  noBoards: 'Start with a board',
  noBoardsHint: 'Type a board name above, or pick one from Hot boards.',
  newPosts: (count, more) => `${count}${more ? '+' : ''} new`,
  open: (what) => `Open ${what}`,
  addBoard: (name) => `Add ${name} to your boards`,
  back: '‹ Back',
  top: '↑ Top',
  done: 'Done',
  up: (name) => `Move ${name} up`,
  down: (name) => `Move ${name} down`,
  remove: 'Remove',
  older: '‹ Older',
  newer: 'Newer ›',
  latest: 'latest',
  pageOf: (n) => `page ${n}`,
  pinned: 'pinned',
  noPosts: 'No posts on this page.',
  all: 'All',
  pushLabel: (n) => (n >= 100 ? '爆' : `${n}+`),
  noFiltered: (n) => `No posts with ${n >= 100 ? '爆' : `${n}+ pushes`} on this board.`,
  filteredPage: (n, page) => `${n >= 100 ? '爆' : `${n}+`} · ${page === null ? 'newest' : `page ${page}`}`,
  copyLink: 'Copy link',
  openOnPtt: 'ptt.cc',
  linkNote: 'Links open outside this pane: Copy link instead.',
  showMore: (n) => `Show all (${n} more line${n === 1 ? '' : 's'})`,
  showAll: 'Show all',
  showLess: 'Show less',
  pushes: 'Pushes',
  pushCounts: (c) => `推 ${c.up} · 噓 ${c.down} · → ${c.arrow}`,
  noPushes: 'No pushes yet.',
  pushesCut: (n) => `${n} more push${n === 1 ? '' : 'es'} not shown (too long for the pane).`,
  bodyCut: 'The article goes on: open it on ptt.cc for the rest.',
  checking: (name) => `Checking ${name} on PTT…`,
  linkCopied: 'Link copied',
  copyFailed: "Couldn't copy here",
  stale: (code) => `Showing the last copy: PTT couldn't be read (${code}).`,
  failed: (code) => `PTT couldn't be read (${code}).`,
  wantError: Object.freeze({
    unreachable: "PTT can't be reached right now; retrying.",
    refused: 'This pane asked for something the service does not take: reload the plugin.',
    filter: 'Filtering is not available right now, so this shows every post.',
    failed: "Couldn't start reading PTT.",
  }),
  slowDown: 'PTT asked to slow down; reading again shortly.',
})

/** What an error code means, in a few words. */
export function explain(code) {
  switch (code) {
    case 'not-found': return 'not found'
    case 'throttled': return 'PTT asked to slow down'
    case 'timeout': return 'no answer in time'
    case 'network': return 'no connection'
    default: return code ?? 'error'
  }
}

/** The body's lines shown before Show all. */
export const BODY_LINES = 30
/** Pushes shown before Show all, and at most with it. */
export const PUSHES_SHOWN = 30
export const PUSHES_MAX = 300

/** PTT's own push-count colours: 爆 red, 10-99 yellow, 1-9 green, X (more boos) dim. */
export function pushStyle(push) {
  if (push === '爆') return { color: 'error' }
  if (/^X/.test(push)) return { dimColor: true }
  const n = Number(push)
  if (Number.isInteger(n) && n >= 10) return { color: 'warning' }
  if (Number.isInteger(n) && n >= 1) return { color: 'success' }
  return {}
}

const join = (...parts) => parts.filter((part) => part).join(' · ')
const autoFocus = (local, key) => (local.focus === key ? { autoFocus: true } : {})

/**
 * A one-glyph or one-word control: no brackets on the terminal. A glyph is
 * the Button's only child and no `label` is set: Claude Desktop draws a
 * Button's `label` in place of its children, so a descriptive label would be
 * drawn as the whole text (`Open [問卦] …` beside every row, seen in Desktop
 * 2026-10-27). The key is the Button's address.
 */
function quiet(el, local, { key, label, glyph, onPress, dim = true }) {
  return h(el.Button, { key, plain: true, ...(dim ? { dimColor: true } : {}), ...autoFocus(local, key), onPress }, glyph ?? label)
}

/** One line of text in a keyed Box: the shape every changing line keeps. */
const line = (el, key, role, content, wrap = 'truncate-end') => h(el.Box, { key }, text(el, role, content, { wrap }))

/** A row of controls: `left` first, `right` pushed to the far end. */
function bar(el, layout, key, left, right = []) {
  const group = (part, items) => h(el.Box, { key: slot(key, part), flexDirection: 'row', alignItems: 'center', columnGap: layout.inlineGap, flexShrink: part === 'left' ? 1 : 0 }, ...items.filter(Boolean))
  return h(el.Box, { key, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', columnGap: layout.inlineGap }, group('left', left), group('right', right))
}

/**
 * A list row: a title line (an optional coloured lead, the title, a meta on
 * the right) over a dim second line, and its controls at the end.
 *
 * With `press`, the two lines act as one button: each is a plain Button
 * running the same press (the second dim), stacked in one column so they
 * line up whatever the font, and both share one hover group (rowScope), so a
 * pointer on either lights both: underlined, the second at full strength.
 * One Button cannot hold both lines: Desktop draws a Button's contents as one
 * line of plain text (tried 2026-10-27: the second line ran on after the
 * title and the count lost its colour). The lead (a push count in PTT's
 * colours) is a column of its own beside them and the meta sits on the right:
 * both outside the Buttons, because Claude Desktop draws a Button's contents
 * as one line of plain text (a colour inside one is lost; seen 2026-10-27).
 * `leadWidth` keeps the lead column on every row, so rows line up whether a
 * post has pushes or not.
 */
/** The hover group of one row's two Buttons: a pointer on either lights both. */
const rowScope = (key) => `ptt-row:${key}`.slice(0, 64)

function navRow(el, layout, { key, title, titleRole = 'body', lead = null, leadWidth = 0, meta = null, metaRole = 'meta', secondary = null, controls = [], press = null, local = null }) {
  const { Box, Text } = el
  if (press) {
    const focus = (k) => (local ? autoFocus(local, k) : {})
    const lines = h(
      Box,
      { key: slot(key, 'text'), flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0 },
      h(Box, { key: slot(key, 'title') }, h(el.Button, { key: press.key, plain: true, hover: { scope: rowScope(press.key), underline: true }, ...focus(press.key), onPress: press.onPress }, clip(title, 200))),
      ...(secondary ? [h(Box, { key: slot(key, 'secondary') }, h(el.Button, { key: slot(press.key, 'sub'), plain: true, dimColor: true, hover: { scope: rowScope(press.key), dimColor: false, underline: true }, onPress: press.onPress }, clip(secondary, 200)))] : []),
    )
    return h(
      Box,
      { key, flexDirection: 'row', alignItems: 'flex-start', columnGap: layout.inlineGap },
      ...(lead || leadWidth ? [h(Box, { key: slot(key, 'lead'), flexShrink: 0, minWidth: leadWidth }, h(Text, lead?.style ?? {}, lead?.text ?? ''))] : []),
      lines,
      ...(meta ? [h(Box, { key: slot(key, 'meta'), flexShrink: 0 }, text(el, metaRole, clip(meta, 24)))] : []),
      ...controls.filter(Boolean),
    )
  }
  const head = h(Text, { ...TEXT[titleRole], wrap: 'truncate-end' }, ...(lead ? [h(Text, lead.style, `${lead.text} `)] : []), clip(title, 200))
  return h(
    Box,
    { key, flexDirection: 'row', alignItems: 'center', columnGap: layout.inlineGap },
    h(
      Box,
      { key: slot(key, 'text'), flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0 },
      h(Box, { key: slot(key, 'head'), flexDirection: 'row', justifyContent: 'space-between', columnGap: layout.inlineGap }, h(Box, { key: slot(key, 'title'), flexShrink: 1, minWidth: 0 }, head), ...(meta ? [h(Box, { key: slot(key, 'meta'), flexShrink: 0 }, text(el, metaRole, clip(meta, 24)))] : [])),
      ...(secondary ? [h(Box, { key: slot(key, 'secondary') }, text(el, 'muted', clip(secondary, 200), { wrap: 'truncate-end' }))] : []),
    ),
    ...controls.filter(Boolean),
  )
}

/** The one line under a screen's top: what the person should know now, or nothing. */
function noteOf(local, shared, value, { home = false } = {}) {
  // The filter fallback matters on the board only; elsewhere the want went through.
  if (local.wantError && !(local.wantError === 'filter' && local.view !== 'board')) return { role: local.wantError === 'refused' ? 'danger' : 'warning', text: PTT_TEXT.wantError[local.wantError] }
  if (home && local.lookup) return { role: 'muted', text: PTT_TEXT.checking(local.lookup) }
  if (home && local.notice) return { role: /^Added /.test(local.notice) ? 'success' : 'danger', text: local.notice }
  const status = statusOf(shared)
  if (status?.blockedUntil && status.lastErrorCode === 'throttled') return { role: 'warning', text: PTT_TEXT.slowDown }
  if (value?.state === 'error' && value.stale) return { role: 'warning', text: PTT_TEXT.stale(explain(value.errorCode)) }
  if (value?.state === 'error') return { role: 'danger', text: PTT_TEXT.failed(explain(value.errorCode)) }
  return { role: 'muted', text: '' }
}

const noteLine = (el, note) => line(el, PTT_KEYS.note, note.role, note.text, 'wrap')
const caption = (el, layout, label) => text(el, 'section', layout.composition.captionCase === 'upper' ? label.toUpperCase() : label)
const back = (el, layout, local, onPress, key = PTT_KEYS.back) => action(el, { key, label: PTT_TEXT.back, autoFocus: local.focus === key, onPress }, layout)
const refresh = (el, local, actions) => quiet(el, local, { key: PTT_KEYS.refresh, label: PTT_TEXT.refresh, glyph: '↻', onPress: actions.refresh })
const heading = (el, label) => h(el.Box, { key: PTT_KEYS.heading, flexShrink: 1, minWidth: 0 }, text(el, 'heading', clip(label, 120), { wrap: 'truncate-end' }))

// ---- home -------------------------------------------------------------------------

function home(el, layout, local, shared, actions) {
  const field = h(el.Input, {
    key: PTT_KEYS.addInput,
    placeholder: PTT_TEXT.addPlaceholder,
    value: local.input,
    submitLabel: PTT_TEXT.add,
    // The ring starts here when the pane takes the keyboard, unless an action named another control.
    ...(local.focus === null || local.focus === PTT_KEYS.addInput ? { autoFocus: true } : {}),
    onInput: actions.typed,
    onSubmit: actions.addFromInput,
  })
  const has = local.favorites.length > 0
  const controls = [
    quiet(el, local, { key: PTT_KEYS.hot, label: PTT_TEXT.hot, onPress: actions.hot }),
    has ? quiet(el, local, { key: PTT_KEYS.manage, label: PTT_TEXT.manage, onPress: actions.manage }) : null,
    has ? refresh(el, local, actions) : null,
  ]
  // Narrow: the controls on their own row, the caption under them; else one row.
  const head = layout.compact
    ? [h(el.Box, { key: PTT_KEYS.controls, flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }, ...controls.filter(Boolean)), ...(has ? [h(el.Box, { key: PTT_KEYS.boardsHead }, caption(el, layout, PTT_TEXT.boards))] : [])]
    : [bar(el, layout, PTT_KEYS.boardsHead, [has ? caption(el, layout, PTT_TEXT.boards) : null], controls)]
  const rows = local.favorites.map((favorite) => {
    const latest = boardOf(shared, favorite.name, null)
    const fresh = newPosts(shared, favorite)
    const newest = latest ? newestFirst(latest.items).find((item) => !item.pinned && !item.deleted) : null
    const secondary = !latest || (latest.state === 'loading' && latest.items.length === 0) ? 'Loading…' : latest.state === 'error' && latest.items.length === 0 ? PTT_TEXT.failed(explain(latest.errorCode)) : (newest?.title ?? '')
    return navRow(el, layout, {
      key: PTT_KEYS.favorite(favorite.name),
      title: favorite.name,
      titleRole: 'heading',
      meta: fresh && fresh.count > 0 ? PTT_TEXT.newPosts(fresh.count, fresh.more) : null,
      metaRole: 'warning',
      secondary,
      press: { key: PTT_KEYS.openFavorite(favorite.name), onPress: () => actions.openBoard(favorite.name) },
      local,
    })
  })
  return [
    h(el.Box, { key: `${PTT_KEYS.addInput}:group`, flexDirection: 'column' }, field, noteLine(el, noteOf(local, shared, null, { home: true }))),
    h(el.Box, { key: `${PTT_KEYS.boards}:group`, flexDirection: 'column', rowGap: layout.composition.headGap }, ...head, ...(has ? [h(el.Box, { key: PTT_KEYS.boards, flexDirection: 'column', rowGap: layout.sectionGap }, ...rows)] : [EmptyState(el, layout, { key: PTT_KEYS.noBoards, title: PTT_TEXT.noBoards, description: PTT_TEXT.noBoardsHint })])),
  ]
}

// ---- manage -----------------------------------------------------------------------

function manage(el, layout, local, shared, actions) {
  const rows = local.favorites.map((favorite, index) =>
    navRow(el, layout, {
      key: PTT_KEYS.manageRow(favorite.name),
      title: favorite.name,
      titleRole: 'heading',
      controls: [
        index > 0 ? quiet(el, local, { key: PTT_KEYS.up(favorite.name), label: PTT_TEXT.up(favorite.name), glyph: '↑', dim: false, onPress: () => actions.moveUp(favorite.name) }) : null,
        index < local.favorites.length - 1 ? quiet(el, local, { key: PTT_KEYS.down(favorite.name), label: PTT_TEXT.down(favorite.name), glyph: '↓', dim: false, onPress: () => actions.moveDown(favorite.name) }) : null,
        quiet(el, local, { key: PTT_KEYS.remove(favorite.name), label: PTT_TEXT.remove, onPress: () => actions.remove(favorite.name) }),
      ],
    }),
  )
  return [
    bar(el, layout, PTT_KEYS.bar, [action(el, { key: PTT_KEYS.done, label: PTT_TEXT.done, kind: 'primary', autoFocus: local.focus === PTT_KEYS.done || local.focus === null, onPress: actions.home }, layout), heading(el, PTT_TEXT.boards)]),
    noteLine(el, noteOf(local, shared, null)),
    rows.length === 0 ? EmptyState(el, layout, { key: PTT_KEYS.noBoards, title: PTT_TEXT.noBoards, description: PTT_TEXT.noBoardsHint }) : h(el.Box, { key: PTT_KEYS.boards, flexDirection: 'column', rowGap: layout.sectionGap }, ...rows),
  ]
}

// ---- hot --------------------------------------------------------------------------

function hot(el, layout, local, shared, actions) {
  const value = hotOf(shared)
  const known = new Set(local.favorites.map((favorite) => favorite.name.toLowerCase()))
  const parts = [bar(el, layout, PTT_KEYS.bar, [back(el, layout, local, actions.back), heading(el, PTT_TEXT.hot)], [refresh(el, local, actions)]), noteLine(el, noteOf(local, shared, value))]
  if (!value || (value.items.length === 0 && value.state !== 'error')) parts.push(Loading(el, { key: `${PTT_KEYS.hotList}:loading` }))
  else if (value.items.length > 0) {
    const rows = value.items.map((item) =>
      navRow(el, layout, {
        key: PTT_KEYS.hotRow(item.name),
        title: item.name,
        titleRole: 'heading',
        meta: item.users !== null ? String(item.users) : null,
        secondary: join(item.category, item.title),
        controls: [
          known.has(item.name.toLowerCase()) ? null : quiet(el, local, { key: PTT_KEYS.hotAdd(item.name), label: PTT_TEXT.addBoard(item.name), glyph: '+', onPress: () => actions.addHot(item.name) }),
        ],
        press: { key: PTT_KEYS.hotOpen(item.name), onPress: () => actions.openHot(item.name) },
        local,
      }),
    )
    parts.push(h(el.Box, { key: PTT_KEYS.hotList, flexDirection: 'column', rowGap: layout.sectionGap }, ...rows))
  }
  return parts
}

// ---- board ------------------------------------------------------------------------

function postRow(el, layout, local, item, index, actions) {
  if (item.deleted || !item.id) return line(el, PTT_KEYS.deleted(index), 'muted', clip(join(item.title, item.date), 200))
  return navRow(el, layout, {
    key: PTT_KEYS.post(item.id),
    title: item.title || '(no title)',
    lead: item.push ? { text: item.push, style: pushStyle(item.push) } : null,
    leadWidth: 2,
    secondary: join(item.author, item.date, item.pinned ? PTT_TEXT.pinned : ''),
    press: { key: PTT_KEYS.openPost(item.id), onPress: () => actions.openArticle(item.id) },
    local,
  })
}

/**
 * The push-count filter: All, 10+, 30+, 50+, 爆, one quiet control each, the
 * one in use at full strength and bold. PTT's own search does the filtering,
 * across the whole board, not this page alone.
 */
function filters(el, layout, local, actions) {
  const chip = (push, label) => {
    const on = local.push === push
    return h(el.Button, { key: PTT_KEYS.filter(push), plain: true, ...(on ? {} : { dimColor: true }), ...autoFocus(local, PTT_KEYS.filter(push)), onPress: () => actions.filterPush(push === null ? 'all' : String(push)) }, on ? h(el.Text, { bold: true }, label) : label)
  }
  return h(el.Box, { key: PTT_KEYS.filters, flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }, chip(null, PTT_TEXT.all), ...PUSH_FILTERS.map((n) => chip(n, PTT_TEXT.pushLabel(n))))
}

function board(el, layout, local, shared, actions) {
  const push = pushShown(local)
  const value = boardOf(shared, local.board, local.page, push)
  const known = local.favorites.some((favorite) => favorite.name.toLowerCase() === local.board.toLowerCase())
  const parts = [
    bar(el, layout, PTT_KEYS.bar, [back(el, layout, local, actions.back), heading(el, local.board)], [known ? null : quiet(el, local, { key: PTT_KEYS.addThis, label: PTT_TEXT.addBoard(local.board), glyph: '+', onPress: actions.addThis }), refresh(el, local, actions)]),
    filters(el, layout, local, actions),
    noteLine(el, noteOf(local, shared, value)),
  ]
  if (!value || (value.items.length === 0 && value.state === 'loading')) parts.push(Loading(el, { key: `${PTT_KEYS.posts}:loading` }))
  else if (value.items.length === 0) parts.push(EmptyState(el, layout, { key: `${PTT_KEYS.posts}:empty`, title: value.state === 'error' ? PTT_TEXT.failed(explain(value.errorCode)) : push ? PTT_TEXT.noFiltered(push) : PTT_TEXT.noPosts }))
  else {
    const ordered = newestFirst(value.items)
    parts.push(h(el.Box, { key: PTT_KEYS.posts, flexDirection: 'column', rowGap: layout.sectionGap }, ...ordered.map((item) => postRow(el, layout, local, item, value.items.indexOf(item), actions))))
  }
  const pageNumber = value?.index ?? local.page
  parts.push(
    bar(
      el,
      layout,
      PTT_KEYS.paging,
      // A Back down here too: the pane has no fixed header, and the list is long.
      [back(el, layout, local, actions.back, PTT_KEYS.backBottom), value?.prev ? action(el, { key: PTT_KEYS.older, label: PTT_TEXT.older, autoFocus: local.focus === PTT_KEYS.older, onPress: actions.older }, layout) : null, h(el.Box, { key: PTT_KEYS.pageLabel }, text(el, 'meta', push ? PTT_TEXT.filteredPage(push, local.page === null ? null : pageNumber) : local.page === null ? PTT_TEXT.latest : PTT_TEXT.pageOf(pageNumber)))],
      [local.page !== null ? action(el, { key: PTT_KEYS.newer, label: PTT_TEXT.newer, autoFocus: local.focus === PTT_KEYS.newer, onPress: actions.newer }, layout) : null],
    ),
  )
  return parts
}

// ---- article ----------------------------------------------------------------------

/**
 * A push line in PTT's own colours: 推 bright, 噓 and → red, the user bright
 * yellow, the text yellow, the time dim. (PTT's web page: `hl push-tag`,
 * `f1 hl push-tag`, `f3 hl push-userid`, `f3 push-content`.) Theme names
 * only: `error` is the red, `warning` the yellow.
 */
export const PUSH_STYLE = Object.freeze({
  tag: Object.freeze({ 推: Object.freeze({ bold: true }), 噓: Object.freeze({ color: 'error', bold: true }), '→': Object.freeze({ color: 'error', bold: true }) }),
  user: Object.freeze({ color: 'warning', bold: true }),
  text: Object.freeze({ color: 'warning' }),
  time: Object.freeze({ dimColor: true }),
})

function pushLine(el, push, index) {
  const { Text } = el
  const clean = (value, max) => sanitizeText(value, { max, singleLine: true })
  return h(
    el.Box,
    { key: PTT_KEYS.push(index) },
    h(
      Text,
      { wrap: 'wrap' },
      h(Text, PUSH_STYLE.tag[push.tag] ?? PUSH_STYLE.tag['→'], `${push.tag} `),
      h(Text, PUSH_STYLE.user, clean(push.user, 40)),
      h(Text, PUSH_STYLE.text, `: ${clean(push.text, 200)}`),
      ...(push.time ? [h(Text, PUSH_STYLE.time, `  ${clean(push.time, 20)}`)] : []),
    ),
  )
}

/**
 * The article's text. Where links open, a line holding an https image
 * address draws it as a Link to the browser (never fetched, never shown);
 * the other lines stay plain text, run together as one Text as before.
 */
/**
 * What a body line is, for its colour: PTT draws a quote's header
 * (`※ 引述《someone》之銘言：`) green and the quoted lines (`: …`) cyan, so a
 * reply's quote never reads as the reply.
 */
export function lineKind(line) {
  const text = String(line ?? '')
  if (/^※\s*引述/.test(text)) return 'header'
  if (/^[:：]/.test(text)) return 'quote'
  return 'plain'
}

/** Body colours by line kind: theme names only (`success` the green, `suggestion` the nearest to PTT's cyan). */
export const BODY_STYLE = Object.freeze({
  plain: Object.freeze({}),
  header: Object.freeze({ color: 'success' }),
  quote: Object.freeze({ color: 'suggestion' }),
})

/**
 * The article's text. Lines run together as one Text per kind (plain, a
 * quote's header, quoted lines), each kind in its colour. Where links open,
 * a line holding an https address draws it as a Link to the browser
 * (never fetched, never shown). A body of plain lines alone is one Text.
 */
function bodyOf(el, layout, lines) {
  const box = (...children) => h(el.Box, { key: PTT_KEYS.body, flexDirection: 'column' }, ...children)
  const opens = (url) => linkOpens(layout.composition, url)
  const imageLine = (one) => segmentsOf(one).some((part) => part.url && opens(part.url))
  if (lines.every((one) => lineKind(one) === 'plain' && !imageLine(one))) return box(text(el, 'body', lines.join('\n'), { wrap: 'wrap' }))
  const blocks = []
  let run = []
  let kind = 'plain'
  let images = 0
  let texts = 0
  const flush = () => {
    if (run.length === 0) return
    blocks.push(h(el.Box, { key: PTT_KEYS.bodyPart(texts) }, h(el.Text, { ...BODY_STYLE[kind], wrap: 'wrap' }, run.join('\n'))))
    texts += 1
    run = []
  }
  for (const one of lines) {
    if (imageLine(one)) {
      flush()
      const style = BODY_STYLE[lineKind(one)]
      const pieces = segmentsOf(one).map((part) => (part.url && opens(part.url) ? h(el.Link, { href: part.url, label: clip(part.url, 120) }) : h(el.Text, style, part.url ?? part.text)))
      blocks.push(h(el.Box, { key: PTT_KEYS.image(images), flexDirection: 'row', flexWrap: 'wrap' }, ...pieces))
      images += 1
      continue
    }
    const next = lineKind(one)
    // A blank line stays with the run it is in: it has no colour to change.
    if (next !== kind && one.trim() !== '') {
      flush()
      kind = next
    }
    run.push(one)
  }
  flush()
  return box(...blocks)
}

function article(el, layout, local, shared, actions) {
  const value = articleOf(shared, local.board, local.article)
  const listed = boardOf(shared, local.board, local.page, pushShown(local))?.items.find((item) => item.id === local.article) ?? null
  const url = `https://www.ptt.cc/bbs/${local.board}/${local.article}.html`
  const opens = linkOpens(layout.composition, url)
  const parts = [
    bar(el, layout, PTT_KEYS.bar, [back(el, layout, local, actions.back)], [
      quiet(el, local, { key: PTT_KEYS.copyLink, label: PTT_TEXT.copyLink, onPress: actions.copyLink }),
      opens ? h(el.Box, { key: PTT_KEYS.link }, h(el.Link, { href: url, label: PTT_TEXT.openOnPtt })) : null,
      refresh(el, local, actions),
    ]),
    h(el.Box, { key: PTT_KEYS.heading }, text(el, 'heading', clip(value?.meta.title || listed?.title || local.article, 200), { wrap: 'wrap' })),
    noteLine(el, noteOf(local, shared, value)),
  ]
  if (!value || (value.state === 'loading' && !value.body)) {
    parts.push(Loading(el, { key: `${PTT_KEYS.body}:loading` }))
    return parts
  }
  if (value.state === 'error' && !value.stale) return parts
  parts.splice(2, 0, line(el, PTT_KEYS.meta, 'meta', clip(join(value.meta.author, value.meta.time), 160)))
  const lines = sanitizeText(value.body, { max: 24000 }).split('\n')
  // The signature separator (`--`) and blank lines at the end say nothing in the pane.
  while (lines.length > 1 && /^(--)?\s*$/.test(lines[lines.length - 1])) lines.pop()
  const shownLines = local.full ? lines : lines.slice(0, BODY_LINES)
  parts.push(bodyOf(el, layout, shownLines))
  const hiddenLines = lines.length - shownLines.length
  const hiddenPushes = local.full ? 0 : Math.max(0, Math.min(value.pushes.length, PUSHES_MAX) - PUSHES_SHOWN)
  if (local.full || hiddenLines > 0 || hiddenPushes > 0) {
    const label = local.full ? PTT_TEXT.showLess : hiddenLines > 0 ? PTT_TEXT.showMore(hiddenLines) : PTT_TEXT.showAll
    parts.push(h(el.Box, { key: `${PTT_KEYS.more}:box` }, quiet(el, local, { key: PTT_KEYS.more, label, onPress: actions.toggleFull })))
  }
  if (value.bodyCut && local.full) parts.push(line(el, `${PTT_KEYS.body}:cut`, 'muted', PTT_TEXT.bodyCut, 'wrap'))
  const pushes = value.pushes.slice(0, local.full ? PUSHES_MAX : PUSHES_SHOWN)
  const notShown = value.pushesCut + Math.max(0, value.pushes.length - PUSHES_MAX)
  parts.push(
    h(
      el.Box,
      { key: PTT_KEYS.pushes, flexDirection: 'column' },
      bar(el, layout, PTT_KEYS.pushesHead, [caption(el, layout, PTT_TEXT.pushes)], [text(el, 'meta', PTT_TEXT.pushCounts(value.counts))]),
      ...(pushes.length === 0 ? [line(el, `${PTT_KEYS.pushes}:none`, 'muted', PTT_TEXT.noPushes)] : pushes.map((push, index) => pushLine(el, push, index))),
      ...(local.full && notShown > 0 ? [line(el, PTT_KEYS.pushesNote, 'muted', PTT_TEXT.pushesCut(notShown), 'wrap')] : []),
    ),
  )
  // The pane has no fixed header: Back and a way to the top at the end too.
  parts.push(bar(el, layout, PTT_KEYS.bottom, [back(el, layout, local, actions.back, PTT_KEYS.backBottom)], [quiet(el, local, { key: PTT_KEYS.top, label: PTT_TEXT.top, onPress: actions.top })]))
  return parts
}

/**
 * @param {{ configured: boolean }} options   from the plugin options (switched on)
 */
export function renderPtt({ local: stored, shared }, el, frame, actions, options = { configured: false }) {
  const { Box } = el
  const layout = layoutFor(frame)
  const local = normalizeLocal(stored)
  const root = (...children) => h(Box, { key: PTT_KEYS.root, flexDirection: 'column', rowGap: layout.sectionGap }, ...children.filter(Boolean))
  if (!options.configured) return root(EmptyState(el, layout, { key: PTT_KEYS.empty, title: PTT_TEXT.unconfigured, description: PTT_TEXT.unconfiguredHint }))
  const values = shared ?? {}
  const screen = local.view === 'hot' ? hot(el, layout, local, values, actions) : local.view === 'manage' ? manage(el, layout, local, values, actions) : local.view === 'board' ? board(el, layout, local, values, actions) : local.view === 'article' ? article(el, layout, local, values, actions) : home(el, layout, local, values, actions)
  return root(...screen)
}
