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
import { addLog } from './state'
import { countItem, countWare, removeItem, removeWare } from './inventory'

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

/** 燃料库存 = 物品仓库 ＋ 当前驾驶船货仓（与精炼炉"货仓＋仓库"同一把尺） */
export function jumpFuelStockOf(state: GameState): number {
  return countWare(state, JUMP_FUEL_ITEM_ID) + countItem(state, JUMP_FUEL_ITEM_ID)
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
  const stock = jumpFuelStockOf(state)
  if (stock < seconds) return 1
  let left = seconds
  const inCargo = Math.min(left, countItem(state, JUMP_FUEL_ITEM_ID))
  if (inCargo > 0) {
    removeItem(state, JUMP_FUEL_ITEM_ID, inCargo)
    left -= inCargo
  }
  if (left > 0) removeWare(state, JUMP_FUEL_ITEM_ID, left)
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
