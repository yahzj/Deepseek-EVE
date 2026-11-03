/**
 * 正式云设置隐藏 Electron 冒烟。先由主代理完成 desktop production build。
 * 用法：node tools/cloud-settings-smoke.cjs
 * 可选：--self-test（仅夹具/脱敏自检，不启动服务/桌面）；--backend-check（短时真实 API 自检）。
 * 输入：本树 apps/desktop/out；合成钱包 111/222；兄弟仓 whale-server/src/test-helpers.ts。
 * 环境：WHALE_CLOUD_SERVER_ROOT 可指定后台仓；ELECTRON_OVERRIDE_DIST_PATH 可复用主树 dist；
 * WHALE_CLOUD_TIMEOUT_MS 默认 360000，最小 120000。所有端口随机且仅访问回环，不使用公网。
 * 输出：tools/_ui-artifacts/cloud-settings/report.json、run-<id>/ 脱敏截图和步骤日志。
 * 不读取个人档，不落密码/token/恢复码/完整存档；清理仅限本次创建的 PID/tmp。
 * 后台始终是真实 startTestApp + SQLite :memory:；HTTP 层只是透明记录/断网开关，不是契约模拟器。
 * 生产 file:// 验证实际 CSP 请求；staticServer 仅用于双布局几何取证，不代表观感验收。
 * selectors 按 label/aria 和本地化表 id 定位；UI 在途变化由主代理在本工具内适配。
 * 后台地址不走玩家 UI：仅在自建临时 profile 以新文档脚本注入内部 serverKey 后重载。
 * --self-test 同时核对 preferences.DEFAULT_CLOUD_SERVER；不生成或覆盖冒烟报告。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, staticServer, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(__dirname, '_ui-artifacts/cloud-settings')
const prefix = 'whale-cloud-settings-'
const cloud = '#settings-panel-save .app-cloud'
const serverKey = 'whale.cloud.server'
const sessionKey = server => 'whale.cloud.session:' + server
const timeout = Math.max(120_000, Number(process.env.WHALE_CLOUD_TIMEOUT_MS) || 360_000)

function fixture() {
  require('tsx/cjs')
  return require('./cloud-settings-fixture.ts')
}

function ownedProfile(profile) {
  const absolute = path.resolve(profile)
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()), '临时目录父级不符')
  assert(path.basename(absolute).startsWith(prefix), '临时目录前缀不符')
  assert(!fs.lstatSync(absolute).isSymbolicLink(), '拒绝清理符号链接')
  assert.equal(fs.realpathSync(absolute), absolute, '拒绝清理重定向目录')
  return absolute
}

function loopback(url) {
  const parsed = new URL(url)
  return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
}

function selfTest() {
  const f = fixture()
  assert.notEqual(f.CLOUD_SMOKE_PILOT, f.CLOUD_SMOKE_CHARACTER, '账号名必须区别于游戏角色名')
  const { DEFAULT_CLOUD_SERVER } = require('../apps/desktop/src/renderer/src/features/cloud/preferences.ts')
  assert.equal(DEFAULT_CLOUD_SERVER, 'http://123.207.188.192', '默认后台契约尚未落齐或已改变')
  for (const wallet of [111, 222]) {
    assert.equal(JSON.parse(f.cloudSettingsFixture(wallet)).state.character.name, f.CLOUD_SMOKE_CHARACTER)
    const result = f.inspectCloudUpload(f.cloudSettingsFixture(wallet))
    assert.deepEqual(result, { format: 'whale-idle-save', wallet,
      characterName: f.CLOUD_SMOKE_CHARACTER, emptyLogs: true, clean: true })
  }
  assert.throws(() => f.inspectCloudUpload(f.futureCloudFixture()))
  const polluted = JSON.parse(f.cloudSettingsFixture())
  polluted.state.token = 'synthetic-secret'
  assert.equal(f.inspectCloudUpload(JSON.stringify(polluted)).clean, false)
  assert(loopback('http://127.0.0.1:1234/api/profile'))
  assert(!loopback('https://example.com/'))
  console.log('云设置默认后台、独立账号/角色、夹具与敏感字段护栏自检通过；未启动后台或 Electron。')
}

// 不保存请求/响应正文、查询值和 Authorization；凭据只短暂留在内存中供另一设备操作。
async function recordingGateway(target, label, secrets, rows) {
  let offline = false
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    const row = { destination: label, method: req.method, path: pathname,
      authorizationPresent: !!req.headers.authorization, status: 0 }
    rows.push(row)
    res.on('close', () => { if (res.headersSent) row.status = res.statusCode })
    if (offline) { row.networkFailure = true; req.socket.destroy(); return }
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      const headers = { ...req.headers }
      delete headers.host
      delete headers.connection
      const response = await fetch(target + req.url, { method: req.method, headers,
        ...(bytes.length ? { body: bytes } : {}), redirect: 'error', signal: AbortSignal.timeout(20_000) })
      const body = Buffer.from(await response.arrayBuffer())
      if (label === 'A' && req.method === 'POST' && response.ok && pathname === '/api/auth/signup') {
        const input = JSON.parse(bytes.toString())
        const auth = JSON.parse(body.toString())
        secrets.username = input.username
        secrets.password = input.password
        secrets.token = auth.token
      }
      if (label === 'A' && req.method === 'POST' && response.ok
        && ['/api/auth/login', '/api/auth/recovery/redeem'].includes(pathname)) {
        secrets.token = JSON.parse(body.toString()).token
      }
      if (req.method === 'PUT' && pathname === '/api/saves') {
        const input = JSON.parse(bytes.toString())
        row.baseVersion = input.baseVersion
        row.upload = fixture().inspectCloudUpload(input.data)
      }
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(body)
    } catch {
      row.gatewayFailure = true
      res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify({ code: 'smoke_gateway_failed' }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { url: `http://127.0.0.1:${server.address().port}`, setOffline: value => { offline = value },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}

async function backend() {
  require('tsx/cjs')
  const serverRoot = path.resolve(process.env.WHALE_CLOUD_SERVER_ROOT || path.join(root, '../whale-server'))
  // 使用 Node（不是 Electron 内嵌 Node）加载 node:sqlite；跨仓引用只存在于测试工具。
  const { startTestApp } = require(path.join(serverRoot, 'src/test-helpers.ts'))
  const apps = [], gateways = [], rows = [], secrets = {}
  try {
    for (const label of ['A', 'B']) {
      const app = await startTestApp({ corsOrigin: '*', rateLimitAuthPerMin: 100, rateLimitGlobalPerMin: 2000 })
      assert(loopback(app.baseUrl), '后台测试入口必须是回环地址')
      apps.push(app)
      gateways.push(await recordingGateway(app.baseUrl, label, secrets, rows))
    }
  } catch (error) {
    for (const gateway of gateways) await gateway.close()
    for (const app of apps) await app.close()
    throw error
  }
  async function api(route, method = 'GET', body, token = secrets.token) {
    assert(token, '尚无合成账号会话')
    const response = await fetch(apps[0].baseUrl + route, { method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) })
    const value = await response.json()
    assert.equal(response.status, 200, '真实后台准备请求失败（不输出响应正文）')
    return value
  }
  return {
    urls: gateways.map(g => g.url), rows,
    async control(action) {
      if (action === 'rows') return rows
      if (action === 'latest') {
        const value = await api('/api/saves/latest')
        return { version: value.version, ...(value.data ? { upload: fixture().inspectCloudUpload(value.data) } : {}) }
      }
      if (action === 'seed222' || action === 'seedFuture' || action === 'race') {
        const current = await api('/api/saves/latest')
        let token = secrets.token
        if (action === 'race') {
          const other = await api('/api/auth/login', 'POST', { username: secrets.username, password: secrets.password })
          token = other.token
        }
        return api('/api/saves', 'PUT', { data: action === 'seedFuture' ? fixture().futureCloudFixture()
          : fixture().cloudSettingsFixture(222), baseVersion: current.version }, token)
      }
      if (action === 'revoke') {
        await api('/api/auth/logout', 'POST')
        const probe = await fetch(apps[0].baseUrl + '/api/profile', {
          headers: { authorization: `Bearer ${secrets.token}` }, signal: AbortSignal.timeout(10_000),
        })
        await probe.arrayBuffer()
        return { strategy: 'real-http-logout-then-profile', logoutStatus: 200, probeStatus: probe.status }
      }
      if (action === 'revocation-check') {
        const signup = await fetch(gateways[0].url + '/api/auth/signup', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'RevokeSmokePilot', password: 'Smoke-only-revocation-check!' }),
          signal: AbortSignal.timeout(10_000),
        })
        await signup.arrayBuffer()
        assert.equal(signup.status, 200, '临时撤销账号准备失败')
        const initial = await this.control('revoke')
        const second = await api('/api/auth/login', 'POST', { username: secrets.username, password: secrets.password })
        secrets.token = second.token
        const subsequent = await this.control('revoke')
        assert.equal(subsequent.probeStatus, 401, '再次登录会话撤销未产生真实 401')
        return { signupStatus: signup.status, initialSession: initial, subsequentSession: subsequent,
          backendInitialSessionRevocation: initial.probeStatus === 401 }
      }
      if (action === 'offline' || action === 'online') { gateways[0].setOffline(action === 'offline'); return true }
      throw new Error('未知后台准备动作')
    },
    async close() {
      for (const gateway of gateways) await gateway.close()
      for (const app of apps) await app.close()
      for (const key of Object.keys(secrets)) delete secrets[key]
    },
  }
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  assert(Number.isInteger(child.pid), '缺少自有进程 PID')
  const ended = once(child, 'exit')
  child.kill()
  await Promise.race([ended, sleep(10_000)])
  assert(child.exitCode !== null || child.signalCode !== null, '自有 Electron 未退出，保留临时目录')
}

async function parent() {
  const report = { ok: false, target: 'desktop-production-hidden', backend: 'real-startTestApp-node-sqlite-memory',
    mode: process.argv.includes('--backend-check') ? 'backend-check-only' : 'full-electron-smoke',
    fullSmokeVerified: false, simulator: false, syntheticOnly: true, visualApproval: false, checks: [], geometry: [], cleanup: {} }
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid
  const runDir = path.join(output, 'run-' + runId)
  fs.mkdirSync(runDir, { recursive: true })
  let profile, child, service, timer
  let stage = 'preflight'
  try {
    const f = fixture()
    if (!process.argv.includes('--backend-check')) {
      for (const file of ['apps/desktop/out/main/index.js', 'apps/desktop/out/renderer/index.html']) {
        assert(fs.existsSync(path.join(root, file)), '缺少桌面构建，请先由主代理构建')
      }
      report.build = ['apps/desktop/out/main/index.js', 'apps/desktop/out/renderer/index.html'].map(file => ({
        file, modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString(),
        sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
      }))
    }
    stage = 'backend-start'
    service = await backend()
    if (process.argv.includes('--backend-check')) {
      const response = await fetch(service.urls[0] + '/health', { signal: AbortSignal.timeout(10_000) })
      assert.equal(response.status, 200)
      report.checks.push({ id: 'real-backend-health', ok: true })
      report.revocationPreflight = await service.control('revocation-check')
      report.backendInitialSessionRevocation = report.revocationPreflight.backendInitialSessionRevocation
      report.checks.push({ id: 'real-backend-revocation-401', ok: true })
      report.ok = true
      return
    }
    profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    ownedProfile(profile)
    fs.writeFileSync(path.join(profile, 'save.json'), f.cloudSettingsFixture(111))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_CLOUD_SMOKE_RUN: runDir,
      WHALE_CLOUD_SMOKE_URLS: JSON.stringify(service.urls) }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF']) delete env[key]
    stage = 'electron-start'
    child = spawn(require('electron'), [__filename, '--child'], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    report.ownedElectronPid = child.pid
    child.on('message', async message => {
      if (message.kind === 'stage') {
        stage = message.id
        fs.appendFileSync(path.join(runDir, 'steps.log'), `${new Date().toISOString()} ${stage}\n`)
        console.log('云设置检查：', stage)
      }
      if (message.kind === 'result') Object.assign(report, message.report)
      if (message.kind === 'rpc') {
        try {
          const value = await service.control(message.action)
          if (child.connected) child.send({ kind: 'rpc-result', id: message.id, value })
        } catch {
          if (child.connected) child.send({ kind: 'rpc-result', id: message.id, failed: true })
        }
      }
    })
    timer = setTimeout(() => { report.timedOut = true; child.kill() }, timeout)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '隐藏 Electron 冒烟未通过')
    assert.equal(report.ok, true, '子进程未交回完整成功报告')
    report.fullSmokeVerified = true
  } catch (error) {
    report.ok = false
    // JourneyPage 异常可能包含 DOM/输入值；不保存 message/stack/原始 CDP 消息。
    report.failure ??= { stage, kind: error.name, detail: '本步骤失败；检查脱敏几何、步骤日志与对应 selector 契约。' }
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
    try { await stopOwned(child); report.cleanup.electronExited = true } catch { report.cleanup.electronExited = false }
    if (service) {
      report.requests = service.rows
      try { await service.close(); report.cleanup.backendClosed = true } catch { report.cleanup.backendClosed = false }
    }
    if (profile && report.cleanup.electronExited) {
      try {
        const absolute = ownedProfile(profile)
        fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
        report.cleanup.temporaryProfileRemoved = !fs.existsSync(absolute)
      } catch { report.cleanup.temporaryProfileRemoved = false }
    }
    if (Object.values(report.cleanup).some(value => value === false)) { report.ok = false; process.exitCode = 1 }
    report.finishedAt = new Date().toISOString()
    report.artifactDirectory = path.relative(output, runDir)
    const json = JSON.stringify(report, null, 2) + '\n'
    fs.writeFileSync(path.join(runDir, 'report.json'), json)
    fs.writeFileSync(path.join(output, 'report.json'), json)
    console.log(`云设置检查 ${report.ok ? '通过' : '未通过'}；报告：${path.join(output, 'report.json')}`)
  }
}

let rpcId = 0
const pending = new Map()
function control(action) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('后台控制超时')) }, 30_000)
    pending.set(id, { resolve, reject, timer })
    process.send({ kind: 'rpc', id, action })
  })
}

async function childMain() {
  fixture()
  const { app, BrowserWindow, session, ipcMain } = require('electron')
  const data = require('../packages/data/src/index.ts')
  const { DEFAULT_CLOUD_SERVER } = require('../apps/desktop/src/renderer/src/features/cloud/preferences.ts')
  const profile = ownedProfile(process.env.WHALE_PERF_USERDATA || '')
  const runDir = path.resolve(process.env.WHALE_CLOUD_SMOKE_RUN || '')
  assert.equal(path.dirname(runDir), output, '输出目录不符')
  assert(path.basename(runDir).startsWith('run-'), '输出目录前缀不符')
  const [serverA, serverB] = JSON.parse(process.env.WHALE_CLOUD_SMOKE_URLS)
  assert(loopback(serverA) && loopback(serverB))
  process.on('message', message => {
    if (message.kind !== 'rpc-result') return
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.failed) entry.reject(new Error('真实后台准备失败'))
    else entry.resolve(message.value)
  })
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  app.setPath('userData', profile)
  const report = { ok: false, checks: [], geometry: [], runtimeErrors: 0, blockedExternalRequests: 0,
    defaultCloudServer: DEFAULT_CLOUD_SERVER, rendererRequests: [] }
  let stage = 'electron-ready', win, page, hosted, saveWrites = 0, operation = null, requestStart = 0
  let initializationId, copiedRecovery = ''
  const step = id => { stage = id; operation = null; process.send({ kind: 'stage', id }) }
  const check = id => report.checks.push({ id, ok: true })
  const t = id => data.l10nEntryText(data.L10N[id], 'zh')
  const ui = n => t('ui.cloud.' + String(n).padStart(3, '0'))
  const mark = async expression => {
    await page.js(`document.querySelector('[data-cloud-smoke-target]')?.removeAttribute('data-cloud-smoke-target')`)
    assert(await page.js(`(()=>{const e=${expression};if(!e)return false;e.setAttribute('data-cloud-smoke-target','1');return true})()`), '语义控件未找到')
    return '[data-cloud-smoke-target]'
  }
  const button = async (n, scope = cloud) => {
    operation = { kind: 'button', textId: 'ui.cloud.' + String(n).padStart(3, '0'), scope }
    const selector = await mark(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>e.hasAttribute('aria-pressed')===${[10, 11, 12].includes(n)}&&(e.getAttribute('aria-label')||e.textContent).trim()===${JSON.stringify(ui(n))})`)
    operation.selectorFound = true
    await page.tap(selector)
    operation.clicked = true
  }
  const field = n => `[...document.querySelectorAll(${JSON.stringify(cloud + ' label')})].find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(ui(n))})?.querySelector('input')`
  const input = async (n, value) => {
    operation = { kind: 'input', labelId: 'ui.cloud.' + String(n).padStart(3, '0') }
    const selector = await mark(field(n))
    await page.tap(selector)
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll'] })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 })
    await page.send('Input.insertText', { text: value })
    assert(await page.js(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`), '输入未应用')
  }
  const wait = async expression => {
    // 不使用 JourneyPage.wait 的 DOM 尾部异常，避免恢复码进入失败消息。
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (await page.js(expression)) return
      await sleep(200)
    }
    throw new Error('有界界面等待超时')
  }
  const idle = () => {
    operation = { kind: 'wait-idle' }
    return wait(`document.querySelector(${JSON.stringify(cloud)})?.getAttribute('aria-busy')==='false'`)
  }
  const status = n => {
    operation = { kind: 'wait-status', expectedId: 'ui.cloud.' + String(n).padStart(3, '0') }
    return wait(`document.querySelector('.app-cloud-status')?.textContent.trim()===${JSON.stringify(ui(n))}`)
  }
  const persisted = () => JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state.wallet.isk
  // 仅从 React 已有 props 读取引擎引用，不添加桥、不调用业务方法，不篡改 React 或状态。
  const memory = () => page.js(`(()=>{const e=document.querySelector(${JSON.stringify(cloud)});let f=e?.[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){const engine=f.memoizedProps?.engine;if(engine?.state)return {wallet:engine.state.wallet.isk,gameMs:engine.state.gameMs}}return null})()`)
  const wallet = async expected => {
    assert.equal(persisted(), expected, '本地持久化钱包不符')
    assert.equal((await memory())?.wallet, expected, '内存钱包不符')
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state.character.name,
      fixture().CLOUD_SMOKE_CHARACTER, '账号操作不应改变持久化角色名')
    assert(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(cloud)});let f=e?.[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){const engine=f.memoizedProps?.engine;if(engine?.state)return engine.state.character.name===${JSON.stringify(fixture().CLOUD_SMOKE_CHARACTER)}}return false})()`), '账号操作不应改变内存角色名')
  }
  const noWrite = async action => {
    const before = saveWrites
    const saved = fs.readFileSync(path.join(profile, 'save.json'), 'utf8')
    await action()
    assert.equal(saveWrites, before, '取消/拒绝路径触发本地写盘（包含心跳，需结合步骤时间复核）')
    assert.equal(fs.readFileSync(path.join(profile, 'save.json'), 'utf8'), saved, '取消/拒绝路径改变本地存档')
  }
  const settleStartupOverlays = async () => {
    operation = { kind: 'dismiss-startup-overlays', closed: 0 }
    const selectors = ['.app-comm-mask .app-comm-foot button',
      '.app-comm-pop .app-comms-eave-extra button', '.app-report-card .app-report-head button',
      '.app-ann .app-ann-head button']
    const deadline = Date.now() + 30_000
    let quietSince = 0
    while (Date.now() < deadline) {
      const found = await page.js(`(()=>{
        document.querySelector('[data-cloud-smoke-dismiss]')?.removeAttribute('data-cloud-smoke-dismiss');
        const selectors=${JSON.stringify(selectors)};
        for(const selector of selectors)for(const e of document.querySelectorAll(selector)){
          if(e.disabled||e.getAttribute('aria-disabled')==='true')continue;
          const s=getComputedStyle(e),r=e.getBoundingClientRect();
          if(s.display==='none'||s.visibility!=='visible'||r.width<1||r.height<1)continue;
          const x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);
          if(x<0||x>=innerWidth||y<0||y>=innerHeight||!(hit===e||e.contains(hit)))continue;
          e.setAttribute('data-cloud-smoke-dismiss','1');return {selector};
        }
        return {pending:!!document.querySelector('.app-comm-mask,.app-comm-pop,.app-report-card,.app-ann')};
      })()`)
      if (found.selector) {
        operation.selector = found.selector
        await page.tap('[data-cloud-smoke-dismiss]', { timeout: 2000 })
        operation.closed++
        quietSince = 0
      } else {
        if (found.pending) quietSince = 0
        else quietSince ||= Date.now()
        if (quietSince && Date.now() - quietSince >= 1800) return
        await sleep(200)
      }
    }
    throw new Error('启动弹层队列未安静，未强行点击设置')
  }
  const open = async () => {
    await wait('!!document.querySelector(".app-root")')
    await settleStartupOverlays()
    operation = { kind: 'open-settings-header' }
    await page.text('.app-header', t('ui.App.010'))
    await settleStartupOverlays()
    operation = { kind: 'open-settings-save-tab' }
    await page.tap('#settings-tab-save')
    await wait(`!!document.querySelector(${JSON.stringify(cloud)})`)
    await idle()
    assert(await page.js(`(()=>{const c=document.querySelector(${JSON.stringify(cloud)});return !c.querySelector('input[inputmode="url"],input[autocomplete="url"],input[type="url"]')&&![...c.querySelectorAll('label')].some(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(ui(3))})&&![...c.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(ui(4))})})()`), '玩家云区不应存在 server URL 输入或应用按钮')
  }
  const initialize = async (server, layout = 'classic') => {
    // 只有本次 mkdtemp 创建并验证过的 userData 可注入；移除旧初始化脚本防止顺序互相覆盖。
    ownedProfile(profile)
    assert(server === undefined || server === serverA || server === serverB, '只允许默认后台或自有回环后台')
    if (initializationId) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initializationId })
    const source = settingsScript(data.ANNOUNCEMENTS[0].id, undefined,
      { locale: 'zh', layout, debug: false, test: false })
      + (server === undefined ? `;localStorage.removeItem(${JSON.stringify(serverKey)});`
        : `;localStorage.setItem(${JSON.stringify(serverKey)},${JSON.stringify(server)});`)
    initializationId = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier
  }
  const reloadServer = async server => {
    operation = { kind: 'isolated-profile-server-injection-reload' }
    await initialize(server)
    await win.loadFile(path.join(root, 'apps/desktop/out/renderer/index.html'))
    await open()
    if (server !== undefined) assert(await page.js(`localStorage.getItem(${JSON.stringify(serverKey)})===${JSON.stringify(server)}`), '内部测试后台注入未生效')
  }
  const screenshot = async name => {
    // 截图前隐藏所有输入值与恢复码；不保存 DOM、Console、Network 原始 payload。
    await page.js(`(()=>{const s=document.createElement('style');s.id='cloud-smoke-redact';s.textContent='input,textarea,.app-cloud-recovery code{color:transparent!important;text-shadow:none!important;caret-color:transparent!important;-webkit-text-security:disc!important} .app-cloud-recovery code{visibility:hidden!important}';document.head.append(s)})()`)
    try {
      assert(await page.js(`(()=>{const el=document.querySelector('.app-cloud-recovery code');return !el||getComputedStyle(el).visibility==='hidden'})()`), '恢复码截图遮罩未生效')
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(runDir, name + '.png'), Buffer.from(image.data, 'base64'))
    } finally { await page.js(`document.querySelector('#cloud-smoke-redact')?.remove()`) }
  }
  try {
    await app.whenReady()
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/.test(details.url)) {
        const parsed = new URL(details.url)
        report.rendererRequests.push({
          destination: parsed.origin === serverA ? 'A' : parsed.origin === serverB ? 'B'
            : parsed.origin === DEFAULT_CLOUD_SERVER ? 'default'
              : loopback(parsed.origin) ? 'other-loopback' : 'external',
          method: details.method, path: parsed.pathname,
        })
      }
      if (/^(https?|wss?):/.test(details.url) && !loopback(details.url)) {
        report.blockedExternalRequests++; callback({ cancel: true }); return
      }
      if (/^https?:/.test(details.url) && loopback(details.url)
        && ![new URL(serverA).origin, new URL(serverB).origin].includes(new URL(details.url).origin)) {
        callback({ cancel: true }); return
      }
      callback({})
    })
    const handle = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
      if (channel === 'save:save') saveWrites++
      return listener(...args)
    })
    const created = once(app, 'browser-window-created')
    require(path.join(root, 'apps/desktop/out/main/index.js'))
    ;[, win] = await created
    // 主进程 createWindow 已自动 loadFile；先等它完成，避免工具的第二次导航
    // 与首次导航重叠，导致 Runtime.evaluate 的 execution context 被销毁。
    if (win.webContents.isLoadingMainFrame()) await once(win.webContents, 'did-finish-load')
    win.setMinimumSize(200, 200)
    win.setContentSize(1366, 900)
    assert.equal(win.isVisible(), false, '测试窗口必须隐藏')
    assert.notEqual(win.webContents.getLastWebPreferences().webSecurity, false, '不得关闭 webSecurity')
    win.webContents.debugger.attach('1.3')
    page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
    win.webContents.debugger.on('message', (_event, method) => {
      if (method === 'Runtime.exceptionThrown') report.runtimeErrors++
    })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await initialize(undefined)
    step('production-file-default-server-no-session')
    const defaultRequestStart = report.rendererRequests.length
    await win.loadFile(path.join(root, 'apps/desktop/out/renderer/index.html'))
    await open()
    assert.equal(await page.js('location.protocol'), 'file:')
    const csp = await page.js(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content`)
    assert(csp?.includes('connect-src'), '生产构建没有 connect-src')
    report.productionCsp = csp
    assert.equal(await page.js(`localStorage.getItem(${JSON.stringify(serverKey)})`), null, '测试脚本不应覆盖默认服务器偏好')
    await sleep(800)
    assert.equal(report.rendererRequests.slice(defaultRequestStart).filter(row => row.destination === 'default').length, 0,
      '默认后台且无 session 时不应自动请求')
    assert.equal((await control('rows')).length, 0, '默认后台不应触达随机测试后台')
    await wallet(111)
    const before = await memory()
    await sleep(500)
    assert((await memory()).gameMs > before.gameMs, '未登录单机没有继续运行')
    check('default-server-no-session-no-request-local-play')

    step('profile-injected-random-loopback-register-empty-username')
    await reloadServer(serverA)
    await button(11)
    assert(await page.js(`(${field(14)})?.value===''`), '首次注册用户名必须为空，不应预填角色名')
    assert.equal((await memory()).wallet, 111)
    assert.equal(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(cloud)});let f=e?.[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){const x=f.memoizedProps?.engine;if(x?.state)return x.state.character.name}return null})()`), fixture().CLOUD_SMOKE_CHARACTER)
    await sleep(600)
    const unauthedRows = await control('rows')
    assert(!unauthedRows.some(row => row.authorizationPresent || row.path.startsWith('/api/saves')), '未登录不应同步云档或携带凭据')
    assert(!report.rendererRequests.some(row => row.destination === 'default'), '测试过程请求了默认固定后台')
    await input(14, fixture().CLOUD_SMOKE_PILOT)
    await input(17, 'Smoke-only-Password-2026!')
    await sleep(600)
    await idle()
    await button(19)
    await wait('!!document.querySelector(".app-cloud-profile") && !!document.querySelector(".app-cloud-recovery code")')
    await idle()
    assert.equal(await page.js(`document.querySelector('.app-cloud-profile strong')?.textContent.trim()`), fixture().CLOUD_SMOKE_PILOT,
      '账号用户名应是手动输入的 pilot')
    // 剪贴板调用在 renderer 内截获；只保留本次合成恢复码内存供跨重载后的真实表单恢复。
    // 不污染用户系统剪贴板，不输出/落盘恢复码，不保存原始 CDP 消息。
    await page.js(`window.__cloudSmokeCopied=false;Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.__cloudSmokeCopied=value===document.querySelector('.app-cloud-recovery code').textContent;window.__cloudSmokeRecovery=value}})`)
    await button(22)
    assert(await page.js('window.__cloudSmokeCopied===true'), '恢复码复制内容不符')
    copiedRecovery = await page.js('window.__cloudSmokeRecovery')
    assert(typeof copiedRecovery === 'string' && copiedRecovery.length > 0, '未复制合成恢复码')
    await button(23)
    await button(25)
    const authRows = await control('rows')
    assert(authRows.some(row => row.path === '/api/auth/signup' && row.status === 200), '生产 CSP 下注册未实际到达后台')
    assert(!authRows.some(row => row.path.startsWith('/api/saves')), '注册不应自动上传/下载')
    await wallet(111)
    check('production-csp-real-signup-recovery-copy-no-auto-sync')

    step('manual-empty-cloud-upload-v1')
    await button(31)
    await wait('!!document.querySelector(".app-cloud-confirm")')
    assert.equal((await control('latest')).version, 0, '上传确认前已写云端')
    await button(38)
    await idle()
    const first = await control('latest')
    assert.equal(first.version, 1)
    assert.deepEqual(first.upload, { format: 'whale-idle-save', wallet: 111,
      characterName: fixture().CLOUD_SMOKE_CHARACTER, emptyLogs: true, clean: true })
    check('manual-upload-v1-format-no-logs-or-secrets')

    step('download-v2-preview-cancel')
    assert.equal((await control('seed222')).version, 2)
    await button(28)
    await idle()
    await noWrite(async () => {
      await button(32)
      await wait(`!!document.querySelector('.app-cloud-confirm[aria-label=${JSON.stringify(ui(39))}]')`)
      await wallet(111)
      await button(26, '.app-cloud-confirm')
      await idle()
    })
    await wallet(111)
    check('download-preview-cancel-no-write-wallet111')
    step('download-confirm-persist-memory222')
    await button(32)
    await wait('!!document.querySelector(".app-cloud-confirm")')
    await button(63)
    await idle()
    await wallet(222)
    check('download-confirm-persist-and-memory222')

    step('future-format-rejected')
    await control('seedFuture')
    await button(28)
    await idle()
    await noWrite(async () => {
      await button(32)
      await idle()
      assert.equal(await page.js('!!document.querySelector(".app-cloud-confirm")'), false, '未来格式不得进入确认')
      assert(await page.js('!!document.querySelector(".app-cloud-status")?.textContent.trim()'), '未来格式缺少错误提示')
    })
    await wallet(222)
    check('future-format-rejected-without-local-write')

    step('upload-confirm-other-device-409')
    await control('seed222')
    await button(31)
    await wait('!!document.querySelector(".app-cloud-confirm")')
    const raced = await control('race')
    await button(38)
    await idle()
    await status(112)
    assert.equal((await control('latest')).version, raced.version, '409 覆盖了另一设备新版本')
    assert((await control('rows')).some(row => row.method === 'PUT' && row.status === 409), '没有发生真实 409')
    check('other-device-write-after-preview-409-not-overwritten')

    step('offline-local-play')
    const offlineBefore = await memory()
    await control('offline')
    try {
      await button(28)
      await idle()
      await status(110)
      await sleep(500)
      assert((await memory()).gameMs > offlineBefore.gameMs, '断网后单机未继续运行')
      await wallet(222)
    } finally { await control('online') }
    check('network-error-local-play')

    step('server-switch-token-isolation')
    const switchRequestStart = (await control('rows')).length
    await reloadServer(serverB)
    assert.equal(await page.js('!!document.querySelector(".app-cloud-profile")'), false, 'B 不应使用 A 会话登录')
    assert.equal(await page.js(`localStorage.getItem(${JSON.stringify(sessionKey(serverB))})!==null`), false, 'B 不应保存 A 会话')
    await button(11)
    await input(14, 'OtherSmokePilot')
    await sleep(700)
    await idle()
    const bRows = (await control('rows')).slice(switchRequestStart).filter(row => row.destination === 'B')
    assert(bRows.some(row => row.path === '/api/auth/username-available'), '新目的地没有真实请求，隔离断言无效')
    assert(bRows.every(row => !row.authorizationPresent), '旧 token 串入另一服务器')
    await reloadServer(serverA)
    await wait('!!document.querySelector(".app-cloud-profile")')
    await idle()
    check('server-switch-old-token-not-forwarded')

    step('initial-session-logout-real-repro')
    operation = { kind: 'initial-session-real-logout-profile' }
    report.initialSessionRevocation = await control('revoke')
    report.backendInitialSessionRevocation = report.initialSessionRevocation.probeStatus === 401
    // 初始 token 的后台兼容回退缺陷单独报告，不用伪造 401 或直接改库掩盖。
    // UI 登出后通过用户名密码重新登录，产生不在 accounts.token_hash 的第二会话。
    await button(7)
    await idle()
    if (!report.backendInitialSessionRevocation) await status(131)
    await button(10)
    await input(14, fixture().CLOUD_SMOKE_PILOT)
    await input(17, 'Smoke-only-Password-2026!')
    await button(18)
    await wait('!!document.querySelector(".app-cloud-profile")')
    await idle()
    check('second-session-ui-login-for-real-401')

    step('401-clears-session-ui-login')
    requestStart = (await control('rows')).length
    operation = { kind: 'backend-revoke-and-probe' }
    report.revocation = await control('revoke')
    assert.equal(report.revocation.probeStatus, 401, '撤销准备没有实际产生 401，不能归因于 UI')
    await button(28)
    await idle()
    await status(102)
    operation = { kind: 'assert-session-removed' }
    assert.equal(await page.js(`localStorage.getItem(${JSON.stringify(sessionKey(serverA))})`), null)
    operation = { kind: 'assert-profile-cleared' }
    assert.equal(await page.js('!!document.querySelector(".app-cloud-profile")'), false)
    await button(10)
    await input(14, fixture().CLOUD_SMOKE_PILOT)
    await input(17, 'Smoke-only-Password-2026!')
    await button(18)
    await wait('!!document.querySelector(".app-cloud-profile")')
    await idle()
    await wallet(222)
    check('401-clears-session-and-manual-login')

    step('manual-logout-recovery-redeem')
    await button(7)
    await idle()
    await button(12)
    await input(13, copiedRecovery)
    copiedRecovery = ''
    await button(20)
    await wait('!!document.querySelector(".app-cloud-profile")')
    await idle()
    await wallet(222)
    assert((await control('rows')).some(row => row.path === '/api/auth/recovery/redeem' && row.status === 200), '恢复未到达真实后台')
    check('manual-logout-and-ui-recovery-redeem')
    await screenshot('production-file-cloud')

    step('two-layouts-desktop375-geometry')
    hosted = await staticServer(path.join(root, 'apps/desktop/out/renderer'))
    for (const layout of ['classic', 'modern']) {
      await initialize(serverA, layout)
      await win.loadURL(hosted.url)
      await open()
      // HTTP 与 file origin 的偏好隔离；通过真实表单登录，几何包含版本列表/确认区。
      if (!await page.js('!!document.querySelector(".app-cloud-profile")')) {
        await button(10)
        await input(14, fixture().CLOUD_SMOKE_PILOT)
        await input(17, 'Smoke-only-Password-2026!')
        await button(18)
        await wait('!!document.querySelector(".app-cloud-profile")')
        await idle()
      }
      await button(28)
      await idle()
      await button(31)
      await wait('!!document.querySelector(".app-cloud-confirm")')
      for (const [width, height] of [[1366, 900], [375, 812]]) {
        win.setContentSize(width, height)
        await sleep(250)
        const geometry = await page.js(`(()=>{const c=document.querySelector(${JSON.stringify(cloud)}),m=c.closest('.app-settings-modal'),list=m.querySelector('.app-settings-list');const r=m.getBoundingClientRect();const controls=[...c.querySelectorAll('button,input')];const unreachable=[];for(let i=0;i<controls.length;i++){const el=controls[i];el.scrollIntoView({block:'nearest',inline:'nearest'});const b=el.getBoundingClientRect(),hit=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);if(b.left<0||b.right>innerWidth+1||b.top<0||b.bottom>innerHeight+1||!(hit===el||el.contains(hit)))unreachable.push(i)}return {viewport:[innerWidth,innerHeight],modalInside:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,horizontalOverflow:[c,m,list].some(e=>e.scrollWidth>e.clientWidth+1),controlCount:controls.length,unreachable}})()`)
        report.geometry.push({ layout, width, height, ...geometry })
        assert.deepEqual(geometry.viewport, [width, height], '实际窗口尺寸未达要求')
        assert(geometry.modalInside && !geometry.horizontalOverflow && !geometry.unreachable.length, '云区横向溢出或内容不可达')
        await screenshot(`${layout}-${width}`)
      }
    }
    check('classic-modern-1366-375-reachability-no-horizontal-overflow')
    assert.equal(report.runtimeErrors, 0, '存在 renderer 未处理异常（不落原始消息）')
    report.ok = true
  } catch (error) {
    report.failure = { stage, kind: error.name, operation,
      detail: '界面步骤失败；未记录原始异常以免泄露凭据。' }
    try { report.failure.http = (await control('rows')).slice(requestStart) } catch {}
    if (page) {
      try {
        const statusIds = Object.fromEntries(Array.from({ length: 30 }, (_, i) => {
          const id = 'ui.cloud.' + (101 + i)
          return [id, data.L10N[id] ? t(id) : '']
        }))
        report.failure.safeUi = await page.js(`(()=>{const c=document.querySelector(${JSON.stringify(cloud)}),status=c?.querySelector('[role=status]')?.textContent.trim()||'';const ids=${JSON.stringify(statusIds)};return {protocol:location.protocol,viewport:[innerWidth,innerHeight],cloudPresent:!!c,busy:c?.getAttribute('aria-busy'),profilePresent:!!c?.querySelector('.app-cloud-profile'),sessionStored:localStorage.getItem(${JSON.stringify(sessionKey(serverA))})!==null,confirmationCount:c?.querySelectorAll('.app-cloud-confirm').length,fields:[...c?.querySelectorAll('input')||[]].map(e=>({type:e.type,autocomplete:e.autocomplete,disabled:e.disabled})),buttons:[...c?.querySelectorAll('button')||[]].map(e=>({disabled:e.disabled,pressed:e.getAttribute('aria-pressed'),loginMode:e.textContent.trim()===${JSON.stringify(ui(10))},loginSubmit:e.textContent.trim()===${JSON.stringify(ui(18))}})),statusPresent:!!status,statusId:Object.keys(ids).find(id=>ids[id]&&ids[id]===status)||null}})()`)
        await screenshot('failure-redacted')
      } catch {}
    }
  } finally {
    copiedRecovery = ''
    if (hosted) { hosted.server.closeAllConnections(); await new Promise(resolve => hosted.server.close(resolve)) }
    for (const entry of pending.values()) clearTimeout(entry.timer)
    process.send({ kind: 'result', report }, () => app.exit(report.ok ? 0 : 1))
  }
}

if (process.argv.includes('--self-test')) selfTest()
else if (process.argv.includes('--child')) childMain().catch(() => {
  if (process.send) process.send({ kind: 'result', report: { ok: false, failure: { stage: 'child-bootstrap', detail: '子进程启动失败（原始异常已抑制）' } } }, () => require('electron').app.exit(1))
  else require('electron').app.exit(1)
})
else parent().catch(() => { console.error('云设置工具收尾失败（未输出敏感异常）。'); process.exitCode = 1 })
