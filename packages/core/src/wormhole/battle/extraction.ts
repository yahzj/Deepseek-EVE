import type { SimContext } from '../../types'
import type { WormholeRunState } from '../../wormhole'
import { wormholeLootValueIsk, wormholeCoreTypeOfItemId, wormholeDeliverRelics, WORMHOLE_ESSENCE_PER_DEVICE, WORMHOLE_ESSENCE_ITEM_ID } from '../../wormholeSalvage'
import { type GameState, addLog } from '../../state'
import { gainAiCore, aiCoreName } from '../../ai'
import { addWare } from '../../inventory'

export function bagValueIsk(ctx: SimContext, run: WormholeRunState): number {
  let v = 0
  for (const slot of run.bag) {
    const units = Math.max(0, Math.floor(slot.units))
    if (units <= 0) continue
    if (slot.itemId.startsWith('wreck-')) v += wormholeLootValueIsk(ctx, slot.itemId, units)
    else v += units * (ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0)
  }
  return v
}

export function deliverWormholeCores(
  state: GameState,
  ids: readonly string[],
): Partial<Record<'gamma' | 'beta' | 'alpha', number>> {
  const cores: Partial<Record<'gamma' | 'beta' | 'alpha', number>> = {}
  for (const id of ids) {
    const type = wormholeCoreTypeOfItemId(id)
    if (!type) continue
    gainAiCore(state, type)
    cores[type] = (cores[type] ?? 0) + 1
  }
  if (Object.keys(cores).length > 0) {
    const text = (['alpha', 'beta', 'gamma'] as const)
      .filter((t) => (cores[t] ?? 0) > 0)
      .map((t) => `${aiCoreName(t)}×${cores[t]}`)
      .join('、')
    addLog(
      state,
      'combat',
      `🕳 带回 ${text}：已直接接入核心库（不占货仓、不入仓库）。`,
      'core.wormholeBattle.021',
      { p1: text },
    )
  }
  return cores
}

export function deliverExtraction(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  if (run.supplyVersion === 1 && run.supplies) {
    for (const [id, n] of Object.entries(run.supplies.items)) addWare(state, id, n)
  }
  let isk = 0
  let recycle = 0
  let oreUnits = 0
  for (const slot of run.bag) {
    const units = Math.floor(slot.units)
    const isWreck = slot.itemId.startsWith('wreck-')
    const price = ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0
    isk += isWreck ? 0 : units * price
    if (!isWreck) oreUnits += units
    if (isWreck) recycle += wormholeLootValueIsk(ctx, slot.itemId, units)
    if (units > 0) addWare(state, slot.itemId, units)
  }
  addLog(
    state,
    'combat',
    `🕳 撤离成功：货仓 ${run.bag.length} 类物资入港` +
      (isk > 0 ? `（按基础价约 ${Math.round(isk).toLocaleString('zh-CN')} 信用点）` : '') +
      (recycle > 0 ? `（残骸拆解估值约 ${Math.round(recycle).toLocaleString('zh-CN')} 信用点）` : '') +
      `，第 ${run.depth} 层撤离。`,
  )
  const relics = [...(run.relics ?? [])]
  if (relics.length > 0) wormholeDeliverRelics(state, ctx, relics)
  const boxes = (run.hold?.placements ?? [])
    .filter((p) => p.kind === 'box')
    .map((p) => p.itemId)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter')
  const tempPlacements = run.tempGrid?.placements ?? []
  const tempUnits = new Map<string, number>()
  for (const p of tempPlacements) {
    tempUnits.set(p.itemId, (tempUnits.get(p.itemId) ?? 0) + Math.max(0, Math.floor(p.units ?? 0)))
  }
  const coreIds = boxes.filter((id) => wormholeCoreTypeOfItemId(id) !== null)
  const cores = deliverWormholeCores(state, coreIds)
  const coresIsk = (['gamma', 'beta', 'alpha'] as const).reduce(
    (s, t) => s + (cores[t] ?? 0) * (ctx.marketGoods.get(`core-${t}`)?.basePrice ?? 0),
    0,
  )
  const matterDevices = (run.hold?.placements ?? []).reduce(
    (n, p) => n + (ctx.items.get(p.itemId)?.kind === 'matter' ? Math.max(1, Math.floor(p.units ?? 1)) : 0),
    0,
  )
  const essences = matterDevices * WORMHOLE_ESSENCE_PER_DEVICE
  if (essences > 0) {
    addWare(state, WORMHOLE_ESSENCE_ITEM_ID, essences)
    const essenceName = ctx.items.get(WORMHOLE_ESSENCE_ITEM_ID)?.name ?? '虫洞谜质'
    addLog(
      state,
      'combat',
      `谜质装置${matterDevices}件析出${essences}枚${essenceName}，已入仓库。`,
      'core.explorationStatus.006',
      { p1: matterDevices, p2: essences, p3: essenceName },
    )
  }
  const essenceIsk = essences * (ctx.marketGoods.get(WORMHOLE_ESSENCE_ITEM_ID)?.basePrice ?? 0)
  const boxesAll = boxes
    .filter((id) => wormholeCoreTypeOfItemId(id) === null)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter')
  if (boxesAll.length > 0) wormholeDeliverRelics(state, ctx, boxesAll)
  if (tempPlacements.length > 0) {
    addLog(
      state,
      'combat',
      `🕳 撤离放弃：临时空间里的 ${tempUnits.size} 类物资留在洞里（未整理的按丢弃处理）。`,
      'core.wormholeBattle.022',
      { p1: tempUnits.size },
    )
  }
  state.wormhole.lastSettle = {
    kind: 'extract',
    ...(run.expeditionRules === 2 ? { expeditionGoal: run.expeditionGoal, expeditionProgress: run.expeditionProgress } : {}),
    ...(run.supplyVersion === 1 && run.supplies ? {
      suppliesReturned: { ...run.supplies.items }, suppliesUsed: { ...run.supplies.consumed },
      suppliesFound: { ...run.supplies.found },
    } : {}),
    depth: run.depth,
    oreUnits,
    oreIsk: isk,
    wreckIsk: recycle,
    boxes: boxesAll,
    relics,
    ...(coreIds.length > 0 ? { cores, coresIsk } : {}),
    ...(essences > 0 ? { essences, ...(essenceIsk > 0 ? { essenceIsk } : {}) } : {}),
    shipsLost: [],
    lostIsk: 0,
  }
}
