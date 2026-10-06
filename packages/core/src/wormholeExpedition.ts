import type { GameState } from './state'
import type { SimContext } from './types'
import { gridCellAt, hasLiveFoe, wormholeStream, type WormholeEventKey, type WormholeEventInstance } from './wormholeGrid'
import { wormholeRelicBoxPoolOf } from './wormholeSalvage'
import { wormholeGroundAddCargo, wormholeGroundAddShape } from './wormholeGround'
import { takeWormholeSupply } from './wormholeSupplies'
import { wormholePatrolAfterAction, wormholeRaiseAlert } from './wormholePatrol'
import { wormholeStartBattle } from './wormholeBattle'
import { wormholeFamilyOfSeed } from './wormholeFoes'

export type WormholeEventAction = 'repair' | 'search' | 'supply' | 'container' | 'force' | 'investigate' | 'verify' | 'respond' | 'reject' | 'wait' | 'cross' | 'bypass'
export interface WormholeEventPreview {
  key: WormholeEventKey
  cellKey: string
  action: WormholeEventAction
  resolved: boolean
  alert: number
  alertDelta: number
  turns: number
  supply: Record<string, number>
  rewards: Record<string, number>
  battle: 'none' | 'certain' | 'possible'
  rangeMul?: number
  identity?: 'genuine' | 'ambush'
  fingerprint?: string
  ok: boolean
  error?: 'no-event' | 'not-ready' | 'invalid-action' | 'insufficient-turns' | 'insufficient-supplies' | 'packages-exhausted' | 'stale-plan' | 'reward-failed' | 'battle-failed'
}

const ACTIONS: Readonly<Record<WormholeEventKey, readonly WormholeEventAction[]>> = {
  maintenance: ['repair', 'search', 'bypass'], transport: ['supply', 'container', 'bypass'],
  controller: ['investigate', 'force', 'bypass'], relay: ['investigate', 'force', 'bypass'],
  storm: ['wait', 'cross', 'bypass'], distress: ['verify', 'respond', 'reject'],
}

function currentEvent(state: GameState) {
  const run = state.wormhole.run
  if (!run?.grid || run.expeditionRules !== 2 || run.supplyVersion !== 1) return null
  const cell = gridCellAt(run.grid, run.grid.pos)
  if (!cell?.eventKey) return null
  if (run.pendingEvent && (run.pendingEvent.cellKey !== cell.key || run.pendingEvent.key !== cell.eventKey)) return null
  return { run, cell, key: cell.eventKey }
}

function instanceOf(state: GameState, ctx: SimContext, hit: NonNullable<ReturnType<typeof currentEvent>>): WormholeEventInstance {
  const { run, cell, key } = hit
  const rng = wormholeStream((run.seed ?? 0) * 31 + run.depth * 7919 + cell.q * 131 + cell.r * 151)
  const pool = wormholeRelicBoxPoolOf(ctx, run.depth, run.family ?? wormholeFamilyOfSeed(run.seed ?? 0))
  return {
    ...cell.event,
    ...(key === 'maintenance' || key === 'transport' ? { supply: { ...(cell.event?.supply ?? run.expeditionSupplyPackage ?? {}) } } : {}),
    ...(key === 'transport' ? { containerId: cell.event?.containerId ?? pool[Math.floor(rng() * pool.length)] } : {}),
  }
}

/** 入场/到达时冻结实例库存；预览本身不写状态。 */
export function wormholeFreezeEvents(state: GameState, ctx: SimContext): void {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !run.grid) return
  for (const cell of run.grid.cells) {
    if (cell.eventKey) cell.event = instanceOf(state, ctx, { run, cell, key: cell.eventKey })
  }
}

export function wormholeEventActions(state: GameState): readonly WormholeEventAction[] {
  const hit = currentEvent(state)
  return hit ? ACTIONS[hit.key] : []
}

export function wormholeEventPreview(state: GameState, ctx: SimContext, action: WormholeEventAction): WormholeEventPreview {
  const hit = currentEvent(state)
  const plan: WormholeEventPreview = { key: hit?.key ?? 'maintenance', cellKey: hit?.cell.key ?? '', action, resolved: false, alert: hit?.run.alertLevel ?? 0, alertDelta: 0, turns: 0, supply: {}, rewards: {}, battle: 'none', ok: false }
  if (!hit) return { ...plan, error: 'no-event' }
  const { run, cell, key } = hit
  if (run.phase !== 'inside' || run.attending !== true || run.battle || run.pendingNodeBattle || run.pendingRuinsBattle || hasLiveFoe(cell) || cell.eventResolved || cell.event?.battle === 'pending') return { ...plan, resolved: cell.eventResolved === true, error: 'not-ready' }
  if (!ACTIONS[key].includes(action)) return { ...plan, error: 'invalid-action' }
  const event = instanceOf(state, ctx, hit)
  const free = action === 'bypass' || action === 'reject'
  plan.turns = free || (key === 'relay' && action === 'force') ? 0 : action === 'search' || action === 'wait' || (key === 'controller' && action === 'investigate') ? 2 : 1
  if (key === 'maintenance' && action === 'repair') plan.supply = { 'repairkit-mil': 20 }
  if (action === 'search' || action === 'supply') plan.rewards = { ...event.supply }
  if (action === 'container' && event.containerId) plan.rewards = { [event.containerId]: 1 }
  if (key === 'controller' && action === 'force') { plan.battle = 'certain'; plan.alertDelta = 2 }
  if (key === 'relay' && action === 'force') plan.battle = 'certain'
  if (key === 'storm' && action === 'cross') { plan.alertDelta = 1; plan.rangeMul = 0.8 }
  if (key === 'distress') {
    if (event.verified) plan.identity = event.identity
    if (action === 'respond') {
      plan.battle = event.verified ? event.identity === 'ambush' ? 'certain' : 'none' : 'possible'
      // 未核验只展示风险上界，不把冻结的身份当免费情报。
      plan.alertDelta = event.verified && event.identity === 'genuine' ? 0 : 2
    }
  }
  if (!free && ((action === 'verify' || (key === 'relay' && action === 'investigate')) && event.verified)) return { ...plan, error: 'not-ready' }
  if ((action === 'search' || action === 'supply') && (run.supplyPackagesTaken ?? 0) >= 3) return { ...plan, rewards: {}, error: 'packages-exhausted' }
  if (plan.turns > run.turnsLeft) return { ...plan, error: 'insufficient-turns' }
  for (const [id, n] of Object.entries(plan.supply)) if ((run.supplies?.items[id] ?? 0) < n) return { ...plan, error: 'insufficient-supplies' }
  plan.ok = true
  plan.fingerprint = JSON.stringify({ run, ships: run.fleet.map(id => [id, state.fleet[id]]) })
  return plan
}

