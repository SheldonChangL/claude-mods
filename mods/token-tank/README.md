# Token Tank 代幣魚缸

A pixel-art aquarium that lives in a Claude Code pane. Claude's work feeds the
fish: every turn's token usage becomes energy, the fish turn energy into coins,
and successful edits, passing tests and git commits pay a little extra. You
collect the coins, feed the fish, buy new species and decorations, and level
the fish up. Nothing dies while you are away; the tank simply waits.

## Install

From a terminal session of Claude Code (`y` to add the marketplace, then pick a scope):

```
/plugin install token-tank --marketplace SheldonChangL/claude-mods
```

From a shell: `claude plugin install token-tank --marketplace SheldonChangL/claude-mods`. In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SheldonChangL/claude-mods`, then **Add plugin**.

The words follow Claude's language: Chinese when Claude Code's `language` setting (or the shell's `LANG`) is Chinese, English otherwise; the settings tab can pin either.

## Use

- `/fish` opens the pane. `/fish collect` collects every pending coin and
  `/fish feed` feeds every fish without opening it.
- In the pane: pick a fish by name to see its card (hunger, mood, XP), then
  feed, collect, rename or level it up. 收全部 / 餵全部 act on the whole tank.
- 商店 sells fish (more unlock as the tank grows), decorations and food. 魚冊
  is the species you have owned, 統計 the token and coin figures, 設定 the
  theme and the animation switches (turn on 簡化動畫 on a slow machine).

## How coins are made

`effective = input + 2×output + 0.1×cacheRead + 1.25×cacheWrite` per main-loop
turn (subagents are part of the same work and do not pay twice). Energy is
`effective / 1000`, with the part above 15,000 counted at a fifth, so idle
prompts are a poor way to farm. Each fish adds `energy × rate × level × hunger
× mood` to its progress; whole coins wait on the fish (at most 80 each) until
you collect them. Fractions carry over, so small turns still add up.

## Where it is stored

The game is one JSON value in the plugin's `$.store`, shared by every session.
A v2 save from an earlier build is migrated and the original kept under
`game.backup.v2`.

## Surfaces

Claude Code Desktop draws the tank as an SVG with native animation. The
terminal shows a text tank with the same buttons; a pixel terminal tank (kitty
graphics) is planned.

## Develop

```
claude plugin validate .
claude plugin test .
node assets/tools/build-sprites.mjs   # assets/sprites.json → render/sprites.ts
```

MIT licensed. All pixel art is original.
