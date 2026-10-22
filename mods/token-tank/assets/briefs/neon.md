# Pixel sprite: neon

Write ONE file, `sprites/neon.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{ "name": "neon", "w": 32, "h": 24,
  "palette": { "A": "#rrggbb", "B": "#rrggbb" },
  "frames": { "<anim>": [ ["....AABB....", ...], ... ] } }
```

Each frame is exactly 24 strings of exactly 32 characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: 霓虹燈魚 Neon tetra (Paracheirodon innesi), like the real fish: a tiny slim torpedo body, an electric blue stripe along the upper flank from eye to adipose fin, a bright red stripe along the lower rear half, silver belly, small clear fins; draw it small inside the canvas (about 26 × 10 px of body). Animations: swim 4, spit 2. A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/neon.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
