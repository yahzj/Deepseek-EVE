/**
 * 内容工作台 · 导入回写（Phase B，2026-09-05 船长确认）：
 * 读回 content:export 生成的 CSV，按主键字段级回写源 TS（保留注释/分组/排版，最小 diff），
 * 四道护栏：
 *   1) 主键只读：CSV 出现未知 id = 拒绝（新增条目走代办）；源表有而 CSV 缺失 = 拒绝
 *      （多发生在"筛选视图保存"误删——提示复原或走代办）；
 *   2) 逐列校验：类型/枚举/数值范围/引用 id 存在（口径与 content-check 同源）；
 *   3) 空单元格 = 不改该字段；可选字段填 '-' = 删除该字段；
 *   4) 只写有差异的字段；收尾自动 content:check + core/data typecheck + diff 摘要。
 *
 * 用法：npm run content:import <表名> <csv文件> [--dry-run]   （表名见 content-schema.ts）
 * 实现：TypeScript AST 定位对象与属性节点，做区间级最小替换（源格式/注释/下划线数字不重排；
 * market 卡为单行对象，同样按区间处理）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import * as ts from 'typescript'
import { ANOMALIES, BELTS, GALAXIES, ITEMS, MARKET_GOODS, MODULES, SHIPS, SKILLS } from '@whale/data'
import { tableOf, type ColSpec } from './content-schema'

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

/* ═══════════ 主键集合 ═══════════ */
function idSetOf(rows: readonly unknown[], key: string): Set<string> {
  return new Set(rows.map((r) => (r as Record<string, string>)[key]))
}
const IDS = {
  skills: idSetOf(SKILLS, 'id'),
  items: idSetOf(ITEMS, 'id'),
  modules: idSetOf(MODULES, 'id'),
  ships: idSetOf(SHIPS, 'id'),
  anomalies: idSetOf(ANOMALIES, 'id'),
  belts: idSetOf(BELTS, 'id'),
  market: idSetOf(MARKET_GOODS, 'key'),
  galaxies: idSetOf(GALAXIES, 'id'),
}

const errors: string[] = []
const err = (m: string): void => { errors.push(m) }

/* ═══════════ AST 辅助 ═══════════ */
interface ObjInfo { obj: ts.ObjectLiteralExpression }

function collectObjects(sf: ts.SourceFile, idPropName: string): Map<string, ObjInfo> {
  const map = new Map<string, ObjInfo>()
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const p = node.properties.find(
        (x): x is ts.PropertyAssignment =>
          ts.isPropertyAssignment(x) && x.name.getText(sf) === idPropName && ts.isStringLiteralLike(x.initializer),
      )
      if (p && ts.isStringLiteralLike(p.initializer) && !map.has(p.initializer.text)) {
        map.set(p.initializer.text, { obj: node })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return map
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

function objPairsOf(expr: ts.Expression | undefined, sf: ts.SourceFile): Array<[string, number]> {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return []
  const out: Array<[string, number]> = []
  for (const p of expr.properties) {
    if (!ts.isPropertyAssignment(p)) continue
    const n = Number(p.initializer.getText(sf).replaceAll('_', ''))
    if (Number.isFinite(n)) out.push([p.name.getText(sf), n])
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
function parseNum(rowId: string, head: string, cell: string, col: ColSpec): number | undefined {
  const n = Number(cell)
  if (!Number.isFinite(n)) {
    err(`${rowId}：${head} 不是数字「${cell}」`)
    return undefined
  }
  if (col.int && !Number.isInteger(n)) err(`${rowId}：${head} 须为整数（得 ${cell}）`)
  if (col.min !== undefined && n < col.min) err(`${rowId}：${head} 不得小于 ${col.min}（得 ${cell}）`)
  if (col.max !== undefined && n > col.max) err(`${rowId}：${head} 不得大于 ${col.max}（得 ${cell}）`)
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
  srcText: string,
  sf: ts.SourceFile,
  changes: Change[],
): void {
  const { obj } = info
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
        if (curText !== undefined && Math.abs(Number(curText.replaceAll('_', '')) - n) < 1e-9) continue
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: fmtNum(n) })
        break
      }
      case 'bool': {
        if (cell !== '是' && cell !== '否') {
          err(`${csvRow[0]}：${col.head} 须填 是/否（得「${cell}」）`)
          continue
        }
        const t = cell === '是' ? 'true' : 'false'
        if (curText === t) continue
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: t })
        break
      }
      case 'obj': {
        const key = col.p.split('.')[1]!
        const n = parseNum(csvRow[0]!, col.head, cell, col)
        if (n === undefined) continue
        const pairs = objPairsOf(prop?.initializer, sf)
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
        const multi = curText.includes('\n')
        changes.push({ kind: 'set', rowId: csvRow[0]!, prop: root, text: renderListText(cell, multi, indent, col.itemKey!, col.valKey!) })
        break
      }
    }
  }
}

