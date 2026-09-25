/**
 * **主题色板契约体检（正式工具）**——`npm run ui:theme-check`
 *
 * 用途：界面配色是"一套变量 + 若干主题覆盖块"的结构，最容易坏在**静默**上：某个 token 只在深空块里有值、
 *   亮白块漏了一条 ⇒ 亮白下那条规则拿不到值（`var()` 失效 = 颜色继承/初始值），界面上只是"某个角落怪怪的"。
 *   本工具把这类问题变成**可复跑的读数**。
 *
 * 四条契约：
 *   ① **引用必须定义**：`styles.css` / `index.css` 里出现的 `var(--wui-*)` 必须在色板里有定义
 *      （`var(--x, 兜底)` 形式豁免 —— 那是有意的可选钩子）；
 *   ② **键集一致**：`:root`（深空）与每个 `[data-theme='…']` 块的 token **键集必须完全一致**
 *      （缺键 = 静默回落 = 半成品；多键 = 打错名字的死值）；
 *   ③ **深空基线冻结**：默认皮肤的主要 token 值必须等于**冻结基线**（防"改亮白顺手带偏深空"）；
 *   ④ **字面量闸门**：`styles.css` 里除**阴影/滤镜**（`box-shadow` / `text-shadow` / `filter` —— 影子在亮底下
 *      仍是黑的，跟着主题翻转只会翻错）外，不得残留颜色字面量（注释里的示例不算）。
 *
 * 用法：`npm run ui:theme-check`（退出码非 0 = 契约被破坏）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 递归收集渲染层 TS/TSX（⑥-b 用） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkTs(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

const ROOT = process.cwd()
const STYLES = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src', 'styles.css')
const UI_CSS = join(ROOT, 'packages', 'ui', 'src', 'index.css')

/**
 * 深空（默认皮肤）冻结基线：这些 token 的值**不许悄悄变**（改了 = 默认皮肤视觉变了 ⇒ 得有船长令）。
 *
 * ⚠ **2026-09-22 船长令两轮调整后重钉**：
 *   ① 「深空太暗 / 白色太亮 / 字都没办法辨认」⇒ 底色挪档 + 前景按对比度自动定值；
 *   ② 船长给参考图后**按图实测值**重钉（`tools/_ref-palette.ts` 解 PNG 数面积）——
 *      深空 ← SpaceIdle（近黑宇宙底 + 面板 `#182232` + 近白字），亮白 ← Kittens Game 亮色（灰页面 + `#f2f2f2` 内容 + 近黑字）。
 *   判据由 ⑤ 项守住（正文 ≥4.5 / 识别色 ≥3.2 / 徽标对 ≥4.5）。
 */
const BASELINE: Record<string, string> = {
  '--wui-bg-deep': '8 11 16',
  '--wui-bg-panel': '24 34 50',
  '--wui-bg-hover': '32 44 62',
  '--wui-border': '45 60 79',
  '--wui-border-bright': '88 108 138',
  '--wui-text': '240 243 246',
  '--wui-accent': '79 216 196',
  '--wui-gold': '232 180 90',
  '--wui-red': '228 132 132',
  '--wui-amber': '217 160 90',
  '--wui-purple': '169 138 224',
  '--wui-scrim': '6 8 12',
  '--wui-slot': '34 46 64',
  '--wui-well': '8 11 16',
}

type Block = { selector: string; tokens: Map<string, string> }

/** 抽出所有"色板块"：同选择器的多个块**合并**（`index.css` 里 `:root` / `[data-theme]` 各出现多次是正常的） */
function blocksOf(css: string): Block[] {
  const bySel = new Map<string, Map<string, string>>()
  const re = /([^{}]+)\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
    if (!/:root|\[data-theme=/.test(selector)) continue
    const tokens = bySel.get(selector) ?? new Map<string, string>()
    const dre = /(--wui-[a-z0-9-]+)\s*:\s*([^;]+);/g
    let d: RegExpExecArray | null
    while ((d = dre.exec(m[2]))) {
      // 只收**色板 token**（空格三元组）：`--wui-mono` 这类非色值不参与"键集一致"口径
      if (!/^\d{1,3} \d{1,3} \d{1,3}$/.test(d[2].trim())) continue
      tokens.set(d[1], d[2].trim())
    }
    if (tokens.size > 0) bySel.set(selector, tokens)
  }
  return [...bySel.entries()].map(([selector, tokens]) => ({ selector, tokens }))
}

