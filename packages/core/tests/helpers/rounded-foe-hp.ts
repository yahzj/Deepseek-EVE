import type { FoeShipSlot } from '../../src/types'
import { ceilFinalQuantity } from '../../src/quantity'

/** 按已确认的族格与逐层取整规则独立计算测试期望，不调用敌舰建档。 */
export function roundedFoeHp(slot: FoeShipSlot, strength = 1) {
  const split = slot.split ?? slot.ship.split
  const base = slot.ship.hp * (slot.hpMul ?? 1) * strength * 1.5 * (slot.ship.family === 'C' ? 1.3 : 1)
  return { s: ceilFinalQuantity(base * split.s), a: ceilFinalQuantity(base * split.a), h: ceilFinalQuantity(base * split.h) }
}