/* ═══════════ 应用变更（区间替换；由后向前套用） ═══════════ */
interface Edit { start: number; end: number; text: string }

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
function main(): void {
  const tableName = process.argv[2]
  const csvPath = process.argv[3]
  const dryRun = process.argv.includes('--dry-run')
  const spec = tableOf(tableName ?? '')
  if (!spec) {
    console.error(`未知表名「${tableName}」；可选：${['skills', 'items', 'modules', 'ships', 'anomalies', 'belts', 'market'].join(' / ')}`)
    process.exit(2)
  }
  if (!csvPath) {
    console.error('用法：npm run content:import <表名> <csv文件> [--dry-run]')
    process.exit(2)
  }
  const csvBuf = readFileSync(csvPath)
  const csvText = decodeText(csvBuf)
  const delim = detectDelimiter(csvText)
  const parsed = parseDelimited(csvText, delim)
  const head = parsed[0]!.map((h) => h.trim())
  // Excel 可能截掉行尾空字段：数据行统一补齐到表头长度（尾部空 = 不改，安全）
  const headLen = head.length
  const headIdx = new Map(head.map((h, i) => [h, i]))
  const dataRows = parsed
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => (r.length < headLen ? [...r, ...new Array<string>(headLen - r.length).fill('')] : r))
  if (dataRows.length === 0) {
    console.error('CSV 无数据行（首行是表头）')
    process.exit(2)
  }
  const idColHead = spec.cols[0]!.head
  if (!head.includes(idColHead)) {
    console.error(`CSV 缺主键列「${idColHead}」——请勿改动表头行`)
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

  const srcPath = spec.file
  const srcText = readFileSync(srcPath, 'utf8')
  const sf = ts.createSourceFile(srcPath, srcText, ts.ScriptTarget.Latest, true)
  const objs = collectObjects(sf, spec.idProp)

  const changes: Change[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const id = csvIds[i]!
    if (!sourceIds.has(id)) continue
    const info = objs.get(id)
    if (!info) {
      err(`源文件找不到 ${id} 的对象块（id 在数据目录但源文件缺失？）`)
      continue
    }
    planRow(spec, info, dataRows[i]!, headIdx, srcText, sf, changes)
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
  const { text: newText, count } = applyChanges(srcText, sf, changes, objs)
  if (count !== changes.length) {
    console.error(`❌ 内部不一致：计划 ${changes.length} 处，实际应用 ${count} 处——未写盘，请报告`)
    process.exit(1)
  }
  writeFileSync(srcPath, newText, 'utf8')
  console.log(`✅ 已回写 ${srcPath}（${count} 处字段变更）`)
  console.log('—— 自动校验：content:check + core/data typecheck ……')
  for (const args of [
    ['run', 'content:check'],
    ['run', 'typecheck', '-w', '@whale/core'],
    ['run', 'typecheck', '-w', '@whale/data'],
  ]) {
    const r = spawnSync('npm.cmd', args, { stdio: 'inherit' })
    if (r.status !== 0) {
      console.error(`⚠️ 自动校验 ${args.slice(1).join(' ')} 失败——请查看上面的错误；如需还原：git checkout -- ${srcPath}`)
      process.exitCode = 1
      return
    }
  }
  const diff = spawnSync('git', ['diff', '--stat', '--', srcPath], { encoding: 'utf8' })
  console.log('—— 改动摘要（git diff --stat）：')
  console.log(diff.stdout.trim())
  console.log('请 git diff 检视无误后提交；技能描述 ⟦数值⟧ 的改动需一号复核与引擎接线一致；')
  console.log('anomalies 表数值改动进二号 C4 平衡复核清单。')
}

main()
