# ptt

A read-only [PTT](https://www.ptt.cc/) (批踢踢) pane for Claude Code: the boards you pick, how many posts are new on each, a board's posts with a push-count filter, an article with its pushes, and PTT's hot boards. No account, no login: nothing is ever posted, pushed or sent to PTT.

## Install

From a terminal session of Claude Code (`y` to add the marketplace, then pick a scope):

```
/plugin install ptt --marketplace SheldonChangL/claude-mods
```

From a shell: `claude plugin install ptt --marketplace SheldonChangL/claude-mods`. In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SheldonChangL/claude-mods`, then **Add plugin**.

## Use

- `/ptt` opens the pane; `/ptt close` closes it.
- **Your boards.** Type a board name in the field (`soft_job` is fine) and press Enter: PTT is asked whether the board exists and how it is spelt, and it is kept under that spelling (`Soft_Job`). Or pick one from **Hot boards**. Each board shows its newest post and how many posts are new since you last opened it. **Manage** reorders and removes boards; **↻** reads them again now.
- **A board.** Its posts, newest first: the push count in PTT's colours (爆 red, 10-99 yellow, 1-9 green, X dim), the title, and author and date under it; either line opens the post. **All · 10+ · 30+ · 50+ · 爆** filters the whole board by push count (PTT's own search). **‹ Older** and **Newer ›** page through it.
- **An article.** Title, author and time, the text (30 lines, then **Show all**) and the pushes (`推 · 噓 · →` counts). **Copy link** puts its ptt.cc address on the clipboard; an https address in the text (an image, a video, a page) opens in your browser; an http one stays text. Nothing in the pane is fetched from anywhere but ptt.cc, and no image is downloaded or shown.

The pane is drawn for a narrow side pane first (the desktop app's), and works the same in a fullscreen terminal.

## Options

`/config` → ptt → **New posts check (seconds)**: how often your boards are checked for new posts once `/ptt` has been opened in a session; 60 to 3600, default 300.

## What it touches

- **The network: www.ptt.cc only.** Every request is a GET of a `https://www.ptt.cc/bbs/...` page the mod builds from checked parts (a board name, a page number, an article id, a push-count filter of 10, 30, 50 or 100), sent through Claude Code's own `$.http.fetch`, with PTT's `over18=1` cookie (its age-gate answer, no account) and a user agent naming this mod. One request at a time, at least a second apart; after a 429 or 503 every request waits (a minute at least). Nothing is fetched in a session until `/ptt` is opened there; after that, only your boards' first pages are re-read, at the interval above, while the session lasts.
- **Your machine.** Your boards and when you last opened each are kept in the plugin's own store under `~/.claude`. Pages and articles are kept in memory only and read again in a new session.
- **Nothing else.** No shell, no files outside `~/.claude`, no other site, no model calls. Titles, names and posts are other people's text: the pane draws them as plain, sanitized text, never as markup or a link (an https address is the one exception, and it only opens in your browser).

## Not done, on purpose

No login, so no PTT-side favourites (我的最愛), no pushing, posting or mail. No search beyond the push-count filter, no images in the pane, no board categories.

## Develop

```bash
claude plugin test .
claude plugin validate --strict .
```

`lib/` is plain ES modules: `parse.mjs` (PTT's pages into plain values), `client.mjs` (the checked GET and the polite queue), `service.mjs` (what is read when, kept where), `actions.mjs`, `state.mjs`, `model.mjs`, `view.mjs` (the pane), `app.mjs` (the wiring). `hooks/main.mjs` is the only file that touches the engine (`$`). The tests use synthetic pages shaped like PTT's (`tests/fixtures/pages.mjs`), never real ones, and answer `$.http.fetch` themselves: they make no request.
