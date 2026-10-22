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

`effective = input + 2×output + 0.02×cacheRead + 1.25×cacheWrite` per main-loop
turn (subagents are part of the same work and do not pay twice). Energy is
`(min(effective, 15,000) + 0.1 × the rest) / 2,500`, so idle prompts are a poor
way to farm. The tank shares each turn's energy by weighted square root: a fish
weighs its rarity (common 1, rare 3, epic 10, legendary 32) times its level,
hunger and mood, and gets `energy × w / √Σw`, so more fish earn more but with
diminishing returns and rarer fish earn far more each. Every fish has a daily
quota by rarity (120 / 360 / 960 / 1,920 coins); past it coins come at a fifth.
Whole coins wait on the sand (at most 80 a fish) until you pick them up;
fractions carry over.

The tank levels up on lifetime coins produced (18 levels, Lv.5 at 640, Lv.10 at
3,200, Lv.18 at 11,500); levels unlock rarer species and more fish slots, and
extra slots can be bought. Edits, passing tests and commits pay a little extra
into the wallet but never count toward the level. `docs/economy-balance-report.md`
holds the 60-day simulations behind these numbers; `npx tsx
scripts/simulate-economy.ts` reruns them.

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
