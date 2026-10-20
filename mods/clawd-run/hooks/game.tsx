import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

// An original side-scroller Clawd plays by itself: pipes, gaps, bugs to stomp
// and coins, generated as the camera moves. Runs on the surface's frame clock.

type Props = { rows: number; columns: number; isWorking: boolean }

type Bug = { x: number; dir: number; squashedFor: number }
type Coin = { x: number; y: number; isTaken: boolean }
type Spark = { x: number; y: number; ttl: number; text: string }

type Game = {
  seed: number
  // world, per column: is there ground, how tall a pipe stands there
  ground: boolean[]
  pipe: number[]
  // which of a pipe's four columns this is
  pipeIx: number[]
  builtTo: number
  bugs: Bug[]
  coins: Coin[]
  sparks: Spark[]
  // Clawd
  x: number
  y: number
  vy: number
  isOnGround: boolean
  blinkFor: number
  // tally
  score: number
  coinsTaken: number
  stomps: number
  falls: number
  ticks: number
  // the player's hand: ticks the last arrow still holds, its direction, a
  // jump asked for, and ticks until Clawd plays by itself again
  holdFor: number
  dir: number
  wantsUp: boolean
  manualFor: number
}

// `view` is the latest size, which the timer reads; the drawing updates it in place.
type View = { rows: number; columns: number }
type State = { game: Game; view: View; frame: number }

const TICK_MS = 50
const SPEED = 0.5
const GRAVITY = 0.17
const JUMP = 1.3
const SCREEN_X = 10
// how long without an arrow before the autopilot plays again: 6 s
const IDLE_TICKS = 120

// Clawd in pixels, after Claude Desktop's own sprite at half its size: 12 by
// 8, O body, s shade, E eyes. Each text row draws two pixel rows (half blocks),
// so Clawd takes 12 cells by 4 rows. The legs alternate while running.
const STAND = [
  '..OOOOOOOO..',
  '..OEOOOOEO..',
  'OOOOOOOOOOOO',
  'OOOOOOOOOOOO',
  '..OOOOOOOO..',
  '..OOOOOOOO..',
  '..O.O..O.O..',
  '..O.O..O.O..',
]
const RUN = [
  [
    '..sOOOOOOO..',
    '..sEOOOOEO..',
    'ssOOOOOOOOOO',
    'ssOOOOOOOOOO',
    '..sOOOOOOO..',
    '..sOOOOOOO..',
    '..s.O..O.O..',
    '..s....O....',
  ],
  [
    '..sOOOOOOO..',
    '..sEOOOOEO..',
    'ssOOOOOOOOOO',
    'ssOOOOOOOOOO',
    '..sOOOOOOO..',
    '..sOOOOOOO..',
    '..s.O..O.O..',
    '....O....O..',
  ],
]
const LEAP = [
  '...O....O...',
  '..OOO..OOO..',
  '..OOOOOOOO..',
  '..OEOOOOEO..',
  '..OOOOOOOO..',
  '..OOOOOOOO..',
  '..O.O..O.O..',
  '............',
]
const W = 12
const H = 4
// the cells that collide: the body less its arms
const HIT_L = 2
const HIT_R = 10

const ORANGE = '#D97757'
const SHADE = '#BF694D'
const EYE = '#141413'
const PIXEL: Record<string, string> = { O: ORANGE, s: SHADE, E: EYE }
const BRICK = '#C0582E'
const SOIL = '#7A3B1A'
const PIPE = '#3FA34D'
const PIPE_DARK = '#2B7A37'
const GOLD = '#F2C230'
const BUG = '#8E5BD6'
const CLOUD = '#9AA4B2'

function rand(game: Game): number {
  game.seed = (game.seed * 1103515245 + 12345) % 2147483648
  return game.seed / 2147483648
}

function groundRow(rows: number): number {
  return rows - 2
}

