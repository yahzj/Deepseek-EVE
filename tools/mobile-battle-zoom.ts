/**
 * **手机战斗画面「忽大忽小」回归探针**（2026-10-02 建 · 二号；船长令「按你的建议先修」后**转正为正式工具**）：
 * 修玩家报障「手机端的战斗画面会忽大忽小（缩放）」时用它取证；**以后改手机视口/缩放相关逻辑都该先跑它**。
 *
 * 它回答四个问题：
 *   ① 战斗画面的缩放系数跟谁走？—— 两条链：`App.tsx` 旋转层（`--mob-scale = 可见高/1200`、
 *      `--mob-h = 1200×可见宽/可见高`）与 `ui/battleFit.ts` 战场层（`k = min(1, 舞台可用高/内容自然高)`）；
 *   ② **幅度**多大（物理像素层面的内容缩放 = `k × --mob-scale`）；
 *   ③ 是不是**自激**（视口不动时 `k` 自己在抖）—— 排除"代码自己抖"这一种成因；
 *   ④ **地址栏"滑动"仿真**（逐帧 8px 改可见视口高）—— **本次修复的关键验证**：旧实现逐帧照单重排
 *      （＝一段连续缩放动画，就是玩家看到的"忽大忽小"）；现口径"小变化要连续 300ms 稳定才采纳"
 *      ⇒ **滑动期间一次都不该重排**，停稳之后干净地采纳一次。另测回弹方向 780→844 与合成双击。
 *
 * 运行前置（与 `ui-battle-fit.ts` 同款，**不自己起浏览器、也绝不动别人的浏览器**）：
 *   1) 网页版已构建并跑：本仓 `npm run build --prefix web` 后
 *      `npm run preview --prefix web -- --port 4199 --strictPort`
 *      （⚠ 本机 vite preview 只监听 IPv6 ⇒ 地址用 `http://localhost:4199/`，`127.0.0.1` 连不上）；
 *   2) 自己起的无头 Chrome 带远程调试端口 `--remote-debugging-port=9333`（起进程时记 PID，收尾只 kill 自己那一个）。
 *
 * 用法：`npm run ui:mob-zoom`（或 `npx tsx tools/mobile-battle-zoom.ts`）
 * 产物：`tools/_ui-artifacts/mobile-battle-zoom-20261002.log`（读数表）
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-10-02 · 最后跑过 **2026-10-02**
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { loadSaveFile, serializeSaveFile, wormholeStartBattle } from '@whale/core'

const APP = process.env.UI_APP_URL ?? 'http://localhost:4199/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const OUT_DIR = join(process.cwd(), 'tools', '_ui-artifacts')
const LOG = join(OUT_DIR, 'mobile-battle-zoom-20261002.log')
const SMALL_SAVE = join(process.cwd(), 'docs', 'test-saves', 'test-save-wh-spore-20260925-131842.json')

type CdpResult = Record<string, unknown>
class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: CdpResult) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: CdpResult }
      const w = msg.id !== undefined ? this.waiting.get(msg.id) : undefined
      if (!w || msg.id === undefined) return
      this.waiting.delete(msg.id)
      if (msg.error) w.rej(new Error(JSON.stringify(msg.error)))
      else w.res(msg.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(`${url}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error(`没有可用的页面 target（CDP ${url}）`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true })
      ws.addEventListener('error', () => rej(new Error(`连不上 CDP：${url}`)), { once: true })
    })
    return new Cdp(ws)
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<CdpResult>((res, rej) => this.waiting.set(id, { res, rej }))
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
      exceptionDetails?: { text?: string }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) throw new Error(`页面报错：${r.exceptionDetails.text ?? ''}`)
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 底档：双舰档现场开一场真战斗（与 `ui-battle-fit.ts --save=small` 同源） */
function makeSave(): string {
  const { state } = loadSaveFile(readFileSync(SMALL_SAVE, 'utf8'))
  const r = wormholeStartBattle(state, buildSimContext(), 'node')
  if (!r.ok) throw new Error(`现场起战斗失败：${r.error ?? ''}`)
  return serializeSaveFile(state, Date.now())
}

