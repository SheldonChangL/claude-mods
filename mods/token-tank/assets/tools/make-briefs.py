#!/usr/bin/env python3
"""Writes one short Codex brief per sprite into assets/briefs/<name>.md."""
import os, textwrap
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.dirname(here)
ROWS = [
 ("guppy", 32, 24, '孔雀魚 Guppy (Poecilia reticulata), drawn like the real fish: a slim small body about twice as long as tall, a tiny pointed head with a small upturned mouth, and a HUGE fan-shaped caudal tail taking a third of the length (iridescent teal/blue body, orange-and-yellow spotted tail and a tall dorsal fin)', "swim 4, spit 2"),
 ("clownfish", 32, 24, '小丑魚 Ocellaris clownfish (Amphiprion ocellaris), like the real fish: a plump oval body, rounded fins, bright orange with THREE white bands (head, middle, tail base) each edged in black, a small eye', "swim 4, spit 2"),
 ("angelfish", 40, 32, '神仙魚 Freshwater angelfish (Pterophyllum scalare), like the real fish: a thin DISC-shaped body as tall as it is long, very tall pointed dorsal and anal fins making a triangle, long thread-like pelvic fins hanging down, silver with 3–4 black vertical bars, small pointed mouth', "swim 4, spit 2"),
 ("koi", 40, 32, '錦鯉 Koi (Cyprinus rubrofuscus), like the real fish: a long torpedo body, white with large red-orange patches (kohaku pattern), two barbels, a forked tail', "swim 4, spit 2"),
 ("puffer", 32, 24, '河豚 Pufferfish (Tetraodon), like the real fish: a round balloon body, big round eyes, a small beak mouth, tiny translucent fins, short spikes, yellow with brown spots and a pale belly', "swim 4, spit 2"),
 ("tang", 32, 24, "藍倒吊 Regal blue tang (Paracanthurus hepatus), like the real fish: an oval laterally flat body, royal blue with a BLACK 'palette' stroke along the back and flank, a bright YELLOW tail, a small mouth", "swim 4, spit 2"),
 ("goldfish", 32, 24, '金魚 Fancy goldfish (Carassius auratus), like the real fish: an egg-shaped orange body, a pale belly, a long flowing DOUBLE tail that fans out behind, rounded fins, a big round eye', "swim 4, spit 2"),
 ("seahorse", 24, 32, '海馬 Seahorse (Hippocampus), like the real animal: an upright S-curved body, a horse-like head with a long tubular snout pointing right, a curled tail at the bottom, ridged body segments, teal with pink spots and a small fin on the back', "swim 4, spit 2"),
 ("neon", 32, 24, "霓虹燈魚 Neon tetra (Paracheirodon innesi), like the real fish: a tiny slim torpedo body, an electric blue stripe along the upper flank from eye to adipose fin, a bright red stripe along the lower rear half, silver belly, small clear fins; draw it small inside the canvas (about 26 × 10 px of body)", "swim 4, spit 2"),
 ("betta", 40, 32, "鬥魚 Siamese fighting fish / betta (Betta splendens), like the real fish: a small slim body with HUGE flowing veil fins and tail that spread like silk, deep red shading to blue-violet, a short upturned mouth", "swim 4, spit 2"),
 ("butterflyfish", 32, 24, "蝴蝶魚 Copperband butterflyfish (Chelmon rostratus), like the real fish: a disc-shaped silver-white body with 3–4 vertical copper-orange bands, a long thin pointed snout, a black eye-spot on the dorsal fin", "swim 4, spit 2"),
 ("lionfish", 40, 32, "獅子魚 Red lionfish (Pterois volitans), like the real fish: a stocky body with red-brown and white vertical stripes, long fan-like spiny pectoral fins spreading out like rays, tall venomous dorsal spines", "swim 4, spit 2"),
 ("arowana", 48, 24, "龍魚 Asian arowana (Scleropages formosus), like the real fish: a long sword-like body, large metallic gold-red scales with dark edges, a large upturned mouth with two barbels, dorsal and anal fins set far back near the tail", "swim 4, spit 2"),
 ("coin", 12, 12, "a gold coin with a darker rim and a highlight", "spin 4 (front, 3/4, edge, 3/4)"),
 ("pellet", 4, 4, "a brown fish-food pellet", "idle 1"),
 ("seaweed", 16, 40, "a tall green seaweed strand, two tones, rooted at the bottom", "sway 4 (the tip moves 1-2 px per frame)"),
 ("coral", 32, 28, "a pink/purple branching coral", "idle 1"),
 ("rock", 40, 24, "a grey-purple boulder with a lit top", "idle 1"),
 ("chest", 48, 32, "a wooden treasure chest with brass bands", "closed 1, open 2 (lid up; lid up with a gold glint)"),
 ("ruin", 40, 56, "a stone arch or pillar ruin, mossy", "idle 1"),
 ("anchor", 24, 32, "an old iron anchor", "idle 1"),
 ("shell", 16, 12, "a cream scallop shell", "idle 1"),
 ("starfish", 14, 14, "an orange-red starfish", "idle 1"),
]
TPL = """# Pixel sprite: {name}

Write ONE file, `sprites/{name}.json`, original pixel art (copy nothing from
existing games). Shape:

```json
{{ "name": "{name}", "w": {w}, "h": {h},
  "palette": {{ "A": "#rrggbb", "B": "#rrggbb" }},
  "frames": {{ "<anim>": [ ["....AABB....", ...], ... ] }} }}
```

Each frame is exactly {h} strings of exactly {w} characters; only palette
letters (A–Z, at most 7) and `.` (transparent). Fish face RIGHT.

Subject: {desc}. Animations: {anims}. A swim cycle is tail left, centre,
right, centre with a 1 px body bob; spit is the mouth opening then a small
highlight at the mouth.

Make it look like the REAL species named above (real proportions, fin shapes and markings), not a generic fish: anyone should recognise it at a glance.

Style: crisp 1-px outline in the sprite's own dark shade (not pure black),
2–3 tone shading, a strong readable silhouette, saturated colours that read
on deep-blue water (#14456e).

Author the pixels directly (or with a tiny generator you run), then validate
the file with `python3 tools/validate.py sprites/{name}.json` and fix until it
passes. Do nothing else; no previews, no narration. Reply with one line.
"""
for name, w, h, desc, anims in ROWS:
    open(os.path.join(A, 'briefs', name + '.md'), 'w').write(TPL.format(name=name, w=w, h=h, desc=desc, anims=anims))
print('briefs:', len(ROWS))
