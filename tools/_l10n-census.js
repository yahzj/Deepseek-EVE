/**
 * 临时探针（用完即删）：量出渲染层「含中日韩的字面量」按**文件 × 类型**的分布，
 * 用来判断剩余接线工作该怎么切批（自动可包 / 跨行断片 / 模板串 / 其它）。
 *
 * 类型判据（只看字面量本身，不做 AST）：
 *   A 已包 tr(  —— `tr('…')` 右侧紧跟的串（正常，不计入待办）
 *   B 模板串    —— 反引号里的中文字面量（多行/含 ${…}）
 *   C 单行串    —— 单/双引号里的中文字面量且不含换行
 *   D 跨行串    —— 单/双引号里含真实换行（正是「需人工拆句」那一类）
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join('apps', 'desktop', 'src', 'renderer', 'src')
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) {
      if (name === 'i18n') continue
      out.push(...walk(p))
    } else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

const rows = []
for (const f of walk(ROOT)) {
  const raw = fs.readFileSync(f, 'utf8')
  const lines = raw.split(/\r?\n/)
  const stat = { A: 0, B: 0, C: 0, D: 0 }
  let inComment = false
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('/*') && !t.includes('*/')) inComment = true
    if (inComment) {
      if (t.includes('*/')) inComment = false
      continue
    }
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    // 去注释尾巴（粗略：忽略行内 //，够本探针用）
    const code = line.includes('//') && !line.includes('://') ? line.slice(0, line.indexOf('//')) : line
    const stripped = code.replace(/\btr\(\s*'[^']*'|\btr\(\s*"[^"]*"|\bt\(\s*'[^']*'|\bt\(\s*"[^"]*"/g, '§WRAPPED§')
    for (const m of stripped.matchAll(/`[^`]*`/g)) {
      if (CJK.test(m[0])) stat.B++
    }
    const noTpl = stripped.replace(/`[^`]*`/g, '`§`')
    for (const m of noTpl.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
      const v = m[1] ?? m[2] ?? ''
      if (v === '§WRAPPED§') continue
      if (!CJK.test(v)) continue
      stat.C++
    }
  }
  // 跨行串：整文件级扫（引号里含 \n）
  for (const m of raw.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const v = m[1] ?? m[2] ?? ''
    if (v.includes('\n') && CJK.test(v)) stat.D++
  }
  const total = stat.B + stat.C + stat.D
  if (total > 0) rows.push({ f, ...stat, total })
}

rows.sort((a, b) => b.total - a.total)
console.log('文件'.padEnd(46) + '模板  单行  跨行   合计')
let sum = { B: 0, C: 0, D: 0, total: 0 }
for (const r of rows) {
  console.log(r.f.replace(/\\/g, '/').replace(ROOT + '/', '').padEnd(44) + String(r.B).padStart(4) + String(r.C).padStart(6) + String(r.D).padStart(6) + String(r.total).padStart(7))
  sum.B += r.B
  sum.C += r.C
  sum.D += r.D
  sum.total += r.total
}
console.log('\n合计：模板 ' + sum.B + ' · 单行 ' + sum.C + ' · 跨行 ' + sum.D + ' · 总计 ' + sum.total + '（' + rows.length + ' 个文件）')
