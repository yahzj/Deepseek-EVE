import type { GameState } from './state'
import type { SimContext } from './types'
import type { WormholeRunState } from './wormhole'
import { gridCellAt, hexDistance, parseHexKey, revealOf } from './wormholeGrid'
import type { WormholeEventKey } from './wormholeGrid'
import { wormholeEventActions, wormholeEventPreview } from './wormholeExpedition'
import type { WormholeEventAction, WormholeEventPreview } from './wormholeExpedition'
import { wormholeCardIdForRun } from './wormholeFoes'
import { wormholeDerivedAnomaly, wormholeMatterBattleModsOf, createFoeSpecs } from './combat'

export interface WormholeViewText { id: string; params?: Readonly<Record<string, string | number>> }
export type WormholeExpeditionGoal = NonNullable<WormholeRunState['expeditionGoal']>
export const WORMHOLE_GOALS: readonly WormholeExpeditionGoal[] = ['deep', 'ruins', 'survey']
export const WORMHOLE_GOAL_IDS: Readonly<Record<WormholeExpeditionGoal, string>> = { deep: 'ui.whExpedition.075', ruins: 'ui.whExpedition.076', survey: 'ui.whExpedition.077' }
export const WORMHOLE_EVENT_IDS: Readonly<Record<WormholeEventKey, string>> = {
  maintenance: 'ui.whExpedition.041', transport: 'ui.whExpedition.042', controller: 'ui.whExpedition.043',
  relay: 'ui.whExpedition.044', storm: 'ui.whExpedition.045', distress: 'ui.whExpedition.046',
}

function actionId(key: WormholeEventKey, action: WormholeEventAction): string {
  if (action === 'investigate') return key === 'controller' ? 'ui.whExpedition.051' : 'ui.whExpedition.053'
  if (action === 'force') return key === 'relay' ? 'ui.whExpedition.054' : 'ui.whExpedition.052'
  if (action === 'bypass') return key === 'controller' ? 'ui.whExpedition.062' : key === 'maintenance' || key === 'transport' ? 'ui.whExpedition.059' : 'ui.whExpedition.060'
  const ids: Partial<Record<WormholeEventAction, string>> = {
    repair: 'ui.whExpedition.047', search: 'ui.whExpedition.048', supply: 'ui.whExpedition.049', container: 'ui.whExpedition.050',
    wait: 'ui.whExpedition.055', cross: 'ui.whExpedition.056', verify: 'ui.whExpedition.057', respond: 'ui.whExpedition.058', reject: 'ui.whExpedition.061',
  }
  return ids[action] ?? 'ui.whExpedition.059'
}