function main(): void {
  const styles = readFileSync(STYLES, 'utf8')
  const ui = readFileSync(UI_CSS, 'utf8')
  const problems: string[] = []
  const infos: string[] = []
  /** 非色值 token（字体族之类）：色板块收不到它们，但要算"已定义" */
  const definedExtras = [...ui.matchAll(/(--wui-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
    .filter((m) => !/^\d{1,3} \d{1,3} \d{1,3}$/.test(m[2].trim()))
    .map((m) => m[1])

  /* ① 引用必须定义（豁免 `var(--x, 兜底)`）—— 非色值 token（如 `--wui-mono` 字体族）也算定义 */
  const defined = new Set<string>(definedExtras)
  for (const b of blocksOf(ui)) for (const k of b.tokens.keys()) defined.add(k)
  const used = new Set<string>()
  const optional = new Set<string>()
  for (const text of [styles, ui]) {
    // 注释里的"写法示例"（`var(--wui-tone-*)` 之类）不算引用
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const re = /var\((--wui-[a-z0-9-]+)(\s*,)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) {
      if (m[2]) optional.add(m[1])
      else used.add(m[1])
    }
  }
  for (const u of used) if (!defined.has(u)) problems.push('① 引用了没定义的 token：' + u)
  infos.push('① 引用 ' + used.size + ' 个 token（全部有定义）· 另 ' + optional.size + ' 个是可选的覆盖钩子（`var(--x, 兜底)`）')

  /* ② 键集一致：以深空（第一个 :root 块）为基准 */
  const blocks = blocksOf(ui)
  const rootBlock = blocks.find((b) => b.selector === ':root')
  const themeBlocks = blocks.filter((b) => b.selector.startsWith("[data-theme="))
  if (!rootBlock) problems.push('② 找不到 `:root` 色板块')
  else {
    for (const b of themeBlocks) {
      const missing = [...rootBlock.tokens.keys()].filter((k) => !b.tokens.has(k))
      const extra = [...b.tokens.keys()].filter((k) => !rootBlock.tokens.has(k))
      if (missing.length > 0) problems.push('② ' + b.selector + ' 缺 ' + missing.length + ' 个 token：' + missing.slice(0, 6).join('、') + (missing.length > 6 ? ' …' : ''))
      if (extra.length > 0) problems.push('② ' + b.selector + ' 多出 ' + extra.length + ' 个未在深空定义的 token：' + extra.slice(0, 6).join('、'))
      if (missing.length === 0 && extra.length === 0) infos.push('② ' + b.selector + ' 键集与深空一致（' + b.tokens.size + ' 个）')
    }
  }

  /* ③ 深空基线冻结 */
  if (rootBlock) {
    for (const [k, v] of Object.entries(BASELINE)) {
      const got = rootBlock.tokens.get(k)
      if (got === undefined) problems.push('③ 深空缺少基线 token：' + k)
      else if (got !== v) problems.push('③ 深空基线被改动：' + k + ' = ' + got + '（基线 ' + v + '）')
    }
    infos.push('③ 深空基线核对 ' + Object.keys(BASELINE).length + ' 项')
  }

  /* ④ styles.css 字面量闸门（阴影/滤镜豁免；注释与**主题覆盖块**豁免 —— 主题块本来就是"具体色值"的落点） */
  const themeBlockRe = /\[data-theme=[^{}]+\]\s*(?:[^{}]*)\{[^}]*\}/g
  const noComments = styles.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(themeBlockRe, ' ')
  const decls = noComments.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? []
  const offenders: string[] = []
  for (const d of decls) {
    const prop = d.slice(0, d.indexOf(':')).trim()
    if (prop === 'box-shadow' || prop === 'text-shadow' || prop === 'filter' || prop === '-webkit-filter') continue
    if (/#[0-9a-fA-F]{3,8}\b/.test(d) || /rgba?\(\s*[0-9]/.test(d)) offenders.push(d.replace(/\s+/g, ' ').trim().slice(0, 80))
  }
  if (offenders.length > 0) {
    problems.push('④ styles.css 里还有 ' + offenders.length + ' 处颜色字面量没 token 化（阴影/滤镜之外）：')
    for (const o of offenders.slice(0, 10)) problems.push('    · ' + o)
  } else infos.push('④ styles.css 无残留颜色字面量（阴影/滤镜豁免）')

  /* ⑥ **裸 var() 当色值用**（2026-09-22 事故的守门人）
   * 色板 token 是**空格三元组**（`--wui-text: 240 243 246`）⇒ 必须包成 `rgb(var(--wui-text))`。
   * 写成 `color: var(--wui-text)` 会**整条声明失效**、`color` 回落初始值**黑**：深色皮肤上什么都看不见
   * （亮色皮肤碰巧正常 ⇒ 只在深空暴露）。这条契约把"漏包一层"从"上线后靠眼睛发现"变成"跑一次就红"。 */
  {
    const bad: string[] = []
    for (const [label, text] of [
      ['styles.css', styles],
      ['index.css', ui],
    ] as Array<[string, string]>) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
      // 定义行（`--wui-x: …`）与函数式包装（`rgb(var(…))` / `rgba(var(…))`）之外的裸引用
      /**
       * ⚠ **非色值 token 整族豁免**（2026-09-25 UI 重置批）：本条判据的语义是"**三元组色值** token
       * 必须包在 `rgb(...)` 里"，故 `--wui-mono`（字体族）、`--wui-dur-*`（动效时长）、
       * `--wui-ease-*`（缓动）、`--wui-fs-*`（字号）、`--wui-sp-*`（间距）这些**本来就不是颜色**的
       * token 不该被点名——此前只豁免了 `mono`，把新加的时长 token 全判成了"漏包 rgb()"（误报）。
       */
      const re = /(^|[^\w(])(var\(--wui-(?!(?:mono|dur-|ease-|fs-|sp-))[a-z0-9-]+\))/g
      let m: RegExpExecArray | null
      while ((m = re.exec(code))) {
        const lead = m[1]
        if (/\($/.test(lead)) continue // rgb( / rgba( 已包住
        // `rgb(var(--wui-warn, var(--wui-gold)))`：内层作为**另一个 var() 的兜底值**，外层已包 rgb() ⇒ 合法
        const before = code.slice(Math.max(0, m.index - 40), m.index)
        if (/var\([^()]*,\s*$/.test(before)) continue
        const line = code.slice(0, m.index).split('\n').length
        bad.push(label + ':' + line + '  ' + m[2])
      }
    }
    if (bad.length > 0) {
      problems.push('⑥ 有 ' + bad.length + ' 处把三元组 token 当**完整色值**用了（漏包 `rgb(...)`）——会整条声明失效：')
      for (const b of bad.slice(0, 12)) problems.push('    · ' + b)
    } else infos.push('⑥ 无裸 var() 当色值用（三元组 token 一律包在 rgb() 里）')

    /* ⑥-b **渲染层 TS/TSX 也算在内**（2026-09-22 船长报障「各种 svg 图标都失效了」的教训）：
     * `ui/tones.ts` 生成的色值串、内联 style 里的色值都不在 CSS 文件里 ⇒ 只查 CSS 会漏。
     * 判据：字符串字面量里出现 `var(--wui-…)`（非 `--wui-mono`、非 `rgb(var(`）⇒ 违规；
     *   拼接式（`'var(--wui-tone-' + name + ')'`）正则查不出"缺 rgb()"，单独点名提醒走 `toneVar`。 */
    const tsBad: string[] = []
    for (const f of walkTs(join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      const rel = relative(ROOT, f).replace(/\\/g, '/')
      const re2 = /(['"`])(var\(--wui-(?!(?:mono|dur-|ease-|fs-|sp-))[a-z0-9-]+\))\1/g
      let m: RegExpExecArray | null
      while ((m = re2.exec(code))) tsBad.push(rel + ':' + code.slice(0, m.index).split('\n').length + '  ' + m[2])
      if (/['"`]var\(--wui-tone-['"`]\s*\+/.test(code)) tsBad.push(rel + '  拼接式色值串缺少 rgb() 包装：`var(--wui-tone-` + …')
    }
    if (tsBad.length > 0) {
      problems.push('⑥-b 渲染层有 ' + tsBad.length + ' 处裸 var() 色值（图标/内联样式会静默失效）：')
      for (const b of tsBad.slice(0, 12)) problems.push('    · ' + b)
    } else infos.push('⑥-b 渲染层 TS/TSX 无裸 var() 色值')
  }

  console.log('主题色板契约体检：')
  for (const i of infos) console.log('  ✓ ' + i)
  console.log('  ── ⑤ 前景 × 底色对比度（正文 ≥4.5 · 强调/图形 ≥3）──')
  contrastReport([rootBlock, ...themeBlocks].filter(Boolean) as Block[], problems)
  if (problems.length === 0) {
    console.log('\n✅ 通过：引用齐全 · 键集一致 · 深空基线未动 · 无残留字面量 · 对比度达标')
    return
  }
  console.log('')
  for (const p of problems) console.log('  ✗ ' + p)
  console.log('\n❌ 不通过：' + problems.length + ' 条')
  process.exitCode = 1
}

/* ── ⑤ 文字 × 底色配对对比度（静态快查：把"字看不清"变成数字，不用起浏览器） ── */

/** 按角色分组的前景 token（正文类要求 4.5:1；图形/强调类要求 3:1） */
const FG_TEXT = ['--wui-text', '--wui-text-hi', '--wui-text-bright', '--wui-text-2', '--wui-text-dim', '--wui-dim', '--wui-log-time', '--wui-log-info', '--wui-pro-text']
const FG_ACCENT = ['--wui-accent', '--wui-accent-2', '--wui-gold', '--wui-flag', '--wui-rare', '--wui-amber', '--wui-red', '--wui-danger', '--wui-blue', '--wui-cyan', '--wui-green', '--wui-mint', '--wui-purple', '--wui-exotic', '--wui-warn-soft', '--wui-log-levelup', '--wui-log-warn', '--wui-log-event', '--wui-log-queue', '--wui-log-trade']
/** 底色 token（文字/图标实际会落在这些底上）。**不含 `scrim`**：那是弹层蒙层，不是文字底 */
const BGS = ['--wui-bg-deep', '--wui-bg-panel', '--wui-bg-hover', '--wui-bg-sunken', '--wui-bg-field', '--wui-bg-bar', '--wui-bg-btn', '--wui-slot']
/** 识别色门槛：**4.5**（与正文同标准）。
 *  为什么不用 WCAG 非文本的 3:1：这些色阶同时被当**标签文字**用（chip 文案、通讯发件人、稀有度 R 标），
 *  3:1 的色在白底小字上依然看不清（船长 2026-09-22 二轮：「字都没办法辨认」）。
 *  ⚠ 只对**前景**色阶生效；"面"色（bg- 家族 / border / slot / well / scrim）不在此列。 */
const ACCENT_FLOOR = 4.5
/** 成对 token（徽标底色 + 其上文字）：单独核对 */
const PAIRS: Array<[string, string, number]> = [['--wui-badge-ink', '--wui-badge-bg', 4.5]]

/* ── **伤害类型徽标**（`app-a-*` / `app-d-*`）的实际底色与字色：从 `styles.css` 读 ──
 * 为什么要读源码而不是写死：红档现在带一条 `color: rgb(var(--wui-chip-ink))` 覆写，
 * 只按"默认徽标字色"算就会算错（2026-09-24 就是这么漏掉"字压红底看不清"的）。 */
const DMG_CHIP_TYPES = ['kinetic', 'explosive', 'plasma'] as const
const chipTokensCache: { css: string; map: Map<string, { bg: string; ink?: string }> } = {
  css: '',
  map: new Map(),
}
function chipTokensOf(stylesCss: string): Map<string, { bg: string; ink?: string }> {
  if (chipTokensCache && chipTokensCache.css === stylesCss) return chipTokensCache.map
  const bare = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const map = new Map<string, { bg: string; ink?: string }>()
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const t of DMG_CHIP_TYPES) {
      if (!new RegExp('(^|,)\\s*\\.app-[da]-' + t + '\\s*($|,)').test(m[1]!)) continue
      const bg = /background\s*:\s*rgb\(var\((--wui-[\w-]+)\)\)/.exec(m[2]!)
      const ink = /color\s*:\s*rgb\(var\((--wui-[\w-]+)\)\)/.exec(m[2]!)
      const cur = map.get(t) ?? {}
      if (bg) cur.bg = bg[1]!
      if (ink) cur.ink = ink[1]!
      map.set(t, cur)
    }
  }
  chipTokensCache.css = stylesCss
  chipTokensCache.map = map
  return map
}

function triplet(v: string): [number, number, number] | null {
  const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function lum(c: [number, number, number]): number {
  const f = (v: number): number => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** 检查每个主题块里"前景 × 底色"的最差值（正文 4.5 / 强调 3.0） */
function contrastReport(blocks: Block[], problems: string[]): void {
  for (const b of blocks) {
    const label = b.selector === ':root' ? '深空（默认）' : b.selector.replace(/\[data-theme='([a-z]+)'\]/, '$1')
    let worstText = { r: 99, fg: '', bg: '' }
    let worstAccent = { r: 99, fg: '', bg: '' }
    const bad: string[] = []
    for (const bgName of BGS) {
      const bg = triplet(b.tokens.get(bgName) ?? '')
      if (!bg) continue
      for (const [fgNames, floor, slot] of [
        [FG_TEXT, 4.5, 'text'],
        [FG_ACCENT, ACCENT_FLOOR, 'accent'],
      ] as Array<[string[], number, string]>) {
        for (const fgName of fgNames) {
          const fg = triplet(b.tokens.get(fgName) ?? '')
          if (!fg) continue
          const r = Math.round(ratio(fg, bg) * 100) / 100
          if (slot === 'text' && r < worstText.r) worstText = { r, fg: fgName, bg: bgName }
          if (slot === 'accent' && r < worstAccent.r) worstAccent = { r, fg: fgName, bg: bgName }
          if (r < floor) bad.push(label + '：' + fgName + ' 压在 ' + bgName + ' 上只有 ' + r + ' : 1（要求 ≥ ' + floor + '）')
        }
      }
    }
    console.log('  · ' + label + ' 最差正文 ' + worstText.r + ' : 1（' + worstText.fg.replace('--wui-', '') + ' / ' + worstText.bg.replace('--wui-', '') + '）' +
      ' · 最差识别色 ' + worstAccent.r + ' : 1（' + worstAccent.fg.replace('--wui-', '') + ' / ' + worstAccent.bg.replace('--wui-', '') + '）')
    /* 成对 token（徽标：底色 + 其上文字） */
    for (const [fgName, bgName, floor] of PAIRS) {
      const fg = triplet(b.tokens.get(fgName) ?? '')
      const bg = triplet(b.tokens.get(bgName) ?? '')
      if (!fg || !bg) continue
      const r = Math.round(ratio(fg, bg) * 100) / 100
      console.log('    · ' + label + ' 徽标对：' + fgName.replace('--wui-', '') + ' 压 ' + bgName.replace('--wui-', '') + ' = ' + r + ' : 1')
      if (r < floor) problems.push('⑤ ' + label + '：' + fgName + ' 压 ' + bgName + ' 只有 ' + r + ' : 1（要求 ≥ ' + floor + '）')
    }
    for (const x of bad) problems.push('⑤ ' + x)
    /* **伤害类型徽标**：底色 `--wui-x211/x57/x77` × **该规则真正用的字色**。
       字色要从 `styles.css` 那条规则里读——徽标默认字色（`.app-a-chip` / `.app-d-chip` 的 `--wui-x229`）是**深色**，
       压亮黄/亮青没问题，但压在**红**底上只有 ~3.9:1（暖色主题更糟：深字压深底，最低 1.2:1 —— 2026-09-24 一并修）。
       故红档在 `styles.css` 里显式改走 `--wui-chip-ink`；本段按"实际生效的那条规则"取色，免得又漏。
       来源：2026-09-24 船长报障「标签中的字体颜色不对」。 */
    const chipMap = chipTokensOf(readFileSync(STYLES, 'utf8'))
    for (const t of DMG_CHIP_TYPES) {
      const bgName = chipMap.get(t)?.bg
      if (!bgName) continue
      const bg = triplet(b.tokens.get(bgName) ?? '')
      const inkName = chipMap.get(t)?.ink ?? '--wui-x229'
      const ink = triplet(b.tokens.get(inkName) ?? '')
      if (!ink || !bg) continue
      const r = Math.round(ratio(ink, bg) * 100) / 100
      console.log('    · ' + label + ' 伤害徽标：' + t + '（' + bgName.replace('--wui-', '') + ' × ' + inkName.replace('--wui-', '') + '）= ' + r + ' : 1')
      if (r < 4.5) {
        problems.push('⑤ ' + label + '：伤害徽标 ' + t + ' 的字只有 ' + r + ' : 1（要求 ≥ 4.5；红底记得走 --wui-chip-ink）')
      }
    }
  }
}

main()
