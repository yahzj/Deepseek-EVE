/**
 * **技能 id 体检**（2026-09-20 立 · 起因 = 外部审计报告点名 `wormhole-econ` / `counter-audit` 用了 5 个假技能 id）。
 *
 * **要解决的问题（实测证据）**：`state.skills.trained[id]` 是 `Record<string, number>` —— **写什么键都收**，
 * 而引擎读等级时按 `ctx.skills`（真实目录）查 ⇒ **写错的 id 等于没训练**，工具却毫无提示。
 * 上一轮实测：`wormhole-econ.ts` 与 `counter-audit.ts` 的参考编队里 5 个技能 id 是假的
 * （`missile-ops` / `shield-ops` / `armor-ops` / `evasive-maneuvers` / `targeting`）
 * ⇒ 编队"0 技能裸奔"，两个工具跑出来的胜率曲线**整体虚假悲观**（层 2~8 全 0%，还被当成"难度墙"）。
 * `docs/glossary.md` §十一 早就记过这次"结论更正"，但代码一直没改 —— 因为**没有任何护栏会红**。
 *
 * **本工具 = 那道护栏**：扫 `tools/*.ts` 里所有"训练技能"的写法，逐个 id 与 `data/src/skills.ts` 对账。
 * 三种写法都认（脚本里就这三种）：
 * ① `skills.trained['x']`／`skills.trained[x]`；
 * ② `const <名含 SKILL> = { x: 数字, ... }`（参考编队的技能档）；
 * ③ `const <名含 SKILL> = ['x', ...]`（技能 id 清单）。
 *
 * 用法：`npm run skill:audit`（发现假 id 退出码 1 ⇒ 可以挂进体检链）。
 * 退出码 0 = 全绿；1 = 有假 id（逐条列出文件:行 + 最接近的真实 id 建议）。
 *
 * ⚠ 本工具**只管技能 id**（技能是唯一"键名自由、错了不报错"的账本；物品/模块等 id 走的是
 * `ctx.*.get()`，错键在界面上就是空名，肉眼可见）。要扩到别的账本另开一条契约。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SKILLS } from '../packages/data/src/skills'

const real = new Set(SKILLS.map((s) => s.id))

interface Hit {
  file: string
  line: number
  id: string
  how: string
}

/** 从"名含 SKILL 的常量块"里抽候选 id（对象字面量的键 / 字符串数组的元素） */
function collectCandidates(text: string): Hit[] {
  const hits: Hit[] = []
  const lines = text.split(/\r?\n/)
  let inObj = false
  let inArr = false
  const push = (line: number, id: string, how: string): void => {
    if (id.length > 0) hits.push({ file: '', line, id, how })
  }
  for (const [i, line] of lines.entries()) {
    const no = i + 1
    for (const m of line.matchAll(/skills\.trained\[\s*'([a-z][a-z0-9-]{2,})'\s*\]/g)) push(no, m[1]!, 'trained[索引]')
    if (/const\s+[A-Z_]*SKILL[A-Z_]*\s*(?::[^=]+)?=\s*\{/.test(line)) inObj = true
    else if (/const\s+[A-Z_]*SKILL[A-Z_]*\s*(?::[^=]+)?=\s*\[/.test(line)) inArr = true
    if (inObj) {
      for (const m of line.matchAll(/^\s*'?([a-z][a-z0-9-]{2,})'?\s*:\s*\d+/g)) push(no, m[1]!, 'SKILL 常量对象')
      if (line.includes('}')) inObj = false
    }
    if (inArr) {
      for (const m of line.matchAll(/'([a-z][a-z0-9-]{2,})'/g)) push(no, m[1]!, 'SKILL 常量数组')
      if (line.includes(']')) inArr = false
    }
  }
  return hits
}

/** 最接近的真实 id（给改法建议：同前缀 / 共享关键词优先，其次编辑距离 ≤ 4） */
function suggest(id: string): string | undefined {
  const head = id.split('-')[0]!
  const near = (a: string, b: string): number => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) dp[0]![j] = j
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      }
    }
    return dp[a.length]![b.length]!
  }
  let best: string | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const r of real) {
    const shared = r.startsWith(head) ? 0 : r.includes(head) ? 1 : 2
    const score = shared * 100 + near(id, r)
    if (score < bestScore) {
      bestScore = score
      best = r
    }
  }
  return bestScore < 200 ? best : undefined
}

const dir = join(process.cwd(), 'tools')
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
const all: Hit[] = []
for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8')
  for (const h of collectCandidates(text)) all.push({ ...h, file })
}

const bad = all.filter((h) => !real.has(h.id))
console.log(
  `· 技能 id 体检：扫了 ${files.length} 个工具文件 · 候选 ${all.length} 处 · 真实技能 ${real.size} 个`,
)
if (bad.length === 0) {
  console.log('✅ 全部技能 id 都是真实存在的')
  process.exit(0)
}
console.log(`❌ 发现 ${bad.length} 处**不存在的技能 id**（写进 trained 等于没训练）：`)
for (const b of bad) {
  const s = suggest(b.id)
  console.log(
    `   ${relative(process.cwd(), join('tools', b.file))}:${b.line}  「${b.id}」（${b.how}）` +
      (s !== undefined ? ` ⇒ 是不是想写「${s}」？` : ' ⇒ 目录里找不到相近的 id，请核对 data/src/skills.ts'),
  )
}
process.exit(1)
