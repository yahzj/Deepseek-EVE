/**
 * 内容工作台 · 导入回写（Phase B，2026-09-05 船长确认）：
 * 读回 content:export 生成的 CSV，按主键字段级回写权威 JSON 或未迁移表的源 TS，
 * 四道护栏：
 *   1) 主键只读：CSV 出现未知 id = 拒绝（新增条目走代办）；源表有而 CSV 缺失 = 拒绝
 *      （多发生在"筛选视图保存"误删——提示复原或走代办）；
 *   2) 逐列校验：类型/枚举/数值范围/引用 id 存在（口径与 content-check 同源）；
 *   3) 空单元格 = 不改该字段；可选字段填 '-' = 删除该字段；
 *   4) 只写有差异的字段；收尾自动 content:check + core/data typecheck + diff 摘要。
 *
 * 用法：npm run content:import <表名> <csv文件> [--dry-run]   （表名见 content-schema.ts）
 * 实现：已迁移表只按JSON字段做局部替换，TS文本/表达式和代码派生行只读；
 * 未迁移表仍用TypeScript AST定位对象与属性节点，保留原注释和数字排版。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import * as ts from 'typescript'
import ExcelJS from 'exceljs'
import { ANOMALIES, BELTS, BLUEPRINTS, FOE_SHIPS, GALAXIES, ITEMS, MARKET_GOODS, MODULES, SHIPS, SKILLS } from '@whale/data'
import { normalizeHead, tableOf, type ColSpec } from './content-schema'
import type { DataDocument, DataRow } from './data-editor-contract'
import { staticDocumentIssues } from '../packages/data/src/staticData'

/* ═══════════ CSV 解析（标准：引号转义/BOM/编码与分隔符自动容错） ═══════════
 * Excel/WPS 保存 CSV 有各种变体：UTF-8 或 ANSI(GBK) 编码、逗号或 Tab 分隔——
 * 这里统一自动识别，船长在 Excel 里怎么存都能导入。 */
function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  const u = buf.toString('utf8')
  if (!u.includes('\uFFFD')) return u
  try {
    return new TextDecoder('gb18030').decode(buf)
  } catch {
    return u // 解码器不可用时退回 utf8（将按含乱码内容提示）
  }
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000)
  const count = (d: string): number => {
    let n = 0
    let inQ = false
    for (let i = 0; i < sample.length; i++) {
      const ch = sample[i]!
      if (ch === '"') inQ = !inQ
      else if (!inQ && ch === d) n++
    }
    return n
  }
  const t = count('\t')
  const c = count(',')
  const s = count(';')
  if (t > c && t > s) return '\t'
  if (s > c && s > t) return ';'
  return ','
}

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (ch !== '\r') cur += ch
  }
  row.push(cur)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/* ═══════════ xlsx 读取（exceljs；单元格值 → 文本，布尔归一 是/否） ═══════════ */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return v.toISOString()
  const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> }
  if (o.richText) return o.richText.map((r) => r.text).join('')
  if (typeof o.text === 'string') return o.text
  if (typeof o.result === 'string' || typeof o.result === 'number' || typeof o.result === 'boolean') {
    return cellText(o.result)
  }
  return String(v)
}

/** 读取编辑文件 → { 表头, 数据行 }（.xlsx 按 sheet 名；空单元格统一补到表头长度） */
async function loadTableFile(
  filePath: string,
  tableName: string,
): Promise<{ head: string[]; data: string[][] }> {
  let rows: string[][]
  if (/\.xlsx$/i.test(filePath)) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const ws = wb.getWorksheet(tableName) ?? wb.worksheets[0]
    if (!ws) throw new Error(`xlsx 里找不到名为「${tableName}」的 sheet`)
    rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = []
      const max = row.cellCount
      for (let i = 1; i <= max; i++) vals.push(cellText(row.getCell(i).value))
      rows.push(vals)
    })
  } else {
    const buf = readFileSync(filePath)
    const text = decodeText(buf)
    rows = parseDelimited(text, detectDelimiter(text))
  }
  const head = rows[0]!.map((h) => h.trim())
  const len = head.length
  return {
    head,
    data: rows
      .slice(1)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .map((r) => (r.length < len ? [...r, ...new Array<string>(len - r.length).fill('')] : r)),
  }
}

/* ═══════════ 主键集合 ═══════════ */
function idSetOf(rows: readonly unknown[], key: string): Set<string> {
  return new Set(rows.map((r) => (r as Record<string, string>)[key]))
}
const IDS = {
  skills: idSetOf(SKILLS, 'id'),
  items: idSetOf(ITEMS, 'id'),
  modules: idSetOf(MODULES.filter((m) => m.slot !== 'plug'), 'id'),
  ships: idSetOf(SHIPS, 'id'),
  anomalies: idSetOf(ANOMALIES, 'id'),
  belts: idSetOf(BELTS, 'id'),
  market: idSetOf(MARKET_GOODS, 'key'),
  // **敌舰级表**（2026-09-24 船长令：敌舰数值也走工作台回写）——主键 = `FoeShipDef.id`
  foeShips: idSetOf(FOE_SHIPS, 'id'),
  /** **舰船插件 ＋ 插件图纸**（**2026-09-27 船长令**）：判据与导出侧同源（`slot: 'plug'` / `bp-plug-*`） */
  plugs: idSetOf(MODULES.filter((m) => m.slot === 'plug'), 'id'),
  plugBlueprints: idSetOf(BLUEPRINTS.filter((b) => b.id.startsWith('bp-plug-')), 'id'),
  galaxies: idSetOf(GALAXIES, 'id'),
}

const errors: string[] = []
const err = (m: string): void => { errors.push(m) }
/** 现值是表达式（同文件常量解析不出 / 计算式）而**只读跳过**的列（不阻断，只提示，见 planRow） */
const readOnlySkips: string[] = []

