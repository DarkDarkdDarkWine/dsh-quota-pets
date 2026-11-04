// Host-side run-outcome aggregation tests (node --test, no dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'

const SETTLE_MS = 1_200

/** Fresh module instance per test (module-level runStates). */
async function mount() {
  const mod = await import(`../lib/index.js?t=${Math.random()}`)
  const handlers = {}
  const routes = {}
  mod.apply({
    effect: (fn) => fn(),
    webServer: { register: (route) => (routes[route.path] = route.handler) },
    on: (event, fn) => (handlers[event] = fn),
  })
  const outcome = (sessionId) =>
    new Promise((resolve) => {
      routes['/dsh-quota-pets/events.json'](
        { url: `/dsh-quota-pets/events.json?session=${sessionId}` },
        { writeHead() {}, end: (body) => resolve(JSON.parse(body).session) },
      )
    })
  return {
    status: (sid, running) => handlers['api-session/status'](sid, running),
    error: (sid) => handlers['api-session/error'](sid),
    outcome,
  }
}

test('clean run settles to done after the settle window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const host = await mount()
  host.status('s', true)
  host.status('s', false)
  assert.equal((await host.outcome('s')).outcome, null)
  t.mock.timers.tick(SETTLE_MS)
  assert.equal((await host.outcome('s')).outcome, 'done')
})

test('trailing error inside the settle window settles to error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const host = await mount()
  host.status('s', true)
  host.status('s', false)
  t.mock.timers.tick(500)
  host.error('s')
  t.mock.timers.tick(SETTLE_MS)
  assert.equal((await host.outcome('s')).outcome, 'error')
})

test('a stale settle timer never publishes for the next run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const host = await mount()
  host.status('s', true)
  host.status('s', false) // run 1 ends: its timer would fire at +1200
  t.mock.timers.tick(300)
  host.status('s', true) // run 2 starts inside run 1's window
  t.mock.timers.tick(300)
  host.status('s', false) // run 2 ends: its own window runs to +1800
  t.mock.timers.tick(700) // past run 1's timer, still inside run 2's window
  assert.equal((await host.outcome('s')).outcome, null, 'run 1 timer must not settle run 2 early')
  host.error('s') // run 2's trailing error
  t.mock.timers.tick(SETTLE_MS)
  assert.equal((await host.outcome('s')).outcome, 'error')
})
