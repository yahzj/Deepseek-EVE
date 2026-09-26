/**
 * **战斗界面「装不下不裁内容」体检**（2026-09-25 建；船长报障「手机战斗画面被压成一条」后设立）。
 *
 * 要回答的问题：战斗界面在**手机竖屏（旋转＋按宽缩放）**下还裁不裁内容？
 * 起因（实测读数）：手机逻辑空间只有 1200×约 540~555px，而战斗界面内部按桌面版式要 ~700px
 * （顶栏 ＋ 距离尺 ＋ 战场 353 ＋ 底栏），历史规则又把车道最小高压到 210px ⇒
 * 舞台与车道各自 `overflow: hidden`，把两排血条整条裁掉（舞台裁 127px / 车道裁 143px）。
 * 修法见 `docs/design/mobile-battle-fit-20260925.md`（甲：整块等比缩放；乙：压底栏）。
 *
 * 判据（代码内是硬的，不达标即退出码 1）：
 *   ① 必须进得了战斗界面（进不去 ⇒ 直接红，读数会告诉你卡在哪）；
 *   ② **手机档**：舞台与车道 `scrollHeight ≤ clientHeight`（不裁），且车道里"要紧件"
 *      （舰影 `.app-bts-unit` 与其血条 `.app-bts-hpWrap`）的下沿不得越出车道；
 *   ③ **桌面档**：等比缩放必须**不介入**（`k = 1`、无 transform、整屏不隐藏溢出）——
 *      ⇒ 桌面逐像素与改造前一致（各部件高度同时打印出来供人工对照）。
 *
 * 运行前置（与 `ui-overflow.ts` 同款，**不自己起浏览器、也绝不动别人的浏览器**）：
 *   1) 网页版已构建并在跑：本仓 `npm run build --prefix web` 后
 *      `npm run preview --prefix web -- --port 4199 --strictPort`（**别占别人的端口**；
 *      默认地址可用 `UI_APP_URL` 覆盖）；
 *   2) 自己起的无头 Chrome 带远程调试端口（默认 `UI_CDP_URL=http://127.0.0.1:9333`，
 *      用非默认端口避免碰到船长自己的 9222；起进程时记 PID，收尾只 kill 自己那一个）。
 *
 * 用法：
 *   npm run ui:battle-fit                     # 手机档（两套布局）+ 桌面 1280×800
 *   npx tsx tools/ui-battle-fit.ts --view=390x844 --only=classic
 *   npx tsx tools/ui-battle-fit.ts --save=small   # 换成双舰底档（默认是 4 舰满装配档）
 *
 * 输出：控制台读数表 ＋ `tools/_ui-artifacts/shots/battle-fit-*.png`（可重建、不入库）
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-25 · 最后跑过 2026-09-25
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { loadSaveFile, serializeSaveFile, wormholeStartBattle } from '@whale/core'

const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const OUT_DIR = join(process.cwd(), 'tools', '_ui-artifacts', 'shots')
/** 满装配底档：4 舰虫洞队（十余门武器 ⇒ 底栏最高），自带一场在途战斗 */
const RICH_SAVE = join(process.cwd(), 'docs', 'test-saves', 'save-20260924-022747.json.json')
/** 双舰底档：站在舰船信号格上 ⇒ 现场用引擎真入口开一场新战斗 */
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

/** 底档：`rich`（默认，满装配）或 `small`（双舰，现场开一场新战斗） */
function makeSave(mode: 'rich' | 'small'): string {
  if (mode === 'rich') {
    const { state } = loadSaveFile(readFileSync(RICH_SAVE, 'utf8'))
    const s = state as unknown as {
      gameMs: number
      wormhole?: { run?: { battle?: { startedAtGameMs: number; lastTickGameMs: number; units?: Record<string, unknown> } } }
    }
    const b = s.wormhole?.run?.battle
    // 只把战斗计时挪到"现在"：否则读档会被快进补算、还没等看清就打完了
    if (b) {
      b.startedAtGameMs = s.gameMs
      b.lastTickGameMs = s.gameMs
    }
    return serializeSaveFile(state as never, Date.now())
  }
  const { state } = loadSaveFile(readFileSync(SMALL_SAVE, 'utf8'))
  const r = wormholeStartBattle(state, buildSimContext(), 'node')
  if (!r.ok) throw new Error(`现场起战斗失败：${r.error ?? ''}`)
  return serializeSaveFile(state, Date.now())
}

