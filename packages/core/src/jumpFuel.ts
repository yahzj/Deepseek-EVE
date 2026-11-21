import { ceilFinalQuantity } from './quantity'
import type { GameState } from './state'
import type { AiCoreType } from './types'
import { addLog, MAX_SKILL_LEVEL } from './state'
import { countWare, removeWare } from './inventory'

export const JUMP_FUEL_ITEM_ID = 'jump-fuel'

export const JUMP_FUEL_SPEED_MUL = 10

export type JumpFuelActivity = 'mine' | 'salvage' | 'expedition' | 'ai'

export const JUMP_FUEL_ACTIVITIES: readonly JumpFuelActivity[] = ['mine', 'salvage', 'expedition', 'ai']

export const JUMP_FUEL_ACTIVITY_TEXT_ID: Readonly<Record<JumpFuelActivity, string>> = {
  mine: 'ui.jumpFuel.001',
  salvage: 'ui.jumpFuel.002',
  expedition: 'ui.jumpFuel.003',
  ai: 'ui.jumpFuel.004',
}

export function jumpFuelEnabledOf(state: GameState, activity: JumpFuelActivity): boolean {
  return state.jumpFuel?.[activity] === true
}


export const JUMP_FUEL_CAP_BASE = 60_000

export const JUMP_FUEL_CAP_SKILLS: readonly { readonly id: string; readonly perLevel: number }[] = [
  { id: 'fuel-tank-structure', perLevel: 0.1 },
  { id: 'orbital-fuel-depot', perLevel: 0.1 },
]

export function jumpFuelCapOf(state: GameState): number {
  let cap = JUMP_FUEL_CAP_BASE
  for (const s of JUMP_FUEL_CAP_SKILLS) {
    const lv = Math.min(MAX_SKILL_LEVEL, state.skills.trained[s.id] ?? 0)
    if (lv > 0) cap *= 1 + s.perLevel * lv
  }
  return ceilFinalQuantity(cap)
}

export function jumpFuelWareOf(state: GameState): number {
  return countWare(state, JUMP_FUEL_ITEM_ID)
}

export function jumpFuelStockOf(state: GameState): number {
  return jumpFuelWareOf(state)
}

export function jumpFuelHeadroomOf(state: GameState): number {
  return Math.max(0, jumpFuelCapOf(state) - jumpFuelWareOf(state))
}

export function jumpFuelWareFull(state: GameState): boolean {
  return jumpFuelWareOf(state) >= jumpFuelCapOf(state)
}

export function jumpFuelLegMsOf(baseMs: number, fuelMul: number): number {
  const mul = Number.isFinite(fuelMul) && fuelMul > 1 ? fuelMul : 1
  return Math.max(1, Math.round(Math.max(0, baseMs) / mul))
}

export function beginJumpFuelLeg(state: GameState, activity: JumpFuelActivity, baseReturnMs: number): number {
  if (!jumpFuelEnabledOf(state, activity)) return 1
  const seconds = Math.ceil(Math.max(0, baseReturnMs) / 1000)
  if (seconds <= 0) return 1
  const stock = jumpFuelWareOf(state)
  if (stock < seconds) return 1
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
