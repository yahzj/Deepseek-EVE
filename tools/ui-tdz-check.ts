/**
 * **渲染层"先用后声明"（TDZ）体检**（正式工具 · **2026-09-24 入库**；原临时探针 `_tdz-probe.ts`）。
 *
 * 事故背景：`BattleScreen.tsx` 把 `const POPUP_LIFE = 900` 写在组件体**后段**，而组件体**前段**的
 * `.filter((p) => now - p.born < POPUP_LIFE)` 会在同一次渲染里**先执行** ⇒
 * `ReferenceError: Cannot access 'POPUP_LIFE' before initialization` ⇒ 战斗页整棵树崩掉 = 进入战斗黑屏。
 * 它**躲过了全部闸门**：typecheck 认为"闭包引用晚声明的 const"合法、测试不渲染 UI、配色/旋转契约无关
 * ⇒ 本工具补上这道护栏，并挂在 `npm run ui:rot-check`（UI/样式改动必跑那条）链上。
 *
 * 判据：同一语句列表里，**靠前的语句**（含其内部任意深度、含闭包）引用了**靠后的语句**声明的
 * `const` / `let` / `class`（块级作用域 · 有 TDZ）⇒ 报告。其中传给**同步数组方法**
 * （`arr.filter(cb)` / `map` / `forEach` …）的回调**当场就跑** ⇒ 标注「直接执行」（必然崩）；
 * 其余闭包（`useEffect` / `useMemo` / 事件回调）在渲染体跑完才执行 ⇒ 标注「闭包内」（需人判）。
 *
 * 用法：`npm run ui:tdz`（或 `npx tsx tools/ui-tdz-check.ts [目录…]`；缺省扫 `apps/desktop/src` 与
 * `packages/ui/src`）· **只读**，不写任何文件。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOTS = process.argv.slice(2)
const roots = ROOTS.length > 0 ? ROOTS : ['apps/desktop/src', 'packages/ui/src']

interface Hit {
  file: string
  line: number
  name: string
  declLine: number
  /** 引用所处的"延迟上下文"提示：包在函数/箭头里 = 可能延后执行 */
  inClosure: boolean
}

const hits: Hit[] = []

function walk(dir: string, out: string[] = []): string[] {
  if (!statSync(dir).isDirectory()) {
    if (dir.endsWith('.ts') || dir.endsWith('.tsx')) out.push(dir)
    return out
  }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 该语句声明的**块级作用域名字**（const/let/class；函数声明会提升、var 无 TDZ ⇒ 排除） */
function blockNamesOf(stmt: ts.Statement): string[] {
  const out: string[] = []
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags
    if ((flags & ts.NodeFlags.Const) === 0 && (flags & ts.NodeFlags.Let) === 0) return out
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) out.push(d.name.text)
    }
  } else if (ts.isClassDeclaration(stmt) && stmt.name) {
    out.push(stmt.name.text)
  }
  return out
}

/** 该语句列表里是否**自己声明**了 `name`（内层声明会遮蔽外层 ⇒ 那一段不该算外层的引用） */
function declaresName(stmts: readonly ts.Statement[], name: string): boolean {
  return stmts.some((s) => blockNamesOf(s).includes(name))
}

/** 某个节点是否"自带一个同名绑定"（参数 / 内层块级声明）⇒ 其子树不再算外层引用 */
function shadowsName(node: ts.Node, name: string): boolean {
  if (ts.isFunctionLike(node)) {
    if (node.parameters.some((pm) => ts.isIdentifier(pm.name) && pm.name.text === name)) return true
    const body = node.body
    if (body && ts.isBlock(body) && declaresName(body.statements, name)) return true
  }
  if ((ts.isBlock(node) || ts.isModuleBlock(node)) && declaresName(node.statements, name)) {
    return true
  }
  if ((ts.isCaseClause(node) || ts.isDefaultClause(node)) && declaresName(node.statements, name)) {
    return true
  }
  return false
}

/**
 * 该标识符是否**只是"名字"**（声明名 / 成员名 / 类型名 / 属性键）而不是**读值**。
 * 只挑"名字位"排除：`{ defeat: … }` 的键、`foeSizes: number[]` 的类型成员、`a.b` 的 `b` 等——
 * 它们不参与运行时取值，报出来就是噪声。
 */
function isNamePosition(node: ts.Identifier): boolean {
  const p = node.parent
  if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) return p.name === node
  if (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) return p.name === node
  if (ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) return p.name === node
  if (ts.isEnumMember(p)) return p.name === node
  if (ts.isBindingElement(p)) return p.propertyName === node
  if (ts.isJsxAttribute(p)) return p.name === node
  if (
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isClassDeclaration(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isModuleDeclaration(p)
  ) {
    return p.name === node
  }
  // 类型位置（`A` 出现在类型里 ⇒ 运行时无取值）
  if (
    ts.isTypeReferenceNode(p) ||
    ts.isTypeQueryNode(p) ||
    ts.isTypeParameterDeclaration(p) ||
    ts.isExpressionWithTypeArguments(p) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p)
  ) {
    return true
  }
  return false
}

/**
 * **同步执行的数组方法**（`arr.filter(cb)` / `arr.map(cb)` …）——传给它们的回调**当场就跑**，
 * 所以回调里对"晚声明的 const"的引用**与直接写在函数体里同罪**（本次黑屏事故正是 `.filter(cb)`）。
 * 其余闭包（`useEffect(cb)` / `useMemo(cb)` / 事件回调 / `setTimeout`）在渲染体跑完才执行 ⇒ 通常无害。
 */
