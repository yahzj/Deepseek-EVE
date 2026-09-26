/**
 * **事件日志分类契约（船长 2026-09-26 令）** —— 本文件钉四件事：
 *
 * 1. **类别全集**：`LogKind` 恰好这 11 个值（新增 combat/industry/fleet/salvage；`queue` 只作老档兼容）。
 * 2. **全仓调用点的 kind 都在白名单里**（静态扫源码）：`packages/core/src/**` 与渲染层 `game/engine.ts`
 *    里每一处 `addLog(...)` 的 kind 字面量都必须是合法类别 —— 防"新写一条日志忘了分类"。
 * 3. **每类都有来源**：十个展示类别（除老档兼容的 queue）在源码里都至少出现一次。
 * 4. **口径守卫**：`信息` 只剩"通讯 / 任务 / 杂项"（不许再当兜底桶）——用条数上限守住
 *    （船长原话：「大量信息都放进了'信息'里」；改前 info 83 处，改后 ≤ 15 处）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const DIRS = [join(ROOT, 'packages', 'core', 'src'), join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src', 'game')]

const KINDS = [
  'system',
  'info',
  'levelup',
  'queue', // 老档兼容
  'warn',
  'trade',
  'event',
  'combat',
  'industry',
  'fleet',
  'salvage',
] as const
/** 展示用十类（不含老档兼容的 queue） */
const SHOWN = KINDS.filter((k) => k !== 'queue')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...tsFiles(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 逐个 `addLog(` 调用点取出 kind（支持跨行写法：kind 允许在随后 3 行内） */
function callSites(): Array<{ file: string; line: number; kind: string }> {
  const out: Array<{ file: string; line: number; kind: string }> = []
  for (const dir of DIRS) {
    for (const file of tsFiles(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i]!.includes('addLog(')) continue
        if (lines[i]!.includes('export function addLog')) continue // 定义本身
        const win = lines.slice(i, Math.min(i + 4, lines.length)).join(' ')
        const m = /'([a-z]+)'/.exec(win.replace(/addLog\(/, ''))
        if (m) out.push({ file: file.replace(ROOT, ''), line: i + 1, kind: m[1]! })
      }
    }
  }
  return out
}

const SITES = callSites()
const countOf = (kind: string): number => SITES.filter((s) => s.kind === kind).length

describe('事件日志分类契约（2026-09-26 船长令）', () => {
  it('全仓 addLog 调用点的 kind 都是合法类别（扫源码，防漏分类）', () => {
    const bad = SITES.filter((s) => !KINDS.includes(s.kind as (typeof KINDS)[number]))
    expect(bad.map((b) => `${b.file}:${b.line} kind=${b.kind}`)).toEqual([])
    expect(SITES.length).toBeGreaterThan(300) // 2026-09-26 实测 362 处；掉到 300 以下说明扫描坏了
  })

  it('展示十类每一类都有来源（没有空类别）', () => {
    for (const k of SHOWN) {
      expect(countOf(k), `类别 ${k} 没有任何来源`).toBeGreaterThan(0)
    }
  })

  it('新四类达到最小规模：战斗 ≥40 · 舰队 ≥60 · 工业 ≥25 · 打捞 ≥20', () => {
    expect(countOf('combat')).toBeGreaterThanOrEqual(40)
    expect(countOf('fleet')).toBeGreaterThanOrEqual(60)
    expect(countOf('industry')).toBeGreaterThanOrEqual(25)
    expect(countOf('salvage')).toBeGreaterThanOrEqual(20)
  })

  it('「信息」不再是兜底桶：条数 ≤ 15（改前 83 处）', () => {
    const info = SITES.filter((s) => s.kind === 'info')
    expect(info.length, `info 现有 ${info.length} 处：${info.map((i) => `${i.file}:${i.line}`).join(', ')}`).toBeLessThanOrEqual(15)
  })

  it('新代码不再写 `queue`（老档兼容值，只在类型/白名单里留着）', () => {
    expect(countOf('queue')).toBe(0)
  })
})
