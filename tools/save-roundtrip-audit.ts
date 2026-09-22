/**
 * **存档往返体检**（正式工具 · 2026-09-22 建）——把"**刷新一次会不会丢东西**"这件事变成可复跑的读数。
 *
 * 治的是什么（**2026-09-22 船长报障**：「**玩家刷新可以重复领取补发的打捞器**」）：`save.ts` 的
 * `normalizeState` 里有几十处**手工白名单**（读档时逐字段重建对象）——**每加一个随档字段就得在两处都写**，
 * 漏了不会报错，只在"刷新/重进"时表现为**重复发奖 / 状态回退**。打捞器那次漏的是
 * `importantTasks.salvagerGift`（补发去重键），于是刷新一次多领一台。
 *
 * 它做什么：把 `docs/test-saves/*.json` 逐份跑 **读档 → 落盘 → 再读档**，递归比对两轮的键集合，报出
 * **第二轮少掉的键 / 类型变了的键**。这是**读数**，不是观感结论。
 *
 * ⚠ **能查到什么、查不到什么（如实登记）**：真档是**历史快照** ⇒ 只能覆盖"这些档里已经存在的字段"；
 * **本批新加的字段**（如 `salvagerGift`）在这些老档里根本不存在，得靠 `save.test.ts` 里那条
 * **自动护栏用例**（把真引擎跑过的档整体往返一次）兜住。两者互补，都要跑。
 *
 * 用法：`npm run save:roundtrip-audit`
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-22 · 最后跑过 2026-09-22
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

/** 真档目录（与 `npm run save:migrate` 同一份） */
const DIR = 'docs/test-saves'

/** 递归收集键路径 → 类型（数组只看第 0 个元素：一份档里的同类元素结构相同） */
function keysDeep(v: unknown, path: string, out: Map<string, string>): void {
  if (v === null || typeof v !== 'object') return
  if (Array.isArray(v)) {
    if (v.length > 0) keysDeep(v[0], `${path}[]`, out)
    return
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k
    out.set(p, Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val)
    keysDeep(val, p, out)
  }
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
/** 丢键 → 命中份数 */
const lost = new Map<string, number>()
/** 类型变了 → 命中份数 */
const typed = new Map<string, number>()
let ok = 0
let failed = 0

for (const f of files) {
  try {
    const first = loadSaveFile(readFileSync(join(DIR, f), 'utf8')).state
    const second = loadSaveFile(serializeSaveFile(first, 0)).state
    const a = new Map<string, string>()
    const b = new Map<string, string>()
    keysDeep(first, '', a)
    keysDeep(second, '', b)
    for (const [k, t] of a) {
      if (!b.has(k)) lost.set(k, (lost.get(k) ?? 0) + 1)
      else if (b.get(k) !== t) typed.set(k, (typed.get(k) ?? 0) + 1)
    }
    ok += 1
  } catch (e) {
    failed += 1
    console.log(`✗ ${f}：${(e as Error).message}`)
  }
}

console.log(`\n往返过的档：${ok} 份成功 / ${failed} 份失败（共 ${files.length} 份）`)
console.log(`\n【第二轮丢掉的键】${lost.size} 个`)
for (const [k, n] of [...lost].sort((x, y) => y[1] - x[1])) console.log(`  ${k}  （${n} 份档丢）`)
console.log(`\n【类型变了的键】${typed.size} 个`)
for (const [k, n] of [...typed].sort((x, y) => y[1] - x[1])) console.log(`  ${k}  （${n} 份档）`)
console.log(
  lost.size === 0 && typed.size === 0
    ? '\n✅ 存档往返体检通过：这些真档读回来一个键都不少、类型不变。'
    : '\n❌ 有键在往返里丢了/变形了——逐条查 `save.ts` 的 `normalizeState`（多半是手工白名单漏了这个字段）。',
)
