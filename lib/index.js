/**
 * dsh-quota-pets — host side.
 *
 * The pet itself lives in the browser (lib/client.js). The host side does
 * two things:
 *
 *   1. Serve the per-pet asset folders under assets/ same-origin
 *      (http pages cannot load file://, and users should not stuff large
 *      images into localStorage).
 *
 *   2. Aggregate agent run outcomes per session. The HOST decides whether
 *      a finished run was clean (`done`) or failed (`error`) and publishes
 *      one settled value — the client can then never flash `done` before a
 *      late `error` lands (see docs/pet-contract.md §2).
 *
 * Routes (prefix /dsh-quota-pets):
 *
 *   GET /dsh-quota-pets/health.json                asset manifest (no-store)
 *   GET /dsh-quota-pets/avatar/<pet>/<file>?v=…    serve an asset (long cache)
 *   GET /dsh-quota-pets/events.json?session=ID     settled run outcome
 *
 * Asset layout (pet-contract v1.2):
 *
 *   assets/<petId>/<state>.<webp|apng|png>
 *
 *   petId  ∈ { glm, minimax, kimi, deepseek, default }
 *   state  ∈ { idle, working, done, error, sleeping, …Batch-2 names }
 *
 * `.webp`/`.apng` are the animated variant, `.png` the static fallback;
 * the client prefers animated and falls back per the contract chain.
 * health.json rescans every 3 s, so "drop file → reload page" just works.
 *
 * Plain JavaScript, no build step, no dependencies.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-quota-pets'

/** Only required service; degrade to placeholders without it. */
export const inject = ['webServer']

const BASE = '/dsh-quota-pets'
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SCAN_TTL_MS = 3_000
const OUTCOME_SETTLE_MS = 1_200

const PET_IDS = ['glm', 'minimax', 'kimi', 'deepseek', 'default']
/** Known states today; unknown state names are still served but flagged `extra`. */
const STATES = ['idle', 'working', 'done', 'error', 'sleeping', 'waiting', 'wake', 'stumble']
const ANIM_EXT = new Set(['webp', 'apng', 'gif'])
const EXT_TYPES = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}
const FILE_RE = /^([a-z0-9]+)\.(webp|apng|png|gif|svg)$/i

// ---------------------------------------------------------------------------
// assets scan (TTL cached; missing directory = placeholders everywhere)
// ---------------------------------------------------------------------------

let scanCache = null
let scannedAt = 0

function scanAssets(force = false) {
  if (!force && scanCache !== null && Date.now() - scannedAt < SCAN_TTL_MS) return scanCache
  const found = {} // { petId: { state: { anim: {file,v}, static: {file,v}, extra: bool } } }
  let petNames
  try {
    petNames = readdirSync(ASSETS_DIR, { withFileTypes: true })
  } catch {
    scanCache = found
    scannedAt = Date.now()
    return found
  }
  for (const petDir of petNames) {
    if (!petDir.isDirectory()) continue
    const petId = petDir.name.toLowerCase()
    if (!PET_IDS.includes(petId)) continue
    let files
    try {
      files = readdirSync(join(ASSETS_DIR, petId))
    } catch {
      continue
    }
    for (const name of files) {
      const match = FILE_RE.exec(name)
      if (!match) continue
      const state = match[1].toLowerCase()
      const ext = match[2].toLowerCase()
      let version = 0
      try {
        version = Math.floor(statSync(join(ASSETS_DIR, petId, name)).mtimeMs)
      } catch {
        continue
      }
      const entry = ((found[petId] = found[petId] || {})[state] = found[petId][state] || {})
      const slot = ANIM_EXT.has(ext) ? 'anim' : 'static'
      if (!entry[slot] || entry[slot].v < version) entry[slot] = { file: name, v: version }
      if (!STATES.includes(state)) entry.extra = true
    }
  }
  scanCache = found
  scannedAt = Date.now()
  return found
}

// ---------------------------------------------------------------------------
// run-outcome aggregation (host decides done vs error — one settled value)
// ---------------------------------------------------------------------------

/**
 * sessionId -> {
 *   running: bool,          last edge seen
 *   runStartedAt: ms,       rising edge time
 *   erroredDuringRun: bool, api-session/error observed since the rising edge
 *   outcome: 'done'|'error'|null,
 *   outcomeAt: ms,          when the outcome settled
 *   seq: int                bumped on every change (cheap client diffing)
 * }
 */
const runStates = new Map()
const OUTCOME_TTL_MS = 30 * 60_000

function runStateOf(sessionId) {
  let rs = runStates.get(sessionId)
  if (!rs) {
    rs = { running: false, runStartedAt: 0, erroredDuringRun: false, outcome: null, outcomeAt: 0, seq: 0 }
    runStates.set(sessionId, rs)
  }
  return rs
}

