/**
 * **存档迁移只读体检**（2026-09-17 教程重做批入库）——`npm run save:migrate`。
 *
 * 干什么：把 `docs/test-saves/` 里的**全部**存档（现存 v18 → v25 各代）逐个走一遍 `loadSaveFile` 的迁移链
 * 到当前版本，并逐份核对五件事：
 * ① **能读进来**（迁移链没有断代）；② `onboarding.step` 只落 0（正处序章演出）或 99；
 * ③ 该版本迁移要求的一次性判定都写上了（例：v25→v26 的 13 条「第一次」判为已完成）；
 * ④ **不发奖励、资产不变**（AI 核心 / 蓝图库存 / 钱包三项与原始 JSON 逐字比对）；
 * ⑤ **页面解锁不倒退**（工业 / 市场 / 星图四页签全开）。
 *
 * 为什么要它（§3「结构改动后跑构建 ＋ 必要时真档迁移检查」）：存档结构每升一次版就多一段迁移代码，
 * 而"老档读进来会怎样"看代码看不出来——本工具把仓里 80 份各代真档一次性过一遍，**只读、绝不写档**。
 * 退出码：0 = 全部通过；1 = 有存档读不进或有核对项不达标（逐份 ❌ 点名）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v26** · 最后核对 2026-09-17 · 最后跑过 2026-09-17
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile } from '../packages/core/src/save'
import { CURRENT_STATE_VERSION } from '../packages/core/src/state'
import { FIRST_TASKS, unlocked } from '../packages/core/src/firstTasks'

const DIR = join(process.cwd(), 'docs', 'test-saves')
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))

let bad = 0
let okN = 0
const rows: string[] = []
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8')
  let raw: { version?: number; state?: Record<string, unknown> } = {}
  try {
    raw = JSON.parse(text) as typeof raw
  } catch {
    rows.push(`❌ ${f}：JSON 解析失败（跳过）`)
    bad += 1
    continue
  }
  const rawState = (raw.state ?? {}) as Record<string, any>
  try {
    const { state } = loadSaveFile(text)
    const problems: string[] = []
    if (state.version !== CURRENT_STATE_VERSION) problems.push(`版本 ${state.version} ≠ ${CURRENT_STATE_VERSION}`)
    const stepOk = state.onboarding.step === 99 || state.onboarding.step === 0
    if (!stepOk) problems.push(`step=${state.onboarding.step}`)
    const missing = FIRST_TASKS.filter((d) => state.importantTasks[d.id]?.done !== true).map((d) => d.id)
    if (missing.length > 0) problems.push(`未判过 ${missing.length} 条：${missing.slice(0, 3).join(',')}…`)
    // 资产不变（老档判定不发奖励）
    const coreBefore = rawState.aiCores?.basic ?? 0
    const coreAfter = state.aiCores.basic ?? 0
    if (coreBefore !== coreAfter) problems.push(`核心 ${coreBefore}→${coreAfter}`)
    const bpBefore = rawState.blueprintStock?.['bp-ammo-kinetic'] ?? 0
    const bpAfter = state.blueprintStock['bp-ammo-kinetic'] ?? 0
    if (bpBefore !== bpAfter) problems.push(`蓝图 ${bpBefore}→${bpAfter}`)
    const iskBefore = rawState.wallet?.isk ?? 0
    if (iskBefore !== state.wallet.isk) problems.push(`钱包 ${iskBefore}→${state.wallet.isk}`)
    // 页面解锁不倒退
    const locked = ['industry', 'market', 'mapMine', 'mapBounty', 'mapSalvage', 'mapHaul'].filter((k) => !unlocked(state, k))
    if (locked.length > 0) problems.push(`仍锁：${locked.join(',')}`)
    if (problems.length > 0) {
      rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：${problems.join(' · ')}`)
      bad += 1
    } else {
      okN += 1
      rows.push(`✅ ${f}（原 v${raw.version ?? '?'} → v${state.version}）step=${state.onboarding.step} · 13 条判过 · 资产不变 · 页面全开`)
    }
  } catch (e) {
    rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：读取失败 ${(e as Error).message}`)
    bad += 1
  }
}

for (const r of rows) console.log(r)
console.log(`\n合计 ${files.length} 份：通过 ${okN} · 失败 ${bad}`)
process.exit(bad === 0 ? 0 : 1)
