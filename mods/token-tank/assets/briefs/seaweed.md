# Pixel sprite: seaweed

Write ONE file, `sprites/seaweed.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{ "name": "seaweed", "w": 16, "h": 40,
  "palette": { "A": "#rrggbb", "B": "#rrggbb" },
  "frames": { "<anim>": [ ["....AABB....", ...], ... ] } }
```

Each frame is exactly 40 strings of exactly 16 characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: a tall green seaweed strand, two tones, rooted at the bottom. Animations: sway 4 (the tip moves 1-2 px per frame). A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/seaweed.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