/** 读数：旋转链（--mob-*）＋ 战场缩放链（battleFit 的 k/need/avail） */
const READ = `(() => {
  const root = document.querySelector('.app-root')
  if (!root) return { err: 'no .app-root' }
  const cs = getComputedStyle(root)
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
  const fit = document.querySelector('.app-bts-stage-fit')
  const stage = document.querySelector('.app-bts-stage')
  const screen = document.querySelector('.app-battle-screen')
  const vv = window.visualViewport
  const mobScale = num(cs.getPropertyValue('--mob-scale')) ?? 1
  const k = fit ? num(fit.dataset.btsK ?? '') ?? 1 : null
  return {
    有战斗界面: !!screen,
    旋转模式: root.className.includes('is-mobile-rot'),
    视口: {
      内宽: window.innerWidth, 内高: window.innerHeight,
      视觉宽: vv ? Math.round(vv.width) : null, 视觉高: vv ? Math.round(vv.height) : null,
      视觉偏移上: vv ? Math.round(vv.offsetTop) : null,
      视觉缩放: vv ? Math.round((vv.scale ?? 1) * 1000) / 1000 : null,
      布局高: document.documentElement.clientHeight,
    },
    旋转链: {
      页面缩放: mobScale,
      逻辑宽: num(cs.getPropertyValue('--mob-w')),
      逻辑高: num(cs.getPropertyValue('--mob-h')),
      对齐Y: num(cs.getPropertyValue('--mob-y')),
    },
    战场链: fit ? {
      k, 内容自然高: num(fit.dataset.btsNeed ?? ''), 可用高: num(fit.dataset.btsAvail ?? ''),
      内联高: fit.style.height || '(空)', 变换: fit.style.transform || '(空)',
      舞台高: stage ? stage.clientHeight : null,
      整屏隐藏溢出: screen ? screen.className.includes('is-bts-fit') : null,
    } : null,
    物理内容缩放: k === null ? null : Math.round(k * mobScale * 10000) / 10000,
  }
})()`

interface Snap {
  有战斗界面: boolean
  旋转模式: boolean
  视口: { 内宽: number; 内高: number; 视觉宽: number | null; 视觉高: number | null; 视觉偏移上: number | null; 视觉缩放: number | null; 布局高: number }
  旋转链: { 页面缩放: number; 逻辑宽: number | null; 逻辑高: number | null; 对齐Y: number | null }
  战场链: null | {
    k: number | null
    内容自然高: number | null
    可用高: number | null
    内联高: string
    变换: string
    舞台高: number | null
    整屏隐藏溢出: boolean | null
  }
  物理内容缩放: number | null
  err?: string
}

