/**
 * **对比度体检（正式工具 · 第五道闸门的配色版）**——`npm run ui:contrast`
 *
 * 用途：把每个一级页（＋设置面板）**实际渲染**出来的每一段文字与每一个 SVG 线稿，按其
 *   **真实前景色**（computed style）对 **真实底像素**（截图取样）算 WCAG 对比度，列出不达标清单。
 *
 * 为什么用真实像素：面板底大量是渐变/照片（`linear-gradient` / 星云底图），按 CSS 背景色叠色算不出有效背景。
 *   做法 = 把文字设为透明、SVG 隐藏后再截一张图 ⇒ 每个文字框内取到的就是它**真正的底**。
 *
 * 判据（WCAG 2.1）：正文 4.5 : 1（大字 3 : 1）· 非文本图形（图标/描边）3 : 1。
 *   ⚠ 这是**读数**、不是观感结论（约定 §九 例外①）：数字只说明"对比度 2.4 : 1、字号 10px"这类事实。
 *
 * **本工具的来历**：2026-09-22 船长「玩家反应，现在的界面看着太吃力」⇒ 先出读数（临时探针），
 *   随后作为**界面配色批的常驻闸门**转正：改配色 / 改主题 / 动色板后必跑。
 *
 * 运行前置（三件，缺一会明确报错）：
 *   1) `npm run build --prefix web` 后 `npm run preview --prefix web -- --port 4173`；
 *   2) 无头 Chrome 带远程调试（**非默认端口**，起前先探占用）：
 *      `chrome --headless=new --remote-debugging-port=9335 --user-data-dir=tools/_ui-artifacts/chrome-contrast`；
 *   3) 一份档：默认取 `docs/test-saves/` 里**最新的**一份（**只读注入浏览器 localStorage，绝不写回文件**）。
 *
 * 用法：
 *   npm run ui:contrast                        # 两套主题（深空 + 亮白）各跑一遍，出最差清单
 *   npm run ui:contrast -- --theme daylight    # 只跑某套主题（deepspace / daylight / contrast）
 *   npm run ui:contrast -- --page 工业          # 只跑某一页（页名按左侧导航文字子串匹配）
 *   npm run ui:contrast -- --shots             # 顺便把"隐藏文字后的底图"存到 contrast/shots/
 *   UI_APP_URL=… UI_CDP_URL=… UI_SAVE=… 可覆盖地址 / 调试端口 / 输入档
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-22**（当日核对：深空/亮白两套 × 9 个一级页 + 设置面板）
 *   - 判据：`CURRENT_STATE_VERSION − v31 ≥ 2` ⇒ 必须重跑核对（选择器与页面结构可能已变）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ART = join(process.cwd(), 'tools', '_ui-artifacts', 'contrast')
const SHOT_DIR = join(ART, 'shots')
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')
const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9335'
const WANT_SHOTS = process.argv.includes('--shots')
const ONLY = argOf('--page')
const THEMES = (() => {
  const t = argOf('--theme')
  if (t) return [t]
  return ['deepspace', 'daylight', 'contrast']
})()

function argOf(flag: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? '') : ''
}

/** 默认输入档 = `docs/test-saves/` 里最新的一份（船长的真档，**只读**） */
function newestSave(): string {
  if (process.env.UI_SAVE) return process.env.UI_SAVE
  const files = readdirSync(SAVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: statSync(join(SAVE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return files.length > 0 ? join(SAVE_DIR, files[0].f) : ''
}

/* ── CDP 小工具（Node 自带 fetch / WebSocket；同 `ui-probe.ts` 口径） ── */
type CdpResult = Record<string, unknown>
class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: CdpResult) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: CdpResult }
      if (msg.id === undefined) return
      const w = this.waiting.get(msg.id)
      if (!w) return
      this.waiting.delete(msg.id)
      if (msg.error) w.rej(new Error(JSON.stringify(msg.error)))
      else w.res(msg.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(url + '/json/list')).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error('没有可用的页面 target（CDP ' + url + '）：先按文件头注释启动无头 Chrome。')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true })
      ws.addEventListener('error', () => rej(new Error('连不上 CDP：' + url)), { once: true })
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
      exceptionDetails?: { text?: string; exception?: { description?: string } }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.text ?? '') + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(cdp: Cdp, expr: string, label: string, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(expr)) return
    } catch {
      /* 页面切换中 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error('等不到：' + label + '（' + APP + ' 是否在跑？）')
    await sleep(120)
  }
}

/** ① 收集候选：有直接文本的元素 + SVG 线稿（带视口矩形，供取底像素用） */
const COLLECT = `(() => {
  const selOf = (el) => {
    const cls = (el.className && typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.')
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
  }
  const texts = []
  const icons = []
  const W = window.innerWidth, H = window.innerHeight
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue
    let txt = ''
    for (const n of el.childNodes) if (n.nodeType === 3) txt += n.nodeValue
    txt = txt.replace(/\\s+/g, ' ').trim()
    if (txt) {
      texts.push({
        sel: selOf(el), text: txt.slice(0, 26), color: cs.color,
        fs: Math.round((parseFloat(cs.fontSize) || 0) * 10) / 10, fw: Number(cs.fontWeight) || 400,
        x: r.left, y: r.top, w: r.width, h: r.height,
      })
    }
    if (el.tagName.toLowerCase() === 'svg') {
      // ⚠ 必须取**子图形**的 fill：svg 根节点的 fill 计算值往往是默认黑，与真正涂色无关
      const shapes = [...el.querySelectorAll('path,circle,rect,line,polygon,polyline,ellipse')]
      let paint = null
      for (const s of shapes) {
        const c2 = getComputedStyle(s)
        const cand = c2.fill && c2.fill !== 'none' && c2.fill !== 'rgba(0, 0, 0, 0)' ? c2.fill : c2.stroke && c2.stroke !== 'none' ? c2.stroke : null
        if (cand) { paint = cand; break }
      }
      if (!paint && cs.stroke && cs.stroke !== 'none') paint = cs.stroke
      if (paint && r.width >= 6 && r.height >= 6) icons.push({ sel: selOf(el), paint, x: r.left, y: r.top, w: r.width, h: r.height })
    }
  }
  return { texts, icons, nodes: document.querySelectorAll('*').length, W, H }
})()`

/** ② 取底像素用：把文字设为透明、SVG 隐藏（不改布局、不改底色） */
const HIDE_FG = `(() => {
  const old = document.getElementById('__ct_hide')
  if (old) old.remove()
  const s = document.createElement('style')
  s.id = '__ct_hide'
  s.textContent = '*{color:transparent !important;text-shadow:none !important;-webkit-text-fill-color:transparent !important}svg{visibility:hidden !important}'
  document.head.appendChild(s)
  return true
})()`

const SHOW_FG = `(() => { const s = document.getElementById('__ct_hide'); if (s) s.remove(); return true })()`

/** ③ 用页面自己的能力解码截图（createImageBitmap + canvas）⇒ 逐节点取真实底像素 + 算比值 */
const sampleScript = (png: string, collect: unknown): string => `(async () => {
  const data = ${JSON.stringify(png)}
  const col = ${JSON.stringify(collect)}
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return [255, 255, 255, 1]; const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] }
  const bin = atob(data)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0)
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
  const px = (x, y) => { const xi = Math.max(0, Math.min(bmp.width - 1, Math.round(x))), yi = Math.max(0, Math.min(bmp.height - 1, Math.round(y))); const o = (yi * bmp.width + xi) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]] }
  const median = (pts) => [0, 1, 2].map((k) => pts.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(pts.length / 2)])
  const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])]
  const inside = (r) => {
    const ins = Math.min(2, Math.max(0, r.w / 4), Math.max(0, r.h / 4))
    const x0 = r.x + ins, x1 = r.x + r.w - ins, y0 = r.y + ins, y1 = r.y + r.h - ins
    // ⚠ 小元素（13px 角标 / 小旗标）：**取 3×3 的九个点的中位色** ——
    //   单点会落在圆角外的相邻底上、或落在数字描边上 ⇒ 早先版本把 13px 导航角标读成 2.05:1（其实 5.9:1，是取样错）
    if (r.w < 16 || r.h < 16) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2
      const pts = []
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) pts.push(px(cx + dx, cy + dy))
      return pts
    }
    return [[(x0 + x1) / 2, (y0 + y1) / 2], [x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => px(x, y))
  }
  const outside = (r) => [[r.x - 2, r.y + r.h / 2], [r.x + r.w + 2, r.y + r.h / 2], [r.x + r.w / 2, r.y - 2], [r.x + r.w / 2, r.y + r.h + 2]].map(([x, y]) => px(x, y))
  const items = col.texts.map((t) => {
    const bg = median(inside(t))
    const fg = parse(t.color)
    const fgc = fg[3] < 0.999 ? over(fg, bg) : fg
    const large = t.fs >= 24 || (t.fs >= 18.66 && t.fw >= 700)
    return { sel: t.sel, text: t.text, fs: t.fs, fw: t.fw, color: t.color, bg: 'rgb(' + bg.join(', ') + ')', large, ratio: Math.round(ratio(fgc, bg) * 100) / 100 }
  })
  const icons = col.icons.map((t) => {
    const bg = median(outside(t))
    const fg = parse(t.paint)
    const fgc = fg[3] < 0.999 ? over(fg, bg) : fg
    return { sel: t.sel, paint: t.paint, bg: 'rgb(' + bg.join(', ') + ')', ratio: Math.round(ratio(fgc, bg) * 100) / 100 }
  })
  return { items, icons, nodes: col.nodes, W: col.W, H: col.H }
})()`

type Item = { sel: string; text: string; fs: number; fw: number; color: string; bg: string; large: boolean; ratio: number }
type Icon = { sel: string; paint: string; bg: string; ratio: number }

/** 跨页汇总：按**选择器**归并 —— 回答"哪些样式是系统性低对比"，而不是"哪一行最差" */
function crossPage(all: Array<{ page: string; items: Item[]; icons: Icon[] }>): Record<string, unknown> {
  const agg = new Map<string, { n: number; pages: Set<string>; ratios: number[]; color: string; bg: string; fs: number; sample: string }>()
  for (const { page, items } of all) {
    for (const it of items) {
      const e = agg.get(it.sel)
      if (e) {
        e.n++
        e.pages.add(page)
        e.ratios.push(it.ratio)
      } else agg.set(it.sel, { n: 1, pages: new Set([page]), ratios: [it.ratio], color: it.color, bg: it.bg, fs: it.fs, sample: it.text })
    }
  }
  const rows = [...agg.entries()]
    .map(([k, v]) => {
      const sorted = [...v.ratios].sort((a, b) => a - b)
      return { 选择器: k, 次数: v.n, 页数: v.pages.size, 最差: sorted[0], 中位: sorted[Math.floor(sorted.length / 2)], 字号: v.fs, 前景: v.color, 底: v.bg, 样例: v.sample }
    })
    .sort((a, b) => a.最差 - b.最差)
  const items = all.flatMap((a) => a.items)
  return {
    页面数: all.length,
    文本节点合计: items.length,
    不达AA合计: items.filter((i) => i.ratio < (i.large ? 3 : 4.5)).length,
    低于3合计: items.filter((i) => i.ratio < 3).length,
    样式清单: rows,
  }
}

function summarize(items: Item[], icons: Icon[], nodes: number): Record<string, unknown> {
  const bucket = (r: number) => (r < 2 ? '<2' : r < 3 ? '2~3' : r < 4.5 ? '3~4.5' : r < 7 ? '4.5~7' : '>=7')
  const byBucket: Record<string, number> = { '<2': 0, '2~3': 0, '3~4.5': 0, '4.5~7': 0, '>=7': 0 }
  for (const i of items) byBucket[bucket(i.ratio)]++
  const fsHist: Record<string, number> = {}
  for (const i of items) {
    const k = i.fs < 10 ? '<10' : i.fs < 11 ? '10~11' : i.fs < 12 ? '11~12' : i.fs < 13 ? '12~13' : i.fs < 15 ? '13~15' : i.fs < 18 ? '15~18' : '>=18'
    fsHist[k] = (fsHist[k] ?? 0) + 1
  }
  return {
    节点数: nodes,
    文本节点: items.length,
    不达AA: items.filter((i) => i.ratio < (i.large ? 3 : 4.5)).length,
    低于3: items.filter((i) => i.ratio < 3).length,
    档位: byBucket,
    字号分布: fsHist,
    图形节点: icons.length,
    图形不达3: icons.filter((i) => i.ratio < 3).length,
  }
}

async function main(): Promise<void> {
  const savePath = newestSave()
  if (!savePath || !existsSync(savePath)) {
    console.error('缺少输入档：把一份存档（导出 json）放进 ' + SAVE_DIR + '，或用 UI_SAVE=… 指定（只读、不会写回）')
    process.exitCode = 1
    return
  }
  mkdirSync(ART, { recursive: true })
  if (WANT_SHOTS) mkdirSync(SHOT_DIR, { recursive: true })
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const save = readFileSync(savePath, 'utf8')
  const out: Record<string, unknown> = { 输入档: savePath }
  for (const theme of THEMES) {
    console.log('\n══════ 主题 ' + theme + ' ══════')
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
    await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); localStorage.setItem('whale-idle:ui-theme', ${JSON.stringify(theme)}); 'ok'`)
    await cdp.send('Page.reload')
    await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '主界面')
    await sleep(800)
    const applied = await cdp.evalJS<string>(`document.documentElement.getAttribute('data-theme')`)
    if (applied !== theme) throw new Error('主题没生效：data-theme=' + applied + '（期望 ' + theme + '）')

    const pages = await cdp.evalJS<string[]>(`[...document.querySelectorAll('.app-nav-item')].map((b) => b.textContent.trim())`)
    const targets = ONLY ? pages.filter((p) => p.includes(ONLY)) : pages
    if (ONLY && targets.length === 0) {
      console.error('没有匹配的页面：' + ONLY + '（可选：' + pages.join(' / ') + '）')
      process.exitCode = 1
      return
    }
    const perTheme: Record<string, unknown> = {}
    const all: Array<{ page: string; items: Item[]; icons: Icon[] }> = []

    async function audit(label: string): Promise<void> {
      await sleep(800)
      const col = await cdp.evalJS<{ texts: Item[]; icons: Icon[]; nodes: number; W: number; H: number }>(COLLECT)
      await cdp.evalJS(HIDE_FG)
      await sleep(120)
      const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
      await cdp.evalJS(SHOW_FG)
      if (!shot.data) throw new Error('截不到图：' + label)
      if (WANT_SHOTS) writeFileSync(join(SHOT_DIR, theme + '-' + label.replace(/[^\w\u4e00-\u9fa5-]/g, '_') + '.png'), Buffer.from(shot.data, 'base64'))
      const r = await cdp.evalJS<{ items: Item[]; icons: Icon[]; nodes: number }>(sampleScript(shot.data, col))
      const s = summarize(r.items, r.icons, r.nodes)
      perTheme[label] = { 视口: col.W + '×' + col.H, ...s, 全部文本: r.items }
      all.push({ page: label, items: r.items, icons: r.icons })
      console.log('  ✓ ' + label + ' — 文本 ' + r.items.length + ' · 不达AA ' + s.不达AA + ' · 低于3 ' + s.低于3 + ' · 图形 ' + r.icons.length + ' / 不达3 ' + s.图形不达3)
    }

    for (const p of targets) {
      const i = pages.indexOf(p)
      await cdp.evalJS(`(() => { const n = [...document.querySelectorAll('.app-nav-item')][${i}]; if (n) n.click(); return !!n })()`)
      await audit(p)
    }
    if (!ONLY) {
      const opened = await cdp.evalJS<boolean>(`(() => {
        const b = [...document.querySelectorAll('.app-header button')].find((x) => /设置|Settings/.test(x.textContent + (x.getAttribute('title') || '')))
        if (!b) return false
        b.click(); return true
      })()`)
      if (opened) {
        await waitFor(cdp, `!!document.querySelector('.app-settings-modal')`, '设置面板')
        await audit('设置面板')
      } else console.log('  · 没找到设置按钮（跳过设置面板）')
    }

    const cross = crossPage(all)
    perTheme['跨页汇总'] = cross
    out[theme] = perTheme
    const rows = cross.样式清单 as Array<{ 选择器: string; 次数: number; 页数: number; 最差: number; 中位: number; 字号: number; 前景: string; 底: string; 样例: string }>
    console.log('  ── 最差样式（升序 · 前 12）──')
    for (const r of rows.slice(0, 12)) {
      console.log('    ' + String(r.最差).padEnd(5) + ': 1  中位 ' + String(r.中位).padEnd(5) + ' ×' + String(r.次数).padEnd(4) + ' ' + String(r.字号) + 'px  ' + r.选择器 + '  「' + r.样例 + '」')
    }
    console.log('  合计：文本 ' + cross.文本节点合计 + ' · 不达AA ' + cross.不达AA合计 + ' · 低于3 ' + cross.低于3合计)
  }
  writeFileSync(join(ART, 'readings.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log('\n读数文件：' + join(ART, 'readings.json'))
  cdp.close()
}

main().catch((e: unknown) => {
  console.error('ui:contrast 失败：' + (e instanceof Error ? e.message : String(e)))
  process.exitCode = 1
})
