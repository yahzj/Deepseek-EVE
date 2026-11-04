/** 功能域职责拆分，保持原计算与顺序。 */
import type { DamageType, SimContext } from '../../types'
import { type GameState, addLog } from '../../state'
import type { CommandResult } from '../../engine'
import { ammoTiersOf } from '../../ammoTiers'

/** 弹药 MK2 档位三族键 */
export const AMMO_TYPES: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']

/**
 * 弹药档位设置（2026-09-09 船长拍板：出战前选档——装配页按弹族选基础弹/弹药 MK2；
 * **取档口径 2026-09-16 船长改判**：开战按"同族取能装得最多的一档"装载（装不满也照装），
 * 旧口径「库存不足整族回退基础弹」**已作废**（细则见 `combat.resolveAmmoTier`）；
 * 连打/离线同源消耗当前配置）。
 * itemId = null → 恢复基础弹（删键）。shipId 缺省 = 当前驾驶船。
 */
export function setAmmoTier(
  state: GameState,
  ctx: SimContext,
  type: DamageType,
  itemId: string | null,
  shipId: string = state.shipId,
): CommandResult {
  const fleet = state.fleet[shipId]
  if (!fleet) return { ok: false, error: '舰队里找不到该舰船，无法设置弹药档位。', errorId: 'core.equipment.006' }
  if (!AMMO_TYPES.includes(type)) return { ok: false, error: '未知弹药类型。', errorId: 'core.equipment.017' }
  if (itemId !== null) {
    const def = ctx.items.get(itemId)
    if (!def || def.kind !== 'ammo') return { ok: false, error: '只能选择弹药物品。', errorId: 'core.equipment.018' }
    if (def.damageType !== type) {
      return {
        ok: false,
        error: `${def.name} 不属于 ${type} 系弹药。`,
        errorId: 'core.equipment.019',
        errorParams: { p1: def.name, p2: type },
      }
    }
    if (!ammoTiersOf(ctx, type).some(item => item.id === itemId)) {
      return {
        ok: false,
        error: `${def.name} 不是可选的弹药档位。`,
        errorId: 'core.equipment.020',
        errorParams: { p1: def.name },
      }
    }
  }
  const pref = { ...(fleet.ammoPref ?? {}) }
  if (itemId === null) delete pref[type]
  else pref[type] = itemId
  fleet.ammoPref = Object.keys(pref).length > 0 ? pref : undefined
  const name = itemId === null ? '基础弹' : (ctx.items.get(itemId)?.name ?? itemId)
  addLog(
    state,
    'fleet',
    `已设${type}系弹药档位：${name}（开战按此预载）。`,
    'core.equipment.025',
    { p1: type, p2: name },
  )
  return { ok: true }
}