/* ═══════════ AST 辅助 ═══════════ */
/** 收集**同文件**的 `const NAME = 数字`（供卡面常量引用比对；只认本文件，跨文件导入的常量按只读处理） */
function collectNumConsts(sf: ts.SourceFile): Map<string, number> {
  const map = new Map<string, number>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const n = Number(node.initializer.getText(sf).replaceAll('_', ''))
      if (Number.isFinite(n)) map.set(node.name.text, n)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return map
}

/** 表达式 → 数值（字面量直接取；标识符查同文件常量表；查不到 = undefined） */
function numOfExpr(expr: ts.Expression | undefined, sf: ts.SourceFile, consts: Map<string, number>): number | undefined {
  if (!expr) return undefined
  const raw = expr.getText(sf).replaceAll('_', '').trim()
  const direct = Number(raw)
  if (Number.isFinite(direct)) return direct
  if (ts.isIdentifier(expr)) {
    const v = consts.get(expr.text)
    if (v !== undefined) return v
  }
  return undefined
}

/** 一个可回写的对象块：**连同它所在的源文件**（多源表要按文件分组回写，见 main 里的多源扫描） */
interface ObjInfo {
  obj: ts.ObjectLiteralExpression
  srcPath: string
}

/**
 * **同文件字符串常量表**（`const NAME = 'x'` 与 `const OBJ = { key: 'x' }` ⇒ 键 `OBJ.key`）。
 *
 * 为什么需要（**2026-09-27**）：`packages/data/src/plugs.ts` 的插件对象写的是
 * `id: PLUG_IDS.shieldPlate`（**常量引用**，为的是"写错当场编译不过"）——
 * 旧收集器只认字符串字面量 ⇒ `content:import plugs` 整张表报「源文件找不到对象块」。
 * 这里把同文件的字符串常量收成一张表供 `collectObjects` 解析；**只认同文件、只认字符串字面量**，
 * 解析不出就照旧跳过（不猜、不改写源文件）。
 */
function collectStrConsts(sf: ts.SourceFile): Map<string, string> {
  /** 剥掉 `as const` / 括号 / 类型断言（`plugs.ts` 的 `PLUG_IDS` 正是 `{…} as const`） */
  const unwrap = (e: ts.Expression): ts.Expression => {
    let x = e
    while (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isTypeAssertionExpression(x)) {
      x = x.expression
    }
    return x
  }
  const map = new Map<string, string>()
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (!d.initializer || !ts.isIdentifier(d.name)) continue
      const init = unwrap(d.initializer)
      if (ts.isStringLiteralLike(init)) map.set(d.name.text, init.text)
      else if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(unwrap(p.initializer))) {
            map.set(`${d.name.text}.${p.name.getText(sf)}`, (unwrap(p.initializer) as ts.StringLiteralLike).text)
          }
        }
      }
    }
  }
  return map
}

/** 主键取值：字符串字面量直接用；否则查同文件字符串常量表（`PLUG_IDS.shieldPlate` 一类） */
function idOfExpr(expr: ts.Expression, sf: ts.SourceFile, strConsts: Map<string, string>): string | undefined {
  if (ts.isStringLiteralLike(expr)) return expr.text
  return strConsts.get(expr.getText(sf).trim())
}

function collectObjects(sf: ts.SourceFile, idPropName: string, srcPath: string): Map<string, ObjInfo> {
  const strConsts = collectStrConsts(sf)
  const map = new Map<string, ObjInfo>()
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const p = node.properties.find(
        (x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && x.name.getText(sf) === idPropName,
      )
      const idVal = p ? idOfExpr(p.initializer, sf, strConsts) : undefined
      if (idVal !== undefined && !map.has(idVal)) {
        map.set(idVal, { obj: node, srcPath })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return map
}

/** 多源表的源码访问器：路径 → 原文 / AST（`planRow` / `applyChanges` 按对象自己的文件取用） */
interface Sources {
  textOf: Map<string, string>
  sfOf: Map<string, ts.SourceFile>
  /**
   * **同文件数值常量表**（`const NAME = 45`；2026-09-15 加）。
   * 为什么需要：卡面允许把数值写成常量（如 `threat: ANCHOR_THREAT`），而导入端原先只会 `Number(文本)`
   * ⇒ 常量解析成 NaN ⇒ 判成"要改"，**把常量引用改写成字面量**（破坏数据意图 + 每轮导入都报改动）。
   * 现在先查这张表；查不到就**当只读列跳过并提示**（宁可不动，也不擅自把表达式换成字面量）。
   */
  numConstOf: Map<string, Map<string, number>>
}

function propOf(obj: ts.ObjectLiteralExpression, name: string, sf: ts.SourceFile): ts.PropertyAssignment | undefined {
  return obj.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === name,
  )
}

/** pos 所在行行首（物理行起点） */
function lineStart(text: string, pos: number): number {
  let s = pos
  while (s > 0 && text[s - 1] !== '\n') s--
  return s
}

function indentOf(text: string, pos: number): string {
  const ls = lineStart(text, pos)
  return text.slice(ls, pos).match(/^\s*/)?.[0] ?? ''
}

/* ═══════════ 值文本生成 ═══════════ */
/** 数字字面量（项目风格：千位整数加下划线如 12_000；小数原样） */
function fmtNum(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) >= 1000) return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_')
  return String(n)
}

function quoteStr(v: string): string {
  return v.includes("'") ? JSON.stringify(v) : `'${v}'`
}

/**
 * 对象字面量的 `key: 数值` 对（obj 列用）。两处兼容（2026-09-15 修既有缺陷）：
 * ① **字符串字面量键**：源里若写成 `{ "kinetic": 0.5 }`（历史导入留下的 JSON 风格），`p.name.getText()`
 *    会连引号一起返回 ⇒ 与表头派生的 `kinetic` 对不上 ⇒ 判成"该键不存在"、**每轮导入都重写一遍**
 *    （实测 ships 表 15 条 `sh-wh-*` 白报 54 处改动）；现字符串键取其 `text`（去引号）。
 * ② **同文件常量值**：值走 `numOfExpr`（字面量或 `const NAME = 数字`），避免把常量引用改写成字面量。
 */
