// Synthetic PTT pages for the PTT service's tests, shaped like www.ptt.cc's
// markup (r-ent rows, the paging buttons, metalines, pushes, b-ent rows)
// with made-up boards, users and text. No real PTT content.

/** One r-ent row: { id, title, author, date, push, mark } or { deleted: '[someone]' }. */
export function row({ board = 'TestBoard', id = 'M.1700000001.A.ABC', title = '[閒聊] 測試標題', author = 'alice01', date = '10/21', push = '', mark = '', deleted = null } = {}) {
  const nrec = push === '' ? '<div class="nrec"></div>' : `<div class="nrec"><span class="hl f3">${push}</span></div>`
  const titleHtml = deleted
    ? `\n\t\t\t\n\t\t\t\t(本文已被刪除) ${deleted}\n\t\t\t\n\t\t\t`
    : `\n\t\t\t\n\t\t\t\t<a href="/bbs/${board}/${id}.html">${title}</a>\n\t\t\t\n\t\t\t`
  return `
		<div class="r-ent">
			${nrec}
			<div class="title">${titleHtml}</div>
			<div class="meta">
				<div class="author">${deleted ? '-' : author}</div>
				<div class="article-menu">
					<div class="trigger">&#x22ef;</div>
					<div class="dropdown">
						<div class="item"><a href="/bbs/${board}/search?q=author%3A${author}">搜尋看板內 ${author} 的文章</a></div>
					</div>
				</div>
				<div class="date">${date}</div>
				<div class="mark">${mark}</div>
			</div>
		</div>
`
}

/** A board list page. prev / next: a page number, or null for a disabled button. */
export function boardPage({ board = 'TestBoard', prev = 41, next = null, rows = [], pinned = [] } = {}) {
  const prevLink = prev === null ? '<a class="btn wide disabled">&lsaquo; 上頁</a>' : `<a class="btn wide" href="/bbs/${board}/index${prev}.html">&lsaquo; 上頁</a>`
  const nextLink = next === null ? '<a class="btn wide disabled">下頁 &rsaquo;</a>' : `<a class="btn wide" href="/bbs/${board}/index${next}.html">下頁 &rsaquo;</a>`
  return `<!DOCTYPE html>
<html>
	<head><meta charset="utf-8"><title>看板 ${board} 文章列表 - 批踢踢實業坊</title></head>
    <body>
<div id="topbar-container">
	<div id="topbar" class="bbs-content">
		<a id="logo" href="/bbs/">批踢踢實業坊</a>
		<span>&rsaquo;</span>
		<a class="board" href="/bbs/${board}/index.html"><span class="board-label">看板 </span>${board}</a>
		<a class="right small" href="/about.html">關於我們</a>
	</div>
</div>
<div id="main-container">
	<div id="action-bar-container">
		<div class="action-bar">
			<div class="btn-group btn-group-dir">
				<a class="btn selected" href="/bbs/${board}/index.html">看板</a>
			</div>
			<div class="btn-group btn-group-paging">
				<a class="btn wide" href="/bbs/${board}/index1.html">最舊</a>
				${prevLink}
				${nextLink}
				<a class="btn wide" href="/bbs/${board}/index.html">最新</a>
			</div>
		</div>
	</div>
	<div class="r-list-container action-bar-margin bbs-screen">
		<div class="search-bar"><form type="get" action="search" id="search-bar"><input class="query" type="text" name="q" value="" placeholder="搜尋文章&#x22ef;"></form></div>
${rows.join('')}${pinned.length ? `\n        <div class="r-list-sep"></div>\n${pinned.join('')}` : ''}
	</div>
</div>
<script>var x = '<div class="r-ent">not a row</div>';</script>
    </body>
</html>
`
}

/** One push line, as PTT writes it (an IP may come before the time). */
export const push = (tag, user, text, time) =>
  `<div class="push"><span class="${tag === '推' ? '' : 'f1 '}hl push-tag">${tag} </span><span class="f3 hl push-userid">${user}</span><span class="f3 push-content">: ${text}</span><span class="push-ipdatetime"> ${time}\n</span></div>`

/** An article page: metalines, a body (raw HTML), the 發信站 footer, then pushes and edit lines (raw HTML). */
export function articlePage({ board = 'TestBoard', id = 'M.1700000001.A.ABC', author = 'alice01 (Alice)', title = '[閒聊] 測試文章', time = 'Tue Oct 21 10:00:00 2025', body = '第一行\n第二行\n', after = '', meta = true } = {}) {
  const metaline = (tag, value, right = false) => `<div class="article-metaline${right ? '-right' : ''}"><span class="article-meta-tag">${tag}</span><span class="article-meta-value">${value}</span></div>`
  const metas = meta ? `${metaline('作者', author)}${metaline('看板', board, true)}${metaline('標題', title)}${metaline('時間', time)}` : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title} - 看板 ${board} - 批踢踢實業坊</title></head><body>
<div id="topbar-container"><div id="topbar" class="bbs-content">
		<a class="board" href="/bbs/${board}/index.html"><span class="board-label">看板 </span>${board}</a>
</div></div>
<div id="main-container">
    <div id="main-content" class="bbs-screen bbs-content">${metas}
${body}
--
<span class="f2">※ 發信站: 批踢踢實業坊(ptt.cc), 來自: 192.0.2.10 (臺灣)
</span><span class="f2">※ 文章網址: <a href="https://www.ptt.cc/bbs/${board}/${id}.html" target="_blank" rel="noreferrer noopener nofollow">https://www.ptt.cc/bbs/${board}/${id}.html</a>
</span>${after}</div>
    <div id="article-polling" data-pollurl="/poll/${board}/${id}.html?cacheKey=1" data-offset="1"></div>
</div>
<script>var s = '<div class="push">fake</div>';</script>
</body></html>
`
}

/** The hot boards page. rows: [{ name, users, category, title }] (users: text as PTT shows it). */
export function hotPage(rows) {
  const ent = ({ name, users, category, title }) => `
        <div class="b-ent">
            <a class="board" href="/bbs/${name}/index.html">
                <div class="board-name">${name}</div>
                <div class="board-nuser"><span class="hl f3">${users}</span></div>
                <div class="board-class">${category}</div>
                <div class="board-title">${title}</div>
            </a>
        </div>
`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>熱門看板 - 批踢踢實業坊</title></head><body>
<div id="main-container"><div class="b-list-container action-bar-margin bbs-screen">${rows.map(ent).join('')}</div></div>
</body></html>
`
}

/** A push-count search page (search?page=N&q=recommend%3AP): a board page whose paging runs from the newest (page 1). */
export function searchPage({ board = 'TestBoard', push = 10, older = 2, newer = null, rows = [] } = {}) {
  const link = (n, label) => (n === null ? `<a class="btn wide disabled">${label}</a>` : `<a class="btn wide" href="/bbs/${board}/search?page=${n}&amp;q=recommend%3A${push}">${label}</a>`)
  return boardPage({ board, rows })
    .replace(/<a class="btn wide(?: disabled)?"[^>]*>&lsaquo; 上頁<\/a>/, link(older, '&lsaquo; 上頁'))
    .replace(/<a class="btn wide(?: disabled)?"[^>]*>下頁 &rsaquo;<\/a>/, link(newer, '下頁 &rsaquo;'))
}
