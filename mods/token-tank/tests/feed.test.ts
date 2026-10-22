import { expect, test } from 'claude-code/testing'
import { dropFood, startle } from '../game/fish'
import { newGame } from '../game/state'
import { fishCentreAt, fishLayout } from '../render/svg'

const T0 = 1_760_000_000_000

test('food dropped on open water feeds the hungry fish, hungriest first, and is wasted on a full tank', () => {
  let s = newGame(T0)
  s = { ...s, fish: s.fish.map((f, i) => ({ ...f, hunger: i === 0 ? 20 : 90 })) }
  const out = dropFood(s, 100, 60, T0)
  expect(out.state.food).toBe(s.food - 1)
  expect(out.state.pellets.length).toBe(1)
  expect(out.state.pellets[0]!.eaters).toEqual([s.fish[0]!.id])
  expect(out.state.fish[0]!.hunger).toBe(50)
  expect(out.state.fish[0]!.state).toBe('feeding')
  expect(out.state.fish[1]!.hunger).toBe(90)
  expect(out.events[0]).toMatchObject({ kind: 'dropped', x: 100, y: 60 })

  const full = dropFood({ ...s, fish: s.fish.map(f => ({ ...f, hunger: 95 })) }, 10, 10, T0)
  expect(full.events[0]).toMatchObject({ kind: 'refused', reason: 'all-full' })
  expect(full.state.food).toBe(s.food)

  const none = dropFood({ ...s, food: 0 }, 10, 10, T0)
  expect(none.events[0]).toMatchObject({ kind: 'refused', reason: 'no-food' })
})

test('a startled fish is marked for the drawing and the tap maths finds a fish on its lane', () => {
  const s = newGame(T0)
  const out = startle(s, s.fish[0]!.id, T0)
  expect(out.state.fish[0]!.state).toBe('startled')
  expect(out.state.fish[0]!.since).toBe(T0)

  const l = fishLayout(s.fish[0]!, 0, 2, 640)
  const at0 = fishCentreAt(l, 0)
  expect(at0.y).toBe(l.y)
  // It patrols between x1 and x2 and never leaves that span.
  for (const ms of [0, 1000, 5000, 12_000, 33_000]) {
    const c = fishCentreAt(l, ms)
    expect(c.x >= l.x1 + l.w / 2 - 0.01 && c.x <= l.x2 + l.w / 2 + 0.01).toBe(true)
  }
})