/** 页面内读数：逻辑空间 ＋ 战斗界面各部件 ＋ 等比缩放系数 */
const READ = `(() => {
  const root = document.querySelector('.app-root')
  if (!root) return { err: 'no .app-root' }
  const cs = getComputedStyle(root)
  const one = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    return {
      sel,
      布局: { w: el.offsetWidth, h: el.offsetHeight },
      滚动: { scrollH: el.scrollHeight, clientH: el.clientHeight, 纵向溢出: el.scrollHeight - el.clientHeight },
    }
  }
  const screen = document.querySelector('.app-battle-screen')
  const rot = root.className.includes('is-mobile-rot')
  const scale = parseFloat(cs.getPropertyValue('--mob-scale')) || 1
  /** 逻辑 y 方向：旋转下是物理 x（rotate(-90deg)）；桌面就是 top/bottom */
  const axisY = (b, r) => (rot
    ? { top: (b.left - r.left) / scale, bottom: (b.right - r.left) / scale, size: b.width / scale }
    : { top: b.top - r.top, bottom: b.bottom - r.top, size: b.height })
  const laneEl = document.querySelector('.app-bts-lane')
  const laneBox = laneEl
    ? (() => {
        const r = laneEl.getBoundingClientRect()
        const h = axisY(r, r).size
        const items = [...laneEl.querySelectorAll('.app-bts-unit, .app-bts-hpWrap, .app-bts-shipRow')].map((el) => {
          const a = axisY(el.getBoundingClientRect(), r)
          return { cls: String(el.className || el.tagName).slice(0, 34), 下沿: Math.round(a.bottom) }
        })
        return {
          逻辑高: Math.round(h),
          最低下沿: items.length ? Math.max(...items.map((x) => x.下沿)) : 0,
          越界项: items.filter((x) => x.下沿 > h + 1),
        }
      })()
    : null
  const fit = document.querySelector('.app-bts-stage-fit')
  const boxOf = (el) => (el ? { 布局: { w: el.clientWidth, h: el.clientHeight }, 滚动: { scrollH: el.scrollHeight, clientH: el.clientHeight, 纵向溢出: el.scrollHeight - el.clientHeight } } : null)
  /** 手机档要点：字号与触控（逻辑 px；物理 = 逻辑 × 页面缩放 mob-scale） */
  // ⚠ mob-* 一组自定义属性挂在 .app-root 上（App.tsx 写在 rootRef 上，不是 html 根）⇒ 从 root 读
  const mobScale = cs.getPropertyValue('--mob-scale').trim()
  const btn = document.querySelector('.app-bts-ops .app-btn')
  const topBtn = document.querySelector('.app-battle-screen-top .app-btn')
  const chip = document.querySelector('.app-bts-chip')
  const px = (v) => Math.round(parseFloat(v || '0') * 10) / 10
  return {
    旋转模式: rot,
    逻辑空间: { w: cs.getPropertyValue('--mob-w').trim() || '(桌面)', h: cs.getPropertyValue('--mob-h').trim() || '(桌面)' },
    页面缩放: mobScale || '(桌面)',
    有战斗界面: !!screen,
    等比缩放: fit
      ? {
          k: fit.dataset.btsK ?? '(未写)',
          内容自然高: fit.dataset.btsNeed ?? '-',
          可用高: fit.dataset.btsAvail ?? '-',
          内联高: fit.style.height || '(空)',
          变换: fit.style.transform || '(空)',
          整屏隐藏溢出: screen ? screen.className.includes('is-bts-fit') : null,
          车道内联最小高: laneEl?.style.minHeight || '(空)',
        }
      : null,
    尺寸: {
      顶栏高: document.querySelector('.app-battle-screen-top')?.clientHeight ?? 0,
      底栏高: document.querySelector('.app-bts-dock')?.clientHeight ?? 0,
      战术键高: btn ? Math.round(btn.offsetHeight) : 0,
      顶栏键高: topBtn ? Math.round(topBtn.offsetHeight) : 0,
      图例chip高: chip ? Math.round(chip.offsetHeight) : 0,
      战术键字号: btn ? px(getComputedStyle(btn).fontSize) : 0,
      图例字号: chip ? px(getComputedStyle(chip).fontSize) : 0,
      正文最小字号: px(getComputedStyle(document.querySelector('.app-bts-note') || document.body).fontSize),
    },
    武器行数: screen ? screen.querySelectorAll('.app-bts-reload').length : 0,
    车道: laneBox,
    部件: ['.app-battle-screen-top', '.app-bts-stage', '.app-bts-stage-fit', '.app-bts-ruler', '.app-bts-lane', '.app-bts-dock', '.app-bts-legends', '.app-bts-reloads', '.app-bts-ops'].map((sel) => {
      const el = document.querySelector(sel)
      const b = boxOf(el)
      return b ? { sel, ...b } : null
    }),
  }
})()`

