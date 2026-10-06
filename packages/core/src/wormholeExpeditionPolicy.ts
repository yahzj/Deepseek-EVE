import type { GameState } from './state'
import type { SimContext } from './types'
import { gridCellAt, hasLiveFoe, hexDistance, revealOf, wormholeHash32 } from './wormholeGrid'
import { wormholeDescend, wormholeGridScan, wormholeScanBonusOf } from './wormhole'
import { advanceWormhole, wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from './wormholeBattle'
import { wormholeEventPreview, wormholeResolveEvent, wormholeFreezeEvents, type WormholeEventAction } from './wormholeExpedition'
import { wormholeGroundBoard } from './wormholeGround'
import { wormholeHoldUsage, wormholeLeaveHoldPiece, wormholeLeaveSupply, wormholeLootTierOf, wormholeTempStowPiece } from './wormholeSalvage'
import { wormholeExtractionPlan, wormholeConfirmExtraction } from './wormholeExtraction'
import { ammoLoadTotals } from './combatAmmo'
import { createPlayerSpec } from './playerSpec'

export interface WormholePolicyLayer {
  depth: number
  stage: 'entry' | 'guard-before' | 'guard-after' | 'exit'
  turns: number
  ships: Array<{ id: string; armor: number; hull: number; drones: Record<string, number> }>
  supplies: Record<string, number>
  consumed: Record<string, number>
  found: Record<string, number>
  used: number
  capacity: number
  alert: number
  patrols: number
}
export interface WormholePolicyResult {
  state: GameState
  reachedDepth: number
  guardClearedDepth: number
  extracted: boolean
  failure?: string
  battles: number
  steps: number
  layers: WormholePolicyLayer[]
}

function snapshot(state: GameState, ctx: SimContext, stage: WormholePolicyLayer['stage']): WormholePolicyLayer {
  const run = state.wormhole.run!
  const usage = wormholeHoldUsage(state, ctx)
  return {
    depth: run.depth, stage, turns: run.turnsLeft,
    ships: run.fleet.map(id => ({ id, armor: state.fleet[id]?.armorPct ?? 1, hull: state.fleet[id]?.durability ?? 0, drones: { ...state.fleet[id]?.droneLoad } })),
    supplies: { ...run.supplies?.items }, consumed: { ...run.supplies?.consumed }, found: { ...run.supplies?.found },
    used: usage.used, capacity: usage.capacity, alert: run.alertLevel ?? 0, patrols: run.patrolsSpawned ?? 0,
  }
}

function loadGround(state: GameState, ctx: SimContext): void {
  const run = state.wormhole.run!
  const pieces = [...(wormholeGroundBoard(run)?.placements ?? [])].sort((a, b) => {
    const priority = (id: string): number => id.startsWith('ammo-') || id.startsWith('repairkit-') || ctx.items.get(id)?.kind === 'drone' ? 3 : wormholeLootTierOf(id)
    return priority(b.itemId) - priority(a.itemId) || a.id.localeCompare(b.id)
  })
  for (const piece of pieces) wormholeTempStowPiece(state, ctx, piece.id)
}

function eventAction(state: GameState, ctx: SimContext): WormholeEventAction {
  const run = state.wormhole.run!
  const key = run.pendingEvent!.key
  const available = (...actions: WormholeEventAction[]): WormholeEventAction | undefined => actions.find(a => wormholeEventPreview(state, ctx, a).ok)
  if (key === 'maintenance') {
    const damaged = run.fleet.some(id => (state.fleet[id]?.armorPct ?? 1) < 0.85 || (state.fleet[id]?.durability ?? 0) < 0.85)
    return (damaged ? available('repair', 'search') : available('search')) ?? 'bypass'
  }
  if (key === 'transport') return available('supply', 'container') ?? 'bypass'
  if (key === 'controller' || key === 'relay') return available('investigate') ?? 'bypass'
  if (key === 'storm') return available('wait') ?? 'bypass'
  const response = wormholeEventPreview(state, ctx, 'respond')
  if (response.identity === 'genuine') return available('respond') ?? 'reject'
  if (response.identity === 'ambush') return 'reject'
  return available('verify') ?? 'reject'
}

function supplyEmpty(state: GameState, ctx: SimContext): boolean {
  const run = state.wormhole.run!
  let needsAmmo = false
  let hasOtherOutput = false
  for (const uid of run.fleet) {
    const spec = createPlayerSpec(state, ctx, uid)
    if (!spec) continue
    if (Object.keys(ammoLoadTotals(spec, ctx.balance.battle, state)).length > 0) needsAmmo = true
    if (spec.weapons.some(w => w.src === 'drone')) hasOtherOutput = true
  }
  return needsAmmo && !hasOtherOutput && !Object.entries(run.supplies?.items ?? {}).some(([id, n]) => id.startsWith('ammo-') && n > 0)
}

function extract(state: GameState, ctx: SimContext): boolean {
  let plan = wormholeExtractionPlan(state, ctx, { leavePieces: [], leaveSupplies: {}, takeGround: [] })
  if (plan.code === 'capacity') {
    const pieces = [...(state.wormhole.run?.hold?.placements ?? [])].sort((a, b) => wormholeLootTierOf(a.itemId) - wormholeLootTierOf(b.itemId))
    for (const piece of pieces) {
      if (!wormholeHoldUsage(state, ctx).overload) break
      wormholeLeaveHoldPiece(state, ctx, piece.id)
    }
    for (const [id, n] of Object.entries(state.wormhole.run?.supplies?.items ?? {})) {
      if (!wormholeHoldUsage(state, ctx).overload) break
      wormholeLeaveSupply(state, ctx, id, n)
    }
    plan = wormholeExtractionPlan(state, ctx, { leavePieces: [], leaveSupplies: {}, takeGround: [] })
  }
  return wormholeConfirmExtraction(state, ctx, plan).ok
}

/** 只对已抵达且出口已知的守卫预估，独立采样不能读取实际未来随机序列。 */
export function wormholeGuardRiskPreview(state: GameState, ctx: SimContext): { available: boolean; wins: number; samples: number; safe: boolean } {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !run.grid?.exitKnown || run.battle || run.pendingNodeBattle || run.pendingRuinsBattle || run.grid.pos.q !== run.grid.exit.q || run.grid.pos.r !== run.grid.exit.r || (run.bossCleared ?? 0) >= run.depth) return { available: false, wins: 0, samples: 0, safe: false }
  let wins = 0
  for (let sample = 0; sample < 3; sample++) {
    const staged = structuredClone(state)
    staged.rng.seed = wormholeHash32((run.seed ?? 1) ^ Math.imul(run.depth, 7919) ^ Math.imul(sample + 1, 104729)) || 1
    if (!wormholeStartBattle(staged, ctx, 'boss').ok) continue
    for (let step = 0; staged.wormhole.run?.battle && step < 9000; step++) { staged.gameMs += 100; advanceWormhole(staged, ctx) }
    if (staged.wormhole.run && (staged.wormhole.run.bossCleared ?? 0) >= run.depth && staged.wormhole.run.fleet.length > 0) wins += 1
  }
  return { available: true, wins, samples: 3, safe: wins >= 2 }
}