export function wormholeEventErrorText(state: GameState, ctx: SimContext, plan: WormholeEventPreview): WormholeViewText | undefined {
  if (!plan.error) return undefined
  if (plan.error === 'insufficient-turns') return { id: 'ui.whExpedition.064', params: { p1: plan.turns, p2: state.wormhole.run?.turnsLeft ?? 0 } }
  if (plan.error === 'insufficient-supplies') {
    const missing = Object.entries(plan.supply).filter(([id, n]) => (state.wormhole.run?.supplies?.items[id] ?? 0) < n).map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n}`).join(' / ')
    return { id: 'ui.whExpedition.065', params: { p1: missing } }
  }
  if (plan.error === 'packages-exhausted') return { id: 'ui.whExpedition.066' }
  if (plan.error === 'stale-plan') return { id: 'ui.whExpedition.016' }
  if (plan.error === 'reward-failed') return { id: 'ui.whExpedition.034' }
  if (plan.error === 'battle-failed') return { id: 'ui.Wormhole.341' }
  return { id: 'ui.whExpedition.079' }
}

export function wormholeEventView(state: GameState, ctx: SimContext) {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !run.grid) return null
  const cell = gridCellAt(run.grid, run.grid.pos)
  if (!cell?.eventKey || cell.eventResolved || !run.pendingEvent) return null
  const choices = wormholeEventActions(state).map(action => {
    const plan = wormholeEventPreview(state, ctx, action)
    const notices: WormholeViewText[] = []
    if (plan.battle === 'certain') notices.push({ id: 'ui.whExpedition.067' })
    if (plan.battle === 'possible') notices.push({ id: 'ui.whExpedition.068' })
    if (plan.rangeMul === 0.8) notices.push({ id: 'ui.whExpedition.069' })
    if (plan.alertDelta > 0) notices.push({ id: 'ui.whExpedition.080', params: { p1: plan.alertDelta } })
    if (action === 'repair') notices.push({ id: 'ui.whExpedition.081' })
    if (action === 'search' || action === 'supply' || action === 'container') notices.push({ id: 'ui.whExpedition.027' })
    if (cell.eventKey === 'controller' && action === 'investigate') notices.push({ id: 'ui.whExpedition.082' })
    if (cell.eventKey === 'relay' && action === 'investigate') notices.push({ id: 'ui.whExpedition.083' })
    if (cell.eventKey === 'relay' && action === 'force') notices.push({ id: 'ui.whExpedition.084' })
    if (cell.eventKey === 'distress' && action === 'verify') notices.push({ id: 'ui.whExpedition.085' })
    if (cell.eventKey === 'distress' && action === 'respond' && plan.identity === 'genuine') notices.push({ id: 'ui.whExpedition.086' })
    if (cell.eventKey === 'controller' && action === 'force') notices.push({ id: 'ui.whExpedition.110' })
    return { action, labelId: actionId(cell.eventKey!, action), plan, notices, rejection: wormholeEventErrorText(state, ctx, plan) }
  })
  return { key: cell.eventKey, titleId: WORMHOLE_EVENT_IDS[cell.eventKey], cellKey: cell.key, identityId: cell.event?.verified && cell.event.identity ? cell.event.identity === 'genuine' ? 'ui.whExpedition.087' : 'ui.whExpedition.088' : undefined, choices }
}

export function wormholeAlertView(state: GameState) {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !run.grid) return null
  const level = run.alertLevel ?? 0
  return {
    level, bandId: level < 2 ? 'ui.whExpedition.070' : level < 4 ? 'ui.whExpedition.071' : 'ui.whExpedition.072',
    patrols: (run.patrols ?? []).map(p => {
      const pos = p.cellKey ? parseHexKey(p.cellKey) : null
      return { id: p.id, status: p.status, actions: Math.max(0, p.nextMoveAt - (run.patrolActionSeq ?? 0)), cellKey: p.cellKey, distance: pos ? hexDistance(pos, run.grid!.pos) : undefined }
    }),
  }
}

export function wormholeEncounterView(state: GameState, ctx: SimContext, cellKey?: string, role?: 'ordinary' | 'guard') {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !run.grid) return null
  const grid = run.grid
  const cell = cellKey ? grid.cells.find(c => c.key === cellKey) : gridCellAt(grid, grid.pos)
  if (!cell) return null
  const reveal = revealOf(grid, cell)
  const info = reveal.kind === 'foe' ? reveal.under : reveal
  if (cellKey && (info.kind === 'unknown' || info.kind === 'nebula')) return null
  const atExit = grid.exitKnown && cell.q === grid.exit.q && cell.r === grid.exit.r
  const encounterRole = role ?? (reveal.kind === 'foe' ? 'patrol' : atExit ? 'guard' : (info.kind === 'signal' || info.kind === 'known') && info.elite ? 'elite' : 'ordinary')
  if (!role && reveal.kind !== 'foe' && !atExit && !((info.kind === 'signal' || info.kind === 'known') && info.signal === 'ship')) return null
  const kind = encounterRole === 'guard' ? 'boss' : encounterRole === 'patrol' ? 'spawn' : 'node'
  const baseId = wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: 1, kind, nodeIndex: 0 })
  const base = ctx.anomalies.get(baseId)
  if (!base) return null
  const mods = wormholeMatterBattleModsOf(state, ctx, base, kind)
  const card = wormholeDerivedAnomaly(ctx, base, { depth: run.depth, kind, waves: 1, expeditionRules: 2, expeditionRole: encounterRole, guardSupportDisabled: encounterRole === 'guard' && run.guardSupportDisabled === true, ...mods })
  const specs = createFoeSpecs(card, ctx.balance.battle)
  const ships = specs.filter(s => !s.foeReinforceBranch || s.foeReinforceBranch === 'inside').map(s => ({ tag: s.tag, name: s.name, mounts: s.foeMountNamePairs ?? [], drones: s.weapons.filter(w => w.src === 'drone' && !w.reserve).length, pd: s.foePointDefenseEnabled === true }))
  const family = run.family ?? base.foeFamily
  const mechanismId = encounterRole === 'elite' || (encounterRole === 'guard' && run.depth >= 4) ? ({ A: 'ui.whExpedition.105', C: 'ui.whExpedition.106', D: 'ui.whExpedition.107', E: 'ui.whExpedition.108', G: 'ui.whExpedition.109' } as Record<string, string>)[family ?? 'A'] : undefined
  const supportDisabled = encounterRole === 'guard' && run.depth >= 4 && family !== 'C' && run.guardSupportDisabled === true
  return { cellKey: cell.key, role: encounterRole, threat: card.threat, title: card.name, ships, mechanismId: supportDisabled ? undefined : mechanismId, rareCount: encounterRole === 'elite' ? 2 : encounterRole === 'guard' ? 3 : encounterRole === 'patrol' ? 0 : 1, guaranteedContainer: encounterRole === 'elite' && run.depth >= 3, supportDisabled }
}

export function wormholeChangeExpeditionGoal(state: GameState, goal: WormholeExpeditionGoal): boolean {
  const run = state.wormhole.run
  if (run?.expeditionRules !== 2 || !WORMHOLE_GOALS.includes(goal) || run.battle || run.attending !== true || run.phase !== 'inside') return false
  run.expeditionGoal = goal
  return true
}
