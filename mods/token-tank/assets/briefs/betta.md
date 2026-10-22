# Pixel sprite: betta

Write ONE file, `sprites/betta.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{ "name": "betta", "w": 40, "h": 32,
  "palette": { "A": "#rrggbb", "B": "#rrggbb" },
  "frames": { "<anim>": [ ["....AABB....", ...], ... ] } }
```

Each frame is exactly 32 strings of exactly 40 characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: 鬥魚 Siamese fighting fish / betta (Betta splendens), like the real fish: a small slim body with HUGE flowing veil fins and tail that spread like silk, deep red shading to blue-violet, a short upturned mouth. Animations: swim 4, spit 2. A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/betta.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
