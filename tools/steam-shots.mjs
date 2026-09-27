/**
 * **Steam「关于此游戏」描述区配图 · 自动截取**（`npm run shots:steam`）
 *
 * 用途（**船长 2026-09-27 令**）：「**关于此游戏**」文案共 10 段（引文 ＋ 9 个【】小节），**每段配一张图**；
 * 口径（船长五答）＝ **只喂描述区** · **旧版（classic）界面** · **图上不叠标题字** · **玩家名换占位** · **中英各一份**。
 * 本工具把 10 个画面按顺序自动摆好并截图（含"现点炉子 / 现开制造线 / 自动开战 / 离线快进"四类造状态）。
 *
 * 用法：
 *   npm run shots:steam -- --lang zh            # 中文一套
 *   npm run shots:steam -- --lang en            # 英文一套
 *   npm run shots:steam -- --lang zh --only 3,7 # 只重拍指定几张
 *
 * 前置（外部先起好，本工具不启动也不关任何进程）：
 *   1) `npm --prefix web run build` 后由本地服务托管 `web/dist`（例：`npx --yes serve -l 4174 dist`）；
 *   2) 无头 Chrome 带远程调试（**非默认端口**；本工具读 `UI_CDP_URL`，例 `http://127.0.0.1:9223`）。
 *
 * 环境变量：`UI_APP_URL`（默认 `http://127.0.0.1:4174/`）· `UI_CDP_URL`（默认 `http://127.0.0.1:9223`）。
 * 产物：`H:\大鲸鱼\steam\shots\<lang>\NN-*.png`（**仓库外**；1920×1080 原图，另有 616 宽派生版与对照表）。
 *
 * ⚠ **存档只读**：默认用 `docs/test-saves/user-backup-20260926-120117.json`（船长真档备份）**在内存里**把
 *   `state.character.name` 换成占位名（zh＝飞行员 / en＝Pilot），**真档与档内其它数据一字未改**；
 *   `localStorage` 只写 `whale:idle:save` / `whale-idle:locale`（**不写 layout** ⇒ 走默认旧版）＋ 第 10 张要用的 `whale-idle:debug`。
 *
 * ⚠ 这是**出图工具**，不进任何闸门（不是体检契约）；改它不影响游戏运行时。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9223'
const APP = process.env.UI_APP_URL ?? 'http://127.0.0.1:4174/'
const BASE_SAVE = 'H:/大鲸鱼/Deepseek-EVE-verify/docs/test-saves/user-backup-20260926-120117.json'

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const LANG = arg('lang', 'zh')
const OUT = arg('out', 'H:/大鲸鱼/steam/shots')
const ONLY = arg('only', '')
const NAME = LANG === 'en' ? 'Pilot' : '飞行员'

/* ── CDP ── */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`${CDP}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const waiting = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(String(ev.data))
  if (m.id === undefined) return
  const w = waiting.get(m.id)
  if (!w) return
  waiting.delete(m.id)
  m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result ?? {})
})
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return '(页内异常：' + String(r.exceptionDetails.exception?.description ?? '').split('\n')[0] + ')'
  return r.result?.value
}
const shot = async (slug) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(OUT, LANG, `${slug}.png`)
  mkdirSync(join(OUT, LANG), { recursive: true })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log(`  📸 ${file}`)
}

/** 点一个按钮/元素：按选择器 + 文本包含匹配；返回它点到了什么 */
const click = async (sel, text) => ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
  const b = ${text === null ? 'els[0]' : `els.find(x => (x.textContent || '').includes(${JSON.stringify(text)}))`}
  if (!b) return '(没找到)'
  b.click(); return (b.textContent || '').trim().slice(0, 24)
})()`)

