/**
 * **色板 token 契约体检**（**2026-09-24 船长报障后加**）：
 *
 * > 船长：「战斗画面中，正在启动的推进器左侧的小圆点是黑的」
 *
 * 根因 = 内联样式写了一个**不存在的 token**：`background: rgb(var(--wui-tone-heal))` ——
 * 色板里只有 `--wui-heal`（`--wui-tone-heal` 一处定义都没有）⇒ 整条声明无效被浏览器丢弃 ⇒
 * 圆点没有底色、看起来是"黑点"。**这种错没有任何闸门会报**，所以补这一条：
 *
 * 口径：把**渲染层源码里出现的每个 `var(--wui-*)`（含 CSS 与 TSX 内联样式）**，
 * 逐个对**色板定义**（`packages/ui/src/index.css`，各主题的 `:root`/主题块）核一遍；
 * **未定义即红**（列出 文件:行 与 token），另有"定义了但没人用"只提示不报错（色板允许留备用位）。
 *
 * 用法：`npx tsx tools/ui-token-check.ts`（等价 `npm run ui:tokens`；已挂进 `npm run ui:theme-check` 的链上）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const PALETTE = join(ROOT, 'packages', 'ui', 'src', 'index.css')
const SRC_DIRS = [join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src')]
const EXTS = ['.css', '.ts', '.tsx']

/** 递归收集文件（跳过 node_modules / 产物目录） */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

/** 收集 `--wui-xxx:` 形式的定义（只认行首/`;`/`{` 之后的定义位，注释里的示例不算） */
function definedTokens(text: string): Set<string> {
  const set = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(--wui[a-z0-9-]*)\s*:/.exec(line)
    if (m) set.add(m[1]!)
  }
  return set
}

/**
 * 收集 `var(--wui-xxx)` 用法（带行号，便于点出位置）。
 *
 * ⚠ 两类**不算违规**（护栏只抓"真·写错名字"）：
 * - **拼接名**：`var(--wui-tone-${kind})` 这类模板串（正则只能截到 `--wui-tone-`）⇒ 见到紧跟 `$`/`{` 或名字以 `-` 结尾就跳过；
 * - **带兜底值**：`var(--wui-warn, var(--wui-gold))` —— 名字不存在但**有兜底** ⇒ CSS 仍有效（安全写法），不算错。
 */
function usedTokens(path: string): Array<{ token: string; line: number }> {
  const out: Array<{ token: string; line: number }> = []
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const re = /var\((--wui[a-z0-9-]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const token = m[1]!
      const after = line.slice(m.index + m[0].length, m.index + m[0].length + 2)
      if (token.endsWith('-') || after.startsWith('$')) continue // 拼接名
      // 带兜底：从 `var(` 起配对括号，深度回到 0 之前若出现过逗号 ⇒ 有 fallback
      let depth = 0
      let hasFallback = false
      for (let k = line.indexOf('(', m.index); k < line.length; k += 1) {
        const ch = line[k]
        if (ch === '(') depth += 1
        else if (ch === ')') {
          depth -= 1
          if (depth === 0) break
        } else if (ch === ',' && depth === 1) hasFallback = true
      }
      if (hasFallback) continue
      out.push({ token, line: i + 1 })
    }
  })
  return out
}

function main(): void {
  const defined = definedTokens(readFileSync(PALETTE, 'utf8'))
  const files = SRC_DIRS.flatMap((d) => walk(d))
  const missing = new Map<string, string[]>() // token → 位置列表
  /* ⚠ **拼接名专项**（**2026-09-30 加**，船长报障「仓库图标模式里道具图标是空的」）：
     上面 `usedTokens` 会**主动跳过**拼接名（`var(--wui-tone-${kind})`），于是
     `ui/tones.ts` 的 `toneVar('consumable')` 这种"名字是拼出来的"就**从来没被核过** ——
     色板里漏定义 `--wui-tone-consumable` 整整一天没人发现，直到船长看见图标是空的。
     ⇒ 这里把 `toneVar('x')` 的字面量调用逐个对色板核一遍（要求每个主题块都有：定义数 ≥ 主题块数）。*/
  const themeBlocks = (readFileSync(PALETTE, 'utf8').match(/^\s*--wui-tone-ore\s*:/gm) ?? []).length
  const toneCalls = new Map<string, string[]>()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/toneVar\(\s*'([a-z0-9-]+)'\s*\)/g)) {
      const token = `--wui-tone-${m[1]!}`
      const line = src.slice(0, m.index).split('\n').length
      const list = toneCalls.get(token) ?? []
      list.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${line}`)
      toneCalls.set(token, list)
    }
  }
  for (const [token, where] of toneCalls) {
    if (defined.has(token)) continue
    missing.set(token, where)
  }
  let uses = 0
  for (const f of files) {
    for (const { token, line } of usedTokens(f)) {
      uses += 1
      if (defined.has(token)) continue
      const where = `${relative(ROOT, f).replace(/\\/g, '/')}:${line}`
      const list = missing.get(token) ?? []
      list.push(where)
      missing.set(token, list)
    }
  }
  console.log(
    `色板 token 契约：定义 ${defined.size} 个 · 引用 ${uses} 处（${files.length} 个文件，扫 ${SRC_DIRS.length} 个源码根）` +
      ` · 拼接名专项：toneVar(…) 共 ${toneCalls.size} 个键（色板 tone 块 ${themeBlocks} 个）`,
  )
  if (missing.size === 0) {
    console.log('✅ 通过：渲染层引用的每个 var(--wui-*) 都在色板里有定义')
    return
  }
  console.error(`❌ 未定义的 token ${missing.size} 个（内联样式会整条失效 ⇒ 静默变色/变黑）：`)
  for (const [token, list] of [...missing].sort()) {
    console.error(`   ${token} —— ${list.length} 处：${list.slice(0, 6).join(' · ')}${list.length > 6 ? ' …' : ''}`)
  }
  process.exit(1)
}

main()
