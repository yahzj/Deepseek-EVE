/**
 * **跃迁燃料**（**2026-09-29 船长令**：「添加超空间折跃燃料，用于大幅缩短各个活动玩家的返航时间」）。
 *
 * 口径（船长逐条定）：
 * - **计量 = 秒**：1 单位燃料抵扣 **1 秒「原返航时长」**——原返航 = **不含燃料时**这一趟本来要飞的
 *   返航时长（已含"货仓占比缩放"：空仓本来就近乎瞬回 ⇒ 自然几乎不耗料）；
 * - **消耗** = 返航腿**开始时扣一次** `ceil(原返航秒)` 单位（不够 ⇒ 本趟不加速、**不扣**）；
 * - **效果** = 那一趟**返航速度 ×10**（时长 ÷10，`JUMP_FUEL_SPEED_MUL`）；
 * - **本地母港卡照吃**（船长 2026-09-29：「本地母港吃燃料」）；
 * - **开关**（`state.jumpFuel`）：采矿 / 打捞 / 悬赏与远征 / AI 副船作业，**默认全关**；
 *   解锁门槛 = **已建成空间站 ≥ 1 座**（`station.builtStationCount`）。
 *
 * **2026-09-30 船长令（上限批）**：
 * - **上限 = 只算物品仓库**（基准 6,000，两条技能可提到 13,500；口径见 `JUMP_FUEL_CAP_BASE` 注释）；
 * - 燃料**每单位 1 m³、普通舰船货仓无法装入**（`ItemDef.holdForbidden`）⇒ 扣料只走仓库；
 * - 读数与上限同尺（界面不再自造"一趟长途 = 1,200 单位"这类常量）。
 *
 * ⚠ **为什么不写在 `trips.scaledReturnMs` 里直接扣料**：那条函数在**每帧的推进循环里被反复调用**
 * （同一趟腿每拍重算一次）⇒ 在里面扣料会把一趟算成几十上百趟。故本模块拆成两半：
 * **`beginJumpFuelLeg` 只在"腿开始"那一刻调一次**（扣料并返回倍率），倍率由调用方**存进那一趟的
 * 任务状态**（`fuelMul` 字段），此后每拍只做 `jumpFuelLegMsOf(base, fuelMul)` 的纯折算。
 *
 * ⚠ **探索扫描不在开关里**：无人扫描艇**没有航行段**（`explore.ts`：总时长 = 就地扫描窗口），
 * 燃料对它无意义 —— 这一条已回报船长。
 */
import type { GameState } from './state'
import type { AiCoreType } from './types'
import { addLog, MAX_SKILL_LEVEL } from './state'
import { countWare, removeWare } from './inventory'

/** 燃料物品 id（`packages/data/src/items.ts` 的 `CONSUMABLES`） */
export const JUMP_FUEL_ITEM_ID = 'jump-fuel'

/** 加速倍率：返航速度 ×10（= 时长 ÷10）——船长 2026-09-29「开启效果为返航速度*10」 */
export const JUMP_FUEL_SPEED_MUL = 10

/** 哪些活动可以吃燃料（**探索扫描不在内**：无航行段，见文件头注） */
export type JumpFuelActivity = 'mine' | 'salvage' | 'expedition' | 'ai'

export const JUMP_FUEL_ACTIVITIES: readonly JumpFuelActivity[] = ['mine', 'salvage', 'expedition', 'ai']

/** 活动 id → 文案 id（界面「跃迁燃料」页的开关行；中英双语在 `l10n/table.ts`） */
export const JUMP_FUEL_ACTIVITY_TEXT_ID: Readonly<Record<JumpFuelActivity, string>> = {
  mine: 'ui.jumpFuel.001',
  salvage: 'ui.jumpFuel.002',
  expedition: 'ui.jumpFuel.003',
  ai: 'ui.jumpFuel.004',
}

/** 本活动是否开着燃料（缺省 = 关） */
export function jumpFuelEnabledOf(state: GameState, activity: JumpFuelActivity): boolean {
  return state.jumpFuel?.[activity] === true
}

/* ───────── 燃料上限（**2026-09-30 船长令**：「只需要显示上限多少……打算添加2个增加燃料上限的技能」） ───────── */

/**
 * **燃料仓库上限基准**（单位）。
 *
 * ⚠ **口径（船长 2026-09-30 两连裁定）**：「**只算仓库，就是只算仓库，不算任何舰船库存**」——
 * 上限与库存读数**都只看物品仓库**（`state.warehouse.items`），驾驶船货仓不参与；
 * 且燃料**普通舰船货仓装不进去**（`ItemDef.holdForbidden`，见 `data/items.ts`），
 * 所以"货仓里的燃料"正常情况下恒为 0（老档残留由读档迁移归仓，见 `save.ts`）。
 */
export const JUMP_FUEL_CAP_BASE = 6_000

/**
 * **提高燃料上限的技能**（声明式表 —— 船长 2026-09-30 问「新功能是否模块化？降低耦合」的落法之一：
 * **加技能 = 表里加一行**，上限算法与界面都不用改）。
 *
 * 叠加口径 = **乘算**（两条满级 1.5 × 1.5 = 2.25 ⇒ 上限 13,500）。
 */
