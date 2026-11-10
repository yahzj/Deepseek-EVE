import type { GameState, WormholeStockItem } from '../state'
import type { SimContext } from '../types'
import { tuningMul } from '../tuning'

/** 后台推演提交前核对所有能力/产出输入；时钟与无关日志不使计算失效。 */
export function signalAutoInputKey(state: GameState, ctx: SimContext, ids: readonly string[], signal: WormholeStockItem): string {
  const kitIds = new Set([...ctx.modules.values()].flatMap(mod => mod.repairKit ? [mod.repairKit] : []))
  const supplies = Object.entries(state.warehouse.items).filter(([id]) => {
    const kind = ctx.items.get(id)?.kind
    return kind === 'ammo' || kind === 'drone' || id.startsWith('repairkit-') || kitIds.has(id)
  }).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([signal, ids.map(id => [id, state.fleet[id]]), state.skills.trained,
    state.research?.levels ?? {}, state.resupplyFromWarehouse !== false, supplies,
    tuningMul(state, 'rareWreckVolume')])
}