function objPairsOf(
  expr: ts.Expression | undefined,
  sf: ts.SourceFile,
  consts: Map<string, number>,
): Array<[string, number]> {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return []
  const out: Array<[string, number]> = []
  for (const p of expr.properties) {
    if (!ts.isPropertyAssignment(p)) continue
    const n = numOfExpr(p.initializer, sf, consts)
    if (n === undefined) continue
    const name = p.name
    const key =
      ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : name.getText(sf)
    out.push([key, n])
  }
  return out
}

const CANON_OBJ_KEYS = ['kinetic', 'explosive', 'plasma', 'high', 'mid', 'low']

function renderObjLine(pairs: Array<[string, number]>): string {
  return `{ ${pairs.map(([k, v]) => `${k}: ${fmtNum(v)}`).join(', ')} }`
}

function renderListText(inner: string, multi: boolean, propIndent: string, itemKey: string, valKey: string): string {
  const items = inner.split('|').filter(Boolean)
  const rendered = items.map((seg) => {
    const [k, v] = seg.split('×')
    return `{ ${itemKey}: '${k}', ${valKey}: ${fmtNum(Number(v))} }`
  })
  if (rendered.length === 0) return '[]'
  if (multi) return `[\n${propIndent}  ${rendered.join(`,\n${propIndent}  `)},\n${propIndent}]`
  return `[${rendered.join(', ')}]`
}

/* ═══════════ 单元格 → 目标值（校验；返回 null = 无差异/跳过） ═══════════ */
/** 解析数值单元格：非法/越界 → 记错并返回 undefined */
function parseNum(rowId: string, head: string, cell: string, col: ColSpec, report: (message: string) => void = err): number | undefined {
  const n = Number(cell)
  if (!Number.isFinite(n)) {
    report(`${rowId}：${head} 不是数字「${cell}」`)
    return undefined
  }
  if (col.int && !Number.isInteger(n)) report(`${rowId}：${head} 须为整数（得 ${cell}）`)
  if (col.min !== undefined && n < col.min) report(`${rowId}：${head} 不得小于 ${col.min}（得 ${cell}）`)
  if (col.max !== undefined && n > col.max) report(`${rowId}：${head} 不得大于 ${col.max}（得 ${cell}）`)
  return n
}

/* ═══════════ 变更规划 ═══════════ */
type Change =
  | { kind: 'set'; rowId: string; prop: string; text: string }
  | { kind: 'del'; rowId: string; prop: string }

