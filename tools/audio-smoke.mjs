/**
 * **声音系统冒烟（网页构建 · 无头 Chrome）** —— 2026-11-02 入库的正式工具。
 *
 * 用途：改音效相关代码/素材后，一条命令验证整条链路真的通（不是只看类型）：
 * 安装入口 → 33 条语义清单 → blob 音频可播（CSP `media-src blob:`）→ 设置「声音」分组 →
 * 本机音效台（**强制「科幻未来」布局**，验证弹层不被设置弹窗 `clip-path` 裁切）→
 * 拖入文件按文件名自动配对 → IndexedDB 落盘 → 试听 → 导出正式入库包（捕获 Blob 校验 zip，
 * 不依赖下载目录）→ 全部清除 → 无 console error。
 *
 * 前置：① `npm --prefix web run build`（本工具自起静态服务托管 `web/dist`；
 *          用 `AUDIO_SMOKE_DIST=<相对仓库根的目录>` 可改托管别的构建产物）；
 *       ② 本机有 Chrome（默认 Program Files；可用 `CHROME_PATH` 指定，如 Edge 也行）。
 *
 * 用法：`npm run audio:smoke`
 * 输出：逐项 ✓/✗ 与最终结论；失败退出码 1。自己起的 Chrome 进程与临时 profile 在结束时清理。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'

const DIST = process.env.AUDIO_SMOKE_DIST
  ? join(process.cwd(), process.env.AUDIO_SMOKE_DIST)
  : join(process.cwd(), 'web', 'dist')
const PREFIX = '/Deepseek-EVE/'
const APP_PORT = 4174
const CDP_PORT = 9333
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 找不到 web/dist：先跑 `npm --prefix web run build`')
  process.exit(1)
}
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('✗ 找不到 Chrome/Edge：用 CHROME_PATH 指定浏览器可执行文件')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${APP_PORT}`)
    if (url.pathname === '/') {
      res.writeHead(302, { Location: PREFIX })
      res.end()
      return
    }
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    let file = join(DIST, decodeURIComponent(url.pathname.slice(PREFIX.length)))
    try {
      const info = await stat(file)
      if (info.isDirectory()) file = join(file, 'index.html')
    } catch {
      /* fallthrough */
    }
    const body = readFileSync(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failures.push(msg)
}

let chrome = null
let profileDir = null
let ws = null