function revealClue(state: GameState, key: string | undefined): void {
  const run = state.wormhole.run!
  if (!run.grid || !key || !run.grid.cells.some(c => c.key === key)) return
  if (!run.grid.scanned.includes(key)) run.grid.scanned.push(key)
  run.grid.dispersed = [...new Set([...(run.grid.dispersed ?? []), key])]
  if (run.expeditionProgress) run.expeditionProgress.clues += 1
}

export function wormholeResolveEvent(state: GameState, ctx: SimContext, action: WormholeEventAction, expected?: WormholeEventPreview): WormholeEventPreview {
  const plan = wormholeEventPreview(state, ctx, action)
  if (!plan.ok) return plan
  if (expected && (expected.action !== action || expected.fingerprint !== plan.fingerprint || expected.cellKey !== plan.cellKey)) return { ...plan, ok: false, error: 'stale-plan' }
  const staged = structuredClone(state)
  const hit = currentEvent(staged)!
  const { run, cell, key } = hit
  const event = cell.event = instanceOf(staged, ctx, hit)
  if (action === 'bypass' || action === 'reject') {
    delete run.pendingEvent
    Object.assign(state, staged)
    return plan
  }
  run.turnsLeft -= plan.turns
  run.turnsSpent = Math.max(run.turnsSpent ?? 0, run.turnsTotal - run.turnsLeft)
  for (const [id, n] of Object.entries(plan.supply)) takeWormholeSupply(run.supplies!, id, n)
  if (key === 'maintenance' && action === 'repair') {
    for (const uid of run.fleet) {
      const ship = staged.fleet[uid]
      if (ship && ship.durability > 0) { ship.armorPct = Math.min(1, (ship.armorPct ?? 1) + 0.2); ship.durability = Math.min(1, ship.durability + 0.2) }
    }
  }
  if (action === 'search' || action === 'supply') {
    for (const [id, n] of Object.entries(plan.rewards)) {
      if (!wormholeGroundAddCargo(run, ctx, id, n)) return { ...plan, ok: false, error: 'reward-failed' }
    }
    run.supplyPackagesTaken = (run.supplyPackagesTaken ?? 0) + 1
  }
  if (action === 'container' && (!event.containerId || !wormholeGroundAddShape(run, event.containerId))) return { ...plan, ok: false, error: 'reward-failed' }
  if (key === 'controller' && action === 'investigate') {
    const ruins = run.grid!.cells.find(c => c.key === event.ruinsKey && c.place === 'ruins')
    if (ruins) { ruins.alarmDisabled = true; revealClue(staged, ruins.key) }
    run.guardSupportDisabled = true
  }
  if (key === 'relay' && action === 'investigate') {
    event.verified = true
    revealClue(staged, run.grid!.cells.find(c => c.elite)?.key)
    for (const p of run.patrols ?? []) revealClue(staged, p.cellKey)
  }
  if (key === 'storm' && action === 'cross') run.nextBattleRangeMul = 0.8
  if (key === 'distress' && action === 'verify') event.verified = true
  if (key === 'distress' && action === 'respond' && event.identity === 'genuine') revealClue(staged, event.intelKey)
  const fight = (action === 'force' && (key === 'controller' || key === 'relay')) || (key === 'distress' && action === 'respond' && event.identity === 'ambush')
  const alertDelta = key === 'distress' ? fight ? 2 : 0 : plan.alertDelta
  if (plan.turns > 0) wormholePatrolAfterAction(staged, { deferMovement: fight })
  wormholeRaiseAlert(staged, alertDelta)
  event.choice = action
  if (fight) {
    event.battle = 'pending'
    const started = wormholeStartBattle(staged, ctx, 'node')
    if (!started.ok) return { ...plan, ok: false, error: 'battle-failed' }
  } else if (action !== 'verify' && !(key === 'relay' && action === 'investigate')) {
    cell.eventResolved = true
    if (run.expeditionProgress) run.expeditionProgress.events += 1
  }
  if (cell.eventResolved || fight) delete run.pendingEvent
  Object.assign(state, staged)
  return { ...plan, resolved: cell.eventResolved === true, alert: run.alertLevel ?? 0, alertDelta }
}

export function wormholeEventAt(state: GameState): WormholeEventKey | undefined {
  const hit = currentEvent(state)
  return hit?.cell.eventResolved ? undefined : hit?.key
}
