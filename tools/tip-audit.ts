/**
 * **悬停提示接线体检**（2026-09-17 加入；船长当日报「鼠标悬停在一些按钮时，默认的悬停 title 和新的悬浮窗
 * 会同时出现」）。
 *
 * 背景（两次同类报障、同一个病根）：浏览器在**悬停元素自身没有 `title`** 时，会顺着祖先链找最近的一条并弹
 * **系统默认提示**。
 * 1. 2026-09-15「鼠标悬浮按钮的提示会和上一级的悬浮提示相互冲突」⇒ 接管层改成「写空 title ＋ 压住整条
 *    祖先链」（`ui/Tooltip.tsx`）。
 * 2. 2026-09-17「默认的悬停 title 和新的悬浮窗同时出现」——同一回退的另一半：**富卡那条路**
 *    （`hoverTipProps`）走的是 React 侧计时，既不压自己的 `title`、也不压祖先链（接管层那条路会压，但它
 *    只认带 `title`/`data-tip` 的元素、且会跳过富卡元素）⇒ 富卡与原生提示同屏。另有一半是**时机**：
 *    接管层原先要停够 `TIP_DELAY_MS` 才置空，而浏览器原生延迟与它同档 ⇒ 竞态（那一半由
 *    `ui/Tooltip.tsx` 的「指针一进就压」根治，**静态查不出来**，本工具管的是接线这一半）。
 *
 * 判据（两条，均出自 `AGENTS.md` §6「悬停说明统一走 `ui/Tooltip.tsx` 自绘接管层」）：
 *   ① **同一元素不许同时带 `title` 与 `hoverTipProps`**（一个元素只该有一个提示归属）；
 *   ② **富卡提示元素的祖先链上不许有原生 `title`** —— 需要**跨文件**解析：组件的 DOM 根若把 `title`
 *      落到宿主元素上（如 `<div title=…>{children}</div>`），它内部渲染的富卡元素照样会吃到祖先回退。
 *      ⚠ 组件自己的 `title` **prop** 不算（如 `Panel` 的 `title` 渲成 `<h2>` 文本、`InfoHover` 的 `title`
 *      是卡片标题）⇒ 只认**小写标签**（DOM 宿主元素）。
 *
 * 用法：`npm run ui:tip-check`（或 `npx tsx tools/tip-audit.ts`）
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`）
 *   - 本工具最后跑过：**2026-09-17**（首次入库；`ui:tip-check` 全绿）
 *   - 本工具最后核对：**2026-09-17**（当日全仓 **0 命中**；同期实测：19 个 `HintIcon` 走 `title`
 *     接管层那条路、5 处 `hoverTipProps` 展开点均在无 `title` 的容器里）
 *   - 判据：`hoverTipProps` / 提示类组件改名、或接管层不再用「写空 title ＋ 压祖先链」的手法 ⇒ 必须重跑核对
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src')
/** 走**富卡**这条路（React 侧计时 + 自绘卡片）的组件与属性 */
const RICH_COMPONENTS = new Set(['HoverTip', 'ItemHover', 'ModuleHover', 'InfoHover', 'ShipHover'])