/** 测试与自动共用；只从已扫描投影选路，旧玩法从不调用此策略。 */
export function wormholeRunExpeditionPolicy(
  initial: GameState, ctx: SimContext,
  opts?: { maxDepth?: number; policy?: 'deep' | 'recovery'; checkpoint?: (state: GameState) => GameState },
): WormholePolicyResult {
  let state = initial
  const out: WormholePolicyResult = { state, reachedDepth: state.wormhole.run?.depth ?? 0, guardClearedDepth: 0, extracted: false, battles: 0, steps: 0, layers: [] }
  const maxDepth = Math.max(1, Math.min(10, Math.floor(opts?.maxDepth ?? 10)))
  const entered = new Set<number>()
  const recovered = new Set<number>()
  const ignoredEvents = new Set<string>()
  let previousBattle: object | undefined
  try {
    for (let step = 0; step < 1200; step++) {
      out.steps = step + 1
      let run = state.wormhole.run
      if (!run) { out.extracted = state.wormhole.lastSettle?.kind === 'extract'; if (!out.extracted) out.failure = 'combat-loss'; break }
      if (run.expeditionRules !== 2 || run.supplyVersion !== 1 || !run.grid) { out.failure = 'unsupported-rules'; break }
      out.reachedDepth = Math.max(out.reachedDepth, run.depth)
      out.guardClearedDepth = Math.max(out.guardClearedDepth, run.bossCleared ?? 0)
      if (!entered.has(run.depth)) {
        entered.add(run.depth)
        out.layers.push(snapshot(state, ctx, 'entry'))
        if (opts?.checkpoint && [3, 7, 10].includes(run.depth)) { state = opts.checkpoint(state); run = state.wormhole.run! }
      }
      if (run.battle) {
        if (run.battle !== previousBattle) { out.battles += 1; previousBattle = run.battle }
        const before = state.gameMs
        while (state.wormhole.run?.battle && state.gameMs - before <= 900_000) { state.gameMs += 100; advanceWormhole(state, ctx) }
        if (state.wormhole.run?.battle) { out.failure = 'battle-timeout'; break }
        if (state.wormhole.run && (state.wormhole.run.bossCleared ?? 0) === state.wormhole.run.depth) out.layers.push(snapshot(state, ctx, 'guard-after'))
        continue
      }
      // 已知情报不指向未揭露的真实地点；事件库存只在到达后读。
      loadGround(state, ctx)
      const grid = run.grid!
      const here = gridCellAt(grid, grid.pos)!
      if (run.pendingRuinsBattle || run.pendingNodeBattle || hasLiveFoe(here)) {
        const result = wormholeStartBattle(state, ctx, run.pendingRuinsBattle ? 'ruins' : 'node')
        if (!result.ok) { out.failure = 'battle-failed'; break }
        continue
      }
      if (run.pendingEvent && !ignoredEvents.has(`${run.depth}:${run.pendingEvent.cellKey}`)) {
        const action = eventAction(state, ctx)
        const result = wormholeResolveEvent(state, ctx, action)
        if (!result.ok) { out.failure = `event-${result.error}`; break }
        if (action === 'bypass' || action === 'reject') ignoredEvents.add(`${run.depth}:${here.key}`)
        continue
      }
      if (run.turnsLeft <= 0 || supplyEmpty(state, ctx) || run.fleet.some(id => (state.fleet[id]?.durability ?? 0) < 0.35)) {
        out.layers.push(snapshot(state, ctx, 'exit'))
        out.failure = run.turnsLeft <= 0 ? 'out-of-turns' : supplyEmpty(state, ctx) ? 'supplies-exhausted' : 'survival-warning'
        out.extracted = extract(state, ctx)
        break
      }
      if (grid.exitKnown && here.q === grid.exit.q && here.r === grid.exit.r) {
        if ((run.bossCleared ?? 0) < run.depth) {
          const risk = wormholeGuardRiskPreview(state, ctx)
          if (!risk.safe) { out.failure = 'predicted-loss'; out.layers.push(snapshot(state, ctx, 'exit')); out.extracted = extract(state, ctx); break }
          out.layers.push(snapshot(state, ctx, 'guard-before'))
          if (!wormholeActivateAt(state, ctx).ok) { out.failure = 'guard-failed'; break }
        } else if (run.depth >= maxDepth) {
          out.guardClearedDepth = Math.max(out.guardClearedDepth, run.depth)
          out.layers.push(snapshot(state, ctx, 'exit'))
          out.extracted = extract(state, ctx)
          if (!out.extracted) out.failure = 'extraction-failed'
          break
        } else {
          const nextSeed = ((run.seed ?? 1) * 1664525 + run.depth * 1013904223) >>> 0
          if (!wormholeDescend(state, nextSeed, wormholeScanBonusOf(ctx, run.fleet), { confirmLeaveCargo: true }).ok) { out.failure = 'descend-failed'; break }
          wormholeFreezeEvents(state, ctx)
        }
        continue
      }
      if (here.place === 'ship' && !here.combatCleared) {
        if (!wormholeStartBattle(state, ctx, 'node').ok) { out.failure = 'battle-failed'; break }
        continue
      }
      const views = grid.cells.map(cell => ({ cell, visible: revealOf(grid, cell) })).map(row => ({ ...row, info: row.visible.kind === 'foe' ? row.visible.under : row.visible }))
      let target = grid.exitKnown ? gridCellAt(grid, grid.exit) : views.find(row => (row.info.kind === 'signal' || row.info.kind === 'known') && row.info.signal === 'beacon' && !grid.activated.includes(row.cell.key))?.cell
      if (opts?.policy === 'recovery' && !recovered.has(run.depth)) {
        if ((here.place === 'ruins' || here.place === 'graveyard') && !grid.activated.includes(here.key)) {
          const result = wormholeActivateAt(state, ctx)
          recovered.add(run.depth)
          if (result.ok) continue
        } else {
          const wreck = views.find(row => (row.info.kind === 'signal' || row.info.kind === 'known') && row.info.signal === 'wreck' && !grid.activated.includes(row.cell.key))
          if (wreck) target = wreck.cell
        }
      }
      if (!target) {
        if (wormholeGridScan(state).ok) continue
        target = views.filter(row => row.cell.key !== here.key && row.info.kind === 'unknown').sort((a, b) => hexDistance(a.cell, here) - hexDistance(b.cell, here) || a.cell.key.localeCompare(b.cell.key))[0]?.cell
      }
      if (!target || target.key === here.key) { out.failure = 'deadlock'; out.extracted = extract(state, ctx); break }
      const result = wormholeTravelTo(state, ctx, target, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true })
      if (!result.ok) { out.failure = `travel-${result.code ?? result.errorId ?? 'failed'}:${result.error ?? ''}`; break }
    }
    if (state.wormhole.run && !out.failure) out.failure = 'step-limit'
  } catch (error) { out.failure = `program-error:${error instanceof Error ? error.message : String(error)}` }
  out.state = state
  return out
}
