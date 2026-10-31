import type { GameState, BattleState } from '../../state'
import { asRaw, cleanBattle } from '../../saveBattleClean'
import { cleanCombatSortie } from './roster'

export function cleanCommandExpedition(raw: unknown): GameState['expedition'] {
  const fuelMulOf = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v > 1 ? v : undefined
  // --- 远征作业（V12 两阶段：out → battle → back；battle 状态只存动态量） ---
  const expRaw = asRaw(raw)
  const expAnomalyId = typeof expRaw.anomalyId === 'string' && expRaw.anomalyId.length > 0 ? expRaw.anomalyId : null
  const expPhaseRaw = expRaw.phase
  const expPhase: 'out' | 'battle' | 'back' =
    expPhaseRaw === 'battle' || expPhaseRaw === 'back' ? expPhaseRaw : 'out'
  const expBattle: BattleState | null = expPhase === 'battle' ? cleanBattle(expRaw.battle) : null
  const expReturnReason: GameState['expedition']['returnReason'] =
    expPhase === 'back' &&
    (expRaw.returnReason === 'victory' || expRaw.returnReason === 'defeat' || expRaw.returnReason === 'retreat')
      ? expRaw.returnReason
      : undefined
  const sortie = cleanCombatSortie(expRaw.sortie)
  return {
    ...(sortie ? { sortie } : {}),
    active: expRaw.active === true && expAnomalyId !== null,
    anomalyId: expAnomalyId,
    finishAtGameMs:
      typeof expRaw.finishAtGameMs === 'number' && Number.isFinite(expRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(expRaw.finishAtGameMs))
        : 0,
    durationMs:
      typeof expRaw.durationMs === 'number' && Number.isFinite(expRaw.durationMs)
        ? Math.max(0, Math.floor(expRaw.durationMs))
        : 0,
    outMs:
      typeof expRaw.outMs === 'number' && Number.isFinite(expRaw.outMs)
        ? Math.max(0, Math.floor(expRaw.outMs))
        : 0,
    combatMs:
      typeof expRaw.combatMs === 'number' && Number.isFinite(expRaw.combatMs)
        ? Math.max(0, Math.floor(expRaw.combatMs))
        : 0,
    power:
      typeof expRaw.power === 'number' && Number.isFinite(expRaw.power) ? Math.max(0, Math.floor(expRaw.power)) : 0,
    eventId: typeof expRaw.eventId === 'string' && expRaw.eventId.length > 0 ? expRaw.eventId : null,
    eventFired: expRaw.eventFired === true,
    phase: expPhase === 'battle' && expBattle === null ? 'out' : expPhase,
    battle: expBattle,
    // 2026-09-11 船长：目标距离**按星系独立保存**（老档的全局 desirePrefM 不再沿用，一律回落射程中段）。
    // 容错：键非空字符串、值为正有限数才收；全空则整字段省略（零迁移）。
    ...(() => {
      const raw = asRaw(expRaw.desirePrefByGalaxy)
      const byGalaxy: Record<string, number> = {}
      for (const [gid, v] of Object.entries(raw)) {
        if (typeof gid !== 'string' || gid.length === 0) continue
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
        byGalaxy[gid] = Math.round(v)
      }
      return Object.keys(byGalaxy).length > 0 ? { desirePrefByGalaxy: byGalaxy } : {}
    })(),
    // 2026-09-06 兼容字段：胜利自动返航（不可召回）/失利/撤退；仅 back 相位有效，其余清空
    returnReason: expReturnReason,
    ...(typeof expRaw.returnAtGameMs === 'number' && Number.isFinite(expRaw.returnAtGameMs)
      ? { returnAtGameMs: Math.max(0, Math.floor(expRaw.returnAtGameMs)) } : {}),
    /**
     * **本场远征打的是哪个星系**（2026-09-25 周末入侵接线）：
     * ⚠ 这一行原先**漏了**（只写了 `state.ts` 的类型与写入点）⇒ **读档即丢**，"战后归属/残骸注入不再落母港"
     * 只在同一次会话里成立、一读档就退回老口径（本轮补上；同批还补了 `rewardIskOverride`）。
     * 按约定 §二：随档字段必须**两处落笔**（写入点 ＋ 清洗器）。
     */
    ...(typeof expRaw.foeGalaxyId === 'string' && expRaw.foeGalaxyId.length > 0
      ? { foeGalaxyId: expRaw.foeGalaxyId }
      : {}),
    /** **奖励基底覆写**（2026-09-25 · 主动出击每场重抽的价钱口径）：非负有限数才收，其余省略 */
    ...(typeof expRaw.rewardIskOverride === 'number' &&
    Number.isFinite(expRaw.rewardIskOverride) &&
    expRaw.rewardIskOverride >= 0
      ? { rewardIskOverride: Math.round(expRaw.rewardIskOverride) }
      : {}),
    /** **本趟返航的跃迁燃料倍率**（2026-09-29 跃迁燃料批）：>1 才收 —— 丢了它，已扣料的那一趟会变回原速 */
    ...(fuelMulOf(expRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(expRaw.fuelMul)! } : {}),
  }

}

export function cleanWeekendSquad(raw: unknown): string[] {
  const ids: string[] = []
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128 || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= 12) break
  }
  return ids
}
