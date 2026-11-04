// Client state-machine tests (node --test, no dependencies).
// lib/client.js is a loader-wrapped browser file; it is evaluated here with
// stubbed browser globals and exercised through its `_internals` test seam.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const STORAGE_KEY = 'dsh-quota-pets:state-v1'
const MIN = 60_000

/** Fresh client instance with its own stubs. */
function loadClient({ stored = null, fetchImpl = null } = {}) {
  const store = stored === null ? {} : { [STORAGE_KEY]: JSON.stringify(stored) }
  const fetched = []
  const microtasks = []
  let factory = null
  const window = { __ModuleLoader__: { load: (mod) => (factory = mod.factory) }, innerWidth: 1200, innerHeight: 800 }
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v) }
  const document = { body: null, visibilityState: 'visible' }
  const fetch = async (url) => {
    fetched.push(url)
    if (fetchImpl) return fetchImpl(url)
    return { ok: true, status: 200, json: async () => ({ ok: true, session: null }) }
  }
  const queueMicrotask = (fn) => microtasks.push(fn)
  new Function('window', 'localStorage', 'document', 'fetch', 'queueMicrotask', SOURCE)(
    window, localStorage, document, fetch, queueMicrotask,
  )
  const exports = factory(() => {
    throw new Error('no react in tests')
  })
  const flush = () => microtasks.splice(0).forEach((fn) => fn())
  return { api: exports._internals, store, fetched, flush }
}

const quota = (providers) => ({ ok: true, providers })
const snap = (provider, usedPercent, extra = {}) => ({
  provider,
  ok: true,
  worstWindowId: 'w',
  windows: [{ id: 'w', title: '5h', usedPercent, resetAt: null }],
  ...extra,
})

// ---- activity priority (contract §2) ---------------------------------------

test('activity priority: debug > working > error > done > sleeping > idle', () => {
  const { api } = loadClient()
  const rt = api.runtime
  assert.equal(api.deriveActivity(), 'idle')
  rt.lastInteraction = Date.now() - 11 * MIN
  assert.equal(api.deriveActivity(), 'sleeping')
  rt.doneUntil = Date.now() + 1_000
  assert.equal(api.deriveActivity(), 'done')
  rt.errorHold = true
  assert.equal(api.deriveActivity(), 'error')
  rt.running = true
  assert.equal(api.deriveActivity(), 'working')
  rt.debugState = 'sleeping'
  assert.equal(api.deriveActivity(), 'sleeping')
})

// ---- client-side done fallback --------------------------------------------

test('falling edge after a run of at least 4 s is a provisional done', () => {
  const { api } = loadClient()
  const rt = api.runtime
  rt.sessionId = 'A'
  api.noteRunning(true)
  rt.runStart = Date.now() - 5_000
  api.noteRunning(false)
  assert.ok(rt.doneUntil > Date.now())
})

test('falling edge after a short run is not done', () => {
  const { api } = loadClient()
  const rt = api.runtime
  rt.sessionId = 'A'
  api.noteRunning(true)
  api.noteRunning(false)
  assert.equal(rt.doneUntil, 0)
})

// ---- session switch (bug: error hold bled across sessions) ----------------

test('switching sessions clears done/error holds and polls the new session', () => {
  const { api, fetched, flush } = loadClient()
  const rt = api.runtime
  rt.sessionId = 'A'
  rt.errorHold = true
  rt.doneUntil = Date.now() + 3_000
  api.switchSession('B')
  assert.equal(rt.errorHold, false)
  assert.equal(rt.doneUntil, 0)
  assert.equal(rt.runSession, null)
  flush()
  assert.deepEqual(fetched, ['/dsh-quota-pets/events.json?session=B'])
})

test("a falling edge from the old session's run is not the new session's done", () => {
  const { api } = loadClient()
  const rt = api.runtime
  rt.sessionId = 'A'
  api.noteRunning(true)
  rt.runStart = Date.now() - 5_000
  api.switchSession('B')
  api.noteRunning(false)
  assert.equal(rt.doneUntil, 0)
})

test('a late events response for the previous session is discarded', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const { api } = loadClient({
    fetchImpl: async () => {
      await gate
      return { ok: true, status: 200, json: async () => ({ ok: true, session: { outcome: 'error', outcomeAt: Date.now(), seq: 1 } }) }
    },
  })
  const rt = api.runtime
  rt.sessionId = 'A'
  const pending = api.pollEvents()
  rt.sessionId = 'B' // user switches while A's request is in flight
  release()
  await pending
  assert.equal(rt.errorHold, false)
  assert.equal(rt.hostOutcome, null)
})

// ---- host outcome ------------------------------------------------------------

test('host error outcome sets the error hold; ignored while a run is live', () => {
  const { api } = loadClient()
  const rt = api.runtime
  rt.hostOutcome = { kind: 'error', at: Date.now(), seq: 1 }
  rt.running = true
  api.applyHostOutcome()
  assert.equal(rt.errorHold, false)
  rt.running = false
  api.applyHostOutcome()
  assert.equal(rt.errorHold, true)
})

