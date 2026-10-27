/** 战斗域职责拆分，保持原计算与顺序。 */
import type { DamageResists, SimContext, DamageType } from '../../types'
import { clamp, RESIST_FLOOR } from '../combatMath'
import type { GameState } from '../../state'
import { familyModules } from '../../equipment'

/**
 * **捕获网的断开距离（敌我通用）**（**船长 2026-09-26**：「**将断开距离提高到4500米，
 * 且这个断开对敌我都有效**」；前令为 4000 米）。
 *
 * 口径：网是**实体缆索**——每拍结算时若交战距离 `b.distanceM` 超过本值 ⇒ **两边的网都立刻断开**：
 * - **我方「墨潮捕获网」**：清目标 ＋ 清减益，**断开算一次使用**（船长同日追答「断开也当使用一次」）
 *   ⇒ 进满一轮周期冷却（`advanceMyCaptureWebs`）；
 * - **敌方「劫掠捕获网」**：清账本（`expireFoeWebs`）——该舰本场只张一次网 ⇒ 本场不再补发。
 *
 * （2026-10-02 批次 4g 从 combat.ts 迁来：createPlayerSpec 建档用它俩当缺省；combat 借回 + 再导出。）
 */
export const WEB_BREAK_DIST_M = 4_500

/**
 * **我方「墨潮捕获网」的投网射程**（**船长 2026-09-26**：「**我方网子的射程是3800米**」）。
 *
 * 与 `WEB_BREAK_DIST_M`（4500 米断开，敌我通用）**刻意分开**：两者之间是一条**滞回带**
 * —— 3800 米内才张网；已张开的网在 ≤4500 米内**保持**（不因拉远到 3900 米就掉）；
 * 超过 4500 米才断。敌方那件仍按"自身第一次开火"发动（无独立射程，等效于它的武器射程）。
 */
export const MY_WEB_RANGE_M = 3_800

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

export const AMMO_IDS: Record<DamageType, string> = {
  kinetic: 'ammo-kinetic-l',
  explosive: 'ammo-explosive-l',
  plasma: 'ammo-plasma-l',
}

/** 本船弹药 id 解析（弹药 MK2，2026-09-09）：
 * battle 覆盖（开战实装/缺货回退，见 BattleState.ammoIds）> 船装配档位偏好（ammoPref）> 基础弹 */
export function ammoIdFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  battleIds?: Partial<Record<DamageType, string>> | null,
): string {
  const override = battleIds?.[type]
  if (override && ctx.items.has(override)) return override
  const pref = state.fleet[shipId]?.ammoPref?.[type]
  if (pref && ctx.items.has(pref)) return pref
  return AMMO_IDS[type]
}

/** 无人机线技能系数（2026-09-10 船长：四条新技能；接线点集中在此，改数值 = 同步 skills.ts 的 ⟦…⟧）
 * （2026-10-02 批次 4g 从 combat.ts 迁来：createPlayerSpec 与机群战损两边共用；combat 借回 + 再导出） */
export const DRONE_SKILL = {
  /** 无人机作战学：单发伤害 +5%/级（既有） */
  warfarePerLevel: 0.05,
  /** 无人机打击学：单发伤害再 +4%/级（与作战学乘算，满级再 ×1.2） */
  strikePerLevel: 0.04,
  /** 无人机耐久学（基础档）：三层血量 +4%/级（满级 +20%） */
  durabilityPerLevel: 0.04,
  /** 无人机强化学（进阶档）：三层血量再 +6%/级（满级再 +30%；与耐久学**乘算** → 双满 ×1.56） */
  reinforcePerLevel: 0.06,
  /** 无人机规避学：闪避 +2%/级（满级 +10%；相对乘算，闪避封顶 0.9） */
  evasionPerLevel: 0.02,
  /** 无人机回收学：战后回收损坏机体，基础 20% + 6%/级（满级 50%）——2026-09-10 船长定：基础 10%→20%、满级仍 50% */
  recoveryBase: 0.2,
  recoveryPerLevel: 0.06,
  recoveryMax: 0.5,
} as const

/** 无人机技能等级读取（0~5） */
export function droneSkillLv(state: GameState, id: string): number {
  return Math.min(5, state.skills.trained[id] ?? 0)
}
