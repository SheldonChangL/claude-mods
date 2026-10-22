# Token Tank — pixel art brief (for Codex)

Deliver ORIGINAL pixel-art sprites for a Claude Code aquarium mod. No copying
of existing games' assets (no existing aquarium game, no Nintendo, nothing).

## Deliverable 1: `sprites.json` (in this folder)

```json
{
  "sprites": {
    "<name>": {
      "w": 32, "h": 24,
      "palette": { "A": "#1a1a2e", "B": "#ff7a30", ... },   // ≤ 7 colours per sprite, letters A–Z
      "frames": {
        "<animation>": [ ["....AABB....", "...", ...], ... ]  // each frame = h strings of w chars, '.' = transparent
      }
    }
  }
}
```

Every frame of a sprite has exactly `h` rows of exactly `w` characters. Only
| name | w × h | animations (frames) |
|---|---|---|
| coin | 12 × 12 | spin 4 (front, 3/4, edge, 3/4) |
| pellet (fish food) | 4 × 4 | idle 1 |
| seaweed | 16 × 40 | sway 4 |
| coral (pink/purple branching) | 32 × 28 | idle 1 |
| rock (grey-purple boulder) | 40 × 24 | idle 1 |
| chest (treasure chest) | 48 × 32 | closed 1, open 2 |
| ruin (stone arch / pillar) | 40 × 56 | idle 1 |
| anchor | 24 × 32 | idle 1 |
| shell | 16 × 12 | idle 1 |
| starfish | 14 × 14 | idle 1 |

`sprites.json` already holds the eight fish: ADD these props to it (keep the
fish untouched). Sway: the seaweed tip moves 1–2 px each frame. Chest open:
lid up, then lid up with a gold glint. Coin spin: front, 3/4, edge, 3/4.
Re-run `tools/preview.py` for the new sprites and write `preview/sheet.png`
with every sprite's first frame on one sheet. Validate the JSON before
finishing. Same style rules as the fish. Keep replies short; report at the
end in ten lines or fewer.