test('a stale host done outcome does not replay the done animation', () => {
  const { api } = loadClient()
  const rt = api.runtime
  rt.hostOutcome = { kind: 'done', at: Date.now() - 10_000, seq: 1 }
  api.applyHostOutcome()
  assert.equal(rt.doneUntil, 0)
  rt.hostOutcome = { kind: 'done', at: Date.now(), seq: 2 }
  api.applyHostOutcome()
  assert.ok(rt.doneUntil > Date.now())
})

// ---- pressure overlay ------------------------------------------------------------

test('pressure thresholds: <70 ok, ≥70 warn, ≥90 critical with sticky bubble', () => {
  const { api } = loadClient()
  const at = (pct) => {
    api.runtime.quota = quota([snap('glm', pct)])
    return api.pressureView('glm')
  }
  assert.equal(at(69.9).pressure, 'ok')
  assert.equal(at(70).pressure, 'warn')
  const critical = at(90)
  assert.equal(critical.pressure, 'critical')
  assert.equal(critical.bubbleAuto, true)
  assert.equal(critical.tagDetail, '90.0%')
})

test('missing key or disabled provider is a ghost; unreachable hub is unknown', () => {
  const { api } = loadClient()
  api.runtime.quota = quota([{ provider: 'kimi', needsKey: true }, { provider: 'glm', disabled: true }])
  assert.equal(api.pressureView('kimi').pressure, 'ghost')
  assert.equal(api.pressureView('glm').pressure, 'ghost')
  api.runtime.quota = null
  api.runtime.quotaError = 'Error: HTTP 502'
  const view = api.pressureView('glm')
  assert.equal(view.pressure, 'unknown')
  assert.match(view.bubble, /HTTP 502/)
})

test('countdown formats minutes, hours and days', () => {
  const { api } = loadClient()
  const inMs = (ms) => new Date(Date.now() + ms).toISOString()
  assert.equal(api.countdown(inMs(-1_000)), '即将重置')
  assert.equal(api.countdown(inMs(30 * MIN)), '30 分后重置')
  assert.equal(api.countdown(inMs(125 * MIN)), '2 时 5 分后重置')
  assert.equal(api.countdown(inMs(72 * 60 * MIN)), '3 天后重置')
  assert.equal(api.countdown('not a date'), '')
})

// ---- identity -------------------------------------------------------------------

test('model → pet matching', () => {
  const { api } = loadClient()
  const ids = (provider, name) => Array.from(api.matchedProviders({ provider, name }))
  assert.deepEqual(ids('zhipu', 'glm-4.6'), ['glm'])
  assert.deepEqual(ids('moonshot', 'kimi-k2'), ['kimi'])
  assert.deepEqual(ids('deepseek', 'deepseek-chat'), ['deepseek'])
  assert.deepEqual(ids('xiaomi', 'mimo-v2'), ['mimo'])
  assert.deepEqual(ids('minimax', 'MiniMax-M2'), ['minimax'])
  assert.deepEqual(ids('openai', 'gpt-5'), [])
  assert.deepEqual(Array.from(api.matchedProviders(null)), [])
})

// ---- asset fallback chain (contract §7) -------------------------------------------

test('asset fallback: state anim → state static → idle static → idle anim → SVG', () => {
  const { api } = loadClient()
  const rt = api.runtime
  const file = (name) => ({ file: name, v: 1 })
  rt.health = {
    ok: true,
    pets: {
      glm: {
        working: { anim: file('working.webp'), static: file('working-static.webp') },
        idle: { anim: file('idle.webp'), static: file('idle-static.webp') },
      },
    },
  }
  const src = (activity) => api.avatarSrcFor('glm', activity).src
  assert.match(src('working'), /\/glm\/working\.webp\?v=1$/)
  api.markFailed('glm', 'working.webp')
  assert.match(src('working'), /working-static\.webp/)
  assert.match(src('done'), /idle-static\.webp/, 'missing state falls back to idle static first')
  api.markFailed('glm', 'idle-static.webp')
  assert.match(src('done'), /\/idle\.webp/)
  rt.health = null
  assert.match(src('working'), /^data:image\/svg\+xml/)
})

// ---- persistence (bug: preview art filled the shared localStorage) ---------------

test('legacy persisted preview art is stripped on load; pos/size are kept', () => {
  const { api, store } = loadClient({
    stored: { pos: { x: 10, y: 20 }, size: 112, custom: { glm: 'data:image/png;base64,AAAA' } },
  })
  assert.deepEqual(JSON.parse(store[STORAGE_KEY]), { pos: { x: 10, y: 20 }, size: 112 })
  assert.equal(api.state.size, 112)
  assert.equal(Object.keys(api.customArt).length, 0)
})

test('preview art wins over shipped assets but is never persisted', () => {
  const { api, store } = loadClient()
  api.customArt.glm = 'data:image/png;base64,BBBB'
  assert.equal(api.avatarSrcFor('glm', 'idle').src, 'data:image/png;base64,BBBB')
  assert.equal(store[STORAGE_KEY], undefined)
})
