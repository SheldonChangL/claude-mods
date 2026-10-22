import { writeFileSync } from 'node:fs'
const blank = (w, h) => Array.from({ length: h }, () => '.'.repeat(w))
const put = (rows, x, y, c) => { if (y >= 0 && y < rows.length && x >= 0 && x < rows[0].length) rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1) }
const ellipse = (rows, cx, cy, rx, ry, c) => { for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(rows, x, y, c) }
const fish = (w, h, body, dark, light, tailShift) => {
  const rows = blank(w, h)
  const cx = w * 0.55, cy = h / 2
  ellipse(rows, cx, cy, w * 0.3, h * 0.35, dark)
  ellipse(rows, cx, cy, w * 0.3 - 1, h * 0.35 - 1, body)
  ellipse(rows, cx - 2, cy - 2, w * 0.12, h * 0.12, light)
  for (let i = 0; i < h * 0.5; i++) { const y = Math.round(cy - h * 0.25 + i + tailShift); const x0 = Math.round(cx - w * 0.3 - Math.abs(i - h * 0.25) * 0.8); for (let x = x0; x < cx - w * 0.3 + 1; x++) put(rows, x, y, dark) }
  put(rows, Math.round(cx + w * 0.15), Math.round(cy - 2), 'K')
  return rows
}
const species = { guppy: ['#58d3f7', '#1f6f9a', '#dff9ff', 32, 24], clownfish: ['#ff8c2b', '#a8420c', '#ffffff', 32, 24], angelfish: ['#d9dde8', '#3c3f55', '#ffffff', 40, 32], koi: ['#f7f1e6', '#c9452c', '#ffffff', 40, 32], puffer: ['#f2d046', '#8a6d10', '#fff6b0', 32, 24], tang: ['#2f6df6', '#15317a', '#f7d84a', 32, 24], goldfish: ['#ff9a2e', '#b4561a', '#ffe0a0', 32, 24], seahorse: ['#3fc9b0', '#1d6f61', '#ffb3d1', 24, 32], neon: ['#4fd1ff', '#1f4f8f', '#ff4d6d', 32, 24], betta: ['#c0392b', '#5b1a6e', '#ff8fa3', 40, 32], butterflyfish: ['#f5f0e6', '#b8651b', '#ffffff', 32, 24], lionfish: ['#c84b31', '#5a1e14', '#f6e7d8', 40, 32], arowana: ['#d4a017', '#7a1f1f', '#ffe9a8', 48, 24], discus: ['#3fb8c9', '#8a3a2a', '#ffe0b0', 40, 32], oscar: ['#3a3a2a', '#d9622b', '#ffb380', 40, 32], danio: ['#cfd8e3', '#1f3a6b', '#ffffff', 32, 24], moorishidol: ['#f4f1e8', '#1a1a2e', '#ffd166', 40, 32], parrotfish: ['#2fbf9f', '#1a6f8a', '#ff9fb0', 40, 32], mandarin: ['#ff8c42', '#1f7a8c', '#7fe0d8', 32, 24], swordtail: ['#ff5a36', '#8a1f14', '#ffd0a0', 32, 24], mola: ['#9aa5b1', '#4a5560', '#d8dee5', 48, 40] }
const sprites = {}
for (const [id, [body, dark, light, w, h]] of Object.entries(species)) {
  const palette = { A: body, B: dark, C: light, K: '#1a1a2e' }
  sprites[id] = { w, h, palette, frames: { swim: [0, 1, 2, 1].map(t => fish(w, h, 'A', 'B', 'C', t - 1)), spit: [0, 0].map(() => fish(w, h, 'A', 'B', 'C', 0)) } }
}
const coinFrame = rx => { const r = blank(12, 12); ellipse(r, 5.5, 5.5, rx, 5, 'B'); ellipse(r, 5.5, 5.5, Math.max(0.5, rx - 1.5), 3.5, 'A'); return r }
sprites.coin = { w: 12, h: 12, palette: { A: '#ffd74a', B: '#b8860b' }, frames: { spin: [5, 3.5, 1.5, 3.5].map(coinFrame) } }
sprites.pellet = { w: 4, h: 4, palette: { A: '#c98a4b' }, frames: { idle: [['.AA.', 'AAAA', 'AAAA', '.AA.']] } }
const weed = shift => { const r = blank(16, 40); for (let y = 0; y < 40; y++) { const x = 7 + Math.round(Math.sin(y / 6 + shift) * 3 * (1 - y / 40)); put(r, x, y, 'A'); put(r, x + 1, y, 'B') } return r }
sprites.seaweed = { w: 16, h: 40, palette: { A: '#2fbf71', B: '#1a7f4b' }, frames: { sway: [0, 0.8, 1.6, 0.8].map(weed) } }
const blob = (w, h, c1, c2) => { const r = blank(w, h); ellipse(r, w / 2, h * 0.7, w / 2 - 0.5, h * 0.5, c2); ellipse(r, w / 2 - 1, h * 0.65, w / 2 - 3, h * 0.4, c1); return r }
sprites.coral = { w: 32, h: 28, palette: { A: '#ff6fa8', B: '#9c2f6b' }, frames: { idle: [blob(32, 28, 'A', 'B')] } }
sprites.rock = { w: 40, h: 24, palette: { A: '#8a8aa8', B: '#4c4c6a' }, frames: { idle: [blob(40, 24, 'A', 'B')] } }
sprites.chest = { w: 48, h: 32, palette: { A: '#a0622d', B: '#5c3312', C: '#ffd74a' }, frames: { closed: [blob(48, 32, 'A', 'B')], open: [blob(48, 32, 'A', 'B'), blob(48, 32, 'C', 'B')] } }
sprites.ruin = { w: 40, h: 56, palette: { A: '#9aa3b5', B: '#55607a' }, frames: { idle: [blob(40, 56, 'A', 'B')] } }
sprites.anchor = { w: 24, h: 32, palette: { A: '#6b7280', B: '#374151' }, frames: { idle: [blob(24, 32, 'A', 'B')] } }
sprites.shell = { w: 16, h: 12, palette: { A: '#ffe4c4', B: '#c48a5a' }, frames: { idle: [blob(16, 12, 'A', 'B')] } }
sprites.starfish = { w: 14, h: 14, palette: { A: '#ff6b57', B: '#b03a2a' }, frames: { idle: [blob(14, 14, 'A', 'B')] } }
sprites.shipwreck = { w: 64, h: 32, palette: { A: '#6b4a2b', B: '#3b2a18' }, frames: { idle: [blob(64, 32, 'A', 'B')] } }
sprites.anemone = { w: 24, h: 20, palette: { A: '#ff8fa3', B: '#b03a5a' }, frames: { sway: [0, 0, 0, 0].map(() => blob(24, 20, 'A', 'B')) } }
sprites.clam = { w: 20, h: 14, palette: { A: '#9ab8ff', B: '#4a3f8a' }, frames: { closed: [blob(20, 14, 'A', 'B')], open: [blob(20, 14, 'A', 'B'), blob(20, 14, 'A', 'B')] } }
sprites.statue = { w: 24, h: 44, palette: { A: '#8f9aa5', B: '#4f5a65' }, frames: { idle: [blob(24, 44, 'A', 'B')] } }
sprites.wheel = { w: 24, h: 24, palette: { A: '#a0622d', B: '#5c3312' }, frames: { idle: [blob(24, 24, 'A', 'B')] } }
writeFileSync(new URL('../sprites.placeholder.json', import.meta.url), JSON.stringify({ sprites }))
console.log('placeholder written')