async function openBattle(cdp: Cdp, save: string): Promise<void> {
  const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `localStorage.setItem('whale:idle:save', ${JSON.stringify(save)});` +
      `localStorage.setItem('whale-idle:layout-set', '1');`,
  })
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 200; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`)) break
    await sleep(150)
  }
  await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); 'ok'`)
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: (seed as { identifier: string }).identifier })
  await cdp.send('Page.reload')
  for (let i = 0; i < 200; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`)) break
    await sleep(150)
  }
  // 读档可能弹公告/模式选择 ⇒ 点掉
  await cdp.evalJS<string>(`(() => {
    const box = document.querySelector('.app-modal-mask .app-modal, .app-modal, .app-ann-mask .app-ann, .app-ann')
    if (!box) return 'none'
    const btns = [...box.querySelectorAll('button')]
    const pick = btns.find((b) => /关闭|确定|知道了|开始|继续|我知道了/.test(b.innerText || '')) ?? btns[btns.length - 1]
    if (pick) pick.click()
    return 'closed'
  })()`)
  await cdp.evalJS<string>(`(() => { const m = document.querySelector('.app-ann-mask'); if (m) { m.click(); return 'clicked' } return 'none' })()`)
  await sleep(500)
  for (let i = 0; i < 60; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-battle-screen')`)) break
    const clicked = await cdp.evalJS<boolean>(`(() => { const b = document.querySelector('.app-battle-float'); if (b) { b.click(); return true } return false })()`)
    if (clicked) await sleep(700)
    else await sleep(250)
  }
  await sleep(1_500)
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const out: string[] = []
  const say = (s: string): void => {
    out.push(s)
    console.log(s)
  }
  const save = makeSave()
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  /** 手机竖屏 390×844（iPhone 14/15 逻辑尺寸）＋ 触屏仿真 ⇒ `(pointer: coarse)` 成立、`is-mobile-rot` 生效 */
  const EMU = { width: 390, deviceScaleFactor: 2.2, mobile: true }
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: 844 })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await openBattle(cdp, save)

  const base = await cdp.evalJS<Snap>(READ)
  say('══ 探针：手机端战斗画面「忽大忽小」取证（2026-10-02）══')
  say(`地址：${APP} · 仿真：390×${844} · dpr 2.2 · 触屏 ⇒ pointer:coarse`)
  say(`进战斗界面：${base.有战斗界面} · 旋转模式(is-mobile-rot)：${base.旋转模式}`)
  if (!base.有战斗界面) {
    say('❌ 没能进战斗界面，后面读数无意义 ⇒ 先排查（可参考 ui-battle-fit 的诊断字段）')
  }

  /** ① 地址栏往复：只改「视觉视口高度」，宽度不动（这正是手机地址栏收起/展开的形态） */
  say('')
  say('── ① 地址栏收起/展开（只改视觉视口高，宽度不动）──')
  say('高度 | 视觉高 | 页面缩放--mob-scale | 逻辑高--mob-h | 舞台可用高 | 内容自然高 | 战场k | 物理内容缩放 | 相对基线')
  const heights = [844, 800, 760, 720, 760, 800, 844, 780, 844]
  const rows: Array<{ h: number; s: Snap }> = []
  for (const h of heights) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: h })
    await sleep(450)
    const s = await cdp.evalJS<Snap>(READ)
    rows.push({ h, s })
    const pct = base.物理内容缩放 && s.物理内容缩放 ? ((s.物理内容缩放 / base.物理内容缩放 - 1) * 100).toFixed(1) + '%' : '—'
    say(
      `${h} | ${s.视口.视觉高} | ${s.旋转链.页面缩放.toFixed(4)} | ${s.旋转链.逻辑高} | ${s.战场链?.可用高} | ` +
        `${s.战场链?.内容自然高} | ${s.战场链?.k} | ${s.物理内容缩放} | ${pct}`,
    )
  }
  /** 幅度统计：物理内容缩放（= k × 页面缩放）在整段里的极差 */
  const phys = rows.map((r) => r.s.物理内容缩放).filter((v): v is number => typeof v === 'number' && v > 0)
  const kk = rows.map((r) => r.s.战场链?.k).filter((v): v is number => typeof v === 'number')
  const sc = rows.map((r) => r.s.旋转链.页面缩放)
  if (phys.length > 1) {
    const min = Math.min(...phys)
    const max = Math.max(...phys)
    say('')
    say(`② 幅度：物理内容缩放 ${min} ~ ${max} ⇒ 极差 ${((max / min - 1) * 100).toFixed(1)}%（这就是玩家看到的"忽大忽小"）`)
    say(`   拆开看：页面缩放(--mob-scale) ${Math.min(...sc).toFixed(4)} ~ ${Math.max(...sc).toFixed(4)}` +
      ` · 战场 k ${Math.min(...kk).toFixed(4)} ~ ${Math.max(...kk).toFixed(4)}`)
  }

  /** ③ 自激检查：视口完全不动，连采 20 次看 k 是否自己抖 */
  say('')
  say('── ③ 自激检查：视口不动（390×844），每 120ms 采一次，共 20 次 ──')
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: 844 })
  await sleep(600)
  const seq: string[] = []
  for (let i = 0; i < 20; i++) {
    const s = await cdp.evalJS<Snap>(READ)
    seq.push(`${s.战场链?.k ?? '—'}`)
    await sleep(120)
  }
  const distinct = [...new Set(seq)]
  say(`k 序列：${seq.join(' ')}`)
  say(`不同取值：${distinct.length} 个 ⇒ ${distinct.length <= 1 ? '✅ 不自激（视口不动 ⇒ 缩放不动）' : '⚠ 自激（视口不动仍在变）'}`)

  /**
   * ④ **浏览器自身的双击缩放手势**（第二个嫌疑）：viewport meta 只有 `width=device-width, initial-scale=1.0`
   *    ——没有 `maximum-scale` / `user-scalable=no`，全仓也没有任何 `touch-action` / `dblclick` / `gesturestart`
   *    拦截 ⇒ 战斗中连点两下（开火/战术键按得很快）就会触发**双击放大**。这里用 CDP 合成一次双击，读
   *    `visualViewport.scale` 与两条缩放链的反应。
   */
  say('')
  say('── ④ 双击（合成）⇒ 浏览器自身的页面缩放 ──')
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: 844 })
  await sleep(600)
  const beforeTap = await cdp.evalJS<Snap>(READ)
  say(`双击前：视觉缩放 ${beforeTap.视口.视觉缩放} · 视觉高 ${beforeTap.视口.视觉高} · --mob-scale ${beforeTap.旋转链.页面缩放} · k ${beforeTap.战场链?.k} · 物理内容缩放 ${beforeTap.物理内容缩放}`)
  await cdp.send('Input.synthesizeTapGesture', { x: 195, y: 420, duration: 40, tapCount: 2, gestureSourceType: 'touch' })
  await sleep(900)
  const afterTap = await cdp.evalJS<Snap>(READ)
  say(`双击后：视觉缩放 ${afterTap.视口.视觉缩放} · 视觉高 ${afterTap.视口.视觉高} · --mob-scale ${afterTap.旋转链.页面缩放} · k ${afterTap.战场链?.k} · 物理内容缩放 ${afterTap.物理内容缩放}`)
  const zoomed = (afterTap.视口.视觉缩放 ?? 1) > (beforeTap.视口.视觉缩放 ?? 1) + 0.01
  say(zoomed
    ? '⚠ **双击把页面放大了**（视觉缩放 > 1）且两条链都跟着变 ⇒ 与玩家报障的"忽大忽小"吻合'
    : '（本次合成双击未触发页面缩放 —— 无头 Chrome 不一定复现该手势；viewport meta 缺 `user-scalable`/`maximum-scale` 与全仓零 `touch-action` 这两条代码事实仍然成立）')
  // 复原：双击一次（或直接重置仿真），避免影响后续读数
  await cdp.send('Input.synthesizeTapGesture', { x: 195, y: 420, duration: 40, tapCount: 2, gestureSourceType: 'touch' })
  await sleep(500)

  /**
   * ⑤ **地址栏"滑动"仿真（本次修复的关键验证）**：真实浏览器里地址栏是**在 200~300ms 内滑进滑出**的，
   *    `visualViewport.height` 在这段时间里**逐帧在变**。旧实现逐帧照单重排 ⇒ 玩家看到的是一段
   *    **连续的缩放动画**（"忽大忽小"）。修复后：小变化要**连续 300ms 不变**才采纳 ⇒
   *    滑动期间**一次都不该重排**，滑完停住之后才干净地采纳一次。
   */
  say('')
  say('── ⑤ 地址栏滑动仿真：844 → 780，每 40ms 降 8px（≈ 真实动画）──')
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: 844 })
  await sleep(700)
  const beforeSlide = await cdp.evalJS<Snap>(READ)
  say(`滑动前：--mob-scale ${beforeSlide.旋转链.页面缩放.toFixed(4)} · --mob-h ${beforeSlide.旋转链.逻辑高} · k ${beforeSlide.战场链?.k} · 物理内容缩放 ${beforeSlide.物理内容缩放}`)
  const during: string[] = []
  for (let h = 844; h >= 780; h -= 8) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: h })
    await sleep(40)
    const s = await cdp.evalJS<Snap>(READ)
    during.push(`${h}:${s.旋转链.页面缩放.toFixed(4)}/${s.战场链?.k}`)
  }
  say(`滑动期间（每步 视口高:--mob-scale/k）：${during.join(' ')}`)
  const scalesDuring = new Set(during.map((d) => d.split(':')[1]))
  say(`滑动期间出现过的（scale/k）组合：${scalesDuring.size} 种 ⇒ ${scalesDuring.size <= 1 ? '✅ 滑动期间**一次都没重排**（修复生效）' : '⚠ 仍在逐帧追动画'}`)
  await sleep(450) // 等稳定门（300ms）过去
  const afterSlide = await cdp.evalJS<Snap>(READ)
  say(`滑动停住 +450ms 后：--mob-scale ${afterSlide.旋转链.页面缩放.toFixed(4)} · --mob-h ${afterSlide.旋转链.逻辑高} · k ${afterSlide.战场链?.k} · 物理内容缩放 ${afterSlide.物理内容缩放}`)
  say(afterSlide.旋转链.页面缩放 !== beforeSlide.旋转链.页面缩放
    ? '　⇒ ✅ 停稳之后**干净地采纳了一次**（跟上新的可见区，不再逐帧抖）'
    : '　⇒ ⚠ 停稳后仍未采纳（滞回没放开？）')
  /** 回弹（780 → 844）同理：也应当只在停稳后采纳一次 */
  say('')
  say('── ⑤之二 地址栏收回仿真：780 → 844，每 40ms 升 8px ──')
  const back: string[] = []
  for (let h = 780; h <= 844; h += 8) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...EMU, height: h })
    await sleep(40)
    const s = await cdp.evalJS<Snap>(READ)
    back.push(`${h}:${s.旋转链.页面缩放.toFixed(4)}`)
  }
  say(`回弹期间：${back.join(' ')}`)
  const backScales = new Set(back.map((d) => d.split(':')[1]))
  say(`回弹期间出现过的 --mob-scale：${backScales.size} 种 ⇒ ${backScales.size <= 1 ? '✅ 回弹期间一次都没重排' : '⚠ 逐帧追动画'}`)
  await sleep(450)
  const afterBack = await cdp.evalJS<Snap>(READ)
  say(`回弹停住 +450ms 后：--mob-scale ${afterBack.旋转链.页面缩放.toFixed(4)} · 物理内容缩放 ${afterBack.物理内容缩放}`)

  writeFileSync(LOG, out.join('\n') + '\n', 'utf8')
  console.log(`\n读数已落：${LOG}`)
  cdp.close()
}

void main()
