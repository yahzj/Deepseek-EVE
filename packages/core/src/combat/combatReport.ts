import { clamp } from './combatMath'
import type { BattleBreakReason, BattleReportRecord, BattleReportSource, GameState } from '../state'

export function spreadWinChance(p: number, k: number): number {
  const t = clamp(0.001, 0.999, p)
  if (k <= 1) return clamp(0.02, 0.98, t)
  const logit = Math.log(t / (1 - t))
  const s = 1 / (1 + Math.exp(-k * logit))
  return clamp(0.02, 0.98, s)
}

export type BattleVerdict = 'great' | 'pyrrhic' | 'defeat' | 'break'

export function battleVerdictOf(r: Pick<BattleReportRecord, 'outcome' | 'shipsLost' | 'dronesGone'>): BattleVerdict {
  if (r.outcome === 'break') return 'break'
  if (r.outcome === 'lose') return 'defeat'
  return r.shipsLost.length > 0 || r.dronesGone > 0 ? 'pyrrhic' : 'great'
}

export function captureBattleReport(
  state: GameState,
  battle: import('../state').BattleState,
  opts: {
    source: BattleReportSource
    outcome: 'win' | 'lose' | 'break'
    breakReason?: BattleBreakReason
    summary: string
    summaryId?: string
    summaryParams?: Readonly<Record<string, string | number>>
    shipsLost?: readonly string[]
  },
): BattleReportRecord {
  const entries = battle.myFleet && battle.myFleet.length > 0 ? battle.myFleet : [{ tag: 'player' }]
  const myUnits: BattleReportRecord['myUnits'] = []
  const derivedLost: string[] = []
  for (const e of entries) {
    const u = battle.units[e.tag]
    if (!u) continue
    const max = u.hpMax ?? u.hp
    myUnits.push({ name: u.name, s: u.hp.s, a: u.hp.a, h: u.hp.h, sMax: max.s, aMax: max.a, hMax: max.h })
    if (u.hp.s + u.hp.a + u.hp.h <= 0) derivedLost.push(u.name)
  }
  let foeTotal = 0
  let foeAlive = 0
  let foeCur = 0
  let foeMax = 0
  for (const u of Object.values(battle.units)) {
    if (u.side !== 'foe') continue
    foeTotal += 1
    const cur = u.hp.s + u.hp.a + u.hp.h
    const max = u.hpMax ?? u.hp
    foeCur += cur
    foeMax += max.s + max.a + max.h
    if (cur > 0) foeAlive += 1
  }
  const loaded = battle.ammoLoaded
  const ammoUsed = loaded
    ? {
        kin: Math.max(0, Math.round(loaded.kin - battle.ammo.kin)),
        exp: Math.max(0, Math.round(loaded.exp - battle.ammo.exp)),
        pla: Math.max(0, Math.round(loaded.pla - battle.ammo.pla)),
      }
    : { kin: 0, exp: 0, pla: 0 }
  const dr = state.droneLossReport
  const dronesGone = dr && dr.battleStartedAtGameMs === battle.startedAtGameMs ? Math.max(0, dr.gone) : 0
  const shipsLost = (opts.shipsLost ?? derivedLost).filter((n) => n.length > 0)
  const rec: BattleReportRecord = {
    battleStartedAtGameMs: battle.startedAtGameMs,
    source: opts.source,
    outcome: opts.outcome,
    ...(opts.breakReason !== undefined ? { breakReason: opts.breakReason } : {}),
    durMs: Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs),
    stats: { ...battle.stats },
    shipsLost,
    myUnits,
    foe: { alive: foeAlive, total: foeTotal, hpFrac: foeMax > 0 ? Math.max(0, Math.min(1, foeCur / foeMax)) : 0 },
    ...(battle.foeMounts && battle.foeMounts.length > 0 ? { foeMounts: [...battle.foeMounts] } : {}),
    ...(battle.foeMountNamePairs && battle.foeMountNamePairs.length > 0
      ? { foeMountNamePairs: [...battle.foeMountNamePairs] }
      : {}),
    ammoUsed,
    dronesGone,
    summary: opts.summary,
    ...(opts.summaryId !== undefined ? { summaryId: opts.summaryId } : {}),
    ...(opts.summaryParams !== undefined ? { summaryParams: opts.summaryParams } : {}),
  }
  state.battleReport = rec
  return rec
}

export function sunkShipIdsOfBattle(
  battle: import('../state').BattleState | null,
  fallbackShipId?: string,
): string[] {
  const out: string[] = []
  const dead = (hp: { s: number; a: number; h: number } | undefined): boolean =>
    hp !== undefined && hp.s + hp.a + hp.h <= 0
  const fleet = battle?.myFleet ?? []
  if (fleet.length > 0) {
    for (const entry of fleet) {
      if (dead(battle?.units[entry.tag]?.hp)) out.push(entry.shipId)
    }
    return out
  }
  if (fallbackShipId !== undefined && fallbackShipId.length > 0 && dead(battle?.units['player']?.hp)) {
    out.push(fallbackShipId)
  }
  return out
}