const nav = async (text) => { const r = await click('.app-nav-side .app-nav-item', text); await wait(1800); return r }
const tab = async (text, sel = '.app-tasktab, .app-subtab') => { const r = await click(sel, text); await wait(1500); return r }
/** 按**下标**点页签（跨语言安全：文案会随语言变，顺序不变） */
const tabIdx = async (i, sel = '.app-subtab') => {
  const r = await ev(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!b) return '(第 ${i} 个页签不存在)'; b.click(); return (b.textContent || '').trim() })()`)
  await wait(1600)
  return r
}
/** 等某选择器出现（跨语言安全 + 抗竞态） */
const waitFor = async (sel, timeoutMs = 10000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) return true
    await wait(400)
  }
  return false
}

/* ── 准备存档：换占位名（不动真档） ── */
const save = JSON.parse(readFileSync(BASE_SAVE, 'utf8'))
save.state.character.name = NAME
const SAVE_JSON = JSON.stringify(save)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await send('Page.addScriptToEvaluateOnNewDocument', {
  source:
    `try{localStorage.clear();` +
    `localStorage.setItem('whale:idle:save', ${JSON.stringify(SAVE_JSON)});` +
    `localStorage.setItem('whale-idle:locale', ${JSON.stringify(LANG)});` +
    `localStorage.setItem('whale-idle:debug','1');}catch(e){}`,
})
console.log(`═══ Steam 配图 · lang=${LANG} · 玩家名=${NAME} · 视口 1920×1080 · 映射表：px 与 CSS 1:1 ═══`)
await send('Page.navigate', { url: APP })
await wait(9000)
await ev(`(() => { for (let i=0;i<5;i++){ const b=[...document.querySelectorAll('.app-modal button, button')].find(x=>/跳过|知道了|关闭|确定|Skip|Got it|Close/.test(x.textContent||'')); if(b) b.click() } return 1 })()`)
await wait(900)

const want = (n) => ONLY === '' || ONLY.split(',').includes(String(n))

/* ── 1 引文：通讯里「信息库 · 检索重启」那封 ── */
if (want(1)) {
  console.log('① 引文 · 通讯')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Comms' : '通讯')))
  const hit = await ev(`(() => {
    const items = [...document.querySelectorAll('.app-comms-item')]
    if (items.length === 0) return '(没有信件)'
    // 「信息库 · 检索重启」那封：中英各一套别名（文案 id = ui.comms.003/004）
    const t = items.find(x => /检索重启|Retrieval Reboot/.test(x.textContent || '')) || items[items.length - 1]
    t.click()
    return (t.textContent || '').trim().slice(0, 36) + '（共 ' + items.length + ' 封）'
  })()`)
  console.log('   选中=' + hit)
  await wait(1500)
  await shot('01-intro-recall')
}

/* ── 2 自动作业：舰船 · AI 指挥中心 ── */
if (want(2)) {
  console.log('② 自动作业 · AI 指挥中心')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Ships' : '舰船')))
  console.log('   页签=' + (await tab(LANG === 'en' ? 'AI Command' : 'AI 指挥中心')))
  await wait(800)
  await shot('02-ai-work')
}

/* ── 3 采掘与精炼：工业 · 精炼炉（滚到"正在跑"的炉卡上） ── */
if (want(3)) {
  console.log('③ 采掘与精炼 · 精炼炉')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Industry' : '工业')))
  console.log('   页签=' + (await tab(LANG === 'en' ? 'Refinery' : '精炼炉')))
  await wait(1000)
  /** 先把炉点起来：一张走「手动运转」（主控亲自那条）、两张走「AI 运转」（闲置核心顶位）—— 正是文案说的多工位排产 */
  const started = await ev(`(() => {
    const cards = [...document.querySelectorAll('.app-belt-card')]
    const out = []
    const used = new Set()
    const has = (c, re) => [...c.querySelectorAll('button')].some(b => !b.disabled && re.test(b.textContent || ''))
    for (const re of [/手动运转|Manual run/, /AI 运转|AI run/, /AI 运转|AI run/]) {
      const card = cards.find(c => !used.has(c) && has(c, re))
      if (!card) continue
      used.add(card)
      const b = [...card.querySelectorAll('button')].find(x => !x.disabled && re.test(x.textContent || ''))
      b.click()
      out.push(((card.querySelector('.app-belt-name') || {}).textContent || '').trim() + ':' + b.textContent.trim())
    }
    return out.length > 0 ? out.join(' · ') : '(没有可点的运转按钮)'
  })()`)
  console.log('   起炉=' + started)
  await wait(2500)
  /** 找到"正在运转"的炉卡（卡内带「停炉 / Stop」按钮）并居中——空转的卡面看不出"多工位排产" */
  const centered = await ev(`(() => {
    const cards = [...document.querySelectorAll('.app-belt-card')]
    const isRunning = (c) => [...c.querySelectorAll('button')].some(b => /^(停|Stop)$/.test((b.textContent || '').trim()))
    const t = cards.find(isRunning)
    // 滚到面板顶部：把「运转 N 台 / AI 核心可驱动 M」抬头 + 主控工位行 + 第一排卡都收进同一帧
    const sc = (t || cards[0]) ? (t || cards[0]).closest('.app-win-body, .wui-panel-body') : null
    if (sc) sc.scrollTop = 0
    return (t ? ((t.querySelector('.app-belt-name') || {}).textContent || 'ok').trim() : '(没有卡)') + '（在跑 ' + cards.filter(isRunning).length + ' 张）'
  })()`)
  console.log('   居中到=' + centered)
  await wait(1200)
  await shot('03-refine')
}

/* ── 4 制造与工业：工业 · 组装机（先点两张卡的开工） ── */
if (want(4)) {
  console.log('④ 制造与工业 · 组装机')
  // 独立跑（--only 4）时也要先落到工业页，否则点到的会是星图页的页签
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Industry' : '工业')))
  await waitFor('.app-subtab', 8000)
  console.log('   页签=' + (await tabIdx(1)))
  await waitFor('.app-belt-card.is-assembler .app-belt-actions button', 12000)
  await wait(600)
  const started = await ev(`(() => {
    const btns = [...document.querySelectorAll('.app-belt-card.is-assembler .app-belt-actions button')]
      .filter(b => !b.disabled && /手动制造|AI 制造|Manual|AI build/.test(b.textContent || ''))
    const out = []
    for (const b of btns.slice(0, 2)) { b.click(); out.push(b.textContent.trim()) }
    return out.length > 0 ? out.join(' / ') : '(没有可开工的卡，共 ' + btns.length + ' 个可点按钮)'
  })()`)
  console.log('   点了=' + started)
  await wait(2500)
  console.log('   制造线读数=' + (await ev(`JSON.stringify([...document.querySelectorAll('.app-belt-card.is-assembler')].filter(c=>/制造中|In progress|生产/.test(c.textContent||'')).length)`) ))
  /** 把"正在制造"的那张卡居中（卡面才有进度条与制造线读数） */
  const centered = await ev(`(() => {
    const cards = [...document.querySelectorAll('.app-belt-card.is-assembler')]
    const run = cards.filter(c => /制造中|停止制造|In progress|Stop/.test(c.textContent || ''))
    const t = run[0] || cards[0]
    if (!t) return '(没有卡)'
    t.scrollIntoView({ block: 'center' })
    return (t.querySelector('.app-belt-name') || {}).textContent || 'ok'
  })()`)
  console.log('   居中到=' + centered)
  await wait(1000)
  await shot('04-craft')
}

/* ── 5 舰船与装配：装配台 ── */
if (want(5)) {
  console.log('⑤ 舰船与装配 · 装配台')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Fitting' : '装配')))
  await wait(800)
  await shot('05-fit')
}

/* ── 6 星图与远征：星图（敌对派系显示模式）＋ 常驻悬赏 ── */
if (want(6)) {
  console.log('⑥ 星图与远征')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Undock' : '点击 出港')))
  console.log('   页签=' + (await tab(LANG === 'en' ? 'Star map' : '星图·远征')))
  console.log('   显示模式=' + (await click('.app-map-viewbar button, button', LANG === 'en' ? 'Hostile factions' : '敌对派系')))
  await wait(1200)
  await shot('06a-starmap-factions')
  // 常驻悬赏 = 星图页第 3 个页签（下标 2）——按**下标**点，跨语言安全
  console.log('   页签=' + (await tabIdx(2)))
  await waitFor('.app-ano-card', 8000)
  await wait(1000)
  await shot('06b-bounty')
}

/* ── 7 实时战斗：出港 → 常驻悬赏 → 出发 → 等接战 ── */
if (want(7)) {
  console.log('⑦ 实时战斗')
  const undock = await click('button', LANG === 'en' ? 'Undock' : '出港')
  console.log('   出港=' + undock)
  await wait(2500)
  console.log('   页签=' + (await tabIdx(2)))
  await waitFor('.app-ano-card', 8000)
  const go = await ev(`(() => {
    const cards = [...document.querySelectorAll('.app-ano-card')]
    for (const c of cards) {
      const bs = [...c.querySelectorAll('button')].filter(b => !b.disabled)
      // 出击键＝卡内主按钮（有的版本是 .is-primary，有的就是最后一个可点键）——跨语言安全
      const b = bs.find(x => x.classList.contains('is-primary')) || bs[bs.length - 1]
      if (b) { b.click(); return (b.textContent || '').trim() + '（卡：' + (c.querySelector('.app-ano-name, b, strong') || {}).textContent + '）' }
    }
    return '(没有可出发的悬赏按钮，卡数 ' + cards.length + ')'
  })()`)
  console.log('   出发=' + go)
  await wait(3000)
  const confirm = await click('.app-modal button', LANG === 'en' ? 'Confirm' : '确认')
  console.log('   确认弹窗=' + confirm)
  // 等接战：最多 4 分钟，轮询战斗界面特征
  let inBattle = false
  for (let i = 0; i < 48; i++) {
    await wait(5000)
    inBattle = await ev(`!!document.querySelector('.app-bts, .app-battle, .app-bts-stage, .app-bts-lane, .app-battle-screen')`)
    if (inBattle) break
    if (i % 6 === 5) console.log(`   …仍在航行/等待接战（${(i + 1) * 5}s）`)
  }
  console.log('   接战=' + inBattle)
  await wait(6000)
  await shot('07-battle')
}

/* ── 8 市场与贸易 ── */
if (want(8)) {
  console.log('⑧ 市场与贸易')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Market' : '市场')))
  await wait(1200)
  await shot('08-market')
}

/* ── 9 通讯与剧情 ── */
if (want(9)) {
  console.log('⑨ 通讯与剧情')
  console.log('   导航=' + (await nav(LANG === 'en' ? 'Comms' : '通讯')))
  await wait(1200)
  await shot('09-comms')
}

/* ── 10 怎么挂机：调试面板 → 离线快进 → 离线简报 ── */
if (want(10)) {
  console.log('⑩ 怎么挂机 · 离线简报')
  const dbg = await click('button', LANG === 'en' ? 'Debug' : '调试')
  console.log('   调试按钮=' + dbg)
  await wait(1200)
  /** 把快进设成 8 小时（离线简报里"离线期间照常产出"才看得出来），再点「快进」→ 弹离线简报 */
  const ff = await ev(`(() => {
    const pop = document.querySelector('.app-debug-pop')
    if (!pop) return '(调试面板没打开)'
    const num = pop.querySelector('input[type=number]')
    const sel = pop.querySelector('select')
    const setV = (el, v) => {
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (num) setV(num, '8')
    if (sel) setV(sel, 'hour')
    const b = [...pop.querySelectorAll('button')].find(x => /快进|Fast-forward/.test(x.textContent || ''))
    if (!b) return '(没有快进按钮)'
    b.click()
    return '已点快进 8 小时'
  })()`)
  console.log('   离线结算=' + ff)
  await wait(3500)
  // 关掉调试小浮层，只留离线简报（否则两个叠一起）
  await ev(`(() => { const bd = document.querySelector('.app-debug-backdrop'); if (bd) bd.click(); return 1 })()`)
  await wait(600)
  await shot('10-offline-report')
}

console.log('═══ 完成（lang=' + LANG + '）═══')
ws.close()
process.exit(0)