function planRow(
  spec: ReturnType<typeof tableOf>,
  info: ObjInfo,
  csvRow: string[],
  headIdx: Map<string, number>,
  sources: Sources,
  changes: Change[],
): void {
  const { obj } = info
  // 多源表：按**本对象自己的源文件**取原文与 AST（数值列还要查该文件的常量表）
  const srcText = sources.textOf.get(info.srcPath)!
  const sf = sources.sfOf.get(info.srcPath)!
  const consts = sources.numConstOf.get(info.srcPath)!
  const indent = indentOf(srcText, obj.getStart(sf)) + '  ' // 对象属性缩进
  for (const col of spec!.cols) {
    if (col.k === 'id') continue
    const idx = headIdx.get(col.head)
    if (idx === undefined) continue // 用户删了该列 → 不改
    const cell = (csvRow[idx] ?? '').trim()
    if (cell === '') continue // 空 = 不改
    const root = col.p.split('.')[0]!
    const prop = propOf(obj, root, sf)
    const curText = prop ? prop.initializer.getText(sf) : undefined
    if (cell === '-') {
      // 删除可选字段（行/行中段删除，见 applyChanges del）
      if (prop) changes.push({ kind: 'del', rowId: csvRow[0]!, prop: root })
      continue
    }
    switch (col.k) {
      case 'str':
      case 'enum':
      case 'ref': {
        if (col.k === 'enum' && !col.vals!.includes(cell)) {
          err(`${csvRow[0]}：${col.head} 非法枚举「${cell}」（合法：${col.vals!.join('/')}）`)
          continue
        }
        if (col.k === 'ref' && !IDS[col.ref!].has(cell)) {
          err(`${csvRow[0]}：${col.head} 引用了不存在的 id「${cell}」`)
          continue
        }
        const t = quoteStr(cell)
        if (curText === t) continue
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: t })
        break
      }
      case 'num': {
        const n = parseNum(csvRow[0]!, col.head, cell, col)
        if (n === undefined) continue
        /**
         * 现值可能是**同文件常量**（如 `threat: ANCHOR_THREAT`）。两条规矩：
         * ① 解析得出且**同值** ⇒ 无需改（这条修掉了"每轮导入白报改动 + 把常量写成字面量"的既有缺陷）；
         * ② 现值是**标识符（常量引用）**：即便表格里填了别的数，也**只读跳过并点名**——直接把字面量写进去
         *    会把全族共用的常量钉死在单张卡上（如 5 张 `wh-*` 卡的 `ANCHOR_THREAT`），要改就该改常量本身。
         * 解析不出的表达式（跨文件常量/计算式）同样只读跳过。
         */
        if (curText !== undefined) {
          const isConstRef = prop !== undefined && ts.isIdentifier(prop.initializer)
          const cur = numOfExpr(prop?.initializer, sf, consts)
          if (cur === undefined) {
            readOnlySkips.push(`${csvRow[0]}·${col.head}`)
            continue
          }
          if (Math.abs(cur - n) < 1e-9) continue
          if (isConstRef) {
            readOnlySkips.push(`${csvRow[0]}·${col.head}（源为常量 ${prop!.initializer.getText(sf)}=${cur}）`)
            continue
          }
        }
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: fmtNum(n) })
        break
      }
      case 'bool': {
        const norm = cell === '是' || cell.toLowerCase() === 'true' ? '是' : cell === '否' || cell.toLowerCase() === 'false' ? '否' : ''
        if (norm === '') {
          err(`${csvRow[0]}：${col.head} 须填 是/否（得「${cell}」）`)
          continue
        }
        const t = norm === '是' ? 'true' : 'false'
        if (curText === t) continue
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: t })
        break
      }
      case 'obj': {
        const key = col.p.split('.')[1]!
        const n = parseNum(csvRow[0]!, col.head, cell, col)
        if (n === undefined) continue
        /**
         * ⚠ **对象里含展开口 ⇒ 本列只读跳过**（2026-09-24 加）：源若写成
         * `shieldResist: { ...C_FAMILY_RESISTS.shieldResist, kinetic: 0.1 }`，`objPairsOf` 只看得见
         * **显式写的键**、看不见展开进来的键 ⇒ 照 CSV 回写会把整个对象换成字面量、**抹掉与族常量的联动**
         * （以后改常量再也不影响这一艘）。与"表达式只读跳过"同一处置：要改这些字段请直接编辑源码。
         */
        /**
         * ⚠ **行对象带展开口（`...C_FAMILY_RESISTS`）且本列没有自己的属性 ⇒ 只读跳过**（2026-09-24 加）：
         * 源里这一列是从**族常量**展开进来的（C 族三层三系抗性就是这种写法），照 CSV 回写会**凭空长出一个
         * 字面量对象**、把这一艘从族常量里摘出去（以后改常量再也不影响它）⇒ 与"表达式只读跳过"同一处置。
         */
        if (!prop && obj.properties.some((p) => ts.isSpreadAssignment(p))) {
          readOnlySkips.push(`${csvRow[0]}·${col.head}（源为族常量展开 ⇒ 只读）`)
          continue
        }
        if (
          prop?.initializer &&
          ts.isObjectLiteralExpression(prop.initializer) &&
          prop.initializer.properties.some((p) => !ts.isPropertyAssignment(p))
        ) {
          readOnlySkips.push(`${csvRow[0]}·${col.head}（源对象含展开口 ⇒ 只读）`)
          continue
        }
        const pairs = objPairsOf(prop?.initializer, sf, consts)
        const cur = pairs.find(([k]) => k === key)
        if (cur && Math.abs(cur[1] - n) < 1e-9) continue
        // 合并：原键序 + 新键按规范序插入
        const merged = pairs.filter(([k]) => k !== key)
        const canon = CANON_OBJ_KEYS.indexOf(key)
        const at = canon >= 0 ? merged.findIndex(([k]) => CANON_OBJ_KEYS.indexOf(k) > canon) : -1
        if (at < 0) merged.push([key, n])
        else merged.splice(at, 0, [key, n])
        const multi = !!curText && curText.includes('\n')
        const text = multi
          ? `{\n${merged.map(([k, v]) => `${indent}  ${k}: ${v},`).join('\n')}\n${indent}}`
          : renderObjLine(merged)
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text })
        break
      }
      case 'list': {
        // 元素级校验
        for (const seg of cell.split('|')) {
          const [k, v] = seg.split('×')
          if (!k || k.trim() === '' || v === undefined || !Number.isFinite(Number(v))) {
            err(`${csvRow[0]}：${col.head} 片段「${seg}」格式应为 id×值`)
            continue
          }
          if (col.ref && !IDS[col.ref].has(k.trim())) err(`${csvRow[0]}：${col.head} 引用了不存在的 id「${k.trim()}」`)
          const n = Number(v)
          if (col.valMin !== undefined && n < col.valMin) err(`${csvRow[0]}：${col.head} 值不得小于 ${col.valMin}（得 ${v}）`)
          if (col.valInt && !Number.isInteger(n)) err(`${csvRow[0]}：${col.head} 值须为整数（得 ${v}）`)
        }
        if (!prop) {
          changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: renderListText(cell, false, indent, col.itemKey!, col.valKey!) })
          break
        }
        const arrNode = prop.initializer
        if (ts.isArrayLiteralExpression(arrNode)) {
          const segs = cell.split('|').filter(Boolean)
          // 结构等价比较：元素对象 itemKey 字符串 === 段 id 且 valKey 数值 ≈ 段值
          const same =
            arrNode.elements.length === segs.length &&
            arrNode.elements.every((el, i) => {
              if (!ts.isObjectLiteralExpression(el)) return false
              const seg = segs[i]!
              const x = seg.indexOf('×')
              const k = seg.slice(0, x)
              const v = Number(seg.slice(x + 1))
              let kOk = false
              let vOk = false
              for (const p of el.properties) {
                if (!ts.isPropertyAssignment(p)) continue
                if (p.name.getText(sf) === col.itemKey && ts.isStringLiteralLike(p.initializer) && p.initializer.text === k) kOk = true
                if (p.name.getText(sf) === col.valKey && Math.abs(Number(p.initializer.getText(sf).replaceAll('_', '')) - v) < 1e-9) vOk = true
              }
              return kOk && vOk
            })
          if (same) continue
        }
        const multi = curText?.includes('\n') ?? false
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: renderListText(cell, multi, indent, col.itemKey!, col.valKey!) })
        break
      }
    }
  }
}

/* ═══════════ 应用变更（区间替换；由后向前套用） ═══════════ */
interface Edit { start: number; end: number; text: string }

const STATIC_TABLES = new Set(['ships', 'modules', 'plugs', 'items', 'market'])
export type StaticChange =
  | { kind: 'set'; rowId: string; prop: string; value: unknown }
  | { kind: 'del'; rowId: string; prop: string }

