/**
 * dsh-quota-pets — 宿主端。
 *
 * 桌宠本体全在浏览器（lib/client.js），宿主端只做一件事：把本包 assets/
 * 目录里的自定义形象文件同源伺服给页面（http 页面里 <img> 不能引 file://，
 * 也不该让用户把大图塞 localStorage）。
 *
 * 路由（前缀 /dsh-quota-pets）：
 *
 *   GET /dsh-quota-pets/health.json          哪些 provider 有哪些形象变体（no-store）
 *   GET /dsh-quota-pets/avatar/<file>?v=…    伺服形象文件（长缓存，靠 ?v=mtime 换代）
 *
 * 形象文件命名（assets/ 目录，Codex 出图后直接扔进来，刷新即生效）：
 *
 *   <provider>.png                     基础形象（ok 态也用它）
 *   <provider>.warn.png                用量 ≥70% 的焦虑态（可选）
 *   <provider>.critical.png            用量 ≥90% 的躺平态（可选）
 *   <provider>.work.png                正在干活态（可选）
 *   扩展名支持 png / apng / gif / webp / svg / jpg
 *
 *   provider ∈ { glm, minimax, kimi, deepseek }
 *
 * 缺的变体自动回退基础形象；基础形象也缺时客户端用内置 SVG 占位。
 * health.json 每 3 秒重扫一次目录，所以「扔图 → 刷新页面」就能看到。
 *
 * 纯 JavaScript，无构建、无依赖。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-quota-pets'

/** 宿主端唯一需要的服务。老宿主没有 webServer 时插件照常降级（只用内置占位形象）。 */
export const inject = ['webServer']

const BASE = '/dsh-quota-pets'
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SCAN_TTL_MS = 3_000

const PROVIDERS = ['glm', 'minimax', 'kimi', 'deepseek']
const MOODS = ['ok', 'warn', 'critical', 'work']
const EXT_TYPES = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

const FILE_RE = new RegExp(
  `^((${PROVIDERS.join('|')}))(?:\\.(${MOODS.join('|')}))?\\.(png|apng|gif|webp|svg|jpe?g)$`,
  'i',
)

// ---------------------------------------------------------------------------
// assets 目录扫描（带 TTL 缓存；目录不存在 = 全部用内置占位）
// ---------------------------------------------------------------------------

let scanCache = null
let scannedAt = 0

function scanAssets(force = false) {
  if (!force && scanCache !== null && Date.now() - scannedAt < SCAN_TTL_MS) return scanCache
  const found = {} // { provider: { base: {name, v}, warn: {...}, ... } }
  let names
  try {
    names = readdirSync(ASSETS_DIR)
  } catch {
    scanCache = found
    scannedAt = Date.now()
    return found
  }
  for (const name of names) {
    const match = FILE_RE.exec(name)
    if (!match) continue
    const provider = match[1].toLowerCase()
    const mood = (match[2] || '').toLowerCase() // '' = 基础形象
    let version = 0
    try {
      version = Math.floor(statSync(join(ASSETS_DIR, name)).mtimeMs)
    } catch {
      continue
    }
    const entry = (found[provider] = found[provider] || {})
    const key = mood === '' ? 'base' : mood
    // 同名不同扩展名（glm.png 与 glm.gif 并存）取 mtime 新的
    if (!entry[key] || entry[key].v < version) entry[key] = { name, v: version }
  }
  scanCache = found
  scannedAt = Date.now()
  return found
}

// ---------------------------------------------------------------------------
// HTTP 基件
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

function sendFile(res, fileName, version) {
  const path = resolvePath(ASSETS_DIR, fileName)
  // 双保险：文件名已在白名单正则里，再确认没被解析出 assets 目录
  if (!path.startsWith(resolvePath(ASSETS_DIR))) {
    return sendJson(res, { ok: false, error: '非法路径' }, 400)
  }
  let body
  try {
    body = readFileSync(path)
  } catch {
    return sendJson(res, { ok: false, error: '形象文件不存在' }, 404)
  }
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  res.writeHead(200, {
    'content-type': EXT_TYPES[ext] || 'application/octet-stream',
    'content-length': body.length,
    // 长缓存；文件更新靠 mtime 变化 → health.json 里的 v 变化 → 客户端换 URL
    'cache-control': 'public, max-age=31536000, immutable',
    'x-pet-version': String(version || 0),
  })
  res.end(body)
}

function handleHealth(_req, res) {
  sendJson(res, { ok: true, base: BASE, avatars: scanAssets(true) })
}

function handleAvatar(req, res, url) {
  // 形如 /dsh-quota-pets/avatar/glm.warn.png? v=1730000000000
  const name = decodeURIComponent(url.pathname.slice(BASE.length + '/avatar/'.length).split('?')[0])
  if (!FILE_RE.test(name)) return sendJson(res, { ok: false, error: '未知的形象文件名' }, 404)
  const provider = FILE_RE.exec(name)[1].toLowerCase()
  const mood = (FILE_RE.exec(name)[2] || '').toLowerCase()
  const key = mood === '' ? 'base' : mood
  const entry = scanAssets()[provider] // scanAssets 有 TTL 缓存，代价可忽略
  const file = entry && entry[key]
  if (!file || file.name !== name) return sendJson(res, { ok: false, error: '形象文件不存在' }, 404)
  sendFile(res, name, file.v)
}

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const register = (webServer) => {
    webServer.register({ kind: 'prefix', path: `${BASE}/health.json`, handler: (req, res) => handleHealth(req, res) })
    webServer.register({
      kind: 'prefix',
      path: `${BASE}/avatar/`,
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        handleAvatar(req, res, url)
      },
    })
  }
  try {
    ctx.effect(() => {
      register(ctx.webServer)
      return () => {}
    }, 'dsh-quota-pets: avatar routes')
  } catch (cause) {
    throw new Error(`dsh-quota-pets：路由注册失败（${cause instanceof Error ? cause.message : String(cause)}）`)
  }
}
