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
function loadClient({ stored = null, fetchImpl = null, reducedMotion = false } = {}) {
  const store = stored === null ? {} : { [STORAGE_KEY]: JSON.stringify(stored) }
  const fetched = []
  const microtasks = []
  let factory = null
  const window = {
    __ModuleLoader__: { load: (mod) => (factory = mod.factory) },
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: (query) => ({ matches: reducedMotion && query.includes('reduce') }),
  }
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

test('a broken asset reported by its <img> src falls back down the chain', () => {
  const { api } = loadClient()
  const file = (name) => ({ file: name, v: 7 })
  api.runtime.health = { ok: true, pets: { glm: { working: { anim: file('working.webp'), static: file('working-static.webp') } } } }
  const first = api.avatarSrcFor('glm', 'working').src
  api.markFailed('glm', first + '&rk=2') // what the img error handler actually passes
  assert.match(api.avatarSrcFor('glm', 'working').src, /working-static\.webp/)
})

// ---- transition clips (contract §6.1) -------------------------------------------

const clipHealth = (clips) => {
  const file = (name, ms) => ({ file: name, v: 1, ...(ms ? { ms } : {}) })
  const pet = {}
  for (const s of ['idle', 'working', 'done', 'error', 'sleeping']) pet[s] = { anim: file(s + '.webp'), static: file(s + '-static.webp') }
  for (const [key, ms] of Object.entries(clips)) pet[key] = { anim: file(key + '.webp', ms) }
  return { ok: true, pets: { glm: pet } }
}
const newPet = () => ({ id: 'glm', shown: null, clips: [], clipStart: 0 })
const keys = (plan) => plan.map((c) => c.key)

test('a direct clip plays for its duration, then the new state shows', () => {
  const { api } = loadClient()
  api.runtime.health = clipHealth({ 'idle-to-working': 1000 })
  const pet = newPet()
  assert.equal(api.stepTransition(pet, 'idle', 0), null, 'first render never plays a clip')
  const step = api.stepTransition(pet, 'working', 100)
  assert.equal(step.clip.key, 'idle-to-working')
  assert.match(step.clip.url, /\/glm\/idle-to-working\.webp\?v=1$/)
  assert.equal(step.endsAt, 1100)
  assert.equal(api.stepTransition(pet, 'working', 1099).clip.key, 'idle-to-working')
  assert.equal(api.stepTransition(pet, 'working', 1100), null)
})

test('without a direct clip the route goes through idle, legs that exist only', () => {
  const { api } = loadClient()
  api.runtime.health = clipHealth({ 'idle-to-working': 1000, 'sleeping-to-idle': 600 })
  assert.deepEqual(keys(api.transitionPlan('glm', 'sleeping', 'working')), ['sleeping-to-idle', 'idle-to-working'])
  assert.deepEqual(keys(api.transitionPlan('glm', 'done', 'working')), ['idle-to-working'], 'done ends on the idle pose')
  assert.deepEqual(keys(api.transitionPlan('glm', 'working', 'done')), [], 'done starts on the working pose')
  assert.deepEqual(keys(api.transitionPlan('glm', 'idle', 'sleeping')), [], 'no leg through idle when idle is an end')
})

test('done/error are entered straight from working, never through idle', () => {
  const { api } = loadClient()
  // found in the browser harness: with working-to-idle shipped, working → done
  // played the put-away clip first, though done starts on the working pose
  api.runtime.health = clipHealth({ 'idle-to-working': 750, 'working-to-idle': 750 })
  assert.deepEqual(keys(api.transitionPlan('glm', 'working', 'done')), [])
  assert.deepEqual(keys(api.transitionPlan('glm', 'working', 'error')), [])
  assert.deepEqual(keys(api.transitionPlan('glm', 'sleeping', 'done')), [])
  api.runtime.health = clipHealth({ 'working-to-done': 500 })
  assert.deepEqual(keys(api.transitionPlan('glm', 'working', 'done')), ['working-to-done'], 'a direct clip still plays')
})

test('chained clips play back to back', () => {
  const { api } = loadClient()
  api.runtime.health = clipHealth({ 'idle-to-working': 1000, 'sleeping-to-idle': 600 })
  const pet = newPet()
  api.stepTransition(pet, 'sleeping', 0)
  assert.equal(api.stepTransition(pet, 'working', 0).clip.key, 'sleeping-to-idle')
  const second = api.stepTransition(pet, 'working', 650)
  assert.equal(second.clip.key, 'idle-to-working')
  assert.equal(second.endsAt, 1600)
  assert.equal(api.stepTransition(pet, 'working', 1600), null)
})

test('an activity change mid-clip replans from the clip target', () => {
  const { api } = loadClient()
  api.runtime.health = clipHealth({ 'idle-to-working': 1000, 'working-to-idle': 1000 })
  const pet = newPet()
  api.stepTransition(pet, 'idle', 0)
  api.stepTransition(pet, 'working', 0)
  assert.equal(api.stepTransition(pet, 'idle', 300).clip.key, 'working-to-idle')
  assert.equal(api.stepTransition(pet, 'done', 400), null, 'idle → done has no clip: cut straight to done')
})

test('clips are skipped under reduced motion, preview art, missing duration or a load failure', () => {
  const reduced = loadClient({ reducedMotion: true })
  reduced.api.runtime.health = clipHealth({ 'idle-to-working': 1000 })
  assert.deepEqual(reduced.api.transitionPlan('glm', 'idle', 'working'), [])

  const { api } = loadClient()
  api.runtime.health = clipHealth({ 'idle-to-working': 0 })
  assert.deepEqual(api.transitionPlan('glm', 'idle', 'working'), [], 'no ms → no clip (APNG/GIF or unparsable)')

  api.runtime.health = clipHealth({ 'idle-to-working': 1000 })
  api.customArt.glm = 'data:image/png;base64,CCCC'
  assert.deepEqual(api.transitionPlan('glm', 'idle', 'working'), [])
  delete api.customArt.glm

  const pet = newPet()
  api.stepTransition(pet, 'idle', 0)
  const step = api.stepTransition(pet, 'working', 0)
  api.markFailed('glm', step.clip.url + '&rk=1')
  assert.equal(api.stepTransition(pet, 'working', 10), null, 'a clip that failed to load is dropped')
  assert.deepEqual(api.transitionPlan('glm', 'idle', 'working'), [])
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
