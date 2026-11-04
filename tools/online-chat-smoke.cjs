/**
 * 正式独立聊天隐藏 Electron 冒烟，2026-11-03；只使用隔离合成档和账号。
 * 用法：主代理完成 npm run build 后，node tools/online-chat-smoke.cjs。
 * 静态自检：node tools/online-chat-smoke.cjs --self-test；不启动后台/Electron，不写报告。
 * 输入：本树 desktop production 产物；兄弟仓 whale-server/src/test-helpers.ts。
 * 可选环境：WHALE_CHAT_SERVER_ROOT、ELECTRON_OVERRIDE_DIST_PATH、WHALE_CHAT_TIMEOUT_MS。
 * 输出：tools/_ui-artifacts/online-chat/run-<id>/{report.json,steps.log,*.png} 和 report.json。
 * Node 侧真实 startTestApp + SQLite :memory:；透明 HTTP/WS 转发只加记录、历史闸门和原帧重放。
 * 不构建、不部署、不连接公网/默认 HTTPS/8787，不读真档，不修改业务或模拟业务控制器。
 * file:// 检查 production CSP；本次回环静态服务仅用于双布局/双语言/桌面窄屏几何。
 * 隐藏文档若阻止真实聊天则明确失败；不伪造 visibility，不改业务为测试专用。
 * 报告不含凭据、正文、完整请求 URL、原始异常/DOM；截图隐藏输入值与账号凭据。
 * 清理仅本次持有的进程、socket、server 和严格验证过的临时目录；每次运行报告 cleanup。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash, randomBytes } = require('node:crypto')
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, staticServer, sleep } = require('./wormhole-expedition-journey-shared.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(__dirname, '_ui-artifacts/online-chat')
const profilePrefix = 'whale-online-chat-'
const serverKey = 'whale.cloud.server'
const sessionKey = server => 'whale.cloud.session:' + server
const timeout = Math.max(120_000, Math.min(900_000, Number(process.env.WHALE_CHAT_TIMEOUT_MS) || 420_000))
const rendererFile = path.join(root, 'apps/desktop/out/renderer/index.html')
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

class SmokeFailure extends Error {
  constructor(code, shape) { super('在线聊天工具步骤失败'); this.code = code; this.shape = shape }
}
function need(value, code) { if (!value) throw new SmokeFailure(code) }
function failure(error, step) {
  return { step, code: error instanceof SmokeFailure ? error.code : 'unexpected-failure',
    ...(error instanceof SmokeFailure && error.shape ? { shape: error.shape } : {}) }
}
function fixture() { require('tsx/cjs'); return require('./online-chat-fixture.ts') }
function allowedOrigin(value) {
  try {
    const url = new URL(value)
    return ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1'
      && Number(url.port) > 0 && Number(url.port) !== 8787 && !url.username && !url.password
  } catch { return false }
}
function checkedProfilePath(value, parent = os.tmpdir()) {
  need(typeof value === 'string' && path.isAbsolute(value), 'profile-not-absolute')
  const absolute = path.resolve(value)
  need(path.dirname(absolute) === path.resolve(parent), 'profile-parent-mismatch')
  need(path.basename(absolute).startsWith(profilePrefix) && path.basename(absolute).length > profilePrefix.length,
    'profile-prefix-mismatch')
  return absolute
}
function ownedProfile(value, io = fs, recursive = false) {
  const absolute = checkedProfilePath(value)
  const realParent = io.realpathSync(path.dirname(absolute))
  need(path.dirname(absolute) === realParent, 'profile-parent-redirected')
  // 不仅检查根，还拒绝 profile 树里的 symlink/junction，避免递归清理越出边界。
  const inspect = current => {
    const stat = io.lstatSync(current)
    need(!stat.isSymbolicLink(), 'profile-symlink')
    need(io.realpathSync(current) === current, 'profile-redirected')
    if (recursive && stat.isDirectory()) for (const entry of io.readdirSync(current)) inspect(path.join(current, entry))
  }
  inspect(absolute)
  return absolute
}

function evaluationValue(response) {
  const shape = { object: !!response && typeof response === 'object',
    hasResult: !!response && own(response, 'result'), hasException: !!response && own(response, 'exceptionDetails'),
    remoteObject: !!response?.result && typeof response.result === 'object' }
  if (!shape.object || !shape.hasResult || !shape.remoteObject) throw new SmokeFailure('evaluate-response-shape', shape)
  if (shape.hasException) throw new SmokeFailure('evaluate-exception', shape)
  const remote = response.result
  if (!['undefined', 'boolean', 'number', 'string', 'object'].includes(remote.type)) throw new SmokeFailure('evaluate-type-shape', shape)
  if (remote.type === 'undefined') return undefined
  if (!own(remote, 'value')) throw new SmokeFailure('evaluate-value-missing', shape)
  return remote.value
}
// 不调用 JourneyPage.js/wait 的异常格式化；缺 result 也是失败，绝不吞错或读 DOM 尾部。
class SafePage extends JourneyPage {
  constructor(send) {
    super(async (method, params = {}) => {
      try { return await send(method, params) } catch { throw new SmokeFailure('cdp-command-failed') }
    })
  }
  async js(source) {
    return evaluationValue(await this.send('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true }))
  }
  async wait(source, limit = 20_000) {
    const end = Date.now() + limit
    while (Date.now() < end) { if (await this.js(source)) return; await sleep(100) }
    throw new SmokeFailure('ui-wait-timeout')
  }
  async tap(selector, options) {
    try { await super.tap(selector, options) } catch (error) {
      if (error instanceof SmokeFailure) throw error
      throw new SmokeFailure('ui-control-unreachable')
    }
  }
}

function sessionProjection(value) {
  need(value && typeof value.token === 'string' && Number.isSafeInteger(value.playerId)
    && typeof value.username === 'string' && typeof value.nickname === 'string', 'account-shape')
  return { token: value.token, playerId: value.playerId, username: value.username, nickname: value.nickname }
}
function initScript(data, server, auth, layout, locale) {
  need(allowedOrigin(server), 'injection-origin-refused')
  need(['classic', 'modern'].includes(layout) && ['zh', 'en'].includes(locale), 'injection-mode-refused')
  return settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { layout, locale, debug: false, test: false })
    + `;(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('whale.cloud.session:'))localStorage.removeItem(k);`
    + `localStorage.setItem(${JSON.stringify(serverKey)},${JSON.stringify(server)});`
    + (auth ? `localStorage.setItem(${JSON.stringify(sessionKey(server))},${JSON.stringify(JSON.stringify(sessionProjection(auth)))});` : '')
    + '})()'
}
async function waitFor(predicate, code, limit = 20_000) {
  const end = Date.now() + limit
  while (Date.now() < end) { if (await predicate()) return; await sleep(100) }
  throw new SmokeFailure(code)
}
async function closeSocket(socket) {
  if (!socket || socket.readyState === 3) return
  const closed = new Promise(resolve => socket.once('close', resolve))
  socket.close()
  let timer
  try {
    await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => { socket.terminate(); resolve() }, 1500) })])
    await waitFor(() => socket.readyState === 3, 'owned-socket-not-closed', 2000)
  } finally { clearTimeout(timer) }
}

async function bounded(promise, code, milliseconds = 15_000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new SmokeFailure(code)), milliseconds) })])
  } finally { clearTimeout(timer) }
}

async function loopbackTestApp(startTestApp, config) {
  // 现有 helper 的 listen(0) 未传 host；只收口本次真实监听，不改后台，也不留全局补丁。
  const { Server } = require('node:net')
  const original = Server.prototype.listen
  let listener, calls = 0, app
  Server.prototype.listen = function (...args) {
    need(++calls === 1 && args[0] === 0 && args.slice(1).every(arg => typeof arg === 'function'), 'unexpected-backend-listen')
    listener = this
    return original.call(this, { port: 0, host: '127.0.0.1' }, ...args.slice(1))
  }
  try {
    app = await startTestApp(config)
    const address = listener?.address()
    need(calls === 1 && address?.address === '127.0.0.1' && address.port > 0 && address.port !== 8787,
      'backend-bind-not-random-loopback')
    need(new URL(app.baseUrl).port === String(address.port), 'backend-bind-url-mismatch')
    return app
  } catch (error) {
    if (app) await bounded(app.close(), 'backend-preflight-close-timeout')
    throw error
  } finally { Server.prototype.listen = original }
}

async function backend(cleanup) {
  require('tsx/cjs')
  const serverRoot = path.resolve(process.env.WHALE_CHAT_SERVER_ROOT || path.join(root, '../whale-server'))
  const { startTestApp } = require(path.join(serverRoot, 'src/test-helpers.ts'))
  const { WebSocket, WebSocketServer } = createRequire(path.join(serverRoot, 'package.json'))('ws')
  const f = fixture()
  const app = await loopbackTestApp(startTestApp, { corsOrigin: '*', rateLimitAuthPerMin: 100, rateLimitGlobalPerMin: 5000,
    chatHistoryLimit: 100, chatRetentionPerChannel: 5000, chatBatchIntervalMs: 0,
    chatChannels: ['zh', 'en'], chatBatchMaxMessages: 5, chatMessageMaxChars: 500, nicknameMaxChars: 24 })
  const sockets = new Set(), peers = new Set(), tcp = new Set(), wires = new Set()
  const requests = []
  const stats = { accepted: 0, active: 0, peak: 0, batchesFromRenderer: 0, batchesToRenderer: 0,
    replayedFrames: 0, heldHistory: 0, protocolErrors: 0 }
  let gateway, wss, session, peer, visitor, held = true, release
  let latestPeerFrame, latestOwnFrame
  const historyGate = new Promise(resolve => { release = () => { held = false; resolve() } })
  const shutdown = async () => {
    release()
    const results = await Promise.allSettled([...sockets, ...peers].map(closeSocket))
    for (const socket of tcp) socket.destroy()
    const closing = []
    if (wss) closing.push(bounded(new Promise(resolve => wss.close(resolve)), 'gateway-ws-close-timeout'))
    if (gateway) {
      gateway.closeAllConnections()
      closing.push(bounded(new Promise(resolve => gateway.close(resolve)), 'gateway-http-close-timeout'))
    }
    closing.push(bounded(app.close(), 'real-backend-close-timeout'))
    results.push(...await Promise.allSettled(closing))
    session = peer = visitor = latestPeerFrame = latestOwnFrame = undefined
    cleanup.backendAndSocketsClosed = results.every(result => result.status === 'fulfilled')
    need(cleanup.backendAndSocketsClosed, 'backend-cleanup-incomplete')
  }
  async function api(route, method = 'GET', body, auth) {
    need(allowedOrigin(app.baseUrl) && route.startsWith('/api/') && !route.includes('://'), 'backend-target-refused')
    const response = await fetch(app.baseUrl + route, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    need(response.status === 200, 'backend-api-status')
    return response.json()
  }
  async function account(username, nickname, login = false) {
    const password = 'Smoke-' + randomBytes(24).toString('hex')
    const signup = await api('/api/auth/signup', 'POST', { username, nickname, password })
    const authenticated = login ? await api('/api/auth/login', 'POST', { username, password }) : signup
    need(authenticated.playerId === signup.playerId, 'login-account-changed')
    return sessionProjection(authenticated)
  }
  async function connect(auth) {
    const address = new URL('/api/chat/ws', app.baseUrl)
    address.protocol = 'ws:'; address.searchParams.set('token', auth.token)
    const ws = new WebSocket(address)
    peers.add(ws)
    const frames = []
    ws.on('error', () => { stats.protocolErrors++ })
    ws.on('message', raw => {
      try { frames.push(JSON.parse(String(raw))) } catch { stats.protocolErrors++ }
      if (frames.length > 400) frames.shift()
    })
    await waitFor(() => frames.some(frame => frame.type === 'hello'), 'peer-hello-timeout')
    return { ws, frames }
  }
  async function batch(client, channel, messages) {
    const start = client.frames.length
    client.ws.send(JSON.stringify({ type: 'batch', channel, messages }))
    await waitFor(() => client.frames.slice(start).some(frame => frame.type === 'batch' && frame.channel === channel
      && frame.messages?.length === messages.length && frame.messages.every((text, i) => text === messages[i])), 'peer-batch-timeout')
    const frame = client.frames.slice(start).find(frame => frame.type === 'batch' && frame.channel === channel
      && frame.messages?.length === messages.length && frame.messages.every((text, i) => text === messages[i]))
    need(frame.ids.every(id => typeof id === 'string' && /^[1-9]\d*$/.test(id)), 'server-batch-id-shape')
    return frame.ids
  }
  try {
    need(allowedOrigin(app.baseUrl), 'backend-origin-refused')
    need(app.app.db.prepare('PRAGMA database_list').all().every(row => !row.file), 'backend-not-memory')
    session = await account('OnlineChatOwner', f.CHAT_OWNER_NICKNAME, true)
    const peerAuth = await account('OnlineChatPeer', f.CHAT_PEER_NICKNAME)
    const visitorAuth = await account('OnlineChatPresence', f.CHAT_PRESENCE_NICKNAME)
    peer = await connect(peerAuth)
    for (const channel of ['zh', 'en']) {
      const messages = f.historyMessages(channel)
      for (let i = 0; i < messages.length; i += 5) await batch(peer, channel, messages.slice(i, i + 5))
    }
    const unauthorized = await fetch(app.baseUrl + '/api/chat/history?channel=zh', {
      redirect: 'error', signal: AbortSignal.timeout(10_000) })
    await unauthorized.arrayBuffer()
    need(unauthorized.status === 401, 'history-missing-auth-not-rejected')
    const newest = await api('/api/chat/history?channel=zh&limit=100', 'GET', undefined, session)
    need(newest.messages.length === 100 && Number.isSafeInteger(newest.nextBeforeId), 'history-cursor-missing')
    const older = await api('/api/chat/history?channel=zh&limit=100&beforeId=' + newest.nextBeforeId, 'GET', undefined, session)
    need(older.messages.length === 25 && older.nextBeforeId === null
      && older.messages.every(row => row.id < newest.nextBeforeId), 'history-cursor-contract')
    gateway = http.createServer(async (req, res) => {
      let url
      try { url = new URL(req.url, 'http://127.0.0.1') } catch { res.writeHead(400).end(); return }
      const route = url.pathname === '/api/profile' ? 'profile' : url.pathname === '/api/chat/history' ? 'history' : 'other'
      const channel = ['zh', 'en'].includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : null
      const row = { route, method: req.method, channel, before: url.searchParams.has('beforeId'), authenticated: !!req.headers.authorization, status: 0 }
      requests.push(row)
      if (route === 'other' || !['GET', 'OPTIONS'].includes(req.method)) { res.writeHead(403).end(); return }
      try {
        if (route === 'history' && channel === 'zh' && !row.before && held) { stats.heldHistory++; await historyGate }
        const response = await fetch(app.baseUrl + url.pathname + url.search, { method: req.method,
          headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
            ...(req.headers.origin ? { origin: req.headers.origin } : {}) },
          redirect: 'error', signal: AbortSignal.timeout(10_000) })
        const bytes = Buffer.from(await response.arrayBuffer())
        row.status = response.status
        if (route === 'history' && response.ok && req.method === 'GET') {
          const value = JSON.parse(bytes.toString())
          row.messageCount = value.messages.length
          row.hasNext = value.nextBeforeId !== null && value.nextBeforeId !== undefined
        }
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes)
      } catch { row.status = 502; res.writeHead(502).end() }
    })
    gateway.on('connection', socket => { tcp.add(socket); socket.once('close', () => tcp.delete(socket)) })
    wss = new WebSocketServer({ noServer: true })
    gateway.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/api/chat/ws' || url.searchParams.get('token') !== session.token) { socket.destroy(); return }
      wss.handleUpgrade(req, socket, head, downstream => {
        const target = new URL('/api/chat/ws', app.baseUrl)
        target.protocol = 'ws:'; target.searchParams.set('token', session.token)
        const upstream = new WebSocket(target), wire = { downstream, upstream }
        sockets.add(downstream); sockets.add(upstream); wires.add(wire)
        stats.accepted++; stats.active++; stats.peak = Math.max(stats.peak, stats.active)
        const queued = []
        downstream.on('message', raw => {
          try { if (JSON.parse(String(raw)).type === 'batch') stats.batchesFromRenderer++ } catch { stats.protocolErrors++ }
          if (upstream.readyState === WebSocket.OPEN) upstream.send(raw.toString())
          else queued.push(raw.toString())
        })
        upstream.on('open', () => { for (const raw of queued) upstream.send(raw); queued.length = 0 })
        upstream.on('message', raw => {
          try {
            const value = JSON.parse(String(raw))
            if (value.type === 'batch') {
              stats.batchesToRenderer++
              if (value.nickname === f.CHAT_PEER_NICKNAME) latestPeerFrame = raw.toString()
              if (value.nickname === f.CHAT_OWNER_NICKNAME) latestOwnFrame = raw.toString()
            }
          } catch { stats.protocolErrors++ }
          if (downstream.readyState === WebSocket.OPEN) downstream.send(raw.toString())
        })
        downstream.once('close', () => { stats.active--; wires.delete(wire); if (upstream.readyState !== 3) upstream.terminate() })
        upstream.once('close', () => { if (downstream.readyState !== 3) downstream.close() })
        for (const ws of [upstream, downstream]) {
          ws.on('error', () => { stats.protocolErrors++; if (ws.readyState !== 3) ws.terminate() })
          ws.once('close', () => sockets.delete(ws))
        }
      })
    })
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
    const url = 'http://127.0.0.1:' + gateway.address().port
    need(allowedOrigin(url), 'gateway-origin-refused')
    return { url, session, requests, stats,
      async control(action) {
        if (action === 'stats') return { ...stats }
        if (action === 'release-history') { release(); return true }
        if (action === 'reset-peak') { stats.peak = stats.active; return { ...stats } }
        if (action === 'visitor-join') { need(!visitor, 'visitor-already-open'); visitor = await connect(visitorAuth); return true }
        if (action === 'visitor-leave') { need(visitor, 'visitor-not-open'); await closeSocket(visitor.ws); visitor = undefined; return true }
        if (['race', 'zh', 'en', 'away'].includes(action)) return batch(peer, action === 'en' ? 'en' : 'zh', [f.CHAT_MARKERS[action]])
        if (action === 'replay-peer' || action === 'replay-own') {
          const raw = action === 'replay-peer' ? latestPeerFrame : latestOwnFrame
          need(raw && wires.size === 1, 'replay-needs-one-real-frame-and-connection')
          for (const wire of wires) {
            need(wire.downstream.readyState === WebSocket.OPEN, 'replay-socket-not-open')
            wire.downstream.send(raw); wire.downstream.send(raw); stats.replayedFrames += 2
          }
          return true
        }
        throw new SmokeFailure('unknown-control-action')
      }, close: shutdown }
  } catch (error) { await shutdown(); throw error }
}

function freshBuild() {
  const artifacts = ['apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js', 'apps/desktop/out/renderer/index.html']
  for (const file of artifacts) need(fs.existsSync(path.join(root, file)), 'missing-production-build')
  const latest = directory => {
    let mtime = 0
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) mtime = Math.max(mtime, latest(file))
      else if (/\.(tsx?|css|html)$/.test(entry.name)) mtime = Math.max(mtime, fs.statSync(file).mtimeMs)
    }
    return mtime
  }
  const sourceTime = Math.max(...['apps/desktop/src', 'packages/core/src', 'packages/data/src', 'packages/ui/src']
    .map(directory => latest(path.join(root, directory))))
  need(artifacts.every(file => fs.statSync(path.join(root, file)).mtimeMs >= sourceTime), 'production-build-stale')
  return artifacts.map(file => ({ file, modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString(),
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }))
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  need(Number.isInteger(child.pid), 'owned-pid-missing')
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill()
  await Promise.race([exited, sleep(10_000)])
  need(child.exitCode !== null || child.signalCode !== null, 'owned-electron-not-exited')
}

async function parent() {
  const report = { ok: false, fullSmokeVerified: false, syntheticOnly: true, simulator: false, visualApproval: false,
    target: 'desktop-production-hidden', backend: 'real-startTestApp-sqlite-memory',
    transport: 'transparent-loopback-http-ws-with-real-frame-replay',
    backendFixture: { chatBatchIntervalMs: 0, historyPerChannel: 125, historyPageLimit: 100 },
    checks: [], cleanup: {} }
  const runDir = path.join(output, 'run-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid)
  fs.mkdirSync(runDir, { recursive: true })
  let service, child, profile, timer, step = 'preflight'
  let interrupted = false
  const interrupt = () => { interrupted = true; report.interrupted = true; if (child && child.exitCode === null) child.kill() }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  try {
    report.build = freshBuild()
    step = 'real-memory-backend'
    service = await backend(report.cleanup)
    need(!interrupted, 'run-interrupted')
    report.checks.push({ id: 'authenticated-history-beforeId-nextBeforeId', ok: true })
    profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix))
    ownedProfile(profile)
    fs.writeFileSync(path.join(profile, 'save.json'), fixture().onlineChatFixture(), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_CHAT_RUN_DIR: runDir }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'WHALE_CLOUD_SMOKE_URLS']) delete env[key]
    step = 'hidden-electron-start'
    child = spawn(require('electron'), [__filename, '--child'], { cwd: root, env, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    report.ownedElectronPid = child.pid
    const send = message => {
      if (!child.connected) return
      try { child.send(message, error => { if (error) report.ipcFailed = true }) } catch { report.ipcFailed = true }
    }
    child.on('message', async message => {
      if (message?.kind === 'ready') send({ kind: 'setup', server: service.url, session: service.session })
      if (message?.kind === 'step' && /^[a-z0-9-]{1,100}$/.test(message.id)) {
        step = message.id
        fs.appendFileSync(path.join(runDir, 'steps.log'), new Date().toISOString() + ' ' + step + '\n', 'utf8')
        console.log('在线聊天检查：' + step)
      }
      if (message?.kind === 'result') {
        report.ui = message.report
        report.ok = message.report.ok === true
      }
      if (message?.kind === 'rpc' && Number.isSafeInteger(message.id)) {
        try {
          const value = await service.control(message.action)
          send({ kind: 'rpc-result', id: message.id, value })
        } catch {
          send({ kind: 'rpc-result', id: message.id, failed: true })
        }
      }
    })
    timer = setTimeout(() => { report.timedOut = true; if (child.exitCode === null) child.kill() }, timeout)
    const [code] = await once(child, 'exit')
    need(code === 0 && report.ok && !report.ipcFailed && !interrupted, 'electron-smoke-not-complete')
    need(service.requests.some(row => row.route === 'history' && row.method === 'GET' && row.before && row.authenticated && row.status === 200)
      && service.requests.filter(row => row.route === 'history').every(row => row.method === 'OPTIONS'
        ? row.status === 204 : row.method === 'GET' && row.authenticated && row.status === 200),
      'renderer-authenticated-pagination-not-observed')
    report.checks.push({ id: 'renderer-real-authenticated-history-pagination', ok: true })
    report.fullSmokeVerified = true
  } catch (error) { report.ok = false; report.failure = failure(error, step); process.exitCode = 1 }
  finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.resourcesCreated = { electron: !!child, backend: !!service, temporaryProfile: !!profile }
    try { await stopOwned(child); report.cleanup.electronExited = true } catch { report.cleanup.electronExited = false }
    if (service) {
      report.requests = service.requests
      report.socketCounts = { ...service.stats }
      try { await service.close(); report.cleanup.backendAndSocketsClosed = true } catch { report.cleanup.backendAndSocketsClosed = false }
    }
    if (profile && report.cleanup.electronExited) {
      try {
        const absolute = ownedProfile(profile, fs, true)
        fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
        report.cleanup.temporaryProfileRemoved = !fs.existsSync(absolute)
      } catch { report.cleanup.temporaryProfileRemoved = false }
    }
    if (report.ui?.cleanup) Object.assign(report.cleanup, report.ui.cleanup)
    if (Object.values(report.cleanup).some(value => value === false)) { report.ok = false; report.fullSmokeVerified = false; process.exitCode = 1 }
    report.finishedAt = new Date().toISOString()
    report.artifactDirectory = path.basename(runDir)
    const json = JSON.stringify(report, null, 2) + '\n'
    fs.writeFileSync(path.join(runDir, 'report.json'), json, 'utf8')
    fs.writeFileSync(path.join(output, 'report.json'), json, 'utf8')
    console.log('在线聊天检查' + (report.ok ? '通过' : '未通过') + '；报告：' + path.join(output, 'report.json'))
  }
}

let rpcId = 0
const pending = new Map()
function control(action) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    const timer = setTimeout(() => { pending.delete(id); reject(new SmokeFailure('control-timeout')) }, 25_000)
    pending.set(id, { resolve, reject, timer })
    process.send({ kind: 'rpc', id, action })
  })
}

async function childMain() {
  process.send({ kind: 'step', id: 'child-bootstrap' })
  const f = fixture()
  const data = require('../packages/data/src/index.ts')
  const { app, BrowserWindow, session } = require('electron')
  const profile = ownedProfile(process.env.WHALE_PERF_USERDATA || '')
  const runDir = path.resolve(process.env.WHALE_CHAT_RUN_DIR || '')
  need(path.dirname(runDir) === output && /^run-[\w-]+$/.test(path.basename(runDir)), 'artifact-path-refused')
  let setupResolve
  const setup = new Promise(resolve => { setupResolve = resolve })
  process.on('message', message => {
    if (message?.kind === 'setup') setupResolve(message)
    if (message?.kind !== 'rpc-result') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id); clearTimeout(entry.timer)
    if (message.failed) entry.reject(new SmokeFailure('backend-control-failed'))
    else entry.resolve(message.value)
  })
  process.send({ kind: 'ready' })
  const { server, session: auth } = await bounded(setup, 'child-setup-timeout', 10_000)
  need(allowedOrigin(server), 'child-server-origin-refused')
  sessionProjection(auth)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  app.setPath('userData', profile)
  const report = { ok: false, checks: [], geometry: [], screenshots: [], cleanup: {}, runtimeErrors: 0,
    blockedExternalRequests: 0, blockedOtherLoopbackRequests: 0, rendererHistoryRequests: 0 }
  let step = 'electron-ready', win, page, hosted, initializationId, locale = 'zh'
  const origins = new Set([new URL(server).origin])
  const stage = id => { step = id; process.send({ kind: 'step', id }) }
  const check = id => report.checks.push({ id, ok: true })
  const t = id => data.l10nEntryText(data.L10N[id], locale)
  const mark = async expression => {
    await page.js(`document.querySelector('[data-online-chat-smoke-target]')?.removeAttribute('data-online-chat-smoke-target')`)
    need(await page.js(`(()=>{const e=${expression};if(!e)return false;e.setAttribute('data-online-chat-smoke-target','1');return true})()`), 'semantic-control-missing')
    return '[data-online-chat-smoke-target]'
  }
  const nav = async (key = 'chat') => {
    const label = t(key === 'chat' ? 'ui.chat.019' : 'ui.App.001')
    const selector = await mark(`[...document.querySelectorAll('button.app-nav-item')].find(e=>e.dataset.navPage===${JSON.stringify(key)}||(e.getAttribute('aria-label')||e.textContent).trim()===${JSON.stringify(label)})`)
    await page.tap(selector)
    await page.wait(key === 'chat' ? `!!document.querySelector('.app-online-chat-login,.app-online-chat-history')`
      : `!document.querySelector('.app-online-chat-history,.app-online-chat-login')`)
  }
  const buttonText = async (scope, id) => {
    const selector = await mark(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>(e.getAttribute('aria-label')||e.textContent).trim()===${JSON.stringify(t(id))})`)
    await page.tap(selector)
  }
  const dismiss = async () => {
    const selectors = ['.app-comm-mask .app-comm-foot button', '.app-comm-pop .app-comms-eave-extra button',
      '.app-report-card .app-report-head button', '.app-ann .app-ann-head button']
    let quiet = 0
    for (let i = 0; i < 150; i++) {
      const selector = await page.js(`(()=>{for(const s of ${JSON.stringify(selectors)})for(const e of document.querySelectorAll(s)){const r=e.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);if(!e.disabled&&r.width>0&&r.height>0&&(hit===e||e.contains(hit)))return s}return null})()`)
      if (selector) { await page.tap(selector); quiet = 0 }
      else {
        const exists = await page.js(`!!document.querySelector('.app-comm-mask,.app-comm-pop,.app-report-card,.app-ann')`)
        quiet = exists ? 0 : quiet + 1
        if (quiet >= 12) return
        await sleep(150)
      }
    }
    throw new SmokeFailure('startup-overlays-not-settled')
  }
  const initialize = async (layout, nextLocale, signedIn, url) => {
    ownedProfile(profile)
    locale = nextLocale
    await page.send('Emulation.clearDeviceMetricsOverride')
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    page.touch = false
    if (initializationId) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initializationId })
    const result = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: initScript(data, server, signedIn ? auth : null, layout, locale) })
    need(typeof result?.identifier === 'string', 'initialization-response-shape')
    initializationId = result.identifier
    win.setContentSize(1366, 900)
    if (url) await win.loadURL(url)
    else await win.loadFile(rendererFile)
    await page.wait(`!!document.querySelector('.app-root')`)
    await dismiss()
    if (layout === 'modern' && await page.js(`!!document.querySelector('.app-log-side:not(.is-collapsed) .app-log-head-right button')`)) {
      await page.tap('.app-log-side:not(.is-collapsed) .app-log-head-right button')
      await page.wait(`!!document.querySelector('.app-log-side.is-collapsed')`)
    }
    need(!win.isVisible(), 'electron-window-became-visible')
    await nav()
  }
  const waitMessage = text => page.wait(`!![...document.querySelectorAll('.app-online-chat-message p')].find(e=>e.textContent===${JSON.stringify(text)})`)
  const messages = () => page.js(`(()=>{const els=[...document.querySelectorAll('.app-online-chat-message')],ids=els.map(e=>e.getAttribute('data-chat-message-id'));return {count:els.length,confirmed:ids.filter(id=>/^[1-9]\\d*$/.test(id||'')).length,unique:new Set(ids.filter(Boolean)).size,pending:els.filter(e=>!e.hasAttribute('data-chat-message-id')).length,failed:els.filter(e=>e.classList.contains('is-failed')).length}})()`)
  const unique = async () => {
    const value = await messages()
    need(value.count === value.confirmed && value.confirmed === value.unique && value.pending === 0 && value.failed === 0, 'duplicate-or-unconfirmed-server-id')
    return value
  }
  const select = async channel => {
    await buttonText('.app-online-chat-channels', channel === 'zh' ? 'ui.chat.006' : 'ui.chat.007')
    await page.wait(`!!document.querySelector('.app-online-chat-channels button[aria-pressed="true"]')`)
  }
  const input = async value => {
    await page.tap('.app-online-chat-input')
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll'] })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 })
    await page.send('Input.insertText', { text: value })
    need(await page.js(`document.querySelector('.app-online-chat-input')?.value===${JSON.stringify(value)}`), 'chat-input-not-applied')
  }
  const screenshot = async name => {
    need(/^[a-z0-9-]+$/.test(name), 'screenshot-name-refused')
    await page.js(`(()=>{const s=document.createElement('style');s.id='online-chat-smoke-redact';s.textContent='input,textarea{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;-webkit-text-security:disc!important} .app-cloud-profile,.app-cloud-recovery,code{visibility:hidden!important}';document.head.append(s)})()`)
    try {
      need(await page.js(`(()=>{const s=document.querySelector('#online-chat-smoke-redact');return !!s&&[...document.querySelectorAll('input,textarea')].every(e=>getComputedStyle(e).color==='rgba(0, 0, 0, 0)'&&getComputedStyle(e).textShadow==='none')&&[...document.querySelectorAll('.app-cloud-profile,.app-cloud-recovery,code')].every(e=>getComputedStyle(e).visibility==='hidden')})()`), 'screenshot-redaction-failed')
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      need(typeof image?.data === 'string' && image.data.length > 0, 'screenshot-empty')
      fs.writeFileSync(path.join(runDir, name + '.png'), Buffer.from(image.data, 'base64'))
      report.screenshots.push(name + '.png')
    } finally { await page.js(`document.querySelector('#online-chat-smoke-redact')?.remove()`) }
  }
  const pageShape = () => page.js(`(()=>{const h=document.querySelector('.app-online-chat-history');if(!h)return null;const panel=h.closest('.wui-panel'),clone=panel.cloneNode(true);clone.querySelector('.app-online-chat-count')?.remove();const text=clone.textContent||'';let signature=2166136261;for(let i=0;i<text.length;i++)signature=Math.imul(signature^text.charCodeAt(i),16777619);return {signature:signature>>>0,messageCount:h.querySelectorAll('.app-online-chat-message').length,count:Number(document.querySelector('.app-online-chat-count')?.textContent.match(/\\d+/)?.[0]),forbidden:/上线|下线|在线名单|在线玩家|连接中|已连接|连接状态|断开连接|重连中|\\b(joined|left|connected|connecting|reconnecting|disconnected|online players|online list)\\b/i.test(text),visitorVisible:text.includes(${JSON.stringify(f.CHAT_PRESENCE_NICKNAME)}),statusCount:panel.querySelectorAll('[role=status]').length,roster:!!panel.querySelector('[role=list],.app-online-chat-roster,.app-online-chat-users,.app-online-chat-presence,.app-online-chat-connection') }})()`)
  const noPresenceUi = value => need(value && !value.forbidden && !value.visitorVisible && !value.roster && value.statusCount === 1, 'presence-roster-or-connection-ui')
  const geometry = () => page.js(`(()=>{
    const history=document.querySelector('.app-online-chat-history'),compose=document.querySelector('.app-online-chat-compose'),input=document.querySelector('.app-online-chat-input'),send=document.querySelector('.app-online-chat-send'),page=document.querySelector('.app-page-content'),toolbar=document.querySelector('.app-online-chat-toolbar'),channelGroup=document.querySelector('.app-online-chat-channels'),channels=[...document.querySelectorAll('.app-online-chat-channels button')];
    if(!history||!compose||!input||!send||!page||!toolbar||!channelGroup||channels.length!==2)return {missing:true};
    const inside=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};
    const reachable=e=>{e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();let l=Math.max(0,r.left),t=Math.max(0,r.top),rr=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),v=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflow+s.overflowX+s.overflowY)){l=Math.max(l,v.left);rr=Math.min(rr,v.right);t=Math.max(t,v.top);b=Math.min(b,v.bottom)}}if(rr-l<1||b-t<1)return false;const hit=document.elementFromPoint((l+rr)/2,(t+b)/2);return hit===e||e.contains(hit)};
    const channelVisibility=e=>{const r=e.getBoundingClientRect(),bounds={left:0,top:0,right:innerWidth,bottom:innerHeight};for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),v=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)) {bounds.left=Math.max(bounds.left,v.left);bounds.right=Math.min(bounds.right,v.right)}if(/auto|scroll|hidden|clip/.test(s.overflowY)) {bounds.top=Math.max(bounds.top,v.top);bounds.bottom=Math.min(bounds.bottom,v.bottom)}}const rect={left:r.left,top:r.top,right:r.right,bottom:r.bottom};return {fullyVisible:r.width>0&&r.height>0&&r.left>=bounds.left-1&&r.top>=bounds.top-1&&r.right<=bounds.right+1&&r.bottom<=bounds.bottom+1,rect,bounds}};
    const channelVisibilityBefore=channels.map(channelVisibility),controls=[...channels,input,send];
    const controlReachability=controls.map((e,i)=>({kind:i<channels.length?'channel':e===input?'input':'send',reachable:reachable(e)})),controlReachable=controlReachability.map(x=>x.reachable),items=[...history.querySelectorAll('.app-online-chat-message')];
    const channelVisibilityAfter=channels.map(channelVisibility),toolbarHorizontalOverflow=toolbar.scrollWidth>toolbar.clientWidth+1,channelsHorizontalOverflow=channelGroup.scrollWidth>channelGroup.clientWidth+1,pageHorizontalOverflow=[document.documentElement,document.body,page].some(e=>e.scrollWidth>e.clientWidth+1);
    const messageReachable=items.map(reachable);
    const overflow=[document.documentElement,document.body,page,toolbar,channelGroup,history,compose,input,send,...items,...history.querySelectorAll('header,strong,p')].some(e=>e.scrollWidth>e.clientWidth+1);
    const longName=items.some(e=>(e.querySelector('strong')?.textContent.length||0)>=24),longText=items.some(e=>(e.querySelector('p')?.textContent.length||0)>=499);
    history.scrollTop=history.scrollHeight;
    return {viewport:[innerWidth,innerHeight],missing:false,historyInside:inside(history),composeInside:inside(compose),inputInside:inside(input),sendInside:inside(send),horizontalOverflow:overflow,toolbarHorizontalOverflow,channelsHorizontalOverflow,pageHorizontalOverflow,channelCount:channels.length,channelsFullyVisibleBefore:channelVisibilityBefore.every(x=>x.fullyVisible),channelsFullyVisibleAfter:channelVisibilityAfter.every(x=>x.fullyVisible),unreachableChannelsBefore:channelVisibilityBefore.map((x,i)=>x.fullyVisible?-1:i).filter(i=>i>=0),unreachableChannelsAfter:channelVisibilityAfter.map((x,i)=>x.fullyVisible?-1:i).filter(i=>i>=0),channelVisibilityBefore,channelVisibilityAfter,controlCount:controls.length,unreachableControls:controlReachable.filter(x=>!x).length,unreachableControlKinds:controlReachability.filter(x=>!x.reachable).map(x=>x.kind),messageCount:items.length,unreachableMessages:messageReachable.filter(x=>!x).length,longName,longText,inputMaxLength:input.maxLength,sendEnabled:!send.disabled,pageScrollTop:page.scrollTop};
  })()`)
  try {
    await app.whenReady()
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^(https?|wss?):/.test(details.url)) {
        const url = new URL(details.url)
        const origin = url.protocol === 'ws:' ? 'http://' + url.host : url.origin
        if (!allowedOrigin(details.url)) { report.blockedExternalRequests++; callback({ cancel: true }); return }
        if (!origins.has(origin)) { report.blockedOtherLoopbackRequests++; callback({ cancel: true }); return }
        if (url.pathname === '/api/chat/history') report.rendererHistoryRequests++
      }
      callback({})
    })
    const created = once(app, 'browser-window-created')
    require(path.join(root, 'apps/desktop/out/main/index.js'))
    ;[, win] = await created
    if (win.webContents.isLoadingMainFrame()) await once(win.webContents, 'did-finish-load')
    win.setMinimumSize(200, 200)
    need(!win.isVisible(), 'electron-window-not-hidden')
    need(win.webContents.getLastWebPreferences().webSecurity !== false, 'web-security-disabled')
    win.webContents.debugger.attach('1.3')
    page = new SafePage((method, params) => win.webContents.debugger.sendCommand(method, params))
    win.webContents.debugger.on('message', (_event, method) => { if (method === 'Runtime.exceptionThrown') report.runtimeErrors++ })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    stage('unauthenticated-independent-navigation-settings')
    await initialize('classic', 'zh', false)
    need(await page.js(`location.protocol==='file:'`), 'not-production-file')
    need(await page.js(`!!document.querySelector('.app-online-chat-login')&&!document.querySelector('.app-online-chat-compose')`), 'unauthenticated-chat-not-available')
    await buttonText('.app-online-chat-login', 'ui.chat.003')
    await page.wait(`!!document.querySelector('.app-settings-modal')`)
    await page.tap('#settings-tab-save')
    await page.wait(`!!document.querySelector('#settings-panel-save .app-cloud')`)
    need((await control('stats')).accepted === 0, 'unauthenticated-socket-created')
    await screenshot('unauthenticated-settings-redacted')
    check('unauthenticated-chat-nav-and-settings-login')

    stage('same-account-injected-real-session-production-chat')
    await initialize('classic', 'zh', true)
    need(await page.js(`localStorage.getItem(${JSON.stringify(serverKey)})===${JSON.stringify(server)}&&Object.keys(localStorage).filter(k=>k.startsWith('whale.cloud.session:')).length===1&&JSON.parse(localStorage.getItem(${JSON.stringify(sessionKey(server))})).playerId===${auth.playerId}`), 'per-server-session-injection-mismatch')
    report.visibility = await page.js(`({documentVisible:document.visibilityState==='visible',documentHidden:document.hidden,windowFocused:document.hasFocus()})`)
    need(report.visibility.documentVisible, 'hidden-document-visibility-blocks-chat')
    await waitFor(async () => { const s = await control('stats'); return s.active === 1 && s.heldHistory > 0 }, 'real-chat-or-held-history-timeout')
    await control('race')
    await waitMessage(f.CHAT_MARKERS.race)
    await control('release-history')
    await waitMessage(f.CHAT_LONG_TEXT)
    await page.wait(`!!document.querySelector('.app-online-chat-older:not(:disabled)')`)
    await unique()
    check('real-peer-before-history-response-and-id-overlap')

    stage('authenticated-history-pagination-realtime-dedup')
    for (let i = 0; i < 8 && await page.js(`!!document.querySelector('.app-online-chat-older')`); i++) {
      const before = (await messages()).count
      await page.tap('.app-online-chat-older')
      await page.wait(`document.querySelectorAll('.app-online-chat-message').length>${before}`)
    }
    await waitMessage(f.historyMessages('zh')[0])
    need(!await page.js(`!!document.querySelector('.app-online-chat-older')`), 'history-not-exhausted')
    const historyCount = (await unique()).count
    need(historyCount === f.CHAT_HISTORY_SIZE + 1, 'history-message-count')
    await control('zh'); await waitMessage(f.CHAT_MARKERS.zh)
    const countBeforeReplay = (await unique()).count
    await control('replay-peer'); await sleep(500)
    need((await unique()).count === countBeforeReplay, 'realtime-replay-duplicated')
    check('older-beforeId-exhaustion-and-realtime-unique-server-ids')

    stage('zh-en-isolation-and-real-ui-send-echo')
    await control('en')
    need(!await page.js(`document.querySelector('.app-online-chat-history').textContent.includes(${JSON.stringify(f.CHAT_MARKERS.en)})`), 'english-message-in-zh')
    await select('en'); await waitMessage(f.CHAT_MARKERS.en)
    need(!await page.js(`document.querySelector('.app-online-chat-history').textContent.includes(${JSON.stringify(f.CHAT_MARKERS.zh)})`), 'chinese-message-in-en')
    await unique()
    await select('zh'); await waitMessage(f.CHAT_MARKERS.zh)
    await input(f.CHAT_MARKERS.own)
    await page.tap('.app-online-chat-send')
    await waitMessage(f.CHAT_MARKERS.own)
    await page.wait(`(()=>{const e=[...document.querySelectorAll('.app-online-chat-message')].find(e=>e.querySelector('p')?.textContent===${JSON.stringify(f.CHAT_MARKERS.own)});return e?.hasAttribute('data-chat-message-id')&&e.classList.contains('is-own')&&!e.querySelector('.app-online-chat-delivery,.app-online-chat-failed')})()`)
    await control('replay-own'); await sleep(500)
    const ownCount = await page.js(`(function(){return [...document.querySelectorAll('.app-online-chat-message p')].filter(e=>e.textContent===${JSON.stringify(f.CHAT_MARKERS.own)}).length})()`)
    need(ownCount === 1 && (await control('stats')).batchesFromRenderer === 1, 'own-echo-not-unique')
    need(await page.js(`document.querySelector('.app-online-chat-input').value===''`), 'send-draft-not-cleared')
    await unique()
    check('zh-en-channel-isolation-and-real-ui-send-echo')

    stage('navigation-away-return-single-connection')
    const beforeNav = await control('reset-peak')
    await nav('map'); await control('away'); await nav()
    await waitMessage(f.CHAT_MARKERS.away)
    for (let i = 0; i < 3; i++) { await nav('map'); await nav() }
    await sleep(500)
    const afterNav = await control('stats')
    need(afterNav.accepted === beforeNav.accepted && afterNav.active === 1 && afterNav.peak === 1, 'navigation-duplicate-connection')
    await unique()
    check('navigation-retains-one-connection-and-no-duplicate-messages')

    stage('presence-count-only-join-leave-no-roster')
    await sleep(800)
    const baseline = await pageShape(); noPresenceUi(baseline)
    need(baseline.count === 2, 'initial-presence-count')
    await control('visitor-join')
    await waitFor(async () => (await pageShape())?.count === 3, 'presence-join-not-observed')
    const joined = await pageShape(); noPresenceUi(joined)
    need(joined.signature === baseline.signature && joined.messageCount === baseline.messageCount, 'presence-join-changed-chat-content')
    await control('visitor-leave')
    await waitFor(async () => (await pageShape())?.count === 2, 'presence-leave-not-observed', 40_000)
    const left = await pageShape(); noPresenceUi(left)
    need(left.signature === baseline.signature && left.messageCount === baseline.messageCount, 'presence-leave-changed-chat-content')
    check('presence-only-total-count-no-join-leave-log-roster-or-connection-status')
    await screenshot('production-file-real-chat-redacted')

    stage('classic-modern-zh-en-desktop-narrow-geometry')
    hosted = await staticServer(path.dirname(rendererFile))
    need(allowedOrigin(hosted.url), 'static-origin-refused')
    origins.add(new URL(hosted.url).origin)
    for (const layout of ['classic', 'modern']) for (const nextLocale of ['zh', 'en']) {
      await initialize(layout, nextLocale, true, hosted.url)
      need(await page.js(`document.visibilityState==='visible'`), 'hidden-document-visibility-blocks-geometry')
      await waitMessage(f.CHAT_LONG_TEXT)
      await unique()
      for (const [width, height] of [[1366, 900], [375, 812]]) {
        const mobile = width < 900
        win.setContentSize(width, height)
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
        page.touch = mobile
        if (mobile) await page.send('Emulation.setDeviceMetricsOverride', {
          width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: true,
          screenOrientation: { type: 'portraitPrimary', angle: 0 },
        })
        await sleep(650)
        const before = await control('stats')
        await nav('map'); await nav()
        await waitMessage(f.CHAT_LONG_TEXT)
        const after = await control('stats')
        need(after.active === 1 && after.accepted === before.accepted, 'geometry-navigation-duplicate-connection')
        await input(f.CHAT_LONG_TEXT)
        const box = await geometry()
        report.geometry.push({ layout, locale: nextLocale, width, height, ...box })
        need(!box.missing && box.viewport[0] === width && box.viewport[1] === height, 'geometry-viewport-or-elements')
        need(box.historyInside && box.composeInside && box.inputInside && box.sendInside && !box.horizontalOverflow
          && box.channelCount === 2 && box.channelsFullyVisibleBefore && box.channelsFullyVisibleAfter
          && box.unreachableChannelsBefore.length === 0 && box.unreachableChannelsAfter.length === 0
          && !box.toolbarHorizontalOverflow && !box.channelsHorizontalOverflow && !box.pageHorizontalOverflow
          && box.unreachableControls === 0 && box.unreachableMessages === 0 && box.longName && box.longText
          && box.inputMaxLength === 500 && box.sendEnabled && box.pageScrollTop === 0, 'geometry-overflow-or-unreachable')
        noPresenceUi(await pageShape())
        await screenshot(layout + '-' + nextLocale + '-' + width + 'x' + height + '-redacted')
      }
    }
    check('classic-modern-zh-en-1366x900-375x812-long-name-text-compose-reachability')
    need(report.runtimeErrors === 0, 'renderer-unhandled-exception')
    need(report.blockedExternalRequests === 0 && report.blockedOtherLoopbackRequests === 0, 'renderer-disallowed-network-attempt')
    need((await control('stats')).protocolErrors === 0, 'websocket-protocol-errors')
    report.ok = true
  } catch (error) {
    report.failure = failure(error, step)
    if (error instanceof SmokeFailure && /^hidden-document-visibility-/.test(error.code)) report.limitation = '隐藏 Electron 文档被标记为 hidden；真实聊天按业务规则未连接，未伪造可见性，需主代理处理验证环境。'
    if (page) {
      try { await screenshot('failure-redacted') } catch { report.failureScreenshotUnavailable = true }
    }
  } finally {
    if (hosted) {
      try { hosted.server.closeAllConnections(); await new Promise(resolve => hosted.server.close(resolve)); report.cleanup.staticServerClosed = true }
      catch { report.cleanup.staticServerClosed = false; report.ok = false }
    }
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new SmokeFailure('child-closing')) }
    pending.clear()
    process.send({ kind: 'result', report }, () => app.exit(report.ok ? 0 : 1))
  }
}

async function selfTest() {
  selfTest.step = 'fixture'
  const f = fixture()
  assert.deepEqual(f.inspectOnlineChatFixture(f.onlineChatFixture(1_800_000_000_000)),
    { synthetic: true, wallet: 111, emptyLogs: true, modeChosen: true })
  assert.equal(f.CHAT_LONG_TEXT.length, 499)
  assert.equal(f.CHAT_OWNER_NICKNAME.length, 24)
  assert.equal(f.CHAT_PEER_NICKNAME.length, 24)
  for (const channel of ['zh', 'en']) {
    assert.equal(f.historyMessages(channel).length, 125)
    assert.equal(new Set(f.historyMessages(channel)).size, 125)
  }
  selfTest.step = 'network-and-cleanup-guards'
  for (const address of ['http://127.0.0.1:12345', 'ws://127.0.0.1:12345/api/chat/ws']) assert(allowedOrigin(address))
  for (const address of ['https://example.com', 'http://127.0.0.1:8787', 'ws://localhost:8787', 'file:///tmp/x', 'http://user:secret@127.0.0.1:12345']) assert(!allowedOrigin(address))
  assert.throws(() => checkedProfilePath('relative'))
  assert.throws(() => checkedProfilePath(path.join(os.tmpdir(), 'unowned')))
  const fakePath = path.join(path.resolve(os.tmpdir()), profilePrefix + 'self-test')
  assert.equal(checkedProfilePath(fakePath), fakePath)
  assert.throws(() => ownedProfile(fakePath, { realpathSync: value => value, lstatSync: () => ({ isSymbolicLink: () => true }) }))
  assert.throws(() => ownedProfile(fakePath, {
    realpathSync: value => value,
    lstatSync: value => ({ isSymbolicLink: () => value !== fakePath, isDirectory: () => value === fakePath }),
    readdirSync: () => ['nested-link'],
  }, true))
  selfTest.step = 'evaluate-response-and-redaction'
  for (const response of [null, {}, { exceptionDetails: { text: 'SECRET_DOM' } }, { result: null },
    { result: { type: 'object' } }, { result: { value: true }, exceptionDetails: { text: 'SECRET_DOM' } }]) {
    let caught
    try { evaluationValue(response) } catch (error) { caught = error }
    assert(caught instanceof SmokeFailure)
    assert(!JSON.stringify(failure(caught, 'self-test')).includes('SECRET_DOM'))
  }
  assert.equal(evaluationValue({ result: { type: 'undefined' } }), undefined)
  assert.equal(evaluationValue({ result: { type: 'boolean', value: false } }), false)
  const page = new SafePage(async () => ({ result: { type: 'boolean', value: true } }))
  assert.equal(await page.js('true'), true)
  await page.wait('true', 10)
  await assert.rejects(new SafePage(async () => ({})).js('true'), error => error.code === 'evaluate-response-shape')
  await assert.rejects(new SafePage(async () => { throw new Error('SECRET_EXCEPTION') }).js('true'), error => {
    assert(!JSON.stringify(failure(error, 'self-test')).includes('SECRET_EXCEPTION')); return error.code === 'cdp-command-failed'
  })
  const data = require('../packages/data/src/index.ts')
  const { Script, runInNewContext } = require('node:vm')
  selfTest.step = 'initialization-and-renderer-script-syntax'
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) new Script(initScript(data, 'http://127.0.0.1:12345',
    { token: 'SELF_TEST_SECRET', playerId: 1, username: 'Synthetic', nickname: f.CHAT_OWNER_NICKNAME }, layout, locale))
  const storage = { 'whale.cloud.session:http://127.0.0.1:45678': 'old-server-only' }
  Object.defineProperties(storage, {
    setItem: { value(key, value) { this[key] = value } },
    removeItem: { value(key) { delete this[key] } },
  })
  runInNewContext(initScript(data, 'http://127.0.0.1:12345', { token: 'SELF_TEST_SECRET', playerId: 1,
    username: 'Synthetic', nickname: f.CHAT_OWNER_NICKNAME, recoveryCode: 'DO_NOT_PERSIST' }, 'classic', 'zh'), { localStorage: storage })
  assert.equal(storage[serverKey], 'http://127.0.0.1:12345')
  assert.equal(Object.keys(storage).filter(key => key.startsWith('whale.cloud.session:')).length, 1)
  assert.equal(own(JSON.parse(storage[sessionKey('http://127.0.0.1:12345')]), 'recoveryCode'), false)
  // 静态编译全部页面 evaluate/wait 模板，插值只替换为 null，不执行任何 DOM/网络代码。
  const ts = require('typescript')
  const source = ts.createSourceFile(__filename, fs.readFileSync(__filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let scripts = 0
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['js', 'wait'].includes(node.expression.name.text) && node.arguments.length) {
      const arg = node.arguments[0]
      if (ts.isNoSubstitutionTemplateLiteral(arg) || ts.isStringLiteral(arg)) { new Script(arg.text); scripts++ }
      else if (ts.isTemplateExpression(arg)) {
        new Script(arg.head.text + arg.templateSpans.map(span => 'null' + span.literal.text).join('')); scripts++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(scripts >= 30)
  assert(!JSON.stringify(failure(new Error('SELF_TEST_SECRET'), 'self-test')).includes('SELF_TEST_SECRET'))
  console.log('在线聊天自检通过：合成档、消息边界、回环/8787限制、清理路径、evaluate缺result/异常脱敏、初始化脚本；未启动后台或 Electron，未写冒烟报告。')
}

if (process.argv.includes('--child') && process.send) {
  childMain().catch(error => {
    process.send({ kind: 'result', report: { ok: false, failure: failure(error, 'child-bootstrap') } }, () => require('electron').app.exit(1))
  })
} else if (require.main === module) {
  const flags = process.argv.slice(2)
  if (flags.includes('--help')) console.log('用法：node tools/online-chat-smoke.cjs [--self-test]；完整冒烟前由主代理构建，当前工具不自动构建。')
  else if (flags.length === 1 && flags[0] === '--self-test') selfTest().catch(error => {
    console.error('在线聊天自检失败：' + selfTest.step + ' / ' + (error instanceof SmokeFailure ? error.code : 'static-check-failed') + '（原始异常已抑制）。')
    process.exitCode = 1
  })
  else if (flags.length === 0) parent().catch(() => { console.error('在线聊天工具收尾失败（原始异常已抑制）。'); process.exitCode = 1 })
  else { console.error('未知参数；使用 --help。'); process.exitCode = 1 }
}
