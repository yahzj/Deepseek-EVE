/**
 * **玩家规格乘数与抗性合成**（2026-10-02 从 `combat.ts` 拆出 · 批次 4g-1 · 零行为变化）。
 *
 * 本文件 = 我方单舰规格的**乘数件与抗性合成**（`createPlayerSpec` 主件 668 行体量大、4g-2 续搬；
 * 届时它从本文件借回这些件）。全部**纯读数/纯计算**（只依赖 state 类型 / types / combatMath /
 * equipment），无战斗引擎内部件。`combat.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */
import type { GameState } from './state'
import type { DamageResists, DamageType, SimContext } from './types'
import { clamp, RESIST_FLOOR } from './combatMath'
import { familyModules } from './equipment'

/** 逐件缺口乘入（对 out 原位改：每系 res = 1−(1−res)(1−add)） */
export function applyAdds(out: DamageResists, add: DamageResists | undefined): void {
  if (!add) return
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const a = add[t] ?? 0
    if (a <= 0) continue
    const cur = out[t] ?? 0
    out[t] = clamp(RESIST_FLOOR, 0.9, 1 - (1 - cur) * (1 - a))
  }
}

/**
 * EVE 式抗性合成（V17）：模块按"缺口削减"乘入——实际抗性 = 1 − (1−基础) × (1−模块值)，
 * 上限 0.9。基础已有高抗的层位装同系模块收益递减（与旧"绝对加算百分点"的分水岭；
 * 对无基础层 = 模块值直接成面板）。
 */
export function mergeResist(base: DamageResists | undefined, add: DamageResists | undefined): DamageResists {
  const out: DamageResists = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    out[t] = clamp(RESIST_FLOOR, 0.9, 1 - (1 - (base?.[t] ?? 0)) * (1 - (add?.[t] ?? 0)))
  }
  return out
}

/* ══════════ 2026-09-27 船长令：R4/R5 上位技能批 · 战斗侧乘数单点 ══════════
 * 每级值 = 父技能每级 ÷ 3；全部与父技能**同乘区乘算**。数值与技能 id 写在同一句里，
 * 既是唯一真相源，也让「技能说明契约」的现场复核（±400 字内找每级值）稳定命中。 */

/** 单发伤害乘数 = 高级炮术学（每级 +1.5%，全武器通用；与炮术学同乘区） */
export function damageUpgradeMult(state: GameState): number {
  return 1 + 0.015 * Math.min(5, state.skills.trained['advanced-gunnery'] ?? 0)
}

/** 武器族上位技能 id（动能射击学 / 导弹制导学 / 光束聚焦学）——族与族互不串乘 */
export function familyUpgradeSkillIdOf(famKey: 'turret' | 'missile' | 'laser'): string {
  return famKey === 'turret' ? 'kinetic-ballistics' : famKey === 'missile' ? 'missile-guidance' : 'beam-focusing'
}

/** 武器族上位技能的乘数（每级 +1.5%） */
export function familyUpgradeMult(state: GameState, famKey: 'turret' | 'missile' | 'laser' | null): number {
  if (famKey === null) return 1
  return 1 + 0.015 * Math.min(5, state.skills.trained[familyUpgradeSkillIdOf(famKey)] ?? 0)
}

/** 命中乘数 = 火控统合学（每级 +1%，与火控阵列学同乘区） */
export function hitUpgradeMult(state: GameState): number {
  return 1 + 0.01 * Math.min(5, state.skills.trained['fire-control-integration'] ?? 0)
}

/** 装填乘数 = 速射装填学（每级 −1.5%） */
export function reloadUpgradeMult(state: GameState): number {
  return 1 - 0.015 * Math.min(5, state.skills.trained['rapid-reload'] ?? 0)
}

/** 无人机装填乘数 = 无人机整备统合学（每级 −1.5%） */
export function droneReloadUpgradeMult(state: GameState): number {
  return 1 - 0.015 * Math.min(5, state.skills.trained['drone-servicing-integration'] ?? 0)
}

/**
 * 主武器型装载（battle.ammo 单型；异型武器在主弹种耗尽后停火，见 E 台阶 per-gun 完整化）。
 */
export function playerAmmoType(state: GameState, ctx: SimContext, shipId: string): DamageType {
  const weapons = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  return (weapons[0]?.damageType as DamageType | undefined) ?? 'kinetic'
}
