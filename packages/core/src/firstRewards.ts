/**
 * **「第一次」任务的奖励发放**（2026-09-18 船长逐条裁定奖励表后，从头注释里的 `grantFirstReward` 拆出来）。
 *
 * 为什么单独一件：奖励要落进**六个不同的口袋**——蓝图书（`blueprintStock`）· 仓库物品（`warehouse.items`）·
 * 装备库（`moduleBay`）· 机库（`fleet`，需按同型自动编号）· AI 核心账本（`aiCores`）· 虫洞库存（`wormholeStock`）——
 * 而 `inventory` / `shipyard` / `wormholeScan` 三个写入方**都反向依赖 `firstTasks`**（用 `bumpFirst` 记数），
 * 所以那几处 import 只能放在这个**没人反向依赖**的模块里；`firstTasks.ts` 继续保持"零运行期 import"。
 *
 * 口径：奖励只在任务**首次完成**那一次发放（去重键 = `importantTasks[id].done`，由调用方保证）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import type { FirstTaskDef } from './firstTasks'
import { addWare } from './inventory'
import { addShipToFleet } from './shipyard'
import { grantWormholeStock } from './wormholeScan'
import { addLog } from './state'

/** 玩家可见的发放日志（一句话；说明文案口径：不写原因解释、短句陈述） */
function grantLog(name: string): string {
  return `◆ 任务奖励已发放：${name}。`
}

/** 按任务定义把奖励逐项落袋；`nameOf` 由调用方给（本模块不查内容表，避免再拉依赖） */
export function grantFirstReward(
  state: GameState,
  ctx: SimContext,
  def: FirstTaskDef,
  nameOf: (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string) => string,
): void {
  const r = def.reward
  if (!r) return
  const granted: string[] = []

  for (const b of r.blueprints ?? []) {
    state.blueprintStock[b.blueprintId] = (state.blueprintStock[b.blueprintId] ?? 0) + b.units
    granted.push(`${nameOf('blueprint', b.blueprintId)} ×${b.units}`)
  }
  for (const w of r.ware ?? []) {
    addWare(state, w.itemId, w.units)
    granted.push(`${nameOf('ware', w.itemId)} ×${w.units}`)
  }
  for (const m of r.modules ?? []) {
    state.moduleBay[m.moduleId] = (state.moduleBay[m.moduleId] ?? 0) + m.units
    granted.push(`${nameOf('module', m.moduleId)} ×${m.units}`)
  }
  for (const s of r.ships ?? []) {
    for (let i = 0; i < s.units; i++) addShipToFleet(state, s.defId)
    granted.push(`${nameOf('ship', s.defId)} ×${s.units}`)
  }
  for (const c of r.aiCores ?? []) {
    // 与 `ai.gainAiCore` 同口径（**核心不进仓库**，直接进账本）；此处就地写以避开反向依赖
    state.aiCores[c.type] = (state.aiCores[c.type] ?? 0) + c.units
    granted.push(`基础 AI 核心 ×${c.units}`)
  }
  if (r.wormholeStock !== undefined && r.wormholeStock > 0) {
    const n = grantWormholeStock(state, ctx, r.wormholeStock)
    granted.push(`未探索虫洞 ×${n}`)
  }
  if (r.isk !== undefined && r.isk > 0) {
    state.wallet.isk += r.isk
    granted.push(`${r.isk.toLocaleString('zh-CN')} 信用点`)
  }

  if (granted.length > 0) addLog(state, 'trade', grantLog(granted.join('、')))
}