export const JUMP_FUEL_CAP_SKILLS: readonly { readonly id: string; readonly perLevel: number }[] = [
  { id: 'fuel-tank-structure', perLevel: 0.1 }, // 储罐结构学（rank 2）：上限每级 +10%
  { id: 'orbital-fuel-depot', perLevel: 0.1 }, // 轨道储备库学（rank 4，前置储罐结构学）：上限每级再 +10%（与前者乘算）
]

/** 燃料上限（单位，已含技能；向下取整到整数单位） */
export function jumpFuelCapOf(state: GameState): number {
  let cap = JUMP_FUEL_CAP_BASE
  for (const s of JUMP_FUEL_CAP_SKILLS) {
    const lv = Math.min(MAX_SKILL_LEVEL, state.skills.trained[s.id] ?? 0)
    if (lv > 0) cap *= 1 + s.perLevel * lv
  }
  return Math.floor(cap)
}

/** **物品仓库里的燃料量**（上限与读数唯一的一把尺；不含任何舰船库存） */
export function jumpFuelWareOf(state: GameState): number {
  return countWare(state, JUMP_FUEL_ITEM_ID)
}

/**
 * 燃料库存 = **物品仓库量**。
 *
 * ⚠ **2026-09-30 船长令改口径**（原为"仓库 ＋ 当前驾驶船货仓"，与精炼炉"货仓＋仓库"同尺）：
 * 「**只算仓库，就是只算仓库，不算任何舰船库存**」——配合"燃料装不进普通货仓"（`ItemDef.holdForbidden`），
 * 现在这条与 `jumpFuelWareOf` 同值；保留本函数名是为了不动既有调用点与用例。
 */
export function jumpFuelStockOf(state: GameState): number {
  return jumpFuelWareOf(state)
}

/** 还能再装多少（上限 − 仓库现有；不小于 0） */
export function jumpFuelHeadroomOf(state: GameState): number {
  return Math.max(0, jumpFuelCapOf(state) - jumpFuelWareOf(state))
}

/** 仓库是否已到上限（**实验室停线判据**；见 `lab.ts` 的 `advanceLab`） */
export function jumpFuelWareFull(state: GameState): boolean {
  return jumpFuelWareOf(state) >= jumpFuelCapOf(state)
}

/** 一把把"原返航时长"折算成实际时长（纯函数；`fuelMul` ∈ {1, 10}） */
export function jumpFuelLegMsOf(baseMs: number, fuelMul: number): number {
  const mul = Number.isFinite(fuelMul) && fuelMul > 1 ? fuelMul : 1
  return Math.max(1, Math.round(Math.max(0, baseMs) / mul))
}

/**
 * **返航腿开始**：判定本趟要不要吃燃料 ⇒ 要吃就**当场扣料**并返回倍率（`JUMP_FUEL_SPEED_MUL`），
 * 否则返回 1（不加速、不扣料）。
 *
 * @param baseReturnMs **原返航时长**（不含燃料；含货仓占比缩放的那一份）
 */
export function beginJumpFuelLeg(state: GameState, activity: JumpFuelActivity, baseReturnMs: number): number {
  if (!jumpFuelEnabledOf(state, activity)) return 1
  const seconds = Math.ceil(Math.max(0, baseReturnMs) / 1000)
  if (seconds <= 0) return 1
  const stock = jumpFuelWareOf(state)
  if (stock < seconds) return 1
  /**
   * ⚠ **只从物品仓库扣**（**2026-09-30 船长令**：「不算任何舰船库存」）：原先"货仓优先、再扣仓库"，
   * 现在燃料**装不进普通货仓**（`ItemDef.holdForbidden`）⇒ 货仓那份恒为 0，直接走仓库一条路。
   */
  removeWare(state, JUMP_FUEL_ITEM_ID, seconds)
  addLog(
    state,
    'fleet',
    `✦ 跃迁燃料点火：本趟返航 ${fmtSec(baseReturnMs)} → ${fmtSec(jumpFuelLegMsOf(baseReturnMs, JUMP_FUEL_SPEED_MUL))}（消耗 ${seconds.toLocaleString('zh-CN')} 单位，余 ${(stock - seconds).toLocaleString('zh-CN')}）。`,
    'core.jumpFuel.001',
    {
      p1: fmtSec(baseReturnMs),
      p2: fmtSec(jumpFuelLegMsOf(baseReturnMs, JUMP_FUEL_SPEED_MUL)),
      p3: seconds.toLocaleString('zh-CN'),
      p4: (stock - seconds).toLocaleString('zh-CN'),
    },
  )
  return JUMP_FUEL_SPEED_MUL
}

/** 实验室内单条产线的劳动者（与精炼炉同款：主控亲自运转 / AI 核心驱动） */
export type LabWorker = 'pilot' | AiCoreType

function fmtSec(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest > 0 ? `${m} 分 ${rest} 秒` : `${m} 分`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h} 小时 ${rm} 分` : `${h} 小时`
}
