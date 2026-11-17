import type { BattleState, GameState } from '../../state'
import type { WormholeRunState } from '../../wormhole'
import type { WormholeFoeKind } from '../../wormholeFoes'
import type { SimContext, AnomalyDef } from '../../types'
import { repairUsageText, resolvedBattleAnomaly, battleAnomalyOf } from '../../combat'
import { weekendFlagshipEncounterOf } from '../../weekendBattle'

export function fleetHpFrac(battle: BattleState): number {
  let cur = 0
  let max = 0
  for (const entry of battle.myFleet ?? []) {
    const u = battle.units[entry.tag]
    if (!u) continue
    cur += u.hp.s + u.hp.a + u.hp.h
    max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
  }
  return max > 0 ? cur / max : 0
}

export function wormholeBattleReport(
  run: WormholeRunState,
  battle: BattleState,
  kind: WormholeFoeKind,
  ctx: SimContext,
): { text: string; textId: string; textParams: Record<string, string | number> } {
  const sec = Math.max(0, Math.round((battle.lastTickGameMs - battle.startedAtGameMs) / 1000))
  const s = battle.stats
  const frac = Math.round(fleetHpFrac(battle) * 100)
  const what = kind === 'boss'
    ? `第 ${run.depth} 层守卫`
    : kind === 'extract'
      ?
        '撤离'
      : kind === 'ruins'
        ? `第 ${run.depth} 层遗迹守军`
        : run.grid
          ? `第 ${run.depth} 层地点`
          : `第 ${run.depth} 层节点`
  const whatId =
    kind === 'boss'
      ? 'core.wormholeBattle.024'
      : kind === 'extract'
        ? 'core.wormholeBattle.025'
        : kind === 'ruins'
          ? 'core.wormholeBattle.026'
          : run.grid
            ? 'core.wormholeBattle.027'
            : 'core.wormholeBattle.028'
  const repair = repairUsageText(battle, ctx)
  const tail = repair.length > 0 ? ` · 船体维修装置${repair}` : ''
  const text =
    `🕳 ${what}交火结束：${sec}s · 我方开火 ${s.meShots}/命中 ${s.meHits} · 敌方开火 ${s.foeShots}/命中 ${s.foeHits} · ` +
    `编队残血 ${frac}%${tail}。`
  return {
    text,
    textId: tail === '' ? 'core.wormholeBattle.029' : 'core.wormholeBattle.030',
    textParams:
      tail === ''
        ? { p1: what, p1Id: whatId, p1p1: run.depth, p2: sec, p3: s.meShots, p4: s.meHits, p5: s.foeShots, p6: s.foeHits, p7: frac }
        : {
            p1: what,
            p1Id: whatId,
            p1p1: run.depth,
            p2: sec,
            p3: s.meShots,
            p4: s.meHits,
            p5: s.foeShots,
            p6: s.foeHits,
            p7: frac,
            p8: repair,
            p8p1: repair,
            p8Id: 'core.wormholeBattle.031',
            p9: '。',
            p9Id: 'core.state.042',
          },
  }
}

export function battleFoeAnomaly(state: GameState, ctx: SimContext): AnomalyDef | undefined {
  const whBattle = state.wormhole.run?.battle
  if (whBattle?.wormhole) {
    return resolvedBattleAnomaly(ctx, whBattle, whBattle.wormhole.cardId)
  }
  if (weekendFlagshipEncounterOf(state, state.encounter) && state.encounter.battle) {
    return resolvedBattleAnomaly(ctx, state.encounter.battle, state.encounter.anomalyId)
  }
  const exp = state.expedition
  return exp.battle ? resolvedBattleAnomaly(ctx, exp.battle, exp.anomalyId, exp.lairTier, exp.factionActive)
    : battleAnomalyOf(ctx, exp.anomalyId, exp.lairTier, exp.factionActive)
}

export function wormholeBattleViewOf(
  state: GameState,
  ctx: SimContext,
): {
  battle: BattleState
  anomaly: AnomalyDef
  leaderShipId: string
  name: string
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
} | null {
  const run = state.wormhole.run
  const battle = run?.battle
  if (!run || !battle) return null
  const spec = battle.wormhole
  const base = spec ? ctx.anomalies.get(spec.cardId) : undefined
  if (!spec || !base) return null
  const anomaly = resolvedBattleAnomaly(ctx, battle, spec.cardId)!
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  const kindLabel =
    spec.kind === 'boss'
      ? '层末守卫'
      : spec.kind === 'extract'
        ?
          '撤离'
        : spec.kind === 'ruins'
          ? `第 ${spec.depth} 层遗迹守军`
          : `第 ${spec.depth} 层`
  return {
    battle,
    anomaly,
    leaderShipId,
    name: `虫洞 · ${kindLabel}`,
    combat: {
      distanceM: battle.distanceM,
      myDesireM: battle.myDesireM,
      meHp: leaderRt ? { ...leaderRt.hp } : { s: 0, a: 0, h: 0 },
      foeHp,
      shots: battle.stats.meShots,
      hits: battle.stats.meHits,
      lockTag: null,
    },
  }
}
