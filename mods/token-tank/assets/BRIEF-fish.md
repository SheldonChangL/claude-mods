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
| guppy (孔雀魚, small, colourful fan tail) | 32 × 24 | swim 4, spit 2 |
| clownfish (小丑魚, orange with white bands) | 32 × 24 | swim 4, spit 2 |
| angelfish (神仙魚, tall triangular, silver/black stripes) | 40 × 32 | swim 4, spit 2 |
| koi (錦鯉, long white body with red/orange patches) | 40 × 32 | swim 4, spit 2 |
| puffer (河豚, round, spiky, yellow) | 32 × 24 | swim 4, spit 2 |
| tang (藍倒吊, blue body, yellow tail) | 32 × 24 | swim 4, spit 2 |
| goldfish (金魚, round orange, flowing tail) | 32 × 24 | swim 4, spit 2 |
| seahorse (海馬, upright, teal/pink) | 24 × 32 | swim 4, spit 2 |

This batch is the EIGHT FISH ONLY (props come in a later batch). Write them to
`sprites.json` (the shape above). Also write `tools/preview.py` (Python 3 with
Pillow; fall back to a hand-written zlib PNG writer if Pillow is missing) that
renders every sprite's frames side by side at 6× nearest-neighbour on #14456e
into `preview/<name>-<anim>.png`, and run it. Validate the JSON (row counts,
widths, palette letters) with a script before finishing.

Swim frames: a 4-frame cycle (tail left, centre, right, centre; fins and body
bob by 1 px). Spit frames: mouth opening, then a small highlight at the mouth.

Style: crisp 1-px dark outline (the sprite's own dark shade, not pure black),
2–3 tone shading, strong readable silhouettes, saturated colours that read on
deep blue water. Every species must differ in silhouette and colour, not just
a recolour. Author pixels by hand or by a generator in `tools/`; the JSON is
what counts. Keep each reply short: write files, run scripts, do not narrate.
Report at the end in ten lines or fewer.