const SYNC_METHODS = new Set([
  'map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'reduce', 'reduceRight', 'sort', 'flatMap', 'flat', 'join', 'includes', 'indexOf', 'lastIndexOf',
  'slice', 'splice', 'concat', 'push', 'unshift', 'fill', 'from', 'of', 'replace', 'split', 'match',
])

/** 本次调用里"当场执行"的函数实参（没有就返回空集） */
function syncArgsOf(call: ts.CallExpression): Set<ts.Node> {
  const out = new Set<ts.Node>()
  const callee = call.expression
  const sync = ts.isPropertyAccessExpression(callee) && SYNC_METHODS.has(callee.name.text)
  if (!sync) return out
  for (const a of call.arguments) if (ts.isFunctionLike(a)) out.add(a)
  return out
}

/** 收集本子树里"当场执行"的函数节点（同步数组方法的回调）——它们**不算**延迟闭包 */
function collectImmediateFns(root: ts.Node, out: Set<ts.Node>): void {
  if (ts.isCallExpression(root)) for (const a of syncArgsOf(root)) out.add(a)
  ts.forEachChild(root, (c) => collectImmediateFns(c, out))
}

/** 在子树里找 `name` 的**值引用**（类型位置与"名字位"不算）；同名再声明的作用域整段跳过 */
function refsOf(
  node: ts.Node,
  name: string,
  inClosure: boolean,
  acc: Array<{ pos: number; inClosure: boolean }>,
  immediate: ReadonlySet<ts.Node>,
): void {
  if (ts.isIdentifier(node) && node.text === name) {
    if (!isNamePosition(node)) acc.push({ pos: node.getStart(), inClosure })
    return
  }
  if (shadowsName(node, name)) return
  const isDeferred = ts.isFunctionLike(node) && !immediate.has(node)
  const childClosure = inClosure || isDeferred
  ts.forEachChild(node, (c) => refsOf(c, name, childClosure, acc, immediate))
}

function checkStatements(sf: ts.SourceFile, file: string, stmts: readonly ts.Statement[]): void {
  for (let i = 0; i < stmts.length; i++) {
    const names = blockNamesOf(stmts[i]!)
    if (names.length === 0) continue
    const declLine = sf.getLineAndCharacterOfPosition(stmts[i]!.getStart(sf)).line + 1
    for (const name of names) {
      for (let j = 0; j < i; j++) {
        const acc: Array<{ pos: number; inClosure: boolean }> = []
        const immediate = new Set<ts.Node>()
        collectImmediateFns(stmts[j]!, immediate)
        refsOf(stmts[j]!, name, false, acc, immediate)
        for (const r of acc) {
          hits.push({
            file: relative(process.cwd(), file).split('\\').join('/'),
            line: sf.getLineAndCharacterOfPosition(r.pos).line + 1,
            name,
            declLine,
            inClosure: r.inClosure,
          })
        }
      }
    }
  }
}

function visit(node: ts.Node, sf: ts.SourceFile, file: string): void {
  if (ts.isBlock(node) || ts.isModuleBlock(node)) {
    checkStatements(sf, file, node.statements)
  } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    checkStatements(sf, file, node.statements)
  }
  ts.forEachChild(node, (c) => visit(c, sf, file))
}

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`❌ 目录不存在：${root}（用法：npx tsx tools/ui-tdz-check.ts [目录…]；缺省扫 apps/desktop/src 与 packages/ui/src）`)
    process.exit(1)
  }
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    checkStatements(sf, file, sf.statements)
    ts.forEachChild(sf, (c) => visit(c, sf, file))
  }
}

hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
if (hits.length === 0) {
  console.log('✅ 未发现"靠前语句引用靠后块级声明"的候选')
} else {
  const direct = hits.filter((h) => !h.inClosure)
  const deferred = hits.filter((h) => h.inClosure)
  console.log(`· 候选 ${hits.length} 处（**直接执行 ${direct.length}** · 闭包内 ${deferred.length}）：`)
  for (const h of hits) {
    console.log(`  ${h.file}:${h.line} 读 \`${h.name}\`（声明在 ${h.declLine} 行）${h.inClosure ? ' · 闭包内' : ' · 直接执行'}`)
  }
  /**
   * **判据**：只有「**直接执行**」那一档报红——它在同一次渲染里必然先读到未初始化的绑定
   * （黑屏事故就是这一档）。「闭包内」那些（`useEffect` / `useMemo` / 事件回调）在渲染体跑完才执行
   * ⇒ 目前无害，只作读数点名（本仓现存 20 来处，都是这种）。
   */
  if (direct.length > 0) {
    console.error('')
    for (const h of direct) {
      console.error(`❌ ${h.file}:${h.line} 在声明（${h.declLine} 行）之前就**直接执行**读到 \`${h.name}\` ⇒ 渲染期必抛 ReferenceError`)
    }
    console.error(`❌ 渲染层 TDZ 体检未通过：${direct.length} 处"直接执行"的先用后声明（会崩，必须先声明再用）`)
    process.exit(1)
  }
  console.log('✅ 无"直接执行"的先用后声明（闭包内的候选见上；它们在渲染体跑完之后才执行 ⇒ 无害）')
}
