/** 战斗域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { lairAnomalyOf } from '../lairs'
import { RETURN_LEG_MUL } from '../balance'
import { bountyWinPercentGuarded } from '../combat'
import { familyModules } from '../equipment'

/** 远征状态快照（界面用；battle 阶段显示交火信息） */
export interface ExpeditionView {
  active: boolean
  anomalyId: string | null
  anomalyName: string
  galaxyName: string
  remainingMs: number
  totalMs: number
  percent: number
  /** 阶段：out 航行 / combat 交火 / back 返航 */
  phase: 'out' | 'combat' | 'back' | null
  phaseLabel: string
  /** 可否召回（去程可；返航仅失利/撤退可——胜利自动返航不可召回） */
  recallable: boolean
  threat: number
  power: number
  /** 预估胜率（百分比，带伤预警口径 bountyWinPercentGuarded——预计伤及装甲/结构会下调显示；0 = 无法评估） */
  winPercent: number
  /** 交火信息（phase=combat 时） */
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    /** 锁定装置集火目标 tag（2026-09-09：驾驶船装配含 target-lock 件时为存活编队首位；否则 null） */
    lockTag: string | null
  } | null
  /** 赏金任务·窝点档位（1/2/3；null = 本趟打的是常驻悬赏） */
  lairTier: 1 | 2 | 3 | null
}

export function expeditionStatus(state: GameState, ctx: SimContext): ExpeditionView {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const galaxy = anomaly ? ctx.galaxies.get(exp.foeGalaxyId ?? anomaly.galaxyId) : undefined
  const base = {
    active: false,
    anomalyId: null as string | null,
    anomalyName: '',
    galaxyName: '',
    remainingMs: 0,
    totalMs: 0,
    percent: 0,
    phase: null as 'out' | 'combat' | 'back' | null,
    phaseLabel: '',
    recallable: false,
    threat: 0,
    power: 0,
    winPercent: 0,
    combat: null,
    lairTier: null as 1 | 2 | 3 | null,
  }
  if (!exp.active || exp.anomalyId === null) return base

  // 窝点（赏金任务目标）：展示名/威胁/胜率估算一律按档位强化后的卡（与战斗、结算同口径）
  const card = anomaly && exp.lairTier ? lairAnomalyOf(anomaly, exp.lairTier, ctx.balance.battle) : anomaly
  const threat = card?.threat ?? 0
  const power = exp.power
  const phase: 'out' | 'combat' | 'back' = exp.phase === 'battle' ? 'combat' : exp.phase
  const phaseLabel =
    phase === 'out' ? '航行中（去程）' : phase === 'combat' ? '交火中' : '返航中'
  // 进度：out（仅旧档兼容）按单程；back 去程并入返航按 2×单程；combat 按已交战时间/最大上限
  let percent = 0
  let remainingMs = 0
  let totalMs = 1
  if (exp.phase === 'out') {
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    totalMs = exp.outMs
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / Math.max(1, totalMs)) * 100))
  } else if (exp.phase === 'back') {
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    // 2026-09-08：进度分母 = 返航段实际时长（returnAtGameMs 兼容字段；
    // 本地 120s / 异星系 2×单程均正确；旧档在途 back 无该字段 → 回退旧口径 outMs×2）
    const totalBack =
      exp.returnAtGameMs !== undefined && Number.isFinite(exp.returnAtGameMs)
        ? Math.max(1, exp.finishAtGameMs - exp.returnAtGameMs)
        : exp.outMs * RETURN_LEG_MUL
    totalMs = Math.max(1, totalBack)
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100))
  } else if (exp.battle) {
    const b = exp.battle
    // 2026-09-09：进度按"战斗时钟"（lastTick−startedAt）而非墙钟——多波次演出窗口与击杀慢镜
    // 期间战斗时钟冻结（不计 maxBattleMs 超时），进度条随之停走，避免间隙空耗把进度顶满
    const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
    totalMs = ctx.balance.battle.maxBattleMs
    remainingMs = Math.max(0, totalMs - elapsed)
    percent = Math.min(100, (elapsed / totalMs) * 100)
  }
  let winPercent = 0
  if (card && exp.phase !== 'battle') {
    // 2026-09-08：悬赏展示胜率走"带伤预警"口径（预计伤及装甲/结构 → 显示下调，结算不变）
    winPercent = Math.round(bountyWinPercentGuarded(state, ctx, card, state.shipId) * 100)
  }
  const combat =
    exp.phase === 'battle' && exp.battle
      ? (() => {
          // 2026-09-09 锁定装置：集火目标 = 存活编队首位（装配含 target-lock 件才显示；无锁定 = null）
          let lockTag: string | null = null
          if (familyModules(state, ctx, state.shipId, 'target-lock').length > 0) {
            for (const [tag, u] of Object.entries(exp.battle!.units)) {
              if (u.side !== 'foe') continue
              if (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0) {
                lockTag = tag
                break
              }
            }
          }
          return {
            distanceM: Math.round(exp.battle!.distanceM),
            myDesireM: Math.round(exp.battle!.myDesireM),
            meHp: { ...(exp.battle!.units['player']?.hp ?? { s: 0, a: 0, h: 0 }) },
            foeHp: Object.fromEntries(
              Object.entries(exp.battle!.units)
                .filter(([, u]) => u.side === 'foe')
                .map(([tag, u]) => [tag, { s: Math.round(u.hp.s), a: Math.round(u.hp.a), h: Math.round(u.hp.h), name: u.name }]),
            ),
            shots: exp.battle!.stats.meShots,
            hits: exp.battle!.stats.meHits,
            lockTag,
          }
        })()
      : null

  return {
    active: true,
    anomalyId: exp.anomalyId,
    anomalyName: card?.name ?? exp.anomalyId,
    galaxyName: galaxy?.name ?? '',
    remainingMs,
    totalMs,
    percent,
    phase,
    phaseLabel,
    recallable: exp.phase === 'out' || (exp.phase === 'back' && exp.returnReason !== 'victory'),
    threat,
    power,
    winPercent,
    combat,
    lairTier: exp.lairTier ?? null,
  }
}
