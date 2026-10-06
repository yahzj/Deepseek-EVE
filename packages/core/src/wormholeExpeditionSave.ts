import type { WormholeRunState } from './wormhole'
import type { WormholeEventInstance } from './wormholeGrid'
import { isWormholeEventKey } from './wormholeGrid'
import type { WormholePatrolState } from './wormholePatrol'

function record(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}
function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0
}
function counts(raw: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(raw)).flatMap(([id, n]) => count(n) > 0 ? [[id, count(n)]] : []))
}
function key(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^-?\d+,-?\d+$/.test(raw) ? raw : undefined
}

export function cleanWormholeEventInstance(raw: unknown): WormholeEventInstance | undefined {
  if (raw === undefined) return undefined
  const r = record(raw)
  return {
    ...(r.identity === 'genuine' || r.identity === 'ambush' ? { identity: r.identity } : {}),
    ...(r.verified === true ? { verified: true } : {}),
    ...(key(r.intelKey) ? { intelKey: key(r.intelKey) } : {}),
    ...(key(r.ruinsKey) ? { ruinsKey: key(r.ruinsKey) } : {}),
    ...(typeof r.containerId === 'string' && r.containerId.startsWith('box-') ? { containerId: r.containerId } : {}),
    ...(r.supply !== undefined ? { supply: counts(r.supply) } : {}),
    ...(r.battle === 'pending' || r.battle === 'won' ? { battle: r.battle } : {}),
    ...(typeof r.choice === 'string' ? { choice: r.choice } : {}),
  }
}

/** 随档账不反推新奖励/新地图；未知规则留标记，不能退回旧入口。 */
export function cleanWormholeExpeditionRun(raw: unknown): Partial<WormholeRunState> {
  const r = record(raw)
  if (r.expeditionRules === undefined) return {}
  const patrols: WormholePatrolState[] = []
  for (const rawPatrol of Array.isArray(r.patrols) ? r.patrols : []) {
    const p = record(rawPatrol)
    const id = p.threshold === 2 ? 0 : p.threshold === 4 ? 1 : undefined
    if (id === undefined || patrols.some(old => old.id === id)) continue
    const status: WormholePatrolState['status'] = p.status === 'warning' || p.status === 'active' || p.status === 'cleared' ? p.status : 'cancelled'
    patrols.push({ id, threshold: id === 0 ? 2 : 4, status, warnedAt: count(p.warnedAt), nextMoveAt: Math.max(count(p.warnedAt) + 2, count(p.nextMoveAt)), card: typeof p.card === 'string' ? p.card : '', ...(key(p.cellKey) ? { cellKey: key(p.cellKey) } : {}) })
  }
  const pe = record(r.pendingEvent)
  const pendingKey = isWormholeEventKey(pe.key) ? pe.key : undefined
  const progress = record(r.expeditionProgress)
  return {
    expeditionRules: typeof r.expeditionRules === 'number' && Number.isSafeInteger(r.expeditionRules) ? r.expeditionRules : -1,
    ...(pendingKey && key(pe.cellKey) ? { pendingEvent: { key: pendingKey, cellKey: key(pe.cellKey)! } } : {}),
    alertLevel: Math.min(6, count(r.alertLevel)),
    patrolActionSeq: count(r.patrolActionSeq),
    patrols,
    patrolsSpawned: Math.max(patrols.length, Math.min(2, count(r.patrolsSpawned))),
    patrolsCleared: Math.min(2, count(r.patrolsCleared)),
    expeditionSupplyPackage: counts(r.expeditionSupplyPackage),
    supplyPackagesTaken: Math.min(3, count(r.supplyPackagesTaken)),
    ...(r.guardSupportDisabled === true ? { guardSupportDisabled: true } : {}),
    ...(r.nextBattleRangeMul === 0.8 ? { nextBattleRangeMul: 0.8 } : {}),
    ...(r.expeditionGoal === 'deep' || r.expeditionGoal === 'ruins' || r.expeditionGoal === 'survey' ? { expeditionGoal: r.expeditionGoal } : {}),
    ...(r.expeditionProgress !== undefined ? { expeditionProgress: { peakDepth: count(progress.peakDepth), guards: count(progress.guards), ruins: count(progress.ruins), events: count(progress.events), revealed: count(progress.revealed), clues: count(progress.clues), elites: count(progress.elites) } } : {}),
  }
}
