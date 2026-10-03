/**
 * **打捞「捞了等于没捞」两处修**（**2026-10-02 船长令「按你推荐」**；起因 = 船长转述玩家报障）：
 *
 * > 「**入侵的残骸打捞后数字不变也打捞不到**」
 *
 * 两个各自独立的缺陷（探针读数见工作文档；两条都在真入口上，本文件走真作业 `advanceSalvageOp` 验收）：
 *
 * ① **不足 1 m³ 的那一轮白捞**：同日更早那批「甲」（入侵池按余额封顶出量）之后，"一轮不足 1 m³"
 *    成了常态；而入库那一步 `inventory.addItem` 是 `Math.floor` ⇒ 0.6 m³ 的一轮**池子扣光、
 *    货舱一件没多**（探针读数 `池 0.60 → 0.00 · 到手 0 → 0`）⇒ 玩家体感「打捞照跑、数字一动不动」。
 *    修 = 入舱件数走单点 `wreckUnitsOf`：**出了量就至少 1 件**（池子仍按实际 m³ 扣）。
 * ② **陈旧的打捞对象把整条路堵死**：`SalvageOpState.targetGroup` 在老档里可能是**上一族那套键**
 *    （如 H 族的 `h-hi`）；原口径"手选组已干 ⇒ 本轮不出"会让它**每轮返回 `null`**（读数
 *    `对象=h-hi · 池 120.00 → 120.00 · pick=null`），而主控作业与 AI 拿到 `null` 都会**终止任务**。
 *    修 = 与 `startSalvageOp` 那句「对象不可用 ⇒ 回落全部」同口径：**就地清掉、本轮按「全部」出**。
 *
 * 本文件钉五件：① `wreckUnitsOf` 单点 · ② **真作业**里尾轮真进舱 1 件 · ③ 大轮照旧 floor ·
 * ④ 陈旧对象自愈（照出 ＋ 字段被清）· ⑤ 可用对象不被误伤。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { countItem } from '../src/inventory'
import {
  WEEKEND_WRECK_TARGET,
  injectWeekendRareWreck,
  injectWeekendWreck,
  weekendWreckDensityOf,
} from '../src/salvage'
import { advanceSalvageOp, pullOneWreck, salvagerCyclesOf, startSalvageOp, wreckUnitsOf } from '../src/salvaging'

const ctx = buildSimContext('zh')
/** 一个"本来就有可见悬赏"的星系（池底 = 它的原卡） */
const GID = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
/** R 族（入侵第二族）的残骸物品 = `wreck-r-inv`（组 key `r-inv`） */
const R_WRECK = 'wreck-r-inv'
/** 真数据里的打捞器（不写死 id：从装备表里按 slot 取） */
const SALVAGER = [...ctx.modules.values()].find((m) => m.slot === 'salvager')!.id

function world(family: 'H' | 'R' = 'R'): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.debugQuick = true // 调试档：行程腿固定 1 秒（照 `salvaging.test.ts` 的既有做法）
  s.exploredGalaxies.push(GID)
  s.salvaging.active = true
  s.salvaging.galaxyId = GID
  s.salvaging.phase = 'salvaging'
  /** ⚠ 事件以"此刻"为起点：`pullOneWreck` 按墙钟判该星系是否还在占领期 */
  s.weekendEvent = {
    seq: 3,
    startedAtWallMs: Date.now(),
    coreId: 'galaxy-kor',
    peripheryIds: [GID],
    family,
    contributed: {},
  }
  s.galaxyWrecks = { [GID]: { density: 0, rare: 0 } }
  return s
}

/** 装一台真打捞器（作业的真实门槛） */
function fitSalvager(s: GameState): void {
  s.fleet[s.shipId]!.fitted = { high: [SALVAGER], mid: [], low: [] }
}

