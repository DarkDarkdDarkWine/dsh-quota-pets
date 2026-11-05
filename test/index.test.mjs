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

/** Minimal animated-WebP container: RIFF/WEBP + one ANMF chunk per frame duration. */
function webpWithFrames(durations) {
  const chunk = (tag, payload) => {
    const pad = payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)
    const head = Buffer.alloc(8)
    head.write(tag, 0, 'ascii')
    head.writeUInt32LE(payload.length, 4)
    return Buffer.concat([head, payload, pad])
  }
  const anmf = (ms) => {
    const p = Buffer.alloc(17) // 16-byte frame header + 1 odd byte of "bitstream"
    p.writeUIntLE(ms, 12, 3)
    return chunk('ANMF', p)
  }
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', Buffer.alloc(10)), chunk('ANIM', Buffer.alloc(6)), ...durations.map(anmf)])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}

test('WebP duration sums the ANMF frame durations; non-animated or foreign data is 0', async () => {
  const { webpDurationMs } = await import(`../lib/index.js?t=${Math.random()}`)
  assert.equal(webpDurationMs(webpWithFrames([125, 125, 300])), 550)
  assert.equal(webpDurationMs(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 0)
  assert.equal(webpDurationMs(Buffer.from('GIF89a')), 0)
  assert.equal(webpDurationMs(Buffer.alloc(0)), 0)
})

test('health lists shipped transition clips with their duration', async () => {
  const handlers = {}
  const mod = await import(`../lib/index.js?t=${Math.random()}`)
  mod.apply({ effect: (fn) => fn(), webServer: { register: (r) => (handlers[r.path] = r.handler) }, on() {} })
  const health = await new Promise((resolve) =>
    handlers['/dsh-quota-pets/health.json']({}, { writeHead() {}, end: (body) => resolve(JSON.parse(body)) }),
  )
  const clip = health.pets.glm['idle-to-working']
  assert.equal(clip.anim.file, 'idle-to-working.webp')
  assert.equal(clip.anim.ms, 1000)
  assert.ok(!clip.extra, 'both ends are known states')
  assert.equal(health.pets.glm.idle.anim.ms, undefined, 'plain states carry no duration')
})

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
