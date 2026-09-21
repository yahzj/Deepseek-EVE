/**
 * **旋转口径体检**（2026-09-14 加入；船长当日连报两起手机竖屏缺陷后设立）。
 *
 * 背景（两个真实缺陷，同一个病根）：
 * 1. 【返回虫洞黑屏】`.app-wh-modal` 用 `width: min(1060px, 92vw)` / `height: min(760px, calc(100vh − 72px))`
 *    定尺寸 —— 手机竖屏自动横屏（`.app-root.is-mobile-rot`）下，界面活在**旋转后的逻辑空间**里
 *    （宽 ≈ 1200、高 = `--mob-h` ≈ 554），可 `vw` 量的却是**物理竖屏宽**（~390）、`vh` 量的是
 *    **物理竖屏高**（~844）⇒ 弹层被挤成窄条、还比屏幕高 ⇒ 标题栏与「✕ 关闭」被顶出屏幕。
 * 2. 【讯息界面只能查看最新的讯息 / 侧边栏选项超出屏幕】`@media (max-width: 1180px / 1023px)` 同样量的是
 *    物理竖屏宽 ⇒ 那两套「窄窗口」布局照样命中：通讯页被改成单列、消息列表收成顶部横排（条目 240px）。
 *
 * 本工具把两条口径变成**可复跑的静默检查**（只读 `styles.css` 文本，不需要跑浏览器）：
 *   ① **物理单位契约**：任何 `app-*` 类若在非旋转规则里用 `vw` 定宽（或 `vh` 定高），
 *      就必须有一条 `is-mobile-rot` 规则用**同轴**的逻辑空间单位覆盖它
 *      （宽按 `100vh` 换算、高按 `--mob-h`；`%` 亦算合规——遮罩是 `inset: 0` 的逻辑空间容器）。
 *   ② **轴不许搞反**：旋转块里 `100vh` 只允许出现在宽度轴（width / max-width），
 *      `--mob-h` 只允许出现在高度轴（height / max-height）。
 *   ③ **窄窗布局白名单**：被 `max-width` 媒体查询改成"非桌面排版"的页，必须在旋转块里恢复桌面排版
 *      （市场 `.app-mkt-split` 是 2026-09-14 的先例，通讯页 `.app-comms-*` 同批加入）。
 *   ④ **侧栏让位顺序**（船长 2026-09-14 口径：先压「出港」，再压其下选项、但"字正常显示"）：
 *      旋转块对导航项只许改**内边距/间距**，不许改字号 / 行高 / 高度（字号一变就不是"字正常显示"）。
 *
 * 用法：`npm run ui:rot-check`（或 `npx tsx tools/ui-rot-check.ts`）
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）
 *   - 本工具最后核对：**2026-09-14**（当日核对：虫洞弹层 / 手册弹窗 / 通讯页三处已按新口径修完）
 *   - 判据：旋转口径搬家或 `.app-root.is-mobile-rot` 改名 ⇒ 必须重跑本工具核对
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS_PATH = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'styles.css')

type Rule = { sel: string; decl: string; media: string; line: number }

/**
 * **同装豁免**：这些类永远和另一个类挂在同一个元素上（尺寸由那个类负责），本类只管内边距等
 * ⇒ 不要求它自己有旋转规则。豁免必须给出"负责人"，且工具会**复核负责人确实有同轴旋转规则**
 * （负责人一旦丢了旋转规则，这里立刻变红，不是白名单黑洞）。
 */
const COMPANION: Record<string, string> = {
  // App.tsx: `<div className="app-modal app-settings-modal">` —— 尺寸归 .app-modal 管
  'app-settings-modal': 'app-modal',
}

/** 逐字符扫规则：剥掉注释（保留行号）、记录每条规则所在 `@media`（块内**所有**规则都算，不是只算第一条） */
function parseRules(src: string): Rule[] {
  // 注释换成等量空行，保证行号不错位
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
  const rules: Rule[] = []
  let i = 0
  let buf = ''
  let media = ''
  let mediaDepth = 0
  let line = 1
  let selLine = 1
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\n') line++
    if (ch === '{') {
      const sel = buf.trim()
      buf = ''
      if (sel.startsWith('@media')) {
        media = sel
        mediaDepth = 1
        i++
        continue
      }
      let j = i + 1
      let depth = 1
      let decl = ''
      while (j < text.length && depth > 0) {
        const c = text[j]!
        if (c === '\n') line++ // 规则体里也要数行，否则后面的行号全漂
        if (c === '{') depth++
        else if (c === '}') {
          depth--
          if (depth === 0) break
        }
        decl += c
        j++
      }
      if (sel !== '') rules.push({ sel, decl, media, line: selLine })
      if (media !== '') mediaDepth++ // 本规则也算一层（免得块内 `}` 误判成 @media 结束）
      i = j + 1
      continue
    }
    if (ch === '}') {
      // 只有 @media 块的收尾 `}` 会走到这里（规则自身的大括号在上面的内层扫描里吃掉了）
      mediaDepth--
      if (mediaDepth <= 0) {
        media = ''
        mediaDepth = 0
      }
      buf = ''
      i++
      continue
    }
    if (buf.trim() === '' && ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') selLine = line
    buf += ch
    i++
  }
  return rules
}