/** 只读字段由迁移后的TS绑定判定，不将运行期继承值倒写成JSON字面量。 */
function staticBindings(sources: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const bindings = new Map<string, Set<string>>()
  for (const [path, text] of sources) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith('_TEXT_BINDINGS') ||
          !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue
        for (const entry of declaration.initializer.properties) {
          if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteralLike(entry.name) || !ts.isObjectLiteralExpression(entry.initializer)) {
            throw new Error(`静态数据绑定不是具名对象：${path}`)
          }
          if (bindings.has(entry.name.text)) throw new Error(`静态数据文本绑定主键重复：${entry.name.text}`)
          const fields = new Set<string>()
          for (const field of entry.initializer.properties) {
            if (ts.isSpreadAssignment(field)) fields.add('*')
            else if (ts.isPropertyAssignment(field)) fields.add(ts.isStringLiteralLike(field.name) ? field.name.text : field.name.getText(sf))
            else throw new Error(`静态数据绑定字段无法解析：${entry.name.text}`)
          }
          bindings.set(entry.name.text, fields)
        }
      }
    }
  }
  return bindings
}

export function planStaticImport(
  spec: NonNullable<ReturnType<typeof tableOf>>,
  source: string,
  sources: ReadonlyMap<string, string>,
  data: string[][],
  headIdx: ReadonlyMap<string, number>,
): { changes: StaticChange[]; errors: string[]; readOnly: string[]; derivedSkipped: number } {
  const document = JSON.parse(source) as DataDocument
  const documentIssues = staticDocumentIssues(document)
  if (documentIssues.length > 0) return { changes: [], errors: documentIssues, readOnly: [], derivedSkipped: 0 }
  if (document.format !== 'whale-static-data' || document.version !== 1 || document.table !== spec.name ||
    !document.groups || typeof document.groups !== 'object' || Array.isArray(document.groups)) {
    throw new Error(`静态JSON格式/版本/表名错误：${spec.name}`)
  }
  const bindings = staticBindings(sources)
  const rows = new Map<string, DataRow>()
  for (const group of Object.values(document.groups)) {
    if (!Array.isArray(group)) throw new Error(`静态JSON分组不是数组：${spec.name}`)
    for (const row of group) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`静态JSON行不是对象：${spec.name}`)
      const id = row[spec.idProp]
      if (typeof id !== 'string' || !id || rows.has(id) || !bindings.has(id)) throw new Error(`静态JSON主键或绑定错误：${String(id)}`)
      rows.set(id, row)
    }
  }
  const issues: string[] = []
  const readOnly: string[] = []
  const changes = new Map<string, StaticChange>()
  const report = (message: string): void => { issues.push(message) }
  const idIndex = headIdx.get(spec.cols[0]!.head)!
  const sourceIds = IDS[spec.name as keyof typeof IDS]
  const csvIds = data.map(row => (row[idIndex] ?? '').trim())
  const seen = new Set<string>()
  for (const id of csvIds) {
    if (!sourceIds.has(id)) report(`CSV 含不存在的主键：${id}`)
    if (seen.has(id)) report(`CSV 主键重复：${id}`)
    seen.add(id)
  }
  for (const id of sourceIds) if (!seen.has(id)) report(`源表有而 CSV 缺失：${id}（疑似筛选视图保存误删）`)
  for (const id of rows.keys()) if (!sourceIds.has(id)) report(`静态JSON主键不在数据目录：${id}`)
  let derivedSkipped = 0
  for (let i = 0; i < data.length; i++) {
    const id = csvIds[i]!
    if (!sourceIds.has(id)) continue
    const row = rows.get(id)
    if (!row) {
      if (spec.name === 'market' && !bindings.has(id)) { derivedSkipped++; continue }
      report(`静态JSON找不到 ${id} 的行（不回写旧TS数值）`)
      continue
    }
    const fields = bindings.get(id)!
    for (const col of spec.cols) {
      if (col.k === 'id') continue
      const idx = headIdx.get(col.head)
      if (idx === undefined) continue
      const cell = (data[i]![idx] ?? '').trim()
      if (!cell) continue
      const [prop, key] = col.p.split('.') as [string, string | undefined]
      if (prop === 'name' || prop === 'description' || fields.has(prop) || fields.has('*')) {
        if (cell !== '-' && (col.k === 'num' || col.k === 'obj')) parseNum(id, col.head, cell, col, report)
        readOnly.push(`${id}·${col.head}（TS文本/表达式绑定，只读）`)
        continue
      }
      const changeKey = `${id}\0${prop}`
      if (cell === '-') {
        if (Object.hasOwn(row, prop)) changes.set(changeKey, { kind: 'del', rowId: id, prop })
        continue
      }
      let value: unknown
      const errorsBefore = issues.length
      switch (col.k) {
        case 'str': case 'enum': case 'ref':
          if (col.k === 'enum' && !col.vals!.includes(cell)) report(`${id}：${col.head} 非法枚举「${cell}」（合法：${col.vals!.join('/')}）`)
          if (col.k === 'ref' && !IDS[col.ref!].has(cell)) report(`${id}：${col.head} 引用了不存在的 id「${cell}」`)
          value = cell
          break
        case 'num':
          value = parseNum(id, col.head, cell, col, report)
          break
        case 'bool':
          if (cell === '是' || cell.toLowerCase() === 'true') value = true
          else if (cell === '否' || cell.toLowerCase() === 'false') value = false
          else report(`${id}：${col.head} 须填 是/否（得「${cell}」）`)
          break
        case 'obj': {
          const n = parseNum(id, col.head, cell, col, report)
          const pending = changes.get(changeKey)
          const current = pending?.kind === 'set' ? pending.value : pending?.kind === 'del' ? undefined : row[prop]
          if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
            report(`${id}：${prop} 不是数值对象`)
            break
          }
          value = { ...(current as DataRow | undefined), [key!]: n }
          break
        }
        case 'list': {
          const list: DataRow[] = []
          for (const seg of cell.split('|')) {
            const [k, v] = seg.split('×')
            if (!k?.trim() || v === undefined || !Number.isFinite(Number(v))) {
              report(`${id}：${col.head} 片段「${seg}」格式应为 id×值`)
              continue
            }
            if (col.ref && !IDS[col.ref].has(k.trim())) report(`${id}：${col.head} 引用了不存在的 id「${k.trim()}」`)
            const n = Number(v)
            if (col.valMin !== undefined && n < col.valMin) report(`${id}：${col.head} 值不得小于 ${col.valMin}（得 ${v}）`)
            if (col.valInt && !Number.isInteger(n)) report(`${id}：${col.head} 值须为整数（得 ${v}）`)
            list.push({ [col.itemKey!]: k.trim(), [col.valKey!]: n })
          }
          value = list
          break
        }
      }
      if (issues.length !== errorsBefore || value === undefined) continue
      if (isDeepStrictEqual(row[prop], value)) changes.delete(changeKey)
      else changes.set(changeKey, { kind: 'set', rowId: id, prop, value })
    }
  }
  const candidate = structuredClone(document)
  const candidateRows = new Map(Object.values(candidate.groups).flat().map(row => [row[spec.idProp], row]))
  for (const change of changes.values()) {
    const row = candidateRows.get(change.rowId)!
    if (change.kind === 'set') row[change.prop] = change.value
    else delete row[change.prop]
  }
  issues.push(...staticDocumentIssues(candidate))
  return { changes: [...changes.values()], errors: issues, readOnly, derivedSkipped }
}

