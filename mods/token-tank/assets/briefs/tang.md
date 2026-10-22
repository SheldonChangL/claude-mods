# Pixel sprite: tang

Write ONE file, `sprites/tang.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{ "name": "tang", "w": 32, "h": 24,
  "palette": { "A": "#rrggbb", "B": "#rrggbb" },
  "frames": { "<anim>": [ ["....AABB....", ...], ... ] } }
```

Each frame is exactly 24 strings of exactly 32 characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: 藍倒吊 Regal blue tang (Paracanthurus hepatus), like the real fish: an oval laterally flat body, royal blue with a BLACK 'palette' stroke along the back and flank, a bright YELLOW tail, a small mouth. Animations: swim 4, spit 2. A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/tang.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
