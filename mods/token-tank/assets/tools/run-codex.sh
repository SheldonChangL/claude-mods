#!/bin/zsh
# One short Codex call per sprite; a sprite whose file validates is skipped,
# so a Mac that sleeps mid-way only costs the sprite in flight. A call that
# outlives 20 minutes of wall clock (a connection lost to sleep) is killed.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/tools/codex.log"
NAMES=(guppy clownfish angelfish koi puffer tang goldfish seahorse neon betta butterflyfish lionfish arowana coin pellet seaweed coral rock chest ruin anchor shell starfish)
LIMIT=1200
for round in 1 2 3 4 5 6; do
  for name in $NAMES; do
    if [ -f "$DIR/sprites/$name.json" ] && python3 "$DIR/tools/validate.py" "$DIR/sprites/$name.json" >/dev/null 2>&1; then continue; fi
    echo "=== $name round $round $(date)" >> "$LOG"
    caffeinate -i codex exec -C "$DIR" --skip-git-repo-check -s workspace-write \
      -c 'approval_policy="never"' -o "$DIR/tools/codex-last.md" - < "$DIR/briefs/$name.md" >> "$LOG" 2>&1 &
    pid=$!
    start=$(date +%s)
    while kill -0 $pid 2>/dev/null; do
      sleep 20
      if [ $(( $(date +%s) - start )) -gt $LIMIT ]; then
        echo "=== $name timed out, killing $(date)" >> "$LOG"
        pkill -9 -P $pid 2>/dev/null; kill -9 $pid 2>/dev/null; pkill -9 -f "codex exec -C $DIR" 2>/dev/null
        break
      fi
    done
    wait $pid 2>/dev/null
    echo "=== $name exit $? $(date)" >> "$LOG"
  done
  if [ $(ls "$DIR/sprites"/*.json 2>/dev/null | wc -l) -ge 23 ]; then break; fi
done
echo "=== all rounds done $(date)" >> "$LOG"