// Builds the world out to `to`: flat runs broken by a gap, a pipe, bugs, coins.
function build(game: Game, rows: number, to: number): void {
  const top = groundRow(rows)
  while (game.builtTo < to) {
    const start = game.builtTo
    const flat = 10 + Math.floor(rand(game) * 14)
    for (let c = start; c < start + flat; c++) {
      game.ground[c] = true
      game.pipe[c] = 0
    }
    if (rand(game) < 0.55) {
      const at = start + 3 + Math.floor(rand(game) * (flat - 6))
      game.bugs.push({ x: at, dir: -1, squashedFor: 0 })
    }
    if (rand(game) < 0.6) {
      const n = 3 + Math.floor(rand(game) * 4)
      const y = top - H - 1 - Math.floor(rand(game) * 2)
      for (let i = 0; i < n; i++) game.coins.push({ x: start + 2 + i * 2, y, isTaken: false })
    }
    let c = start + flat
    const pick = rand(game)
    if (pick < 0.4) {
      const gap = 4 + Math.floor(rand(game) * 5)
      for (let i = 0; i < gap; i++, c++) {
        game.ground[c] = false
        game.pipe[c] = 0
      }
      // coins over the gap, along the jump
      game.coins.push({ x: c - Math.ceil(gap / 2), y: top - H - 3, isTaken: false })
    } else if (pick < 0.85) {
      const tall = Math.min(rows - 8, 2 + Math.floor(rand(game) * 2))
      for (let i = 0; i < 4; i++, c++) {
        game.ground[c] = true
        game.pipe[c] = tall
        game.pipeIx[c] = i
      }
    }
    game.builtTo = c
  }
}

function isSolid(game: Game, rows: number, col: number, row: number): boolean {
  if (col < 0) return true
  const top = groundRow(rows)
  if (row >= top) return game.ground[col] === true
  const tall = game.pipe[col] ?? 0
  return tall > 0 && row >= top - tall
}

function hits(game: Game, rows: number, x: number, y: number): boolean {
  const c0 = Math.floor(x + HIT_L + 0.001)
  const c1 = Math.ceil(x + HIT_R - 0.001) - 1
  const r0 = Math.floor(y + 0.001)
  const r1 = Math.ceil(y + H - 0.001) - 1
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      if (isSolid(game, rows, c, r)) return true
    }
  }
  return false
}

function newGame(rows: number): Game {
  const game: Game = {
    seed: 7 + Math.floor(Math.random() * 100000),
    ground: [],
    pipe: [],
    pipeIx: [],
    builtTo: 0,
    bugs: [],
    coins: [],
    sparks: [],
    x: 2,
    y: groundRow(rows) - H,
    vy: 0,
    isOnGround: true,
    blinkFor: 0,
    score: 0,
    coinsTaken: 0,
    stomps: 0,
    falls: 0,
    ticks: 0,
    holdFor: 0,
    dir: 1,
    wantsUp: false,
    manualFor: 0,
  }
  // a safe runway to start on
  for (let c = 0; c < 24; c++) {
    game.ground[c] = true
    game.pipe[c] = 0
  }
  game.builtTo = 24
  return game
}

type Body = { x: number; y: number; vy: number; isOnGround: boolean }

// One tick of Clawd's physics; the game and the look-ahead both run it.
function step(game: Game, rows: number, body: Body, jump: boolean, dx = SPEED): void {
  if (jump && body.isOnGround) {
    body.vy = -JUMP
    body.isOnGround = false
  }
  const nx = body.x + dx
  if (!hits(game, rows, nx, body.y)) body.x = nx
  body.vy = Math.min(body.vy + GRAVITY, 1.2)
  const ny = body.y + body.vy
  if (!hits(game, rows, body.x, ny)) {
    body.y = ny
    body.isOnGround = false
  } else {
    if (body.vy > 0) {
      body.y = Math.floor(ny + H) - H
      while (hits(game, rows, body.x, body.y) && body.y > 0) body.y -= 1
      body.isOnGround = true
    }
    body.vy = 0
  }
}

