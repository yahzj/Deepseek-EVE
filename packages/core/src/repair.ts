import type { GameState } from './state'
import type { SimContext } from './types'

export function repairCapacityMulOf(max: { a: number; h: number }, base: { armorHp?: number; hullHp?: number }): { a: number; h: number } {
  return { a: (base.armorHp ?? 0) > 0 ? max.a / base.armorHp! : 1,
    h: (base.hullHp ?? 0) > 0 ? max.h / base.hullHp! : 1 }
}

export function quickRepairFactor(state: GameState, ctx: SimContext): number {
  let sum = 0
  for (const s of ctx.balance.repair.quickRepairSkills) {
    sum += s.perLevel * Math.min(5, state.skills.trained[s.id] ?? 0)
  }
  return 1 + sum
}
