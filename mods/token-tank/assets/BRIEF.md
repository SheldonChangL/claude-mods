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
palette letters and `.` appear. Fish FACE RIGHT (the renderer mirrors them).

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

Swim frames: a 4-frame cycle (tail left, centre, right, centre; fins and body
bob by 1 px). Spit frames: mouth opening then a small highlight at the mouth.
Sway: the seaweed tip moves 1–2 px each frame. Chest open: lid up, then lid up
with a gold glint.

Style: crisp 1-px dark outline (not pure black: use the sprite's own dark
shade), 2–3 tone shading, strong readable silhouettes, saturated colours that
read on a deep-blue (#0b2a4a → #14456e) water background. Every species must
differ in silhouette and colour, not just a recolour.

## Deliverable 2: previews

Write `tools/preview.py` (Python 3, Pillow is available; otherwise write PNG
with zlib by hand) that renders `sprites.json` to `preview/<name>-<anim>.png`
at 6× scale with nearest-neighbour on a #14456e background, every frame side by
side. Run it and leave the PNGs in `preview/`. Also write `preview/sheet.png`
with every sprite's first frame on one sheet.

You may author pixels by hand or by a generator script in `tools/`; the JSON is
what counts. Validate the JSON (row counts, widths, palette letters) with a
script before finishing. Report at the end: how each sprite was made, anything
you could not do, and the validation output.