type Outcome = 'ok' | 'fall' | 'bug' | 'wall'

// Plays the next ticks ahead: walking on, or jumping now and until landing.
function foresee(game: Game, rows: number, jump: boolean, steps: number): Outcome {
  const top = groundRow(rows)
  const body: Body = { x: game.x, y: game.y, vy: game.vy, isOnGround: game.isOnGround }
  for (let i = 1; i <= steps; i++) {
    const was = body.x
    step(game, rows, body, jump && i === 1)
    if (body.y + H > top + 0.5) return 'fall'
    if (body.x === was && body.isOnGround) return 'wall'
    const feet = body.y + H
    for (const bug of game.bugs) {
      if (bug.squashedFor > 0) continue
      const bx = bug.x + 0.15 * bug.dir * i
      const overlapsX = bx + 2 > body.x + HIT_L && bx < body.x + HIT_R
      if (overlapsX && feet > top - 0.5 && !(body.vy > 0 && feet <= top + 0.4)) return 'bug'
    }
    if (jump && i > 1 && body.isOnGround) return 'ok'
  }
  return 'ok'
}

// Should Clawd jump now? Jumps when walking on goes wrong and a jump lands.
function wantsJump(game: Game, rows: number): boolean {
  const walk = foresee(game, rows, false, 10)
  if (walk === 'wall') return true
  const leap = foresee(game, rows, true, 60)
  if (walk !== 'ok') {
    // the last moment: jump even onto a worse landing rather than walk in
    return leap === 'ok' || foresee(game, rows, false, 2) !== 'ok'
  }
  // now and then a hop for coins overhead, when it lands safely
  const front = game.x + HIT_R
  const top = groundRow(rows)
  return (
    game.ticks % 3 === 0 &&
    leap === 'ok' &&
    game.coins.some(coin => !coin.isTaken && coin.y < top - H && coin.x >= front - 4 && coin.x < front)
  )
}

function tick(game: Game, rows: number, columns: number): void {
  game.ticks += 1
  build(game, rows, Math.floor(game.x) + columns + 40)
  const top = groundRow(rows)

  if (game.manualFor > 0) {
    game.manualFor -= 1
    const dx = game.holdFor > 0 ? SPEED * game.dir : 0
    if (game.holdFor > 0) game.holdFor -= 1
    step(game, rows, game, game.wantsUp, dx)
    game.wantsUp = false
  } else {
    step(game, rows, game, game.isOnGround && wantsJump(game, rows))
  }

  // fell into a gap: back on the next ground ahead
  if (game.y > rows) {
    game.falls += 1
    let c = Math.floor(game.x) + 1
    while (!(game.ground[c] && game.ground[c + W] && !game.pipe[c] && !game.pipe[c + W])) c += 1
    game.x = c
    game.y = top - H - 3
    game.vy = 0
    game.blinkFor = 30
    game.sparks.push({ x: c, y: top - H - 4, ttl: 20, text: 'oops!' })
  }

  // bugs walk, turn at gaps and pipes, get stomped from above
  for (const bug of game.bugs) {
    if (bug.squashedFor > 0) {
      bug.squashedFor -= 1
      continue
    }
    const ahead = Math.floor(bug.x + (bug.dir < 0 ? -0.2 : 2.2))
    if (!game.ground[ahead] || (game.pipe[ahead] ?? 0) > 0) bug.dir = -bug.dir
    else bug.x += 0.15 * bug.dir
    const overlapsX = bug.x + 2 > game.x + HIT_L && bug.x < game.x + HIT_R
    const feet = game.y + H
    if (overlapsX && feet > top - 1 && feet <= top + 0.4 && game.vy > 0) {
      bug.squashedFor = 12
      game.vy = -1.1
      game.isOnGround = false
      game.stomps += 1
      game.score += 100
      game.sparks.push({ x: bug.x, y: top - 2, ttl: 14, text: '+100' })
    } else if (overlapsX && feet > top - 0.5 && game.blinkFor === 0) {
      game.blinkFor = 30
      game.sparks.push({ x: game.x + 2, y: game.y - 1, ttl: 14, text: 'ouch' })
    }
  }

  for (const coin of game.coins) {
    if (coin.isTaken) continue
    if (coin.x >= game.x + HIT_L && coin.x < game.x + HIT_R && coin.y >= game.y - 0.5 && coin.y < game.y + H + 0.5) {
      coin.isTaken = true
      game.coinsTaken += 1
      game.score += 10
    }
  }

  if (game.blinkFor > 0) game.blinkFor -= 1
  for (const spark of game.sparks) {
    spark.ttl -= 1
    spark.y -= 0.1
  }
  game.score += game.ticks % 10 === 0 ? 1 : 0

  // forget what scrolled away
  const gone = Math.floor(game.x) - SCREEN_X - 10
  game.bugs = game.bugs.filter(bug => bug.x > gone && !(bug.squashedFor === 1))
  game.coins = game.coins.filter(coin => coin.x > gone && !coin.isTaken)
  game.sparks = game.sparks.filter(spark => spark.ttl > 0)
}