/** JSON也按语法节点做局部替换，只重排发生增删的最小对象，不序列化整张表。 */
export function applyStaticChanges(source: string, changes: readonly StaticChange[]): string {
  const sf = ts.parseJsonText('static.json', source)
  const edits: Edit[] = []
  const byRow = new Map<string, StaticChange[]>()
  for (const change of changes) byRow.set(change.rowId, [...(byRow.get(change.rowId) ?? []), change])
  const propertyName = (prop: ts.PropertyAssignment): string => ts.isStringLiteralLike(prop.name) ? prop.name.text : prop.name.getText(sf)
  const render = (value: unknown, node: ts.Node): string => {
    const indent = indentOf(source, node.getStart(sf))
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    return JSON.stringify(value, null, 2).replace(/\n/g, `${eol}${indent}`)
  }
  const diff = (node: ts.Expression, before: unknown, after: unknown): void => {
    if (isDeepStrictEqual(before, after)) return
    if (ts.isObjectLiteralExpression(node) && before && after && typeof before === 'object' && typeof after === 'object' &&
      !Array.isArray(before) && !Array.isArray(after) &&
      isDeepStrictEqual(Object.keys(before), Object.keys(after))) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('JSON对象属性无法解析')
        const key = propertyName(property)
        diff(property.initializer, (before as DataRow)[key], (after as DataRow)[key])
      }
    } else edits.push({ start: node.getStart(sf), end: node.end, text: render(after, node) })
  }
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const idProp = node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ['id', 'key'].includes(propertyName(p)))
      const id = idProp && ts.isStringLiteralLike(idProp.initializer) ? idProp.initializer.text : undefined
      const rowChanges = id === undefined ? undefined : byRow.get(id)
      if (rowChanges) {
        if (found.has(id!)) throw new Error(`JSON主键重复：${id}`)
        found.add(id!)
        const before = JSON.parse(node.getText(sf)) as DataRow
        const after = { ...before }
        for (const change of rowChanges) {
          if (change.kind === 'set') after[change.prop] = change.value
          else delete after[change.prop]
        }
        diff(node, before, after)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (found.size !== byRow.size) throw new Error('JSON变更主键未全部定位')
  let output = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  JSON.parse(output)
  return output
}

function applyChanges(
  srcText: string,
  sf: ts.SourceFile,
  changes: Change[],
  objs: Map<string, ObjInfo>,
): { text: string; count: number } {
  const edits: Edit[] = []
  for (const c of changes) {
    const info = objs.get(c.rowId)
    if (!info) continue
    const prop = propOf(info.obj, c.prop, sf)
    if (c.kind === 'set') {
      if (prop) {
        edits.push({ start: prop.initializer.getStart(sf), end: prop.initializer.getEnd(), text: c.text })
      } else {
        // 新增可选字段：块尾 '}' 前追加（多行对象：吃掉 '}' 行缩进，整行插入）
        const braceEnd = info.obj.getEnd() - 1
        const oneLine = !info.obj.getText(sf).includes('\n')
        if (oneLine) {
          // 单行对象：吃掉 '}' 前的空白后插入 ', 字段: 值 '（逗号后空格 + '}' 前空格 = 项目风格）
          let s = braceEnd
          while (s > 0 && srcText[s - 1] === ' ') s--
          edits.push({ start: s, end: braceEnd, text: `, ${c.prop}: ${c.text} ` })
        } else {
          const objIndent = indentOf(srcText, info.obj.getStart(sf))
          const s = lineStart(srcText, braceEnd)
          edits.push({ start: s, end: braceEnd, text: `${objIndent}  ${c.prop}: ${c.text},\n${objIndent}` })
        }
      }
    } else {
      if (!prop) continue
      const start = prop.getStart(sf)
      const ls = lineStart(srcText, start)
      const preSeg = srcText.slice(ls, start) // 行内前缀（'  ' 或 'key: v, '）
      const isLineLead = preSeg.trim() === ''
      let s: number
      let e: number
      if (!isLineLead) {
        // 行中属性（market 单行卡）：吞掉前导 ', '（同物理行内最近逗号起）
        const ci = preSeg.lastIndexOf(',')
        s = ci >= 0 ? ls + ci : start
        e = prop.getEnd()
        // 吞尾随 ', '（若后面同行内先遇逗号且其后到行尾只有空白）
        const nl = srcText.indexOf('\n', e)
        const tail = nl < 0 ? srcText.slice(e) : srcText.slice(e, nl)
        const ti = tail.indexOf(',')
        if (ti >= 0 && tail.slice(ti + 1).trim() === '') e += ti + 1
      } else {
        // 整行属性（含行内注释）：行首 → 行尾（含换行）
        s = ls
        e = prop.getEnd()
        const nl = srcText.indexOf('\n', e)
        e = nl < 0 ? srcText.length : nl + 1
      }
      edits.push({ start: s, end: e, text: '' })
    }
  }
  edits.sort((a, b) => b.start - a.start)
  let out = srcText
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { text: out, count: edits.length }
}

