/**
 * **存档迁移只读体检**（2026-09-17 教程重做批入库）——`npm run save:migrate`。
 *
 * 干什么：把 `docs/test-saves/` 里的**全部**存档逐份过一遍 `loadSaveFile`，按版本分两路核对：
 * - **v≥24（可迁移区间，下限见 `MIN_MIGRATABLE_VERSION`）**：走迁移链升到当前版本，并核对五件事——
 *   ① **能读进来**（迁移链没有断代）；② `onboarding.step` 只落 0（正处序章演出）或 99；
 *   ③ 该版本迁移要求的一次性判定都写上了（例：v25→v26 的 13 条「第一次」判为已完成）；
 *   ④ **不发奖励、资产不变**（AI 核心 / 蓝图库存 / 钱包三项与原始 JSON 逐字比对）；
 *   ⑤ **页面解锁不倒退**（工业 / 市场 / 星图四页签全开）。
 * - **v<24（过旧）**：按 2026-09-19 船长裁定**应被拒载入**（`SaveError('VERSION')`）——
 *   能读进来反而是 ❌（说明老迁移没删干净）。仓里留一份最老的档（v17）专门盯这一路。
 *
 * ⚠ **2026-09-21 补：老档的 13 条「第一次」不再在迁移层直接判过**（船长令「老档直接完成」＋同日
 * 「第一次任务不要自动完成，要让玩家回到任务中心点击完成」的合流口径）：v30→v31 只打一个收口标记
 * `firstTaskAutoClaim`，**真正判过发生在读档后的第一拍**（`engine.advanceGame` 里那段一次性收口）。
 * ⇒ 本工具对"带这个标记的档"**先跑一拍**再核对 ③（与玩家真实路径同构；仍然是纯内存、绝不写档）。
 *
 * 为什么要它（§3「结构改动后跑构建 ＋ 必要时真档迁移检查」）：存档结构每升一次版就多一段迁移代码，
 * 而"老档读进来会怎样"看代码看不出来——本工具把仓里 80 份各代真档一次性过一遍，**只读、绝不写档**。
 * 退出码：0 = 全部通过；1 = 有存档读不进或有核对项不达标（逐份 ❌ 点名）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-21 · 最后跑过 2026-09-21
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, MIN_MIGRATABLE_VERSION, SaveError } from '../packages/core/src/save'
import { CURRENT_STATE_VERSION } from '../packages/core/src/state'
import { FIRST_TASKS, unlocked } from '../packages/core/src/firstTasks'
import { advanceGame } from '../packages/core/src/engine'
import { buildSimContext } from '../packages/data/src/index'

const DIR = join(process.cwd(), 'docs', 'test-saves')
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
/** 老档收口那一拍要用的内容表（只跑一拍，不落档） */
const ctx = buildSimContext()

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
  /**
   * **过旧档（v<下限）应被拒载入**（船长 2026-09-19：「删除过旧的版本迁移」）：核心抛
   * `SaveError('VERSION')`，玩家侧由 `engine.start()` 开新档并写日志。能读进来 = 老迁移没删干净。
   */
  if (typeof raw.version === 'number' && raw.version < MIN_MIGRATABLE_VERSION) {
    try {
      loadSaveFile(text)
      rows.push(`❌ ${f}（原 v${raw.version}）：**过旧档却被读进来了**——老迁移没删干净？`)
      bad += 1
    } catch (e) {
      const isVersionErr = e instanceof SaveError && e.code === 'VERSION'
      if (isVersionErr) {
        okN += 1
        rows.push(`✅ ${f}（原 v${raw.version} < 下限 v${MIN_MIGRATABLE_VERSION}）：已按预期拒载入`)
      } else {
        rows.push(`❌ ${f}（原 v${raw.version}）：拒载入的**错误码不对**（${(e as Error).message}）`)
        bad += 1
      }
    }
    continue
  }
  try {
    const { state } = loadSaveFile(text)
    /**
     * **两条口径分岔**（2026-09-21 补，见头注）：
     * - **v25 及更早的"老档"**：v25→v26 迁移会把 13 条「第一次」一次性判过 ⇒ 硬要求"13 条全过 + 页面全开"。
     * - **v26 起的"教程链进行中的档"**：13 条由玩家自己走（2026-09-21 起还要**点「完成」**才推进）⇒
     *   一律硬要求"13 条全过"会把**玩家的真实存档**误判成失败（他还没玩到那儿）。这一档改钉三件不变量：
     *   ① 迁移**不倒退**（读档前已判过的照旧判过）；② **不凭空完成**（没走到的任务不许被标 done）；
     *   ③ 资产三项不变、版本正确、step 合法。完成度与页面锁**如实打印成 ⚠ 读数**（不是失败）。
     */
    const legacyAllDone = (raw.version ?? 0) <= 25
    if (state.firstTaskAutoClaim === true) advanceGame(state, 1000, ctx)
    const problems: string[] = []
    const notes: string[] = []
    if (state.version !== CURRENT_STATE_VERSION) problems.push(`版本 ${state.version} ≠ ${CURRENT_STATE_VERSION}`)
    const stepOk = state.onboarding.step === 99 || state.onboarding.step === 0
    if (!stepOk) problems.push(`step=${state.onboarding.step}`)
    const missing = FIRST_TASKS.filter((d) => state.importantTasks[d.id]?.done !== true).map((d) => d.id)
    if (legacyAllDone) {
      if (missing.length > 0) problems.push(`未判过 ${missing.length} 条：${missing.slice(0, 3).join(',')}…`)
    } else {
      const rawTasks = (rawState.importantTasks ?? {}) as Record<string, { done?: boolean } | undefined>
      const lost = FIRST_TASKS.filter((d) => rawTasks[d.id]?.done === true && state.importantTasks[d.id]?.done !== true)
      if (lost.length > 0) problems.push(`判过又被抹掉 ${lost.length} 条：${lost.map((d) => d.id).slice(0, 3).join(',')}…`)
      if (missing.length > 0) notes.push(`教程链进行中：还有 ${missing.length} 条待玩家自己做`)
    }
    // 资产不变（老档判定不发奖励）
    const coreBefore = rawState.aiCores?.basic ?? 0
    const coreAfter = state.aiCores.basic ?? 0
    if (coreBefore !== coreAfter) problems.push(`核心 ${coreBefore}→${coreAfter}`)
    const bpBefore = rawState.blueprintStock?.['bp-ammo-kinetic'] ?? 0
    const bpAfter = state.blueprintStock['bp-ammo-kinetic'] ?? 0
    if (bpBefore !== bpAfter) problems.push(`蓝图 ${bpBefore}→${bpAfter}`)
    const iskBefore = rawState.wallet?.isk ?? 0
    if (iskBefore !== state.wallet.isk) problems.push(`钱包 ${iskBefore}→${state.wallet.isk}`)
    // 页面解锁不倒退（老档硬要求全开；教程链档如实打印——他还没走到那一步就该是锁的）
    const locked = ['industry', 'market', 'mapMine', 'mapBounty', 'mapSalvage', 'mapHaul'].filter((k) => !unlocked(state, k))
    if (locked.length > 0) {
      if (legacyAllDone) problems.push(`仍锁：${locked.join(',')}`)
      else notes.push(`页面仍锁（未解锁的前置未完成）：${locked.join(',')}`)
    }
    if (problems.length > 0) {
      rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：${problems.join(' · ')}`)
      bad += 1
    } else {
      okN += 1
      const okNote = legacyAllDone ? '13 条判过 · 资产不变 · 页面全开' : '不倒退 · 不凭空完成 · 资产不变'
      rows.push(
        `✅ ${f}（原 v${raw.version ?? '?'} → v${state.version}）step=${state.onboarding.step} · ${okNote}` +
          (notes.length > 0 ? ` · ⚠ ${notes.join(' · ')}` : ''),
      )
    }
  } catch (e) {
    rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：读取失败 ${(e as Error).message}`)
    bad += 1
  }
}

for (const r of rows) console.log(r)
console.log(`\n合计 ${files.length} 份：通过 ${okN} · 失败 ${bad}`)
process.exit(bad === 0 ? 0 : 1)
