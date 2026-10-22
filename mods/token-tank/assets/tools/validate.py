#!/usr/bin/env python3
"""Validates one sprite file: sizes, palette letters, frame counts."""
import json, re, sys
ok = True
for path in sys.argv[1:]:
    d = json.load(open(path))
    w, h, pal, frames = d['w'], d['h'], d['palette'], d['frames']
    for a, fl in frames.items():
        for i, rows in enumerate(fl):
            if len(rows) != h: print(f'{path} {a}[{i}]: {len(rows)} rows, want {h}'); ok = False
            for y, row in enumerate(rows):
                if len(row) != w: print(f'{path} {a}[{i}] row {y}: {len(row)} chars, want {w}'); ok = False
                for c in set(row) - {'.'}:
                    if c not in pal: print(f'{path} {a}[{i}] row {y}: {c!r} not in palette'); ok = False
    for k, v in pal.items():
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', v): print(f'{path}: palette {k}={v!r} is not #rrggbb'); ok = False
    if len(pal) > 7: print(f'{path}: {len(pal)} colours, max 7'); ok = False
    opaque = sum(c != '.' for a in frames.values() for rows in a for row in rows for c in row)
    if opaque == 0: print(f'{path}: empty'); ok = False
    print(f'{path}: {"ok" if ok else "FAIL"} ({len(pal)} colours, ' + ', '.join(f'{a} {len(fl)}' for a, fl in frames.items()) + ')')
sys.exit(0 if ok else 1)