/** 进不了战斗界面时的诊断（多数是底档的战斗已经打完、或弹窗挡着） */
const DIAG = `(() => {
  const raw = localStorage.getItem('whale:idle:save') || ''
  return {
    有导航: !!document.querySelector('.app-nav-side'),
    浮动入口: !!document.querySelector('.app-battle-float'),
    遮罩或弹层: [...document.querySelectorAll('[class*="mask"],[class*="modal"]')].map((e) => String(e.className).slice(0, 48)).slice(0, 8),
    存档长度: raw.length,
    存档含battle: raw.indexOf('"battle":{') >= 0,
    正文前200: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`

interface Reading {
  旋转模式: boolean
  页面缩放: string
  有战斗界面: boolean
  等比缩放: null | { k: string; 内容自然高: string; 可用高: string; 内联高: string; 变换: string; 整屏隐藏溢出: boolean | null; 车道内联最小高: string }
  尺寸: {
    顶栏高: number
    底栏高: number
    战术键高: number
    顶栏键高: number
    图例chip高: number
    战术键字号: number
    图例字号: number
    正文最小字号: number
  }
  武器行数: number
  车道: null | { 逻辑高: number; 最低下沿: number; 越界项: Array<{ cls: string; 下沿: number }> }
  部件: Array<null | { sel: string; 布局: { w: number; h: number }; 滚动: { scrollH: number; clientH: number; 纵向溢出: number } }>
}

const part = (r: Reading, sel: string): { scrollH: number; clientH: number; 纵向溢出: number } | null =>
  r.部件.find((p) => p?.sel === sel)?.滚动 ?? null

function check(tag: string, r: Reading, mobile: boolean): string[] {
  const bad: string[] = []
  if (!r.有战斗界面) {
    bad.push(`[${tag}] 没能进战斗界面`)
    return bad
  }
  if (!r.等比缩放) bad.push(`[${tag}] 没有 .app-bts-stage-fit 包裹层（方案甲没生效？）`)
  const stage = part(r, '.app-bts-stage')
  const lane = part(r, '.app-bts-lane')
  const top = part(r, '.app-battle-screen-top')
  const dock = part(r, '.app-bts-dock')
  const k = Number(r.等比缩放?.k ?? '1')
  const need = Number(r.等比缩放?.内容自然高 ?? '0')
  const avail = Number(r.等比缩放?.可用高 ?? '0')
  /** 手机档：物理像素 = 逻辑 × 页面缩放（旋转那层的 `--mob-scale`）——读数按**物理**判才有意义 */
  const sc = Number(r.页面缩放) || 1
  if (mobile) {
    if (k > 1) bad.push(`[${tag}] 缩放系数 ${r.等比缩放?.k} > 1（只缩不放的口径被破坏）`)
    // 缩了 ⇒ 缩后必须装得下（scale 只压战场，顶栏/底栏不缩）
    if (k < 1 && need * k > avail + 1) bad.push(`[${tag}] 战场缩后仍溢出：${Math.round(need * k)} > ${avail}`)
    // 没缩（k=1）⇒ 战场自然高本来就装得下
    if (k >= 1 && stage && stage.纵向溢出 > 0) bad.push(`[${tag}] 战场未缩放却裁内容 ${stage.纵向溢出}px`)
    if (lane && lane.纵向溢出 > 0) bad.push(`[${tag}] 车道裁内容 ${lane.纵向溢出}px`)
    if (top && top.纵向溢出 > 0) bad.push(`[${tag}] 顶栏裁内容 ${top.纵向溢出}px（顶栏不参与缩放，必须自己装得下）`)
    if (dock && dock.纵向溢出 > 0) bad.push(`[${tag}] 底栏裁内容 ${dock.纵向溢出}px（底栏不参与缩放，必须自己装得下）`)
    if (r.车道 && r.车道.越界项.length > 0) bad.push(`[${tag}] 车道里 ${r.车道.越界项.length} 件要紧件越出下沿（最低 ${r.车道.最低下沿} / 车道 ${r.车道.逻辑高}）`)
    // 手机可读可点（物理 px）：触控 ≥31（= 44 逻辑 × 390×844 的 0.703）· 正文 ≥10.5
    const touch = (v: number): string => `${Math.round(v * sc)}px`
    if (r.尺寸.战术键高 * sc < 31) bad.push(`[${tag}] 战术键物理高 ${touch(r.尺寸.战术键高)} < 31px（触屏下限）`)
    if (r.尺寸.顶栏键高 * sc < 31) bad.push(`[${tag}] 顶栏键物理高 ${touch(r.尺寸.顶栏键高)} < 31px（触屏下限）`)
    if (r.尺寸.图例字号 * sc < 10.5) bad.push(`[${tag}] 图例字号物理 ${touch(r.尺寸.图例字号)} < 10.5px（可读下限）`)
  } else {
    if (k !== 1) bad.push(`[${tag}] 桌面档 k=${r.等比缩放?.k} ≠ 1（桌面应逐像素不变）`)
    if (r.等比缩放 && r.等比缩放.变换 !== 'none') bad.push(`[${tag}] 桌面档带了 transform：${r.等比缩放.变换}`)
    if (r.等比缩放 && r.等比缩放.整屏隐藏溢出) bad.push(`[${tag}] 桌面档整屏被隐藏溢出（不该发生）`)
    if (need > avail + 1) bad.push(`[${tag}] 桌面档战场自然高 ${need} > 可用 ${avail}（桌面不该触发缩放）`)
    if (stage && stage.纵向溢出 > 0) bad.push(`[${tag}] 桌面战场裁内容 ${stage.纵向溢出}px`)
    if (lane && lane.纵向溢出 > 0) bad.push(`[${tag}] 桌面车道裁内容 ${lane.纵向溢出}px`)
  }
  return bad
}