function bump(rs) {
  rs.seq += 1
  if (runStates.size > 64) {
    // drop the stalest entries (sessions long gone)
    const cutoff = Date.now() - OUTCOME_TTL_MS
    for (const [id, entry] of runStates) {
      if (entry !== rs && entry.outcomeAt < cutoff && !entry.running) runStates.delete(id)
    }
  }
}

function onSessionStatus(sessionId, running) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const rs = runStateOf(sessionId)
  const now = Date.now()
  if (running === true) {
    rs.running = true
    rs.runStartedAt = now
    rs.erroredDuringRun = false
    rs.outcome = null
    rs.outcomeAt = now
    bump(rs)
    return
  }
  if (rs.running !== true) return // stale falling edge
  rs.running = false
  // settle window: let a trailing api-session/error land before deciding
  setTimeout(() => {
    if (rs.running) return // a new run started during the window
    rs.outcome = rs.erroredDuringRun ? 'error' : 'done'
    rs.outcomeAt = Date.now()
    bump(rs)
  }, OUTCOME_SETTLE_MS)
}

function onSessionError(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const rs = runStateOf(sessionId)
  rs.erroredDuringRun = true
  if (rs.running) return // outcome settles on the falling edge
  // error outside a run: treat as an immediate error hold
  rs.outcome = 'error'
  rs.outcomeAt = Date.now()
  bump(rs)
}

function eventsPayload(sessionId) {
  if (!sessionId) return { ok: true, session: null, now: Date.now() }
  const rs = runStates.get(sessionId)
  return {
    ok: true,
    session: rs
      ? { running: rs.running, outcome: rs.outcome, outcomeAt: rs.outcomeAt, seq: rs.seq }
      : { running: false, outcome: null, outcomeAt: 0, seq: 0 },
    now: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendFile(res, petId, fileName, version) {
  const dir = resolvePath(ASSETS_DIR, petId)
  const path = resolvePath(dir, fileName)
  if (!path.startsWith(dir)) return sendJson(res, { ok: false, error: 'invalid path' }, 400)
  let body
  try {
    body = readFileSync(path)
  } catch {
    return sendJson(res, { ok: false, error: 'asset not found' }, 404)
  }
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  res.writeHead(200, {
    'content-type': EXT_TYPES[ext] || 'application/octet-stream',
    'content-length': body.length,
    // long cache; updates flow through health.json's v (mtime) into new URLs
    'cache-control': 'public, max-age=31536000, immutable',
    'x-pet-version': String(version || 0),
  })
  res.end(body)
}

function handleHealth(_req, res) {
  sendJson(res, { ok: true, base: BASE, pets: scanAssets(true) })
}

function handleAvatar(req, res, url) {
  // /dsh-quota-pets/avatar/<petId>/<file>?v=…
  const rest = decodeURIComponent(url.pathname.slice(BASE.length + '/avatar/'.length).split('?')[0])
  const sep = rest.lastIndexOf('/')
  if (sep <= 0) return sendJson(res, { ok: false, error: 'unknown asset path' }, 404)
  const petId = rest.slice(0, sep).toLowerCase()
  const name = rest.slice(sep + 1)
  if (!PET_IDS.includes(petId) || !FILE_RE.test(name)) {
    return sendJson(res, { ok: false, error: 'unknown asset name' }, 404)
  }
  const entry = scanAssets()[petId]
  const state = name.slice(0, name.lastIndexOf('.')).toLowerCase()
  const slot = ANIM_EXT.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) ? 'anim' : 'static'
  const file = entry && entry[state] && entry[state][slot]
  if (!file || file.file !== name) return sendJson(res, { ok: false, error: 'asset not found' }, 404)
  sendFile(res, petId, name, file.v)
}

function handleEvents(req, res, url) {
  sendJson(res, eventsPayload(url.searchParams.get('session')))
}

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const register = (webServer) => {
    webServer.register({ kind: 'prefix', path: `${BASE}/health.json`, handler: (req, res) => handleHealth(req, res) })
    webServer.register({
      kind: 'prefix',
      path: `${BASE}/avatar`,
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        handleAvatar(req, res, url)
      },
    })
    webServer.register({
      kind: 'prefix',
      path: `${BASE}/events.json`,
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        handleEvents(req, res, url)
      },
    })
  }
  try {
    ctx.effect(() => {
      register(ctx.webServer)
      return () => {}
    }, 'dsh-quota-pets: routes')
  } catch (cause) {
    throw new Error(`dsh-quota-pets: route registration failed (${cause instanceof Error ? cause.message : String(cause)})`)
  }

  // Run-outcome aggregation. Verified host events: api-session/status,
  // api-session/error. Guarded — on an old host without them the pets
  // simply fall back to client-side done detection.
  try {
    ctx.on('api-session/status', (sessionId, running) => onSessionStatus(sessionId, running))
    ctx.on('api-session/error', (sessionId) => onSessionError(sessionId))
  } catch {
    // events unavailable — degrade silently
  }
}