const declsOf = (decl: string): Array<[string, string]> =>
  [...decl.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1]!, m[2]!.trim()] as [string, string])

const classesOf = (sel: string): string[] => [...sel.matchAll(/\.(app-[a-z0-9-]+)/g)].map((m) => m[1]!)

const isRot = (r: Rule): boolean => r.sel.includes('is-mobile-rot')

const WIDTH_PROPS = ['width', 'max-width', 'min-width']
const HEIGHT_PROPS = ['height', 'max-height', 'min-height']

const errors: string[] = []
const warn: string[] = []

function main(): void {
  const rules = parseRules(readFileSync(CSS_PATH, 'utf8'))
  const rotRules = rules.filter(isRot)
  if (rotRules.length === 0) {
    errors.push('旋转口径：`styles.css` 里找不到任何 `.app-root.is-mobile-rot` 规则（口径搬家或改名？）')
  }

  /** 类 → 旋转块里声明过的属性集合 */
  const rotProps = new Map<string, Set<string>>()
  for (const r of rotRules) {
    for (const c of classesOf(r.sel)) {
      const set = rotProps.get(c) ?? new Set<string>()
      for (const [p] of declsOf(r.decl)) set.add(p)
      rotProps.set(c, set)
    }
  }
  const guardedByRot = (cls: string, axis: readonly string[]): boolean => {
    const own = rotProps.get(cls)
    if (own && axis.some((p) => own.has(p))) return true
    const mate = COMPANION[cls]
    if (mate === undefined) return false
    const m = rotProps.get(mate)
    return !!m && axis.some((p) => m.has(p))
  }
  const exemptNote = (cls: string): string => {
    const mate = COMPANION[cls]
    return mate === undefined ? '' : `（本类与 \`${mate}\` 同装，尺寸归它管）`
  }

  let guarded = 0
  const seen = new Set<string>()
  for (const r of rules) {
    if (isRot(r)) continue
    for (const [prop, value] of declsOf(r.decl)) {
      const widthAxis = WIDTH_PROPS.includes(prop) && value.includes('vw')
      const heightAxis = HEIGHT_PROPS.includes(prop) && value.includes('vh')
      if (!widthAxis && !heightAxis) continue
      for (const c of classesOf(r.sel)) {
        const key = `${c}|${prop}`
        if (seen.has(key)) continue
        seen.add(key)
        guarded++
        const axis = widthAxis ? WIDTH_PROPS : HEIGHT_PROPS
        if (!guardedByRot(c, axis)) {
          errors.push(
            `物理单位契约：\`${c}\` 在非旋转规则里用 ${prop}: ${value}（物理${widthAxis ? '竖屏宽' : '竖屏高'}）` +
              `定尺寸，但旋转块没有用 ${axis.join('/')} 覆盖它${exemptNote(c)}` +
              `（第 ${r.line} 行${r.media ? ` · ${r.media}` : ''}）——旋转模式会取错轴`,
          )
        }
      }
    }
  }

  /* ── ② 轴不许搞反 ── */
  for (const r of rotRules) {
    for (const [prop, value] of declsOf(r.decl)) {
      if (WIDTH_PROPS.includes(prop) && value.includes('--mob-h')) {
        errors.push(`轴搞反：第 ${r.line} 行 \`${r.sel}\` 在宽度轴（${prop}）用了 \`--mob-h\`（那是逻辑高，宽度轴该用 100vh）`)
      }
      if (HEIGHT_PROPS.includes(prop) && /(^|[^-\w])100vh/.test(value)) {
        errors.push(`轴搞反：第 ${r.line} 行 \`${r.sel}\` 在高度轴（${prop}）用了 \`100vh\`（那是物理竖屏高，高度轴该用 --mob-h）`)
      }
    }
  }

  /* ── ③ 窄窗布局白名单：旋转时维持桌面排版 ── */
  const NARROW_RESTORE = ['app-mkt-split', 'app-comms-grid', 'app-comms-list', 'app-comms-item'] as const
  let narrowChecked = 0
  for (const cls of NARROW_RESTORE) {
    const narrow = rules.filter((r) => !isRot(r) && r.media.includes('max-width') && classesOf(r.sel).includes(cls))
    if (narrow.length === 0) {
      warn.push(`窄窗白名单：\`${cls}\` 已不再出现在 max-width 媒体查询里（口径变了？）`)
      continue
    }
    narrowChecked++
    if (!(rotProps.get(cls)?.size ?? 0)) {
      errors.push(
        `窄窗布局白名单：\`${cls}\` 被 max-width 媒体查询改了排版（物理竖屏宽会误触发），` +
          `但旋转块没有恢复桌面排版——旋转时会被当成窄窗口`,
      )
    }
  }

  /* ── ④ 侧栏让位顺序：旋转块对导航项只许改内边距/间距 ── */
  const NAV_ALLOWED = /^(padding|padding-top|padding-bottom|padding-left|padding-right|gap|row-gap|column-gap|margin|margin-top|margin-bottom)$/
  let navChecked = 0
  for (const r of rotRules) {
    if (!classesOf(r.sel).includes('app-nav-item')) continue
    navChecked++
    for (const [prop, value] of declsOf(r.decl)) {
      if (NAV_ALLOWED.test(prop)) continue
      errors.push(
        `侧栏让位顺序：第 ${r.line} 行 \`${r.sel}\` 在旋转模式下改了 \`${prop}: ${value}\`——` +
          `船长口径是"只压高度、字要正常显示"（只许收内边距/间距，字号/行高/图标尺寸不许动）`,
      )
    }
  }

  /* ── ⑤ 窄屏断点同源：JS 的 matchMedia 必须与 CSS 的单栏断点同一个数 ──
     2026-09-21（船长：「手机或窄屏时隐藏市场详情、点订单弹悬浮窗」）：市场页的 `narrow` 判定走
     `window.matchMedia('(max-width: 1180px)')`，而"单栏"是 `styles.css` 里
     `@media (max-width: 1180px) { .app-mkt-split { grid-template-columns: 1fr } }` 定的。
     两处必须同数——改一处不改另一处会出现"CSS 已切单栏、JS 还当宽屏"（详情既不常驻也不弹窗）
     这类静默错位。这里把**CSS 那一侧**钉成基准，JS 只能跟着它走。 */
  const mktCssBreak = (() => {
    for (const r of rules) {
      if (isRot(r)) continue
      if (!classesOf(r.sel).includes('app-mkt-split')) continue
      const m = r.media.match(/max-width:\s*(\d+)px/)
      if (m && declsOf(r.decl).some(([p, v]) => p === 'grid-template-columns' && v.trim() === '1fr')) {
        return Number(m[1])
      }
    }
    return null
  })()
  if (mktCssBreak === null) {
    errors.push('窄屏断点同源：`styles.css` 里找不到 `.app-mkt-split` 的单栏媒体查询（口径搬家或改名？）')
  } else {
    const mktTsx = readFileSync(join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'pages', 'MarketPage.tsx'), 'utf8')
    const jsBreaks = [...mktTsx.matchAll(/matchMedia\(\s*'\(max-width:\s*(\d+)px\)'\s*\)/g)].map((m) => Number(m[1]))
    if (jsBreaks.length === 0) {
      errors.push('窄屏断点同源：`MarketPage.tsx` 里找不到 `matchMedia(\'(max-width: Npx)\')`（窄屏判定去哪了？）')
    } else {
      for (const n of new Set(jsBreaks)) {
        if (n !== mktCssBreak) {
          errors.push(
            `窄屏断点同源：\`MarketPage.tsx\` 用 ${n}px、而 \`styles.css\` 的 \`.app-mkt-split\` 单栏断点是 ` +
              `${mktCssBreak}px —— 两处必须同数（否则会出现"CSS 已切单栏、JS 还当宽屏"的静默错位）`,
          )
        }
      }
    }
  }

  /* ── 输出 ── */
  console.log(
    `· 旋转口径：旋转块规则 ${rotRules.length} 条 · 覆盖类 ${rotProps.size} 个 · ` +
      `按物理单位定尺寸且已受契约约束的声明 ${guarded} 处 · ` +
      `窄窗白名单 ${narrowChecked}/${NARROW_RESTORE.length} 个 · 导航项受控规则 ${navChecked} 条`,
  )
  if (warn.length > 0) {
    console.log('· 警告：')
    for (const w of warn) console.log(`  ⚠ ${w}`)
  }
  if (errors.length > 0) {
    console.error(`\n❌ 旋转口径体检失败：${errors.length} 处`)
    for (const e of errors) console.error(`  ✗ ${e}`)
    process.exit(1)
  }
  console.log('\n✅ 旋转口径体检通过：覆盖层尺寸与窄窗排版都按逻辑空间口径。')
}

main()