async function shoot(cdp: Cdp, name: string): Promise<void> {
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
  if (shot.data) writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'))
}

async function boot(cdp: Cdp, layout: 'classic' | 'modern', save: string): Promise<void> {
  /**
   * ⚠ **底档必须在页面脚本跑起来之前就写进 localStorage**（2026-09-26 修）：
   * 老写法是「先 navigate → 再 setItem → 再 reload」，而**旧页面在卸载时会把当前进度自动存回去**
   * ⇒ 我们刚写进去的底档被它覆盖，读到的永远是上一轮那份（探针读数里表现为"存档含 battle: false"）。
   * 改用 `Page.addScriptToEvaluateOnNewDocument`：在**新文档的任何脚本之前**注入，读完就摘掉。
   */
  const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `localStorage.setItem('whale:idle:save', ${JSON.stringify(save)});` +
      `localStorage.setItem('whale-idle:layout-set', '1');` +
      `localStorage.setItem('whale-idle:layout', ${JSON.stringify(layout)});`,
  })
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 200; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`)) break
    await sleep(150)
  }
  await cdp.evalJS(
    `localStorage.setItem('whale:idle:save', ${JSON.stringify(save)});` +
      `localStorage.setItem('whale-idle:layout-set', '1');` +
      `localStorage.setItem('whale-idle:layout', ${JSON.stringify(layout)}); 'ok'`,
  )
  // 摘掉注入脚本：后续 reload（本函数每档都会再跑一次）由上面的显式写入负责
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier })
  await cdp.send('Page.reload')
  for (let i = 0; i < 200; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`)) break
    await sleep(150)
  }
  // 读档时可能弹公告/模式选择，会挡住战斗界面 ⇒ 点掉（并记录弹的是什么）
  await cdp.evalJS<string>(`(() => {
    const box = document.querySelector('.app-modal-mask .app-modal, .app-modal, .app-ann-mask .app-ann, .app-ann')
    if (!box) return 'none'
    const btns = [...box.querySelectorAll('button')]
    const pick = btns.find((b) => /关闭|确定|知道了|开始|继续|我知道了/.test(b.innerText || '')) ?? btns[btns.length - 1]
    if (pick) pick.click()
    return 'closed'
  })()`)
  // 公告遮罩是**独立一层**（`.app-ann-mask`）：上面那条按按钮点，可能仍留遮罩 ⇒ 再兜一次（点遮罩空白处）
  await cdp.evalJS<string>(`(() => {
    const mask = document.querySelector('.app-ann-mask')
    if (!mask) return 'none'
    mask.click()
    return 'clicked'
  })()`)
  await sleep(500)
  // 战斗界面不自动弹（`inBattle && !battleOpen` 时只有浮动入口）⇒ 等它出现，等不到就点它
  for (let i = 0; i < 60; i++) {
    if (await cdp.evalJS<boolean>(`!!document.querySelector('.app-battle-screen')`)) break
    const clicked = await cdp.evalJS<boolean>(`(() => { const b = document.querySelector('.app-battle-float'); if (b) { b.click(); return true } return false })()`)
    if (clicked) await sleep(600)
    else await sleep(250)
  }
  await sleep(1_500) // 让战斗页跑几拍（舰影/弹道/飘字就位）
}