function walkDir(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkDir(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement
type CompInfo = { sf: ts.SourceFile; root: JsxNode | null }

const files = walkDir(ROOT)
const comp = new Map<string, CompInfo>()

const tagOf = (sf: ts.SourceFile, node: JsxNode): string =>
  (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(sf)
const attrNames = (sf: ts.SourceFile, node: JsxNode): string[] =>
  Array.from((ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties).map((a) =>
    ts.isJsxSpreadAttribute(a) ? `…${a.expression.getText(sf)}` : a.name.getText(sf),
  )
/** 只有小写标签才是 DOM 宿主元素——组件的 `title` prop 是标题文本，不落 HTML 属性 */
const isHost = (sf: ts.SourceFile, node: JsxNode): boolean => /^[a-z]/.test(tagOf(sf, node))
const hasTitle = (sf: ts.SourceFile, node: JsxNode): boolean => isHost(sf, node) && attrNames(sf, node).includes('title')
/** 富卡元素：展开 `hoverTipProps(...)`/`hoverTip(...)`、显式 `data-tip-hover`、或直接用富卡组件 */
const isRich = (sf: ts.SourceFile, node: JsxNode): boolean => {
  const n = attrNames(sf, node)
  return (
    n.some((x) => x.includes('hoverTipProps') || x.includes('hoverTip')) ||
    n.includes('data-tip-hover') ||
    RICH_COMPONENTS.has(tagOf(sf, node))
  )
}

/** 组件函数体里"渲染出来的第一个 JSX 元素"（≈ DOM 根） */
function findRoot(fn: ts.Node): JsxNode | null {
  let found: JsxNode | null = null
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      found = n
      return
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(fn, visit)
  return found
}

// pass 1：组件表（名字 → DOM 根）
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      comp.set(n.name.getText(sf), { sf, root: findRoot(n.body) })
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) comp.set(n.name.getText(sf), { sf, root: findRoot(init) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

/** 该组件（顺其 DOM 根链）是否把 `title` 落到宿主元素上 */
function titleHostOf(name: string, depth = 0, seen = new Set<string>()): string | null {
  if (depth > 4 || seen.has(name)) return null
  seen.add(name)
  const info = comp.get(name)
  if (!info || !info.root) return null
  const { sf, root } = info
  if (isHost(sf, root)) return hasTitle(sf, root) ? `${name} 的 <${tagOf(sf, root)} title>` : null
  return titleHostOf(tagOf(sf, root), depth + 1, seen)
}

// pass 2：找命中
type Hit = { file: string; line: number; rule: '同元素' | '祖先 title'; who: string; via: string }
const hits: Hit[] = []
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
  const walk = (node: ts.Node, stack: JsxNode[]): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (isRich(sf, node)) {
        const at = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        const who = `<${tagOf(sf, node)}${ts.isJsxElement(node) ? '' : '/'}>`
        if (hasTitle(sf, node)) {
          hits.push({ file: rel, line: at, rule: '同元素', who, via: '自身同时带 title 与富卡提示' })
        } else {
          for (const a of [...stack].reverse()) {
            if (isHost(sf, a) && hasTitle(sf, a)) {
              hits.push({
                file: rel,
                line: at,
                rule: '祖先 title',
                who,
                via: `宿主 <${tagOf(sf, a)}> @${sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1}`,
              })
              break
            }
            const seen = titleHostOf(tagOf(sf, a))
            if (seen) {
              hits.push({
                file: rel,
                line: at,
                rule: '祖先 title',
                who,
                via: `${tagOf(sf, a)}（根元素带 title）@${sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1}`,
              })
              break
            }
          }
        }
      }
      ts.forEachChild(node, (c) => walk(c, [...stack, node]))
      return
    }
    ts.forEachChild(node, (c) => walk(c, stack))
  }
  walk(sf, [])
}

const perRule = (r: Hit['rule']): Hit[] => hits.filter((h) => h.rule === r)
console.log('=== 悬停提示接线体检（判据：AGENTS §6 悬停说明统一走自绘接管层）===')
console.log(`源文件 ${files.length} 个 · 组件 ${comp.size} 个`)
console.log(`① 同元素同时带 title 与富卡提示：${perRule('同元素').length} 处`)
for (const h of perRule('同元素')) console.log(`   ✗ ${h.file}:${h.line} · ${h.who} · ${h.via}`)
console.log(`② 富卡元素祖先链上有原生 title：${perRule('祖先 title').length} 处`)
for (const h of perRule('祖先 title')) console.log(`   ✗ ${h.file}:${h.line} · ${h.who} · title 来源=${h.via}`)
if (hits.length === 0) {
  console.log('\n✅ 悬停提示接线体检通过：没有元素同时挂两套提示，富卡元素的祖先链上也没有原生 title。')
} else {
  console.log(`\n❌ 悬停提示接线体检失败：${hits.length} 处会让浏览器原生提示与自绘提示同屏——请按上面两条判据改接线。`)
  process.exitCode = 1
}