describe('① 入舱件数：出了量就至少 1 件（2026-10-02 船长令「按你推荐」）', () => {
  it('`wreckUnitsOf` 单点：0 / 负数 ⇒ 0；0.6 ⇒ **1**；3.2 ⇒ 3（floor 不变）', () => {
    expect(wreckUnitsOf(0)).toBe(0)
    expect(wreckUnitsOf(-1)).toBe(0)
    expect(wreckUnitsOf(0.6), '不足 1 m³ ⇒ 保底 1 件（改前 floor ⇒ 0）').toBe(1)
    expect(wreckUnitsOf(1)).toBe(1)
    expect(wreckUnitsOf(3.2), '正常轮照旧 floor（不多给）').toBe(3)
    expect(wreckUnitsOf(95.04)).toBe(95)
  })

  it('**真作业**：池子只剩 0.6 m³ 的那一轮 ⇒ 舱里真多 1 件（改前 = 0），池子照旧扣光', () => {
    const s = world('R')
    fitSalvager(s)
    injectWeekendWreck(s, GID, 0.6, 'R')
    expect(countItem(s, R_WRECK), '开捞前舱里 0 件').toBe(0)
    expect(startSalvageOp(s, GID, ctx, WEEKEND_WRECK_TARGET).ok, '开工（真门槛：装了打捞器）').toBe(true)
    /** 推进**正好一个打捞周期**（真打捞器的周期从数据取，别写死 1000） */
    const cycle = salvagerCyclesOf(s, ctx, s.shipId)[0]!
    advanceSalvageOp(s, cycle, ctx)
    expect(countItem(s, R_WRECK), '**改前这里是 0 —— 捞了等于没捞**').toBe(1)
    expect(weekendWreckDensityOf(s, GID), '池子按实际出量扣光（甲令语义不变）').toBe(0)
    console.log(`  [读数] 池 0.6 m³ ⇒ 入舱 ${countItem(s, R_WRECK)} 件 · 池 0.6 → 0.00 · 周期 ${cycle}ms`)
  })

  it('大池子照旧：一件不多给、总量仍被池子封顶（甲令回归）', () => {
    const s = world('R')
    injectWeekendWreck(s, GID, 30, 'R')
    s.salvaging.targetGroup = WEEKEND_WRECK_TARGET
    const pick = pullOneWreck(s, ctx, GID, 60_000)!
    expect(wreckUnitsOf(pick.volumeM3), '入舱件数 = floor(出量)，不是出量向上凑').toBe(Math.floor(pick.volumeM3))
    expect(pick.volumeM3, '出量仍被池子余额封顶').toBeLessThanOrEqual(30.001)
  })

  it('箱子那一轮不受影响（稀有残骸固定 30 m³ ⇒ 30 件）', () => {
    const s = world('R')
    injectWeekendRareWreck(s, GID, 'corona-converge', 1)
    const pick = pullOneWreck(s, ctx, GID, 60_000)!
    expect(pick.itemId).toBe('wreck-rare-r-inv')
    expect(wreckUnitsOf(pick.volumeM3)).toBe(30)
  })
})

describe('② 陈旧的打捞对象：就地自愈、本轮按「全部」出', () => {
  it('老档留下的 H 族对象（`h-hi`）遇上 R 族残骸 ⇒ **照出**，且字段被清掉', () => {
    const s = world('R')
    injectWeekendWreck(s, GID, 120, 'R')
    s.salvaging.targetGroup = 'h-hi'
    const pick = pullOneWreck(s, ctx, GID, 60_000)
    expect(pick, '**改前这里是 null ⇒ 作业/AI 直接终止**').not.toBeNull()
    expect(pick!.itemId, '本轮按「全部」出 ⇒ 抽中的是入侵残骸').toBe(R_WRECK)
    expect(s.salvaging.targetGroup, '就地清掉（下一次取数即「全部」）').toBeUndefined()
    console.log(`  [读数] 陈旧对象 h-hi：改后 pick=${pick!.itemId} ×${pick!.volumeM3.toFixed(2)} m³ · 字段已清`)
  })

  it('可用对象不被误伤：哨兵键「只捞入侵残骸」有存量 ⇒ 照旧按它出、字段照旧留着', () => {
    const s = world('R')
    injectWeekendWreck(s, GID, 60, 'R')
    s.salvaging.targetGroup = WEEKEND_WRECK_TARGET
    const pick = pullOneWreck(s, ctx, GID, 60_000)!
    expect(pick.itemId).toBe(R_WRECK)
    expect(s.salvaging.targetGroup, '可用的对象照旧留着').toBe(WEEKEND_WRECK_TARGET)
  })

  it('开局入口同口径：给一个无存量的对象 ⇒ 开工时就回落「全部」', () => {
    const s = world('R')
    fitSalvager(s)
    injectWeekendWreck(s, GID, 60, 'R')
    const r = startSalvageOp(s, GID, ctx, 'h-hi')
    expect(r.ok, '开工照成功（对象不可用只回落，不拒开工）').toBe(true)
    expect(s.salvaging.targetGroup, '与运行期自愈同一口径').toBeUndefined()
  })
})