async function main(): Promise<void> {
  const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7)
  const saveMode: 'rich' | 'small' = process.argv.includes('--save=small') ? 'small' : 'rich'
  const viewsArg = (process.argv.find((a) => a.startsWith('--view=')) ?? '').slice(7)
  mkdirSync(OUT_DIR, { recursive: true })
  const all = [
    { tag: '390x844-mob', w: 390, h: 844, mobile: true },
    { tag: '1280x800-desk', w: 1280, h: 800, mobile: false },
  ]
  const views = viewsArg
    ? [
        {
          tag: `${viewsArg}-${process.argv.includes('--desktop') ? 'desk' : 'mob'}`,
          w: Number(viewsArg.split('x')[0]),
          h: Number(viewsArg.split('x')[1]),
          mobile: !process.argv.includes('--desktop'),
        },
      ]
    : all

  const save = makeSave(saveMode)
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const problems: string[] = []
  const table: string[] = []
  for (const v of views) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: v.mobile ? 2.2 : 1, mobile: v.mobile })
    if (v.mobile) {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
        platform: 'Android',
      })
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    for (const layout of (['classic', 'modern'] as const).filter((l) => !only || l === only)) {
      await boot(cdp, layout, save)
      const r = await cdp.evalJS<Reading>(READ)
      const tag = `${v.tag} · ${layout}`
      const bad = check(tag, r, v.mobile)
      problems.push(...bad)
      if (!r.有战斗界面) console.log(`—— 诊断（${tag}）——\n${JSON.stringify(await cdp.evalJS<Record<string, unknown>>(DIAG), null, 1)}`)
      const g = (sel: string): string => {
        const p = part(r, sel)
        return p ? `${p.clientH}(溢${p.纵向溢出})` : '-'
      }
      table.push(
        `│ ${tag.padEnd(22)} │ ${(r.等比缩放?.k ?? '-').padEnd(7)} │ ${(r.等比缩放?.内容自然高 ?? '-').padEnd(5)} │ ` +
          `${g('.app-battle-screen-top').padEnd(9)} │ ${g('.app-bts-stage').padEnd(9)} │ ${g('.app-bts-ruler').padEnd(9)} │ ` +
          `${g('.app-bts-lane').padEnd(9)} │ ${g('.app-bts-dock').padEnd(9)} │ ${String(r.武器行数).padEnd(3)} │`,
      )
      const sc = Number(r.页面缩放) || 1
      const phy = (v: number): string => `${Math.round(v * sc)}`
      console.log(
        `   ↳ ${tag} ${r.旋转模式 ? '旋转模式' : '非旋转'} 物理读数（×${sc.toFixed(3)}）：战术键 ${phy(r.尺寸.战术键高)}px · 顶栏键 ${phy(r.尺寸.顶栏键高)}px · ` +
          `图例字 ${phy(r.尺寸.图例字号)}px · 正文最小 ${phy(r.尺寸.正文最小字号)}px · 顶栏 ${phy(r.尺寸.顶栏高)}px · 底栏 ${phy(r.尺寸.底栏高)}px`,
      )
      await shoot(cdp, `battle-fit-${layout}-${v.tag}`)
    }
  }
  console.log('\n部件「clientH(溢N)」＝该件实际高与它裁掉多少逻辑 px：')
  console.log('┌────────────────────────┬─────────┬───────┬───────────┬───────────┬───────────┬───────────┬───────────┬─────┐')
  console.log('│ 视口 · 布局            │ 缩放 k  │ 需高  │ 顶栏      │ 舞台      │ 距离尺    │ 车道      │ 底栏      │武器 │')
  console.log('├────────────────────────┼─────────┼───────┼───────────┼───────────┼───────────┼───────────┼───────────┼─────┤')
  for (const row of table) console.log(row)
  console.log('└────────────────────────┴─────────┴───────┴───────────┴───────────┴───────────┴───────────┴───────────┴─────┘')
  console.log(`\n截图：${OUT_DIR}\\battle-fit-*.png`)
  cdp.close()
  if (problems.length > 0) {
    console.log('\n❌ 不达标：')
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
  } else {
    console.log('\n✅ 手机档：战场缩后装得下、顶栏/底栏不裁、车道要紧件不越界、触控与字号达物理下限；桌面档：等比缩放不介入（k=1）。')
  }
}

main().catch((e: unknown) => {
  console.error(`体检失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