async function main() {
  profileDir = mkdtempSync(join(tmpdir(), 'whale-audio-smoke-'))
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let cdpReady = false
  for (let i = 0; i < 60 && !cdpReady; i++) {
    await sleep(250)
    try {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      cdpReady = true
    } catch {
      cdpReady = false
    }
  }
  check(cdpReady, '无头浏览器已带 CDP 启动')
  if (!cdpReady) return

  await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r))
  console.log(`· 静态服务：http://127.0.0.1:${APP_PORT}${PREFIX}`)

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  check(page !== undefined, 'CDP 里有页面 target')
  if (!page) return
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params?.exceptionDetails?.text ?? 'exception')
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (res.error) throw new Error(`CDP 错误：${JSON.stringify(res.error)}`)
    if (res.result?.exceptionDetails) throw new Error(`页面异常：${JSON.stringify(res.result.exceptionDetails)}`)
    return res.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  /** 强制「科幻未来」布局：设置弹窗在该布局下有 clip-path，音效台必须用 Portal 才能完整显示 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('whale-idle:layout-set','1'); localStorage.setItem('whale-idle:layout','modern') } catch (e) {}`,
  })
  await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}${PREFIX}` })

  let ready = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    try {
      ready = await evaluate(`!!document.querySelector('.app-root')`)
    } catch {
      ready = false
    }
    if (ready) break
  }
  check(ready, '页面启动并渲染出 .app-root')
  if (!ready) return

  const api = await evaluate(`({
    hasApi: typeof window.__whaleSfx === 'object',
    ids: window.__whaleSfx ? window.__whaleSfx.ids.length : 0,
    status: window.__whaleSfx ? window.__whaleSfx.status().length : 0
  })`)
  check(api.hasApi === true, '本机调试口 window.__whaleSfx 已挂上')
  check(api.ids === 33, `语义清单 33 个（实际 ${api.ids}）`)
  check(api.status === 33, `状态列表 33 条（实际 ${api.status}）`)

  // 记录清除前的来源：仓库里放了内置素材时，"全部清除"应回到「内置」而不是「未接入」
  const before = await evaluate(`({
    source: window.__whaleSfx.status().find(s => s.id === 'invasion-alarm').source,
    builtinTotal: window.__whaleSfx.status().filter(s => s.source === 'builtin').length
  })`)
  const beforeSource = before.source
  console.log(`· 素材状态：内置素材覆盖 ${before.builtinTotal} 个事件；invasion-alarm 当前来源 = ${beforeSource}`)
  if (beforeSource !== 'none') {
    const builtinPreview = await evaluate(`window.__whaleSfx.preview('invasion-alarm')`)
    check(builtinPreview === true, '内置素材可试听（Audio 起播未抛错）')
  }

  // 素材状态（2026-11-05 船长/DanJuan 素材提交后）：29 个音频文件，覆盖 24/33；缺 9 个按设计静音（缺=不占位）
  const coverage = await evaluate(`(() => {
    const rows = window.__whaleSfx.status()
    const count = (id) => {
      const row = rows.find(s => s.id === id)
      return row === undefined ? 0 : row.builtinCount
    }
    return {
      covered: rows.filter(s => s.builtinCount > 0).length,
      missing: rows.filter(s => s.builtinCount === 0).map(s => s.id).sort(),
      bgm: ['bgm-docked','bgm-space','bgm-battle','bgm-wormhole','bgm-invasion'].map(count),
      blips: ['ambient-blip-static','ambient-blip-metal','ambient-blip-comms'].map(count),
      click: count('ui-click'),
      hit: count('combat-hit'),
    }
  })()`)
  const EXPECTED_MISSING = [
    'invasion-end',
    'combat-fire',
    'combat-miss',
    'combat-win',
    'combat-lose',
    'industry-done',
    'skill-done',
    'trade-done',
    'build-done',
  ].sort()
  check(coverage.covered === 24, `内置素材覆盖 24 个事件（实际 ${coverage.covered}）`)
  check(
    JSON.stringify(coverage.missing) === JSON.stringify(EXPECTED_MISSING),
    `缺素材的 9 个事件与预期一致（实际 ${coverage.missing.join('/')}）`,
  )
  check(
    JSON.stringify(coverage.bgm) === JSON.stringify([1, 2, 2, 2, 1]),
    `BGM 变体数（停靠1/太空2/战斗2/虫洞2/入侵1，实际 ${coverage.bgm.join('/')}）`,
  )
  check(
    JSON.stringify(coverage.blips) === JSON.stringify([2, 2, 1]),
    `环境点缀变体数（杂音2/金属2/通讯1，实际 ${coverage.blips.join('/')}）`,
  )
  check(coverage.click === 1, `ui-click 素材 1 条（实际 ${coverage.click}）`)
  check(coverage.hit === 1, `combat-hit（命中）素材已随包内置（实际 ${coverage.hit}）`)

  const WAV_FN = `function makeWav(){
    const rate=8000, secs=0.2, n=Math.floor(rate*secs), bytes=new Uint8Array(44+n*2), dv=new DataView(bytes.buffer)
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))}
    ws(0,'RIFF'); dv.setUint32(4,36+n*2,true); ws(8,'WAVE'); ws(12,'fmt '); dv.setUint32(16,16,true)
    dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true)
    dv.setUint16(32,2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,n*2,true)
    for(let i=0;i<n;i++) dv.setInt16(44+i*2, Math.round(Math.sin(i/rate*Math.PI*2*440)*3000), true)
    return new Blob([bytes], {type:'audio/wav'})
  }`
  const playResult = await evaluate(`(async () => {
    ${WAV_FN}
    const url = URL.createObjectURL(makeWav())
    const a = new Audio(url)
    a.volume = 0.01
    try { await a.play(); await new Promise(r=>setTimeout(r,150)); a.pause(); return 'ok' }
    catch (e) { return 'fail:' + (e && e.name) }
    finally { URL.revokeObjectURL(url) }
  })()`)
  check(playResult === 'ok', `blob 音频可播放（实际 ${playResult}；失败= CSP/自动播放策略问题）`)

  const openSettings = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '设置')
    if (!b) return 'no-btn'
    b.click()
    return 'ok'
  })()`)
  check(openSettings === 'ok', '顶栏「设置」按钮可点')
  await sleep(400)
  await evaluate(`document.querySelector('#settings-tab-sound')?.click()`)
  await sleep(200)
  const settings = await evaluate(`({
    modal: !!document.querySelector('.app-settings-modal'),
    sliders: document.querySelectorAll('.app-settings-slider').length,
    hasPitchRow: [...document.querySelectorAll('.app-settings-label')].some(x => x.textContent.includes('音高随机')),
    hasConsoleBtn: [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '音效台')
  })`)
  check(settings.modal === true, '设置面板已打开')
  check(settings.sliders === 8, `声音页滑条为 8（总音量/6 类分类/音高，实际 ${settings.sliders}）`)
  check(settings.hasPitchRow === true, '设置里出现「战斗音效音高随机」一行')
  check(settings.hasConsoleBtn === true, '设置内出现「音效台」入口（本机调试门禁放行）')

  const openConsole = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '音效台')
    if (!b) return 'no-btn'
    b.click()
    return 'ok'
  })()`)
  check(openConsole === 'ok', '音效台入口可点')
  await sleep(500)
  const consoleState = await evaluate(`({
    modal: !!document.querySelector('.app-sfx-modal'),
    rows: document.querySelectorAll('.app-sfx-row').length,
    hasDrop: !!document.querySelector('.app-sfx-drop'),
    groups: (() => {
      const text = document.querySelector('.app-sfx-list')?.textContent ?? ''
      return { sfx: text.includes('音效'), music: text.includes('音乐'), ambient: text.includes('环境') }
    })()
  })`)
  check(consoleState.modal === true, '音效台面板已打开')
  check(consoleState.rows === 33, `音效台列出 33 个事件（实际 ${consoleState.rows}）`)
  check(consoleState.groups.sfx && consoleState.groups.music && consoleState.groups.ambient, `音效台分「音效 / 音乐 / 环境」三组（实际 ${JSON.stringify(consoleState.groups)}）`)
  check(consoleState.hasDrop === true, '音效台有拖放区')

  // 现代布局下设置弹窗带 clip-path：嵌套弹层会被裁掉 ⇒ 这里查"弹层中心真的能命中自己"
  const visibleCheck = await evaluate(`(() => {
    const el = document.querySelector('.app-sfx-modal')
    if (!el) return { ok: false, reason: 'missing' }
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { ok: r.width > 600 && r.height > 300 && !!top && el.contains(top), w: Math.round(r.width), h: Math.round(r.height) }
  })()`)
  check(visibleCheck.ok === true, `音效台在现代布局下完整可见（实际 ${JSON.stringify(visibleCheck)}；被 clip-path 裁掉会在这里红）`)

  const dropResult = await evaluate(`(async () => {
    ${WAV_FN}
    const file = new File([makeWav()], 'invasion-alarm.wav', { type: 'audio/wav' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const el = document.querySelector('.app-sfx-drop')
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await new Promise(r => setTimeout(r, 800))
    const status = window.__whaleSfx.status().find(s => s.id === 'invasion-alarm')
    const row = [...document.querySelectorAll('.app-sfx-row')].find(r => r.textContent.includes('invasion-alarm'))
    return {
      source: status ? status.source : null,
      badge: row ? row.querySelector('.app-sfx-badge').textContent.trim() : null,
      overrides: window.__whaleSfx.overrides().length,
      preview: window.__whaleSfx.preview('invasion-alarm'),
    }
  })()`)
  check(dropResult.source === 'override', `拖入后该事件来源 = 本机覆盖（实际 ${dropResult.source}）`)
  check((dropResult.badge ?? '').includes('本机覆盖'), `面板状态徽标已切到本机覆盖（实际「${dropResult.badge}」）`)
  check(dropResult.overrides === 1, `IndexedDB 本机覆盖 1 条（实际 ${dropResult.overrides}）`)
  check(dropResult.preview === true, '本机覆盖可试听（Audio 起播未抛错）')

  // 导出正式入库包：hook createObjectURL 捕获 Blob（校验格式即可，不依赖无头浏览器的下载目录）
  const packExport = await evaluate(`(async () => {
    const btn = [...document.querySelectorAll('.app-sfx-modal button')].find(x => x.textContent.trim() === '导出正式入库包')
    if (!btn) return { ok: false, reason: 'no-btn' }
    if (btn.disabled) return { ok: false, reason: 'disabled' }
    window.__packCapture = null
    const origCreate = URL.createObjectURL
    URL.createObjectURL = function (obj) {
      try { if (obj instanceof Blob && obj.type === 'application/zip') window.__packCapture = obj } catch (e) { /* 忽略 */ }
      return origCreate.call(URL, obj)
    }
    try {
      btn.click()
      for (let i = 0; i < 40 && !window.__packCapture; i++) await new Promise(r => setTimeout(r, 100))
      const blob = window.__packCapture
      if (!blob) return { ok: false, reason: 'no-blob' }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const text = new TextDecoder().decode(bytes)
      const modal = document.querySelector('.app-sfx-modal')
      return {
        ok: true,
        size: bytes.length,
        magic: bytes[0] === 0x50 && bytes[1] === 0x4b,
        manifest: text.includes('"format": "whale-idle-sfx-pack"') && text.includes('"version": 1'),
        path: text.includes('sfx/invasion-alarm.wav'),
        notice: (modal ? modal.textContent : document.body.textContent).includes('已生成'),
      }
    } finally { URL.createObjectURL = origCreate }
  })()`)
  check(packExport.ok === true, `音效台可导出正式入库包（实际 ${JSON.stringify(packExport)}）`)
  check(packExport.magic === true && packExport.size > 200, `入库包是 zip 且非空（实际 ${packExport.size} 字节）`)
  check(packExport.manifest === true && packExport.path === true, '入库包含 manifest v1 与正确素材路径')
  check(packExport.notice === true, '导出后给出成功提示')

  /* ── 2026-11-04 调试批：页签 / 场景预演 / 实时触发 / 收起条 / 网页版一键入库兜底 ── */
  const tabs = await evaluate(`({
    count: document.querySelectorAll('.app-sfx-tab').length,
    active: document.querySelector('.app-sfx-tab.is-active')?.textContent.trim() ?? '',
    panels: !!document.querySelector('.app-sfx-panels')
  })`)
  check(tabs.count === 4, `音效台有 4 个页签（实际 ${tabs.count}）`)
  check(tabs.active === '素材清单', `默认页签 = 素材清单（实际「${tabs.active}」）`)
  check(tabs.panels === true, '音效台正文区存在（页签切换容器）')

  const scenes = await evaluate(`(async () => {
    const tab = [...document.querySelectorAll('.app-sfx-tab')].find(x => x.textContent.trim() === '场景预演')
    if (!tab) return { ok: false, reason: 'no-tab' }
    tab.click()
    await new Promise(r => setTimeout(r, 150))
    const cards = document.querySelectorAll('.app-sfx-card').length
    const firstCard = document.querySelector('.app-sfx-card')
    const forceBtn = firstCard ? [...firstCard.querySelectorAll('button')].find(x => x.textContent.trim() === '切到此场景的声音') : null
    if (!forceBtn) return { ok: false, reason: 'no-force-btn', cards }
    forceBtn.click()
    await new Promise(r => setTimeout(r, 150))
    const forced = window.__whaleSfx.sceneState()
    const restore = [...document.querySelectorAll('.app-sfx-panels button')].find(x => x.textContent.trim() === '恢复真实场景')
    if (restore) restore.click()
    await new Promise(r => setTimeout(r, 150))
    const restored = window.__whaleSfx.sceneState()
    return { ok: true, cards, forced, restored }
  })()`)
  check(scenes.ok === true && scenes.cards === 5, `场景预演页签有 5 张场景卡片（实际 ${JSON.stringify({ ok: scenes.ok, cards: scenes.cards, reason: scenes.reason })}）`)
  check(typeof scenes.forced?.forced === 'string' && scenes.forced.forced === scenes.forced.active, `「切到此场景的声音」后强制场景生效（实际 ${JSON.stringify(scenes.forced)}）`)
  check(scenes.restored?.forced === null, `「恢复真实场景」应清除强制（实际 ${scenes.restored?.forced}）`)

  const liveLog = await evaluate(`(async () => {
    // 用刚拖入的 invasion-alarm（有本机素材）触发真实播放；无素材的 cue 按设计静默、不会进日志
    window.__whaleSfx.play('invasion-alarm')
    const tab = [...document.querySelectorAll('.app-sfx-tab')].find(x => x.textContent.trim() === '实时触发')
    if (!tab) return { ok: false, reason: 'no-tab' }
    tab.click()
    await new Promise(r => setTimeout(r, 200))
    return { ok: true, rows: document.querySelectorAll('.app-sfx-log-row').length, entries: window.__whaleSfx.playLog().length }
  })()`)
  check(liveLog.ok === true, '「实时触发」页签可打开')
  check(liveLog.entries >= 1, `调试口 play() 属于真实触发并进入日志（实际 ${liveLog.entries} 条）`)
  check(liveLog.rows >= 1, `实时触发页签显示日志行（实际 ${liveLog.rows} 行）`)

  // 命中音（2026-11-05 船长报障「命中/击中不触发」的运行时证据）：素材在包内、可试听、真实播放进日志
  const battleCue = await evaluate(`(async () => {
    const preview = window.__whaleSfx.preview('combat-hit')
    const before = window.__whaleSfx.playLog().length
    window.__whaleSfx.play('combat-hit')
    await new Promise(r => setTimeout(r, 150))
    const entries = window.__whaleSfx.playLog()
    return { preview, before, now: entries.length, hasHit: entries.some(e => e.cueId === 'combat-hit') }
  })()`)
  check(battleCue.preview === true, '命中音（combat-hit）内置素材可试听')
  check(battleCue.hasHit === true, `命中音可经真实播放链路起播并进日志（实际 ${JSON.stringify(battleCue)}）`)

  const ingest = await evaluate(`(async () => {
    const tab = [...document.querySelectorAll('.app-sfx-tab')].find(x => x.textContent.trim() === '入库')
    if (!tab) return { ok: false, reason: 'no-tab' }
    tab.click()
    await new Promise(r => setTimeout(r, 150))
    const oneClick = [...document.querySelectorAll('.app-sfx-modal button')].find(x => x.textContent.trim() === '一键入库（写入仓库）')
    return {
      ok: true,
      oneClick: !!oneClick,
      disabled: oneClick ? oneClick.disabled : null,
      note: (document.querySelector('.app-sfx-panels')?.textContent ?? '').includes('桌面开发版'),
    }
  })()`)
  check(ingest.ok === true && ingest.oneClick === true, '入库页签有「一键入库（写入仓库）」按钮')
  check(ingest.disabled === true, '网页版一键入库按钮应置灰（没有 window.whale.audio 桥）')
  check(ingest.note === true, '网页版入库页签提示改用「导出 + 命令」')

  const collapse = await evaluate(`(async () => {
    const b = [...document.querySelectorAll('.app-sfx-head button')].find(x => x.textContent.trim() === '收起')
    if (!b) return { ok: false, reason: 'no-btn' }
    b.click()
    await new Promise(r => setTimeout(r, 100))
    const bar = !!document.querySelector('.app-sfx-bar')
    const modal = !!document.querySelector('.app-sfx-modal')
    const expand = [...document.querySelectorAll('.app-sfx-bar button')].find(x => x.textContent.trim() === '展开')
    if (!expand) return { ok: false, reason: 'no-expand', bar, modal }
    expand.click()
    await new Promise(r => setTimeout(r, 100))
    return { ok: true, bar, modal, reopened: !!document.querySelector('.app-sfx-modal') }
  })()`)
  check(collapse.bar === true && collapse.modal === false, '收起后只留右下角悬浮条（大窗关闭）')
  check(collapse.reopened === true, '「展开」回到音效台大窗')

  const clearResult = await evaluate(`(async () => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '全部清除')
    if (!b) return 'no-btn'
    b.click()
    await new Promise(r => setTimeout(r, 800))
    return { overrides: window.__whaleSfx.overrides().length, source: window.__whaleSfx.status().find(s => s.id === 'invasion-alarm').source }
  })()`)
  check(clearResult.overrides === 0 && clearResult.source === beforeSource, `全部清除后回到原来源（期望 ${beforeSource}，实际 ${JSON.stringify(clearResult)}）`)
  check(consoleErrors.length === 0, `页面无 console error（实际 ${consoleErrors.length} 条${consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''}）`)
}

try {
  await main()
} catch (err) {
  console.error(`✗ 冒烟执行失败：${err && err.message ? err.message : err}`)
  failures.push('执行异常')
} finally {
  try {
    ws?.close()
  } catch {
    /* 忽略 */
  }
  try {
    server.close()
  } catch {
    /* CDP 没起来时静态服务可能还没 listen——这里不能抛，否则后面的 Chrome 清理会被跳过 */
  }
  if (chrome?.pid !== undefined) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        chrome.kill('SIGKILL')
      }
    } catch {
      /* 忽略 */
    }
  }
  if (profileDir) {
    await sleep(300)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* Chrome 可能还占着 profile；退出后由系统临时目录清理 */
    }
  }
}

console.log(failures.length === 0 ? '\n✓ 声音系统冒烟全部通过' : `\n✗ 冒烟失败 ${failures.length} 项`)
process.exit(failures.length === 0 ? 0 : 1)
