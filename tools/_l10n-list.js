/**
 * 临时探针（用完即删）：逐条列出某文件里**含中日韩、且没被 tr()/t() 包**的字符串字面量，
 * 并标注它是否已在唯一表里有同中文条目（有 ⇒ 直接复用那个 id，无需新译）。
 *
 * 用法：node tools/_l10n-list.js panels/Wormhole.tsx [起始行]
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join('apps', 'desktop', 'src', 'renderer', 'src')
const rel = process.argv[2]
const from = Number(process.argv[3] ?? 1)
const file = path.join(ROOT, rel)

const table = fs.readFileSync('packages/data/src/l10n/table.ts', 'utf8')
const byZh = new Map()
for (const m of table.matchAll(/^ {2}"([^"]+)": \{ zh: "((?:[^"\\]|\\.)*)", en: /gm)) {
  if (!byZh.has(m[2])) byZh.set(m[2], m[1])
}

const raw = fs.readFileSync(file, 'utf8')
const lines = raw.split(/\r?\n/)
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

let n = 0
let inBlock = false
for (let i = from - 1; i < lines.length; i++) {
  const line = lines[i]
  let code = line
  if (inBlock) {
    const end = code.indexOf('*/')
    if (end === -1) continue
    code = code.slice(end + 2)
    inBlock = false
  }
  // 去掉块注释（/* … */，含跨行）；行内块注释后的代码要保留
  for (;;) {
    const s = code.indexOf('/*')
    if (s === -1) break
    const e = code.indexOf('*/', s + 2)
    if (e === -1) {
      code = code.slice(0, s)
      inBlock = true
      break
    }
    code = code.slice(0, s) + code.slice(e + 2)
  }
  const t = code.trim()
  if (t === '' || t.startsWith('//') || t.startsWith('*')) continue
  if (code.includes('//') && !code.includes('://')) code = code.slice(0, code.indexOf('//'))
  // 单行单/双引号字面量（跳过已包的 tr('…') / t('…')）
  for (const m of code.matchAll(/(^|[^.\w])(['"])((?:(?!\2)[^\\\n]|\\.)*)\2/g)) {
    const v = m[3]
    if (!CJK.test(v)) continue
    const before = code.slice(0, m.index + m[1].length)
    if (/\b(?:tr|t)\(\s*$/.test(before)) continue
    const id = byZh.get(v)
    n++
    console.log(`${i + 1}: ${id ? `[复用 ${id}]` : '[新造]    '} ${JSON.stringify(v)}`)
  }
  // 模板串
  for (const m of code.matchAll(/`([^`]*)`/g)) {
    const v = m[1]
    if (!CJK.test(v)) continue
    const before = code.slice(0, m.index)
    if (/\b(?:tr|t)\(\s*$/.test(before)) continue
    n++
    console.log(`${i + 1}: [模板]     ${JSON.stringify(v)}`)
  }
}
console.log(`\n共 ${n} 条（${rel}）`)