/* ═══════════ 主流程 ═══════════ */
async function main(): Promise<void> {
  const tableName = process.argv[2]
  const csvPath = process.argv[3]
  const dryRun = process.argv.includes('--dry-run')
  const spec = tableOf(tableName ?? '')
  if (!spec) {
    console.error(`未知表名「${tableName}」；可选：${['skills', 'items', 'modules', 'ships', 'anomalies', 'belts', 'market'].join(' / ')}`)
    process.exit(2)
  }
  if (!csvPath) {
    console.error('用法：npm run content:import <表名> <xlsx或csv文件> [--dry-run]')
    process.exit(2)
  }
  const loaded = await loadTableFile(csvPath, spec.name)
  /**
   * **表头归一化**（2026-09-15 船长「按照新名词改名」）：表头里的中文说明词跟随现行术语后，
   * 改名之前导出的文件仍在用旧表头 ⇒ 先按 `HEAD_ALIASES` 映射回现行写法再匹配列，
   * 免得那几列被判成"未知表头"而静默不回写（用到即提示重导）。
   */
  const rawHead = loaded.head
  const head = rawHead.map(normalizeHead)
  const aliased = rawHead.filter((h, i) => h.trim() !== head[i])
  if (aliased.length > 0) {
    console.warn(
      `ℹ️ 文件里有 ${aliased.length} 个旧表头列，已按现行术语映射（建议重新 npm run content:export 取干净文件）：${aliased.slice(0, 6).join('、')}`,
    )
  }
  const dataRows = loaded.data
  if (dataRows.length === 0) {
    console.error('文件无数据行（首行是表头）')
    process.exit(2)
  }
  if (dataRows.length === 0) {
    console.error('CSV 无数据行（首行是表头）')
    process.exit(2)
  }
  const headIdx = new Map(head.map((h, i) => [h, i]))
  const idColHead = spec.cols[0]!.head
  if (!head.includes(idColHead)) {
    console.error(`文件缺主键列「${idColHead}」——请勿改动表头行`)
    process.exit(2)
  }
  // 未知表头检查：警告并跳过该列（Excel ANSI 保存可能把生僻字符写成 '?' 弄坏表头——
  // 跳过比中断安全：坏表头列的数据不回写，其余列照常导入）
  const known = new Set(spec.cols.map((c) => c.head))
  const unknownHeads = head.filter((h) => !known.has(h))
  if (unknownHeads.length > 0) {
    console.warn(`⚠️ 忽略 ${unknownHeads.length} 个无法识别的表头列（数据不回写）：${unknownHeads.slice(0, 6).join('、')}${unknownHeads.length > 6 ? '…' : ''}`)
    console.warn('   若表头被 Excel 存坏（如 m? ⟦? 乱码），请重新 npm run content:export 生成干净文件后只改数据列。')
  }
  const sourceIds = spec.idProp === 'key' ? IDS.market : IDS[tableName as 'items']
  const csvIds = dataRows.map((r) => (r[headIdx.get(idColHead)!] ?? '').trim())
  const unknownIds = csvIds.filter((id) => !sourceIds.has(id))
  if (unknownIds.length > 0) {
    err(`CSV 含 ${unknownIds.length} 个不存在的主键（新增条目不走 CSV，走代办）：${unknownIds.slice(0, 8).join('、')}${unknownIds.length > 8 ? '…' : ''}`)
  }
  const removedIds = [...sourceIds].filter((id) => !csvIds.includes(id))
  if (removedIds.length > 0) {
    err(`源表有而 CSV 缺失 ${removedIds.length} 条（疑似筛选视图保存误删；真删走代办）：${removedIds.slice(0, 8).join('、')}${removedIds.length > 8 ? '…' : ''}`)
  }

  /**
   * **多源文件**（2026-09-15 修既有缺陷）：一张表的数据可能横跨多个 TS 文件 —— 典型是 `anomalies`：
   * 5 张 `wh-*` 洞内敌卡住在 `data/wormholeFoes.ts`，而 `ANOMALIES` 在 `data/anomalies.ts` 里摊进去
   * ⇒ 旧版只扫一个文件时会报「源文件找不到 wh-xxx 的对象块」，**整个敌情表导不回去**。
   * 现在逐个文件收集对象块并合并（同一 id 出现在两处 = 数据错误，直接拦下）。
   */
  const sources: Sources = { textOf: new Map(), sfOf: new Map(), numConstOf: new Map() }
  const staticPath = STATIC_TABLES.has(spec.name) ? `packages/data/src/static/${spec.name}.json` : undefined
  const objs = new Map<string, ObjInfo>()
  for (const srcPath of spec.files) {
    const srcText = readFileSync(srcPath, 'utf8')
    sources.textOf.set(srcPath, srcText)
    if (staticPath) continue
    const sf = ts.createSourceFile(srcPath, srcText, ts.ScriptTarget.Latest, true)
    sources.sfOf.set(srcPath, sf)
    sources.numConstOf.set(srcPath, collectNumConsts(sf))
    for (const [id, info] of collectObjects(sf, spec.idProp, srcPath)) {
      if (objs.has(id)) err(`id「${id}」在多个源文件里都出现（${srcPath}）：请先消除重复`)
      objs.set(id, info)
    }
  }

  const staticText = staticPath ? readFileSync(staticPath, 'utf8') : undefined
  const staticPlan = staticText === undefined ? undefined : planStaticImport(spec, staticText, sources.textOf, dataRows, headIdx)
  if (staticPlan) {
    errors.push(...staticPlan.errors)
    readOnlySkips.push(...staticPlan.readOnly)
  }
  const changes: Array<Change | StaticChange> = staticPlan?.changes ?? []
  let derivedSkipped = staticPlan?.derivedSkipped ?? 0
  for (let i = 0; !staticPlan && i < dataRows.length; i++) {
    const id = csvIds[i]!
    if (!sourceIds.has(id)) continue
    const info = objs.get(id)
    if (!info) {
      // 2026-09-09：派生只读行放行——残骸收购卡（wreck-*）= marketCatalog.ts WRECK_BUY_GOODS
      // 由敌群表动态 map 生成（1:1，无字面量对象块可回写），改卡应改敌群表/代码而非表格；
      // 导出会带上它们，导入时跳过而不是整体报错。
      if (tableName === 'market' && id.startsWith('wreck-')) {
        derivedSkipped += 1
        continue
      }
      err(`源文件找不到 ${id} 的对象块（id 在数据目录但源文件缺失？）`)
      continue
    }
    planRow(spec, info, dataRows[i]!, headIdx, sources, changes as Change[])
  }
  if (derivedSkipped > 0) {
    console.log(`ℹ️ 跳过 ${derivedSkipped} 行派生只读卡（残骸收购/插件占位等由代码生成，改动请走来源表/代码）`)
  }
  if (readOnlySkips.length > 0) {
    console.log(
      `ℹ️ ${readOnlySkips.length} 处列为文本、表达式或源对象展开口，表格不改它（请编辑原文本/公式来源）：` +
        `${readOnlySkips.slice(0, 6).join('、')}${readOnlySkips.length > 6 ? '…' : ''}`,
    )
  }

  if (errors.length > 0) {
    console.error('❌ 校验未通过，未写入任何改动：')
    for (const e of errors) console.error(`  · ${e}`)
    process.exit(1)
  }
  if (changes.length === 0) {
    console.log('✅ 无差异：CSV 相对源数据没有改动（或只动了空单元格）。')
    return
  }
  const byRow = new Map<string, string[]>()
  for (const c of changes) {
    const arr = byRow.get(c.rowId) ?? []
    arr.push(c.kind === 'del' ? `${c.prop}（删除）` : c.prop)
    byRow.set(c.rowId, arr)
  }
  console.log(`计划改动 ${changes.length} 处（${byRow.size} 条）：`)
  for (const [id, props] of byRow) console.log(`  · ${id}: ${props.join('、')}`)
  if (dryRun) {
    console.log('（--dry-run 预览模式，未写盘）')
    return
  }
  // **按源文件分组回写**（已迁移表只写JSON，旧表继续按TS对象所在文件分组）
  const byFile = new Map<string, Change[]>()
  for (const c of changes as Change[]) {
    const info = objs.get(c.rowId)
    if (!info) continue
    const arr = byFile.get(info.srcPath) ?? []
    arr.push(c)
    byFile.set(info.srcPath, arr)
  }
  let applied = 0
  let backup: string | undefined
  if (staticPath && staticText !== undefined && staticPlan) {
    const output = applyStaticChanges(staticText, staticPlan.changes)
    if (readFileSync(staticPath, 'utf8') !== staticText) throw new Error('静态JSON在预览后被修改，拒绝覆盖，请重新导入')
    for (const [path, text] of sources.textOf) {
      if (readFileSync(path, 'utf8') !== text) throw new Error(`TS文本/表达式绑定在预览后被修改，拒绝覆盖：${path}`)
    }
    const backupDir = resolve('content-csv', 'backups', `content-import-${Date.now()}-${process.pid}`)
    mkdirSync(backupDir, { recursive: true })
    backup = resolve(backupDir, `${spec.name}.json`)
    writeFileSync(backup, readFileSync(staticPath))
    writeFileSync(staticPath, output, 'utf8')
    applied = staticPlan.changes.length
    console.log(`ℹ️ 写入前备份：${backup}`)
  }
  for (const [path, fileChanges] of byFile) {
    const { text, count } = applyChanges(sources.textOf.get(path)!, sources.sfOf.get(path)!, fileChanges, objs)
    applied += count
    writeFileSync(path, text, 'utf8')
  }
  if (applied !== changes.length) {
    console.error(`❌ 内部不一致：计划 ${changes.length} 处，实际应用 ${applied} 处——请报告`)
    process.exit(1)
  }
  const written = staticPath ? [staticPath] : [...byFile.keys()]
  console.log(`✅ 已回写 ${written.join(' · ')}（${applied} 处字段变更）`)
  console.log('—— 自动校验：content:check + core/data typecheck ……')
  for (const args of [
    ['run', 'content:check'],
    ['run', 'typecheck', '-w', '@whale/core'],
    ['run', 'typecheck', '-w', '@whale/data'],
  ]) {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
    })
    if (r.status !== 0) {
      if (staticPath && backup && staticText !== undefined) {
        const expected = applyStaticChanges(staticText, staticPlan!.changes)
        if (readFileSync(staticPath, 'utf8') === expected) {
          writeFileSync(staticPath, readFileSync(backup))
          console.error(`⚠️ 自动校验失败，本次JSON写入已恢复；备份：${backup}`)
        } else console.error(`⚠️ JSON又被并行修改，未自动覆盖；原始备份：${backup}`)
      }
      console.error(`⚠️ 自动校验 ${args.slice(1).join(' ')} 失败——请查看上面的错误；如需还原：git restore ${written.join(' ')}`)
      process.exitCode = 1
      return
    }
  }
  const diff = spawnSync('git', ['diff', '--stat', '--', ...written], { encoding: 'utf8' })
  console.log('—— 改动摘要（git diff --stat）：')
  console.log(diff.stdout.trim())
  console.log('请 git diff 检视无误后提交；技能描述 ⟦数值⟧ 的改动需一号复核与引擎接线一致；')
  console.log('anomalies 表数值改动进二号 C4 平衡复核清单。')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error('❌ 导入失败：', e)
  process.exit(1)
})