type Cell = { ch: string; color?: string; bg?: string }

function paint(game: Game, rows: number, columns: number, isWorking: boolean): Cell[][] {
  const grid: Cell[][] = []
  for (let r = 0; r < rows; r++) {
    const line: Cell[] = []
    for (let c = 0; c < columns; c++) line.push({ ch: ' ' })
    grid.push(line)
  }
  const put = (col: number, row: number, ch: string, color?: string) => {
    const line = grid[row]
    if (!line || col < 0 || col >= columns || ch === ' ') return
    line[col] = { ch, color }
  }
  const text = (col: number, row: number, s: string, color?: string) => {
    for (let i = 0; i < s.length; i++) put(col + i, row, s.charAt(i), color)
  }

  const cam = Math.floor(game.x) - SCREEN_X
  const top = groundRow(rows)

  // clouds at half speed
  const cloud = '▁▃▅▆▅▃▁'
  for (let k = -1; k < columns / 22 + 2; k++) {
    const base = Math.floor(cam / 2 / 22) + k
    const col = base * 22 - Math.floor(cam / 2) + ((base * 7) % 11)
    text(col, 1 + (Math.abs(base) % 2), cloud, CLOUD)
  }

  for (let sc = 0; sc < columns; sc++) {
    const c = cam + sc
    if (game.ground[c]) {
      put(sc, top, c % 4 === 0 ? '▙' : '▄', BRICK)
      put(sc, top + 1, c % 4 === 2 ? '▓' : '█', SOIL)
    }
    const tall = game.pipe[c] ?? 0
    if (tall > 0) {
      const i = game.pipeIx[c] ?? 0
      for (let r = top - tall; r < top; r++) {
        const isCap = r === top - tall
        const ch = isCap ? '█' : i === 0 ? '▐' : i === 3 ? '▌' : '█'
        put(sc, r, ch, isCap || i === 1 ? PIPE : PIPE_DARK)
      }
    }
  }

  const spin = ['●', '◐', '│', '◑']
  for (const coin of game.coins) {
    put(Math.floor(coin.x) - cam, Math.round(coin.y), spin[(game.ticks >> 2) % 4] ?? '●', GOLD)
  }

  for (const bug of game.bugs) {
    const col = Math.floor(bug.x) - cam
    if (bug.squashedFor > 0) text(col, top - 1, '▁▁', BUG)
    else text(col, top - 1, (game.ticks >> 2) % 2 === 0 ? '▟▙' : '▙▟', BUG)
  }

  const isHidden = game.blinkFor > 0 && (game.blinkFor >> 1) % 2 === 0
  if (!isHidden) {
    const col = Math.floor(game.x) - cam
    const row = Math.round(game.y)
    const art = game.isOnGround ? (RUN[(game.ticks >> 2) % 2] ?? STAND) : LEAP
    // two pixel rows to a cell: the top as the glyph's colour, the bottom
    // as the cell's background when both are drawn
    for (let i = 0; i < H; i++) {
      const top = art[2 * i] ?? ''
      const bottom = art[2 * i + 1] ?? ''
      for (let x = 0; x < W; x++) {
        const up = PIXEL[top.charAt(x)]
        const down = PIXEL[bottom.charAt(x)]
        const line = grid[row + i]
        if (!line || col + x < 0 || col + x >= columns) continue
        if (up && down) line[col + x] = up === down ? { ch: '█', color: up } : { ch: '▀', color: up, bg: down }
        else if (up) line[col + x] = { ch: '▀', color: up }
        else if (down) line[col + x] = { ch: '▄', color: down }
      }
    }
  }

  for (const spark of game.sparks) {
    text(Math.floor(spark.x) - cam, Math.round(spark.y), spark.text, GOLD)
  }

  // the tally on the top row
  const seconds = Math.floor((game.ticks * TICK_MS) / 1000)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const hud = `CLAWD ${String(game.score).padStart(6, '0')}  ● ×${game.coinsTaken}  ▟▙ ×${game.stomps}  ⏱ ${clock}`
  text(1, 0, hud, ORANGE)
  const note =
    game.manualFor > 0
      ? '← → run · ↑ / space jump'
      : isWorking
        ? 'Claude is working… · click to play'
        : 'preview · click to play · /clawd-run hides'
  text(columns - note.length - 1, 0, note)

  return grid
}

