import { ceilFinalQuantity } from './quantity'
import type { GameState } from './state'
import type { SimContext } from './types'
import type { FirstReward, FirstTaskDef } from './firstTasks'
import { FIRST_TASKS, isFirstTaskCurrent, visibleFirstTasks } from './firstTasks'
import { addWare } from './inventory'
import { addShipToFleet } from './shipyard'
import { grantWormholeStock } from './wormholeScan'
import { addLog } from './state'

function nameOfFrom(ctx: SimContext) {
  return (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string): string =>
    kind === 'blueprint'
      ? (ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
      : kind === 'ware'
        ? (ctx.items.get(id)?.name ?? id)
        : kind === 'module'
          ? (ctx.modules.get(id)?.name ?? id)
          : (ctx.ships.get(id)?.name ?? id)
}

function grantLog(name: string): string {
  return `◆ 任务奖励已发放：${name}。`
}
function startGrantLog(name: string): string {
  return `◆ 任务起手道具已发放：${name}。`
}

export function grantFirstPocket(
  state: GameState,
  ctx: SimContext,
  def: FirstTaskDef,
  pocket: 'reward' | 'startReward',
  nameOf: (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string) => string,
): void {
  const r: FirstReward | undefined = pocket === 'reward' ? def.reward : def.startReward
  if (!r) return
  const granted: string[] = []

  for (const b of r.blueprints ?? []) {
    const units = ceilFinalQuantity(b.units)
    state.blueprintStock[b.blueprintId] = (state.blueprintStock[b.blueprintId] ?? 0) + units
    granted.push(`${nameOf('blueprint', b.blueprintId)} ×${units}`)
  }
  for (const w of r.ware ?? []) {
    const units = ceilFinalQuantity(w.units)
    addWare(state, w.itemId, units)
    granted.push(`${nameOf('ware', w.itemId)} ×${units}`)
  }
  for (const m of r.modules ?? []) {
    const units = ceilFinalQuantity(m.units)
    state.moduleBay[m.moduleId] = (state.moduleBay[m.moduleId] ?? 0) + units
    granted.push(`${nameOf('module', m.moduleId)} ×${units}`)
  }
  for (const s of r.ships ?? []) {
    const units = ceilFinalQuantity(s.units)
    for (let i = 0; i < units; i++) addShipToFleet(state, s.defId)
    granted.push(`${nameOf('ship', s.defId)} ×${units}`)
  }
  for (const c of r.aiCores ?? []) {
    const units = ceilFinalQuantity(c.units)
    state.aiCores[c.type] = (state.aiCores[c.type] ?? 0) + units
    granted.push(`基础 AI 核心 ×${units}`)
  }
  if (r.wormholeStock !== undefined && r.wormholeStock > 0) {
    const n = grantWormholeStock(state, ctx, r.wormholeStock)
    granted.push(`未探索虫洞 ×${n}`)
  }
  if (r.isk !== undefined && r.isk > 0) {
    const isk = ceilFinalQuantity(r.isk)
    state.wallet.isk += isk
    granted.push(`${isk.toLocaleString('zh-CN')} 信用点`)
  }

  if (granted.length > 0) {
    const names = granted.join('、')
    const textId = pocket === 'reward' ? 'core.firstRewards.001' : 'core.firstRewards.007'
    addLog(state, 'trade', (pocket === 'reward' ? grantLog : startGrantLog)(names), textId, { p1: names })
  }
}

export function grantFirstReward(
  state: GameState,
  ctx: SimContext,
  def: FirstTaskDef,
  nameOf: (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string) => string,
): void {
  grantFirstPocket(state, ctx, def, 'reward', nameOf)
}

export function grantStartRewardsForCurrent(state: GameState, ctx: SimContext): string[] {
  const nameOf = nameOfFrom(ctx)
  const out: string[] = []
  for (const def of visibleFirstTasks(state)) {
    if (!def.startReward) continue
    if (state.importantTasks[def.id]?.started === true) continue
    grantFirstPocket(state, ctx, def, 'startReward', nameOf)
    state.importantTasks[def.id] = { ...(state.importantTasks[def.id] ?? {}), started: true }
    out.push(def.id)
  }
  return out
}

export interface ClaimFirstTaskResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  started?: string[]
}

export function claimFirstTask(state: GameState, ctx: SimContext, id: string): ClaimFirstTaskResult {
  const def = FIRST_TASKS.find((d) => d.id === id)
  if (!def) return { ok: false, error: `未知任务：${id}。`, errorId: 'core.firstRewards.002', errorParams: { p1: id } }
  if (state.importantTasks[id]?.done === true) {
    return { ok: false, error: '这条任务已经完成过了。', errorId: 'core.firstRewards.003' }
  }
  if (!isFirstTaskCurrent(state, id)) {
    return { ok: false, error: '这条任务还没轮到：先完成当前那一条。', errorId: 'core.firstRewards.004' }
  }
  if (def.judge(state, ctx) < 1) {
    return { ok: false, error: '这条任务的条件还没达成。', errorId: 'core.firstRewards.005' }
  }
  state.importantTasks[id] = { ...(state.importantTasks[id] ?? {}), done: true }
  grantFirstPocket(state, ctx, def, 'reward', nameOfFrom(ctx))
  const started = grantStartRewardsForCurrent(state, ctx)
  addLog(state, 'info', `◆ 任务完成：「${def.title}」。`, 'core.firstRewards.006', { p1: def.title })
  return { ok: true, started }
}
