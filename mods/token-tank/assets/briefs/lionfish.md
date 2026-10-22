# Pixel sprite: lionfish

Write ONE file, `sprites/lionfish.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{ "name": "lionfish", "w": 40, "h": 32,
  "palette": { "A": "#rrggbb", "B": "#rrggbb" },
  "frames": { "<anim>": [ ["....AABB....", ...], ... ] } }
```

Each frame is exactly 32 strings of exactly 40 characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: 獅子魚 Red lionfish (Pterois volitans), like the real fish: a stocky body with red-brown and white vertical stripes, long fan-like spiny pectoral fins spreading out like rays, tall venomous dorsal spines. Animations: swim 4, spit 2. A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/lionfish.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