const draw: ClientModule<JsonValue, State> = (raw, surface: ClientSurface<State>) => {
  const props = raw as unknown as Props
  const { Box, Text } = surface.elements
  const rows = Math.max(7, props.rows)
  const columns = Math.max(30, surface.columns || props.columns)

  let state = surface.state
  if (state === undefined) {
    const first: State = { game: newGame(rows), view: { rows, columns }, frame: 0 }
    state = first
    surface.setState(first)
    // arrows take over from the autopilot; idle a while and it plays again.
    // Terminals send no key-up, so a press holds the run for a few ticks and
    // the key's repeat keeps it going.
    surface.onKey(event => {
      const game = (surface.state ?? first).game
      const key = event.key
      if (key === 'left' || key === 'a' || key === 'right' || key === 'd') {
        game.dir = key === 'left' || key === 'a' ? -1 : 1
        game.holdFor = 7
      } else if (key === 'up' || key === ' ' || key === 'w') {
        game.wantsUp = true
      } else {
        return
      }
      game.manualFor = IDLE_TICKS
    })
    surface.every(TICK_MS, () => {
      const now = surface.state ?? first
      tick(now.game, now.view.rows, now.view.columns)
      surface.setState({ ...now, frame: now.frame + 1 })
    })
  }
  state.view.rows = rows
  state.view.columns = columns

  const grid = paint(state.game, rows, columns, props.isWorking)

  return (
    <Box flexDirection="column">
      {grid.map((line, r) => {
        const runs: { s: string; color?: string; bg?: string }[] = []
        for (const cell of line) {
          const last = runs[runs.length - 1]
          // a blank takes no colour: it joins the run before it
          if (last && ((last.color === cell.color && last.bg === cell.bg) || (cell.ch === ' ' && !last.bg))) last.s += cell.ch
          else runs.push({ s: cell.ch, color: cell.color, bg: cell.bg })
        }
        return (
          <Box key={`r${r}`} flexDirection="row">
            {runs.map(run =>
              run.color ? (
                <Text mono color={run.color} backgroundColor={run.bg}>
                  {run.s}
                </Text>
              ) : (
                <Text mono>{run.s}</Text>
              ),
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export default draw
