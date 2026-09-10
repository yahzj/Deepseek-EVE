/**
 * V12 实时战斗引擎（核心逻辑，无 UI 依赖）。
 *
 * 模型（中文说明，详见 docs/design/v12-combat.md）：
 * - 编队对编队：我方 = 玩家主控船 1 单位（炮台或基础舰炮 + 装载的无人机各自展开为武器条目，
 *   无人机不单独成单位、不损毁）；敌方 = 异常点按威胁卡面展开：主体 + 0~2 僚机
 *   （卡面 threat = 编队总战力：主体份额 = T/(1+0.6×escorts)，僚机 = 主体×0.6）；
 * - BattleState 只存动态量（血/装填/距离/弹药/统计）；静态卡由 ship+fleet+anomaly 每次重建；
 * - 确定性事件步进：BATTLE_STEP_MS 基本步长；随机全部走 state.rng（种子可复现）；
 * - 命中：hit = clamp((weapon.hitRate + 攻方命中加成×锁定修正) × 距离衰减 − 守方有效回避)；
 * - 伤害：我方炮台单发 = 弹 dmg × dmgMult ×(1+5%/级炮术)×(1+powerBonus)（构建期折算好
 *   每型弹的单发伤害 shotsByType）；其它武器固定值；按 类型×层克制系数 ×(1−层抗) 逐层消费；
 * - 弹药：我方炮台开火即时消耗 1 发（弹型 = 剩余最多型，平局 kin→exp→pla）；
 *   战斗结束剩余退回仓库（V18 口径取消：单档通用弹，无轻/重之分）。
 */
import type { GameState } from './state'
import { addLog } from './state'
import type { AnomalyDef, BattleBalance, DamageResists, DamageType, DefProfile, FoeTactic, ModuleDef, SimContext } from './types'
import { factionAnomalyOf, lairAnomalyOf } from './lairs'
import type { LairTier } from './lairs'
import { nextRandom } from './rng'
import { cargoItemsOf, countWare, removeItem, removeWare, addWare } from './inventory'
import { fleetDefOf } from './instances'
import { allFittedModules, curveMult, effectiveCpu, familyModules, fittedCpuUsed, gapCombine, stackWeight } from './equipment'
import { applyTutorialBuff, isTutorialBattle } from './onboarding'

/** 战斗基本步长（毫秒） */
export const BATTLE_STEP_MS = 100
/** 步数守卫上限（防失控循环） */
export const BATTLE_MAX_STEPS = 40_000
/** 船体维修装置脉冲间隔（毫秒；2026-09-09 三档统一 5 秒一跳，见 data/modules.ts mod-hullrep-*） */
export const REPAIR_PULSE_MS = 5_000

/** 三层血量形状 */
export interface Hp3 {
  s: number
  a: number
  h: number
}

/** 武器来源（2026-09-10 船长批：无人机战斗动画差异化地基——纯展示字段，不参与任何数值结算） */
export type WeaponSrc = 'turret' | 'missile' | 'laser' | 'drone' | 'base'

/** 静态武器卡 */
export interface WeaponSpec {
  label: string
  /** gun = 我方炮台/导弹架（吃弹药，按 shotsByType 给单发伤害）；beam = 激光炮（必中、
   * 逐发扣能量弹药、威力随距离衰减）；fixed = 固定单发（基础舰炮/无人机/敌方） */
  kind: 'gun' | 'beam' | 'fixed'
  /** 武器来源（展示层用：无人机机群/弹道形制据此区分；缺省 = 旧口径不区分） */
  src?: WeaponSrc
  /** 无人机机型 id（src='drone' 时携带：drone-scout/assault/heavy/sentry —— UI 按机型出机体与弹点） */
  artId?: string
  /** fixed/beam 的固定伤害类型（beam = plasma 能量弹药键） */
  fixedType?: DamageType
  /** fixed/beam 单发伤害 */
  shotDmg?: number
  /** gun：弹型 → 单发伤害（构建期含 dmgMult×(1+炮术×5%)×(1+powerBonus)×伤害稳定器） */
  shotsByType?: Partial<Record<DamageType, number>>
  /** V18.1 索敌阵列（命中件）：炮台命中整体乘子（EVE 曲线合成；仅 gun 携带，缺省 1；
   * beam 必中不携带——命中件对激光无效） */
  eqHitMul?: number
  /** V18B 敌方近盲带伤害比例（2026-09-05）：敌在近盲带内（dist < minRange）仍开火，
   * 伤害 × 本值；玩家武器不受影响（近盲带内不开火） */
  blindDmgMul?: number
  maxRangeM: number
  minRangeM: number
  hitRate: number
  falloff: number
  reloadMs: number
}

/**
 * 激光威力系数（2026-09-08 船长定：幅度 = 命中衰减的 0.8 倍）——
 * 系数 = 1 − 距离进度 × (1−falloff) × 0.8，保底 0（例 falloff 0.3 → 远端威力 ×0.44）。
 */
export function beamPowerFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  const { minRangeM: min, maxRangeM: max, falloff } = w
  if (max <= min) return 1
  const t = clamp(0, 1, (dist - min) / (max - min))
  return Math.max(0, 1 - t * (1 - falloff) * 0.8)
}

/** 静态单位卡（构建后不进存档） */
export interface UnitSpec {
  tag: string
  name: string
  side: 'me' | 'foe'
  hp: Hp3
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  evasion: number
  hitBonus: number
  /** V17.1 开火失稳乘子：推进器装配后 <1（命中整体 ×hitMul）；V18.1 多件推进器只取
   * 最重（削减最大）一件；索敌命中件走 WeaponSpec.eqHitMul，不并入本字段 */
  hitMul?: number
  signatureM: number
  scanResMm: number
  speedMps: number
  agility: number
  weapons: WeaponSpec[]
  /** 锁定装置（2026-09-09）：被锁定目标受本舰伤害加深等效比例（多件 EVE 曲线收敛）；
   *  >0 同时表示"本场集火模式"——全部武器打存活编队首位（替代每发随机分散） */
  lockedDmgBonus?: number
  foeTactic: FoeTactic | null
}

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * 层位克制系数（远行星号体系削弱版）。
 * 2026-09-05 船长改：能量（plasma）对护盾 0.75 → 1.25（能量弹/激光对盾更有效，
 * 三系成为"各有克制侧重"：动能拆盾 1.5、爆炸破甲 1.5、能量拆盾 1.25 且不劣于任何层）。
 * ⚠ C4 复核项：此改动提升激光炮/能量弹系（含部分无人机能量弹）胜率与 PvE 时长结构，请二号复核平衡。
 */
export function typeLayerMult(t: DamageType, layer: 'shield' | 'armor' | 'hull'): number {
  if (t === 'kinetic') return layer === 'shield' ? 1.5 : layer === 'armor' ? 0.5 : 1
  if (t === 'explosive') return layer === 'shield' ? 0.5 : layer === 'armor' ? 1.5 : 1
  return layer === 'shield' ? 1.25 : 1 // plasma（能量）：拆盾 1.25，对甲/结构无劣化
}

/** 三层克制一句话（UI 悬停/手册速查用；数值与 typeLayerMult 同源） */
export function layerMultText(type: DamageType): string {
  const fmt = (layer: 'shield' | 'armor' | 'hull'): string => {
    const v = typeLayerMult(type, layer)
    return v === 1 ? '×1' : `×${v}`
  }
  return `盾 ${fmt('shield')} · 甲 ${fmt('armor')} · 结构 ${fmt('hull')}`
}

/** 距离衰减：minRange 端 1.0 → maxRange 端 falloff（线性） */
export function distFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  const { minRangeM: min, maxRangeM: max, falloff } = w
  if (max <= min) return 1
  const t = clamp(0, 1, (dist - min) / (max - min))
  return 1 - t * (1 - falloff)
}

/** 武器是否在当前距离开火 */
export function inRange(dist: number, w: { minRangeM: number; maxRangeM: number }): boolean {
  return dist >= w.minRangeM && dist <= w.maxRangeM
}

/**
 * 单发命中概率（设计文档公式；V17.1：×attacker.hitMul = 加力失稳缩放，缺省 1）。
 * 2026-09 船长拍板：信号半径/扫描分辨率等"间接属性"不参与战斗公式（纯展示副属性），
 * 命中只由 武器基础命中/攻方命中加成 × 距离衰减 − 守方回避 决定。
 * 参数保留 scanResMm/signatureM 可选字段仅为调用面兼容（字面量与单位对象），公式不消费。
 */
export function hitChance(
  weapon: { hitRate: number; minRangeM: number; maxRangeM: number; falloff: number; eqHitMul?: number },
  attacker: { hitBonus: number; scanResMm?: number; hitMul?: number },
  defender: { evasion: number; signatureM?: number },
  dist: number,
  bal: BattleBalance,
): number {
  const df = distFactor(dist, weapon)
  const raw = (weapon.hitRate + attacker.hitBonus) * df - defender.evasion
  // V18.1：索敌（命中件）乘子在 clamp 内与失稳分开——eqHitMul 只随炮台条目
  return clamp(bal.hitMin, bal.hitMax, raw * (weapon.eqHitMul ?? 1) * (attacker.hitMul ?? 1))
}

/** 把一发伤害按层序消费（盾→甲→结构），返回更新后三层与实际扣血 */
export function applyDamage(
  hp: Hp3,
  resists: UnitSpec['resists'],
  dmg: number,
  type: DamageType,
): { hp: Hp3; dealt: number } {
  const next = { s: hp.s, a: hp.a, h: hp.h }
  let rest = Math.max(0, dmg)
  const layerKey: Array<keyof Hp3> = ['s', 'a', 'h']
  const layerName: Array<'shield' | 'armor' | 'hull'> = ['shield', 'armor', 'hull']
  const before = hp.s + hp.a + hp.h
  for (let i = 0; i < 3 && rest > 0; i++) {
    const res = resists[layerName[i]!]?.[type] ?? 0
    const layerDmg = rest * typeLayerMult(type, layerName[i]!) * (1 - clamp(0, 0.9, res))
    const absorbed = Math.min(next[layerKey[i]!], layerDmg)
    next[layerKey[i]!] -= absorbed
    rest = Math.max(0, layerDmg - absorbed) // 层破溢出进下一层
  }
  const after = next.s + next.a + next.h
  return { hp: next, dealt: Math.max(0, before - after) }
}

/* ═══════════ 构建 ═══════════ */

const AMMO_IDS: Record<DamageType, string> = {
  kinetic: 'ammo-kinetic-l',
  explosive: 'ammo-explosive-l',
  plasma: 'ammo-plasma-l',
}

/** 本船弹药 id 解析（弹药 MK2，2026-09-09）：
 * battle 覆盖（开战实装/缺货回退，见 BattleState.ammoIds）> 船装配档位偏好（ammoPref）> 基础弹 */
function ammoIdFor(
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

function combatSpeed(maxSpeedMps: number, agility: number, bal: BattleBalance): number {
  return Math.max(20, maxSpeedMps * bal.speedFactor * (1 + (agility - 0.5) * 2 * bal.agilitySpeedBonus))
}

/** 逐件缺口乘入（对 out 原位改：每系 res = 1−(1−res)(1−add)） */
function applyAdds(out: DamageResists, add: DamageResists | undefined): void {
  if (!add) return
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const a = add[t] ?? 0
    if (a <= 0) continue
    const cur = out[t] ?? 0
    out[t] = clamp(0, 0.9, 1 - (1 - cur) * (1 - a))
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
    out[t] = clamp(0, 0.9, 1 - (1 - (base?.[t] ?? 0)) * (1 - (add?.[t] ?? 0)))
  }
  return out
}

/** 敌方编队主伤害类型（V17 导出；卡面 dmgMix 取最高权重，缺省 = 动能）——悬赏卡展示/玩家配抗参考 */
export function foeMainDamageType(anomaly: AnomalyDef): DamageType {
  return pickTopType(anomaly.dmgMix)
}

/** 敌方血型层占比（V17.2 导出；悬赏卡"敌型"展示——与 createFoeSpecs 同源）：
 * 盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33（盾/甲/结构） */
export function foeLayerSplit(profile: DefProfile | undefined): { s: number; a: number; h: number } {
  return PROFILE_SPLIT[profile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
}

/** 构建我方单位静态卡（V18 多件语义：全位装配生效——多炮/多矿枪/盾甲多件/无人机装置；null = 船数据缺失） */
/** 我方规格快照（手动/AI/MC/预估同源）。
 * ammoIds（弹药 MK2，2026-09-09）：战斗内实装弹 id 覆盖（缺货回退等）——
 * 推进/视图重建传 battle.ammoIds 使伤害与实装弹种一致；缺省 = 船装配 ammoPref，再缺省 = 基础弹。 */
export function createPlayerSpec(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  ammoIds?: Partial<Record<DamageType, string>> | null,
): UnitSpec | null {
  const ship = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!ship || !fleet) return null
  const bal = ctx.balance.battle
  const fitted = fleet.fitted

  // V18：家族件列表（全位；V18.1 起无同类唯一——多件按收敛组合成）
  const shieldDefs = familyModules(state, ctx, shipId, 'shield')
  const armorDefs = familyModules(state, ctx, shipId, 'armor')
  const propDefs = familyModules(state, ctx, shipId, 'propulsion')
  const targetLockDefs = familyModules(state, ctx, shipId, 'target-lock') // 2026-09-09 锁定装置（高槽）
  // V18B：武器形态分家——turret（动能炮）与 missile（导弹架）与 laser（激光炮）都进武器池
  const turretDefs = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  // V18.1 支援件（中/低槽：伤害/射速/命中/闪避，效果字段判别）
  const supportDefs = allFittedModules(fitted, ctx).filter((d) => d.slot === 'support')
  // 无人机装置（高槽 rack 件；甲板扩展/战术导控/中继天线按字段判别）
  const droneGear = allFittedModules(fitted, ctx).filter(
    (d) => d.droneBayBonusM3 !== undefined || d.droneDmgBonus !== undefined || d.droneRangeBonusPct !== undefined,
  )

  // 盾/甲：容量加成加算求和；抗性按系逐件缺口乘入（mergeResist 链；V18.1 同系可多件）
  let shieldHpMult = 1
  for (const m of shieldDefs) shieldHpMult += m.shieldHpBonus ?? 0
  let armorHpMult = 1
  for (const m of armorDefs) armorHpMult += m.armorHpBonus ?? 0
  // 结构层容量（2026-09-10 船长：E 族巨构骨架引出）——任何槽位都可能带，按件加算求和，
  // 与甲容同口径；技能（船体加固理论/重装舰操作）再乘于其上
  let hullHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) hullHpMult += m.hullHpBonus ?? 0
  // 批次三技能（2026-09-05）：护盾操作学（盾容量 +4%/级）/ 船体加固理论（甲+结构 +4%/级）——乘于装备件之上
  const shOpLv = Math.min(5, state.skills.trained['shield-operation'] ?? 0)
  const hullLv = Math.min(5, state.skills.trained['hull-upgrades'] ?? 0)
  // 批次五：重装舰操作（armored 族驾驶）——装甲+结构容量 +4%/级，与船体加固理论乘算
  const armoredOpsLv = ship.role === 'armored' ? Math.min(5, state.skills.trained['armored-ops'] ?? 0) : 0
  const hullSkillMult = (1 + 0.04 * hullLv) * (1 + 0.04 * armoredOpsLv)
  const hp: Hp3 = {
    s: (ship.shieldHp ?? 0) * Math.max(1, shieldHpMult) * (1 + 0.04 * shOpLv),
    a: (ship.armorHp ?? 0) * Math.max(1, armorHpMult) * hullSkillMult,
    h: (ship.hullHp ?? 0) * Math.max(1, hullHpMult) * hullSkillMult,
  }
  const shieldRes = mergeResist(ship.shieldResist, undefined)
  for (const m of shieldDefs) applyAdds(shieldRes, m.shieldResistAdd)
  const armorRes = mergeResist(ship.armorResist, undefined)
  for (const m of armorDefs) applyAdds(armorRes, m.armorResistAdd)
  // 批次五：护盾调谐学/装甲调谐学——减伤缺口每级收窄 2%（等效抗性 +~2 百分点/级，上限 90% 不变）
  const tune = (res: DamageResists, lv: number): void => {
    if (lv <= 0) return
    const f = 1 - 0.02 * lv
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const v = res[t] ?? 0
      res[t] = Math.min(0.9, Math.max(0, 1 - (1 - v) * f))
    }
  }
  tune(shieldRes, Math.min(5, state.skills.trained['shield-tuning'] ?? 0))
  tune(armorRes, Math.min(5, state.skills.trained['armor-tuning'] ?? 0))
  // 结构层抗性（2026-09-10 船长：模块首次可加壳抗——hullResistAdd，按系缺口复合，上限 0.9）
  const hullRes = mergeResist(ship.hullResist, undefined)
  for (const m of allFittedModules(fitted, ctx)) if (m.hullResistAdd) applyAdds(hullRes, m.hullResistAdd)
  const resists = { shield: shieldRes, armor: armorRes, hull: hullRes }

  // V18.1 支援件合成：
  // - 伤害稳定器（按系加算）+ 射速计算机（装填缩短加算）只进炮台条目；
  // - 索敌阵列 = EVE 曲线命中乘子（只进炮台条目 eqHitMul）；
  // - 姿态陀螺 = 缺口复合回避（全船，含船体基础）。
  const dmgBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  let rofCut = 0
  const hitEqs: number[] = []
  const evadeGaps: number[] = []
  for (const m of supportDefs) {
    for (const [t, v] of Object.entries(m.damageTypeBonusPct ?? {})) dmgBonus[t as DamageType] += v ?? 0
    rofCut += m.reloadCutPct ?? 0
    if (m.hitBonusPct !== undefined) hitEqs.push(m.hitBonusPct)
    if (m.evasionGapPct !== undefined) evadeGaps.push(m.evasionGapPct)
  }
  const hitEq = curveMult(hitEqs)
  // 2026-09-05 一号按盘点补：规避机动学——舰船被命中缺口每级收窄 5%（与姿态陀螺缺口复合）
  const evLv = Math.min(5, state.skills.trained[bal.evasionSkillId] ?? 0)
  if (evLv > 0) evadeGaps.push(bal.evasionPerLevel * evLv)
  const evasion = gapCombine(evadeGaps, ship.evasion ?? 0.12)
  const reloadDiv = 1 + Math.min(0.9, rofCut)

  // 推进器（V18.1 多件）：速度加成 EVE 曲线收敛；开火失稳只取最重一件
  const propSpeeds = propDefs.map((p) => p.speedBonusPct ?? 0)
  const speedEq = curveMult(propSpeeds)
  const worstPen = Math.max(0, ...propDefs.map((p) => p.hitPenalty ?? 0))
  // 装甲件常驻速度代价（2026-09-10 船长：陵寝装甲层 −25%）——多件取最重一件（与上面的失稳同口径）
  const worstSpeedPen = Math.max(0, ...allFittedModules(fitted, ctx).map((m) => m.speedPenaltyPct ?? 0))
  // 锁定装置（2026-09-09 船长拍板：集火 + 被锁目标受击加深 8/12/20% 档；多件 EVE 曲线收敛）
  const lockEq = curveMult(targetLockDefs.map((m) => m.lockDmgBonus ?? 0))

  const weapons: WeaponSpec[] = []
  const gunneryLv = state.skills.trained[ctx.balance.combat.gunnerySkillId] ?? 0
  // 批次五：武装舰操作（armed 族驾驶 +3%/级 全武器单发，乘于炮术学之外）
  const arOpsLv = ship.role === 'armed' ? Math.min(5, state.skills.trained['armed-ops'] ?? 0) : 0
  const dmgScale = (1 + bal.gunneryDmgPerLevel * gunneryLv) * (1 + (ship.powerBonus ?? 0)) * (1 + 0.03 * arOpsLv)

  // 兜底武器：基础舰炮恒在（弱；无炮/无弹仍可还击）
  weapons.push({
    label: '基础舰炮',
    kind: 'fixed',
    src: 'base',
    fixedType: 'kinetic',
    shotDmg: Math.round(8 * dmgScale),
    maxRangeM: 2500,
    minRangeM: 0,
    hitRate: 0.5,
    falloff: 0.3,
    reloadMs: 3500,
  })
  // V18 多炮：同 id 同参合并为 ×N 齐射条目（避免 UI 弧线爆炸），异型各自成条目
  const gunGroups = new Map<string, ModuleDef[]>()
  for (const t of turretDefs) {
    if (t.maxRangeM === undefined || t.reloadMs === undefined) continue
    const g = gunGroups.get(t.id)
    if (g) g.push(t)
    else gunGroups.set(t.id, [t])
  }
  for (const group of gunGroups.values()) {
    const turret = group[0]!
    if (turret.maxRangeM === undefined || turret.reloadMs === undefined) continue
    const count = group.length
    const type = turret.damageType ?? 'kinetic'
    const mult = turret.dmgMult ?? 1
    const ammoDef = ctx.items.get(ammoIdFor(state, ctx, shipId, type, ammoIds))
    // V18B 武器族专精技能：按模块槽族取专精技能（turret→动能炮术 / missile→导弹发射学 /
    // laser→激光炮学），乘算于 dmgScale（炮术学）之上——族与族互不串乘
    const famKey = turret.slot === 'missile' || turret.slot === 'laser' || turret.slot === 'turret' ? turret.slot : null
    const famLv =
      famKey !== null ? Math.min(5, state.skills.trained[ctx.balance.battle.familySkillIds[famKey]] ?? 0) : 0
    let famMult = famLv > 0 ? 1 + ctx.balance.battle.familySkillPerLevel * famLv : 1
    // 批次三：能量管理学（energy-management）——激光供能调谐 +3%/级（与激光炮学乘算）
    if (turret.slot === 'laser') {
      const engLv = Math.min(5, state.skills.trained['energy-management'] ?? 0)
      if (engLv > 0) famMult *= 1 + 0.03 * engLv
    }
    // V18.1：伤害稳定器（该系加算）乘入单发；射速计算机缩短装填
    // 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——按本武器固定弹型乘入，
    // 装别族武器 = 无加成（仍可用）；无人机与基础舰炮不在此链上，天然豁免
    const shipFam = ship.weaponFamilyBonus?.[type] ?? 0
    const perShot = Math.round((ammoDef?.dmg ?? 0) * mult * dmgScale * famMult * (1 + dmgBonus[type]) * (1 + shipFam))
    // 第二批技能（2026-09-05）：火控阵列学 命中 +3%/级（仅非必中 gun）；武器装填技术 −4%/级（≥60%，gun/beam 共用装填）
    const fireLv = Math.min(5, state.skills.trained['fire-control'] ?? 0)
    const fireMult = fireLv > 0 ? 1 + 0.03 * fireLv : 1
    const reload = Math.max(100, Math.round((turret.reloadMs / reloadDiv) * (1 - 0.04 * Math.min(5, state.skills.trained['reload-drills'] ?? 0))))
    if (turret.slot === 'laser') {
      // V18B-2 激光炮：beam 条目——必中（开火不掷命中）、逐发扣能量弹药、
      // 距离衰减作用于威力（幅度 = 命中衰减的 50%，开火时按当前距离计算）
      weapons.push({
        label: count > 1 ? `${turret.name}×${count}` : turret.name,
        kind: 'beam',
        src: 'laser',
        fixedType: 'plasma',
        shotDmg: perShot * count,
        maxRangeM: turret.maxRangeM,
        minRangeM: turret.minRangeM ?? 0,
        hitRate: 1,
        falloff: turret.falloff ?? 0.3,
        reloadMs: reload,
      })
      continue
    }
    const shotsByType: Partial<Record<DamageType, number>> = {}
    shotsByType[type] = perShot * count
    weapons.push({
      label: count > 1 ? `${turret.name}×${count}` : turret.name,
      kind: 'gun',
      src: turret.slot === 'missile' ? 'missile' : 'turret',
      shotsByType,
      eqHitMul: hitEq > 1 ? hitEq : undefined,
      maxRangeM: turret.maxRangeM,
      minRangeM: turret.minRangeM ?? 0,
      hitRate: (turret.hitRate ?? 0.5) * fireMult,
      falloff: turret.falloff ?? 0.3,
      reloadMs: reload,
    })
  }

  // 无人机装载（2026-09-08 无人机舱大改：只放飞该船 droneLoad 清单——不再从仓库/货仓自动贪心；
  // 甲板扩展 +bay、战术导控 +dmg 不变。装入时 CPU 已在装配预算内预占（UI 钳制），此处为防御：
  // 装配变化导致舱容/CPU 不足时按清单顺序整型裁到装得下，装不下的类型跳过）
  let bayLimit = ship.droneBayM3 ?? 0
  let droneDmgBonus = 0
  // 无人机中继天线（2026-09-10 船长：百分比制求和乘入机型基础射程；多件线性可叠）
  let droneRangeMult = 1
  for (const g of droneGear) {
    bayLimit += g.droneBayBonusM3 ?? 0
    droneDmgBonus += g.droneDmgBonus ?? 0
    droneRangeMult += g.droneRangeBonusPct ?? 0
  }
  let bayUsed = 0
  let cpuLeft = effectiveCpu(state, ctx, ship) - fittedCpuUsed(fitted, ctx)
  const droneLoad = fleet.droneLoad ?? {}
  // 批次五更正（船长 2026-09-05）：无人机整备学改折装填（CPU 不打折）——每级 −4%
  //（与武器装填技术同口径，均为乘算；武器装填技术不含无人机，两者独立乘算）
  // 2026-09-10 船长（配合出击-返航动画节奏）：装填基准 2200→**4400ms**、单发同步 ×2
  // ——每轮更重、节奏更舒缓，**净 DPS 不变**（故既有校准矩阵口径不变，无需复跑）。
  const droneReload = Math.round(4400 * (1 - 0.04 * Math.min(5, state.skills.trained['drone-servicing'] ?? 0)))
  if (bayLimit > 0 && cpuLeft > 0) {
    for (const [droneId, want] of Object.entries(droneLoad)) {
      if (!want || want <= 0) continue
      const def = ctx.items.get(droneId)
      if (!def || def.kind !== 'drone') continue
      const perCpu = def.cpuUse ?? 0
      const perM3 = def.unitM3 ?? 0
      if (perCpu <= 0 || perM3 <= 0) continue
      const byCpu = Math.floor(cpuLeft / perCpu)
      const byBay = Math.floor((bayLimit - bayUsed) / perM3)
      const n = Math.max(0, Math.min(want, byCpu, byBay))
      if (n <= 0) continue
      bayUsed += perM3 * n
      cpuLeft -= perCpu * n
      // V18 战术导控阵列 ×(1+Σ导控)（乘算）；无人机作战学（drone-warfare）+5%/级 +
      // **无人机打击学（drone-strike）+4%/级**（2026-09-10 船长：高阶伤害技能）；三者乘算；
      // 2026-09-10 船长：再加船体无人机专属加成（ship.droneDmgBonus，王鲭 +12%/梭鱼 +8%）
      // 2026-09-10 船长：单发 ×2 与装填 ×2 同步（每轮更重、节奏更舒缓，净 DPS 不变）
      const shot = Math.round(
        (def.dmg ?? 0) *
          2 *
          (1 + droneDmgBonus) *
          (1 + (ship.droneDmgBonus ?? 0)) *
          (1 + DRONE_SKILL.warfarePerLevel * droneSkillLv(state, 'drone-warfare')) *
          (1 + DRONE_SKILL.strikePerLevel * droneSkillLv(state, 'drone-strike')),
      )
      for (let i = 0; i < n; i++) {
        weapons.push({
          label: def.name,
          kind: 'fixed',
          // 2026-09-10 船长批：无人机 = 独立来源 + 机型 id（每架一条条目；UI 按其放飞机群/出弹）
          src: 'drone',
          artId: droneId,
          fixedType: def.damageType ?? 'kinetic',
          shotDmg: shot,
          // 射程 = 机型基础 × 中继乘数（2026-09-10 船长：蜂鸟 2500/赤鸢 3000/猎鹰 3500/
          // 雷鸥哨戒 5000；旧值 2600 兜底；中继天线百分比乘入）
          maxRangeM: Math.round((def.maxRangeM ?? 2600) * droneRangeMult),
          minRangeM: 200,
          // 命中（2026-09-10 船长：下放到机型本体，不再硬编码 0.6/0.35）——
          // 侦察/战斗/攻坚三型 0.75 且**命中不随距离衰减**（falloff 1）；哨戒 1.10 保留正常衰减 0.35
          hitRate: def.hitRate ?? 0.6,
          falloff: def.falloff ?? 0.35,
          reloadMs: droneReload,
        })
      }
    }
  }

  return {
    tag: 'player',
    name: ship.name,
    side: 'me',
    hp,
    resists,
    // V18.1：回避 = 船体基础 + 姿态陀螺缺口复合（1−(1−基础)Π(1−x)）
    evasion,
    hitBonus: (ship.hitBonus ?? 0) * (1 + bal.hitPerLevel * Math.min(5, state.skills.trained[bal.hitSkillId] ?? 0)),
    // V17.1 失稳（多件只取最重一件；V18.1 索敌命中乘子走炮台条目 eqHitMul，不在此）
    hitMul: 1 - worstPen,
    signatureM: ship.signatureM ?? 80,
    scanResMm: ship.scanResMm ?? 500,
    // V17 矢量推进器 = 加力推进；V18.1 多件速度加成 EVE 曲线收敛；矢量机动操作（舰船）再乘 +5%/级
    // 2026-09-10 船长：装甲件的**常驻速度代价**（如陵寝装甲层 −25%）——多件只取最重一件
    // （与推进器失稳 hitPenalty 同口径：重甲不会叠成静止），钳制到 [0.1, 1]
    speedMps:
      (ship.maxSpeedMps ?? 200) *
      Math.max(1, speedEq) *
      (1 + bal.speedPerLevel * Math.min(5, state.skills.trained[bal.speedSkillId] ?? 0)) *
      Math.max(0.1, 1 - worstSpeedPen),
    agility: ship.agility,
    weapons,
    // 锁定装置（2026-09-09）：被锁目标受击加深等效比例（>0 同时开启集火模式）
    ...(lockEq > 1 ? { lockedDmgBonus: lockEq - 1 } : {}),
    foeTactic: null,
  }
}

/** 我方主武器固定弹种（V18 多炮：取高槽第一门武器（炮台/导弹架）的 damageType；无武器
 * 也返回 kinetic——基础舰炮实际不消耗弹药）。多门异弹型武器的装载/消耗在出发预载时按
 * 主武器型装载（battle.ammo 单型；异型武器在主弹种耗尽后停火，见 E 台阶 per-gun 完整化）。 */
export function playerAmmoType(state: GameState, ctx: SimContext, shipId: string): DamageType {
  const weapons = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  return (weapons[0]?.damageType as DamageType | undefined) ?? 'kinetic'
}

/* ═══════════ 敌方编队 ═══════════ */

const PROFILE_SPLIT: Record<string, Hp3> = {
  shield: { s: 0.5, a: 0.25, h: 0.25 },
  armor: { s: 0.2, a: 0.55, h: 0.25 },
  balanced: { s: 0.34, a: 0.33, h: 0.33 },
}

/** 敌方战术 → 武器射程带（贴合作战风格）：
 * brawl 贴脸肉搏 = 无最小射程的近身喷子；orbit 环绕 = 中距小炮；kite 放风筝 = 高最小射程的远距炮。
 * C4-#3（2026-09-05）：射程/速度由"虚拟装配模板"推导——射程 = 基础带 ×
 * (1 + 侧重系数×(threat−10)/90) 后封顶；速度 = 参考船速段 × m_base × tactic 系数
 * （平衡常量 battle 段 foe* 模板）。射程语义保持 tactic 身份（brawl 近战靠速度贴脸）。 */
const TACTIC_RANGE: Record<FoeTactic, { max: number; min: number }> = {
  brawl: { max: 2200, min: 0 },
  orbit: { max: 4600, min: 350 },
  kite: { max: 9200, min: 1200 },
}

/** 参考船速分段查询（threat → 等效船体 maxSpeed；与玩家 maxSpeedMps 同池） */
export function foeRefSpeedMps(threat: number, bal: BattleBalance): number {
  const table = bal.foeRefSpeedTable
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) return table[i]!.maxSpeedMps
  }
  const last = table[table.length - 1]
  return last ? last.maxSpeedMps : 200
}

/** 敌速基数（无 tactic 系数）：m_base = 0.80 + (0.95−0.80)×(threat−10)/90，clamp [0.7, 1.15] */
function foeSpeedBase(threat: number, bal: BattleBalance): number {
  const lo = bal.foeSpeedAtThreat10 ?? 0.8
  const hi = bal.foeSpeedAtThreat100 ?? 0.95
  const t = Math.min(1, Math.max(0, (threat - 10) / 90))
  return Math.min(1.15, Math.max(0.7, lo + (hi - lo) * t))
}

/** 敌编队总血（C4 时长预期曲线反推，2026-09-05）：参考段火力 × D(T) */
export function foeHpOfThreat(threat: number, bal: BattleBalance): number {
  const floor = bal.foeHpCurveFloorThreat ?? 6
  const span = bal.foeHpCurveSpanThreat ?? 90
  const t = Math.min(1, Math.max(0, (threat - floor) / span))
  const d = (bal.foeHpCurveDMin ?? 5) + (bal.foeHpCurveDSpan ?? 85) * Math.pow(t, bal.foeHpCurveExp ?? 1.6)
  const table = bal.foeRefFire
  let f = table[0]?.dps ?? 5
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) {
      f = table[i]!.dps
      break
    }
    f = table[i]!.dps
  }
  return Math.max(1, Math.round(f * d))
}

/** 展开敌方编队（threat 卡面 = 总战力；血/火力威胁线性，射程/速度走虚拟装配模板） */
/** createFoeSpecs 波次参数（2026-09-09 多波；缺省 = 单波现状） */
export interface FoeSpecOpts {
  /** 本波"主舰+僚机"小队数（escorts 随卡不变） */
  units?: number
  /** 本波分得的敌总血比例（0~1；缺省 1 = 全量） */
  hpShare?: number
  /** tag 前缀（第 2 波起用，避免与首波/旧档 tag 冲突；首波 = '' 保持 foe-0/foe-1 旧命名） */
  tagPrefix?: string
}

/* ═══════════ 敌舰显示名（2026-09-09 船长拍板：同一悬赏内规格/属性不同的敌舰名字不同；
   名字只由"异常属性 × 单位规格"推导，引擎建档与界面显示同源，存档字符串仅作兜底） ═══════════ */

/** 敌舰"舰种名"按 战术 × 血型（9 类；满规格主体用本名，弱规格单位加词缀） */
const FOE_CLASS: Record<string, Record<string, string>> = {
  brawl: { shield: '突击护卫舰', armor: '攻坚重甲舰', balanced: '突击炮艇' },
  orbit: { shield: '巡逻护卫舰', armor: '装甲巡逻舰', balanced: '环绕护航舰' },
  kite: { shield: '狙击护卫舰', armor: '远程装甲舰', balanced: '狙击炮艇' },
}

/** 规格词缀（前缀）：轻装 = 单舰规格 ≤ 本场最强档 ×FOE_LIGHT_FRAC（现覆盖僚机 ×0.6 份额与
 *  明显低血波，见 foeUnitNameOf）；"精锐"档预留——若将来出现相对规格 >1 的头目单位，
 *  在此增加精锐前缀分支即可（词缀判定与血量数值解耦，纯命名）。 */
export const FOE_LIGHT_WORD = '轻装'
const FOE_LIGHT_FRAC = 0.6
const FOE_CLASS_FALLBACK = '敌方舰艇'

/** 舰种名（战术 × 血型；与卡面"敌型/战术"口径一致） */
export function foeClassName(tactic: string | undefined, profile: string | undefined): string {
  return FOE_CLASS[tactic ?? 'orbit']?.[profile ?? 'balanced'] ?? FOE_CLASS_FALLBACK
}

/** 主/僚判定（按 tag 结构，2026-09-09 多波）：主舰 = foe-0 或 w{n}-foe-{k}；
 *  僚机 = legacy foe-N（N≥1，旧单波 escorts）或 *-e{i}（各小队 escort）。 */
export function foeMainTagOf(tag: string): boolean {
  if (tag === 'foe-0') return true
  if (/^foe-\d+$/.test(tag)) return false
  return tag.includes('-foe-') && !tag.includes('-e')
}

/** 单位所在波的血档（tag 前缀 w{n}- 反查波表；首波/无波表 = 1） */
function waveHpShareOf(tag: string, anomaly: AnomalyDef): number {
  const waves = anomaly.waves
  if (!waves || waves.length === 0) return 1
  const m = /^w(\d+)-/.exec(tag)
  const idx = m ? Math.min(waves.length - 1, parseInt(m[1]!, 10)) : 0
  return Math.max(0.001, waves[idx]!.hpShare ?? 1)
}

/** 敌舰单位显示名（船长 2026-09-09 拍板：舰种名 + 规格词缀）：
 * - 满规格主体（主舰、血档不弱）= 舰种名（9 类原样）；
 * - 僚机（份额 ×0.6）或 明显低血波主舰（hpShare ≤ 同卡最强波 ×0.6）→ 轻装 + 舰种名；
 *   例：攻坚重甲舰 → 轻装攻坚重甲舰（替代旧「悬赏名·僚机」两套命名）；
 * - 单卡单波/波间差异小（如穹顶 .857 比值）不触发——避免无感知差异的伪区分。 */
export function foeUnitNameOf(anomaly: AnomalyDef, tag: string): string {
  const base = foeClassName(anomaly.tactic, anomaly.defProfile)
  if (!foeMainTagOf(tag)) return `${FOE_LIGHT_WORD}${base}`
  const waves = anomaly.waves
  if (waves && waves.length > 0) {
    let maxShare = 0.001
    for (const w of waves) maxShare = Math.max(maxShare, w.hpShare ?? 0)
    if (waveHpShareOf(tag, anomaly) / maxShare <= FOE_LIGHT_FRAC) return `${FOE_LIGHT_WORD}${base}`
  }
  return base
}

export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts = {}): UnitSpec[] {
  const tactic = anomaly.tactic ?? 'orbit'
  const split = PROFILE_SPLIT[anomaly.defProfile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
  const escorts = Math.max(0, Math.min(2, anomaly.escorts ?? 0))
  const waveUnits = Math.max(1, Math.floor(opts.units ?? 1))
  const hpShare = opts.hpShare ?? 1
  const prefix = opts.tagPrefix ?? ''
  const mainThreat = anomaly.threat / (1 + 0.6 * escorts)
  const mainType = pickTopType(anomaly.dmgMix)
  // C4-#3：射程 = 基础带 ×(1 + 侧重×((T−10)/90)) → 封顶（clamp 保持 min < max）
  const rangeBase = TACTIC_RANGE[tactic]!
  const growMul = bal.foeRangeGrowMul[tactic] ?? 0.7
  const growT = Math.min(1, Math.max(0, (anomaly.threat - 10) / 90))
  const cap = bal.foeRangeCapM ?? 15_000
  const rangeMax = Math.min(cap, Math.round(rangeBase.max * (1 + growMul * growT)))
  const rangeMin = Math.max(1, Math.min(rangeMax - 1, Math.round(rangeBase.min * (1 + growMul * growT))))
  // C4-#3：速度 = 参考船速(段) × m_base(threat) × tactic 系数 → cap（≤参考 ×foeSpeedCapMul）
  const refSpeed = foeRefSpeedMps(anomaly.threat, bal)
  const spdCap = Math.round(refSpeed * (bal.foeSpeedCapMul ?? 1.2))
  const tacticSpd = bal.foeSpeedTacticMul[tactic] ?? 1
  const foeSpeed = anomaly.foeSpeedMps ?? Math.min(spdCap, Math.round(refSpeed * foeSpeedBase(anomaly.threat, bal) * tacticSpd))

  const make = (tag: string, name: string, uThreat: number, type: DamageType): UnitSpec => {
    // C4：总血 = 时长曲线反推表值（P1：单卡 foeHpOverride 优先 = 独立标定，脱离曲线）；
    // 多波（2026-09-09）：本波分得 总血 × hpShare，波内按威胁份额分配（主体/僚机 = uThreat/T × 波血）
    const baseHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * hpShare
    const unitHp = (baseHp * uThreat) / Math.max(1, anomaly.threat)
    const totalHp = unitHp
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    const dps = uThreat * bal.foeDpsPerThreat
    // 2026-09-08（船长定：能量=光束必中；动能/爆炸普遍高命中 0.85 + 逐卡低命中特例）：
    // 非能量单发 = DPS×装填 ÷ 有效命中 × foeHitCompMul（回避>0 期望上升的等效补偿，方案 A）；
    // 能量 effHit=1 不消费补偿；foeDmgMul 为逐卡等效回退/个性口
    const effHit = type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate
    const shotDmg = Math.max(
      1,
      Math.round(((dps * bal.foeReloadMs) / 1000) * (effHit < 1 ? bal.foeHitCompMul / effHit : 1) * (anomaly.foeDmgMul ?? 1)),
    )
    return {
      tag,
      name,
      side: 'foe',
      hp,
      resists: {},
      evasion: 0.12,
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      speedMps: foeSpeed, // C4-#3 虚拟装配推导（整编队同速；anomaly.foeSpeedMps 覆盖优先）
      agility: 0.3,
      weapons: [
        {
          label: `${name} 武器组`,
          // 2026-09-08（船长定）：能量（plasma）= 光束必中（开火即中、无视回避），
          // **近盲带保留**（带内威力 ×blindDmgMul）；动能/爆炸 = fixed 命中模型 + 逐卡命中率
          kind: type === 'plasma' ? 'beam' : 'fixed',
          fixedType: type,
          shotDmg,
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          // V18B：敌人近盲带伤害比例（船长 2026-09-05：与玩家区分——近盲带内不停火、伤害打折）
          blindDmgMul: anomaly.blindDmgMul ?? 0.3,
          hitRate: type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate,
          falloff: bal.foeFalloff,
          reloadMs: bal.foeReloadMs,
        },
      ],
      foeTactic: tactic,
    }
  }
  const specs: UnitSpec[] = []
  for (let k = 0; k < waveUnits; k++) {
    // tag 唯一性（2026-09-09 多波修复）：仅首波第一小队沿用旧命名（foe-0 主 / foe-1.. 僚，
    // 兼容旧 UI/测试的"主+僚"假想）；其余小队（同波第 2 队起）与后续波统一 w{波}-foe-{队} 前缀，
    // 避免与 legacy 僚机 tag（foe-1..n）撞名造成单位覆盖/血条参照错位。
    const legacySquad = prefix === '' && k === 0
    const squadPrefix = legacySquad ? '' : `${prefix === '' ? 'w0-' : prefix}`
    const mainTag = legacySquad ? 'foe-0' : `${squadPrefix}foe-${k}`
    specs.push(make(mainTag, foeUnitNameOf(anomaly, mainTag), mainThreat, mainType))
    for (let i = 1; i <= escorts; i++) {
      const escortTag = legacySquad ? `foe-${i}` : `${squadPrefix}foe-${k}-e${i}`
      specs.push(make(escortTag, foeUnitNameOf(anomaly, escortTag), mainThreat * 0.6, mainType))
    }
  }
  return specs
}

function pickTopType(mix: Partial<Record<DamageType, number>> | undefined): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = -1
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = mix?.[t] ?? 1
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

/** 开战距离 = 双方最大射程 ×factor + 缓冲；缓冲 = max(固定 100m, 最大射程×10%)（船长 2026-09-05：
 * 远程武器不再 100m 即接战，按射程比例拉开，保证开场有可见的接近窗口） */
export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.round(top * bal.openRangeFactor + pad)
}

/** 玩家战术期望距离（贴脸/中距/风筝）。
 * "主武器" = 炮台（若有）否则基础舰炮；中距 = 主武器有效射程 [min,max] 的中点（默认距离条位置）。 */
export function desiredRangeFor(me: UnitSpec, tactic: 'assault' | 'mid' | 'kite', bal: BattleBalance): number {
  const main = me.weapons.find((w) => w.kind === 'gun') ?? me.weapons[0]
  const mainMin = main ? main.minRangeM : 0
  const mainMax = main ? main.maxRangeM : 0
  if (tactic === 'assault') return Math.max(bal.minDistanceM, Math.round(mainMin * 0.6))
  if (tactic === 'kite') return Math.max(bal.minDistanceM + 1, Math.round(mainMax * 0.95))
  // mid：有效射程中点
  return Math.max(bal.minDistanceM, Math.round((mainMin + mainMax) / 2))
}

/**
 * 敌方编队期望交战距离：站在**自己武器射程带内**的战术位置（旧口径 = 双方最大射程 × 系数，
 * 会让期望落在自己射程带之外 → 敌人在期望处打不到人）。
 * tacticDesireFactor 现表示"带内站位系数"：贴脸型靠带内近端、环绕居中、风筝型贴带内远端。
 */
export function foeDesiredRange(_me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  const tactic = foes[0]?.foeTactic ?? 'orbit'
  const band = TACTIC_RANGE[tactic]!
  const pos = clamp(0.05, 0.95, bal.tacticDesireFactor[tactic] ?? 0.5)
  return Math.max(bal.minDistanceM, Math.round(band.min + pos * (band.max - band.min)))
}

/* ═══════════ 弹药 ═══════════ */

/**
 * 预载需求（V18B-2 per-gun 多键）：按每种耗弹武器键分别估量
 * （该键武器中取最快装填：时间上限 ÷ reload × 余量）。
 */
export function ammoLoadTotals(
  me: UnitSpec,
  bal: BattleBalance,
  state: import('./state').GameState,
): Partial<Record<DamageType, number>> {
  const fastest = new Map<DamageType, number>()
  const consider = (t: DamageType, reloadMs: number): void => {
    fastest.set(t, Math.min(fastest.get(t) ?? Number.POSITIVE_INFINITY, reloadMs))
  }
  for (const w of me.weapons) {
    if (w.kind === 'gun') {
      const t = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
      if (t) consider(t, w.reloadMs)
    } else if (w.kind === 'beam') {
      consider('plasma', w.reloadMs)
    }
  }
  // 弹药集约学（ammunition-condensing，批次四）：出发预载弹药 +8%/级（实际装载仍受库存上限约束）
  const condLv = Math.min(5, state.skills.trained['ammunition-condensing'] ?? 0)
  const condFactor = 1 + 0.08 * condLv
  const out: Partial<Record<DamageType, number>> = {}
  for (const [t, reload] of fastest) {
    out[t] = Math.max(1, Math.ceil(((bal.ammoTimeCapMs * condFactor) / reload) * bal.ammoMargin))
  }
  return out
}

/**
 * V17.2 单型装载：只装载炮台固定弹种的那一型（炮族制——炮台 damageType 决定弹种，
 * battle.ammo 其余键恒 0；开火/退还/UI dominant 仍走既有三键结构，无需第二套）。
 * 货仓优先、仓库兜底；返回实装各型数量（只有目标型非零）。
 * （基础弹装载：旧语义保留，测试/兼容用；开战装载请走 loadAmmoTier 按档装载）
 */
export function loadAmmo(state: GameState, ctx: SimContext, type: DamageType, total: number): { kin: number; exp: number; pla: number } {
  const out = { kin: 0, exp: 0, pla: 0 }
  const key = ammoKeyOf(type)
  out[key] = loadAmmoOf(state, ctx, AMMO_IDS[type], total)
  return out
}

/** 装载指定弹 id（货仓优先、仓库兜底，单型一次抽足）；返回实装数 */
function loadAmmoOf(state: GameState, ctx: SimContext, id: string, total: number): number {
  if (total <= 0) return 0
  const stock = Math.floor((cargoItemsOf(state)[id] ?? 0) + countWare(state, id))
  if (stock <= 0) return 0
  let want = Math.min(stock, total)
  let got = 0
  const fromCargo = Math.min(want, Math.floor(cargoItemsOf(state)[id] ?? 0))
  if (fromCargo > 0) {
    removeItem(state, id, fromCargo)
    want -= fromCargo
    got += fromCargo
  }
  if (want > 0) {
    const fromWare = Math.min(want, countWare(state, id))
    if (fromWare > 0) {
      removeWare(state, id, fromWare)
      want -= fromWare
      got += fromWare
    }
  }
  return got
}

/**
 * 开战按档装载（弹药 MK2，2026-09-09 船长拍板：出战前选档——船装配 ammoPref 决定本场弹种；
 * 该档库存不足 → 整族回退基础弹（fellBack = true，由调用方日志提示），不卡远征）。
 * 返回实装数 + 实装弹 id（写 battle.ammoIds 供推进/退还/视图对齐）。
 */
export function loadAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  total: number,
): { loaded: number; id: string; fellBack: boolean } {
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantId = prefId && ctx.items.has(prefId) ? prefId : null
  let id = AMMO_IDS[type]
  let fellBack = false
  if (wantId !== null) {
    const have = Math.floor((cargoItemsOf(state)[wantId] ?? 0) + countWare(state, wantId))
    if (have >= total) id = wantId
    else fellBack = true // 配置档不足整批 → 整族回退基础弹
  }
  const loaded = loadAmmoOf(state, ctx, id, total)
  return { loaded, id, fellBack }
}

/** 剩余弹药退回物品仓库（弹药 MK2：按实装弹 id 原样退回；ids 缺省 = 基础弹语义） */
export function refundAmmo(
  state: GameState,
  ammo: { kin: number; exp: number; pla: number },
  ids?: Partial<Record<DamageType, string>> | null,
): void {
  const map: Array<[DamageType, number]> = [
    ['kinetic', ammo.kin],
    ['explosive', ammo.exp],
    ['plasma', ammo.pla],
  ]
  for (const [t, n] of map) {
    if (n > 0) addWare(state, ids?.[t] ?? AMMO_IDS[t], Math.floor(n))
  }
}

/** 开火弹型 = 剩余最多（平局 kin→exp→pla）；全空 null */
export function nextAmmoType(ammo: { kin: number; exp: number; pla: number }): DamageType | null {
  let best: DamageType | null = null
  let bestN = 0
  const order: Array<DamageType> = ['kinetic', 'explosive', 'plasma']
  for (const t of order) {
    const n = ammo[ammoKeyOf(t)]
    if (n > bestN) {
      bestN = n
      best = t
    }
  }
  return best
}

/** ammo 计数对象键 → DamageType 的映射辅助 */
export type AmmoKey = 'kin' | 'exp' | 'pla'
export function ammoKeyOf(t: DamageType): AmmoKey {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

/* ═══════════ 2026-09-09 船体维修装置（战斗中自动修复装甲/结构） ═══════════ */
/* 船长定稿：中槽支援件；每 5 秒一跳，逐台修复装甲/结构（各层满则额度转投另一层），
 * 每台每跳消耗 1 枚对应修理组件；组件耗尽自动停机；与弹药预载同哲学——开战装载、结束退还。 */

/** 当前船已装配的维修装置（带 repairArmorHp/repairHullHp 的装配件，按位序） */
export function fittedRepairModules(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  return allFittedModules(ship.fitted, ctx).filter((d) => (d.repairArmorHp ?? 0) > 0 || (d.repairHullHp ?? 0) > 0)
}

/**
 * 维修装置开战预载：装配快照 + 组件装载（货舱优先、仓库兜底，单型一次抽足）。
 * 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1（多波演出窗口冻结战斗时钟，余量防不足）；
 * 库存不足的装置直接标记停机（组件一枚没有 = 开战即停）。无装置返回 null。
 * 返回结构的 nextPulseAtMs 恒为 undefined——由 startBattleFor 按开战时刻赋值
 * （全部装置停机则保持 undefined = 不调度）。
 */
export function preloadRepairFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  maxBattleMs: number,
): import('./state').BattleState['repair'] | null {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return null
  const units: import('./state').BattleRepairUnit[] = []
  const need = new Map<string, number>()
  const perUnit = Math.max(1, Math.ceil(maxBattleMs / REPAIR_PULSE_MS)) + 1
  // 无消耗自愈件（2026-09-10 船长：异形生体件）——修复量在**同型多件间按 EVE 曲线收敛**
  // （权重 100%/87%/57%/28%/11%，与"命中/速度"同类；不吃组件故必须收敛，否则叠装失控）
  const freeSeen = new Map<string, number>()
  for (const d of defs) {
    const isFree = d.repairFree === true
    let w = 1
    if (isFree) {
      const n = (freeSeen.get(d.id) ?? 0) + 1
      freeSeen.set(d.id, n)
      w = stackWeight(n)
    }
    if (isFree) {
      units.push({
        moduleId: d.id,
        kitId: '',
        free: true,
        armorPerPulse: Math.max(0, Math.round((d.repairArmorHp ?? 0) * w)),
        hullPerPulse: Math.max(0, Math.round((d.repairHullHp ?? 0) * w)),
        stopped: false,
      })
      continue
    }
    const kitId = d.repairKit ?? 'repairkit-civ'
    units.push({
      moduleId: d.id,
      kitId,
      armorPerPulse: Math.max(0, Math.round(d.repairArmorHp ?? 0)),
      hullPerPulse: Math.max(0, Math.round(d.repairHullHp ?? 0)),
      stopped: false,
    })
    need.set(kitId, (need.get(kitId) ?? 0) + perUnit)
  }
  // 装载（与 loadAmmo 同序：货舱优先、仓库兜底）
  const kits: Record<string, number> = {}
  for (const [kitId, wantTotal] of need) {
    let want = wantTotal
    const inCargo = Math.floor(cargoItemsOf(state)[kitId] ?? 0)
    const fromCargo = Math.min(want, inCargo)
    if (fromCargo > 0) {
      removeItem(state, kitId, fromCargo)
      want -= fromCargo
    }
    if (want > 0) {
      const fromWare = Math.min(want, countWare(state, kitId))
      if (fromWare > 0) {
        removeWare(state, kitId, fromWare)
        want -= fromWare
      }
    }
    const got = wantTotal - want
    if (got > 0) kits[kitId] = got
  }
  // 一枚组件都没装到的装置 → 开战即停机（脉冲逻辑跳过；缺料提示由 startBattleFor 日志给出）
  // 无消耗自愈件不参与组件检查（永不因缺料停机）
  for (const u of units) {
    if (u.free) continue
    if ((kits[u.kitId] ?? 0) <= 0) u.stopped = true
  }
  return { units, kits, nextPulseAtMs: undefined, pulses: 0, kitsUsed: 0 }
}

/** 退还维修装置预载的未用组件（回仓库；与弹药退还同哲学）——战斗结束/撤退收场调用；幂等 */
export function refundRepairKits(
  state: GameState,
  repair: import('./state').BattleState['repair'],
): void {
  if (!repair || !repair.kits || Object.isFrozen(repair.kits)) return
  for (const [id, n] of Object.entries(repair.kits)) {
    if (n > 0) addWare(state, id, Math.floor(n))
  }
  repair.kits = {}
}

/**
 * 单次维修脉冲（advanceBattleFor 在到期脉冲处调用）：
 * 逐台未停机装置修复——每层通道修复量 = 该层额度，某层已满（或补满）后，该层剩余额度
 * 转投另一层（单跳修复上限 = 甲 + 结构额度之和，痊愈后不再消耗）；每台实际修复 > 0 才扣
 * 1 枚对应组件并计入消耗；组件耗尽该台停机（日志一次）。修复上限 = 出场满值口径
 * （advanceBattleFor 重建的 me，与保险检查同源——可把入场残值修回满血）。
 */
function pulseRepairs(
  state: GameState,
  ctx: SimContext,
  b: import('./state').BattleState,
  me: UnitSpec,
): void {
  const r = b.repair
  const meRt = b.units['player']
  if (!r || !meRt || r.nextPulseAtMs === undefined) return
  const capA = Math.max(0, me.hp.a)
  const capH = Math.max(0, me.hp.h)
  const hp = meRt.hp
  let active = 0
  for (const u of r.units) {
    if (u.stopped) continue
    active += 1
    // 无消耗自愈件（repairFree）：不看组件余额、不扣组件、永不停机
    if (u.free) {
      const da0 = Math.max(0, capA - hp.a)
      const dh0 = Math.max(0, capH - hp.h)
      let ag0 = Math.min(u.armorPerPulse, da0)
      let hg0 = Math.min(u.hullPerPulse, dh0)
      if (ag0 < u.armorPerPulse && hg0 < dh0) hg0 += Math.min(u.armorPerPulse - ag0, dh0 - hg0)
      if (hg0 < u.hullPerPulse && ag0 < da0) ag0 += Math.min(u.hullPerPulse - hg0, da0 - ag0)
      if (ag0 <= 0 && hg0 <= 0) continue
      hp.a += ag0
      hp.h += hg0
      continue
    }
    const kitNow = r.kits[u.kitId] ?? 0
    if (kitNow <= 0) {
      // 组件耗尽（预载余额用光）：本台停机，日志一次
      u.stopped = true
      const modName = ctx.modules.get(u.moduleId)?.name ?? u.moduleId
      const kitName = ctx.items.get(u.kitId)?.name ?? u.kitId
      addLog(state, 'warn', `🔧 ${modName}的${kitName}耗尽，自动停机——战斗中装甲/结构修复暂停。`)
      continue
    }
    // 额度分配：各层先按自身额度补缺口，层满后剩余额度转投另一层（总上限 = 甲 + 结构额度）
    const da = Math.max(0, capA - hp.a)
    const dh = Math.max(0, capH - hp.h)
    let ag = Math.min(u.armorPerPulse, da)
    let hg = Math.min(u.hullPerPulse, dh)
    if (ag < u.armorPerPulse && hg < dh) hg += Math.min(u.armorPerPulse - ag, dh - hg) // 甲通道剩余 → 结构
    if (hg < u.hullPerPulse && ag < da) ag += Math.min(u.hullPerPulse - hg, da - ag) // 结构通道剩余 → 甲
    if (ag <= 0 && hg <= 0) continue // 痊愈空转：不耗组件
    hp.a += ag
    hp.h += hg
    r.kits[u.kitId] = kitNow - 1
    r.kitsUsed += 1
  }
  r.pulses += 1
  if (active === 0) r.nextPulseAtMs = undefined // 全部停机：停调度
  else r.nextPulseAtMs += REPAIR_PULSE_MS
}


export function createBattleState(
  me: UnitSpec,
  foes: UnitSpec[],
  nowMs: number,
  myDesireM: number,
): import('./state').BattleState {
  const units: Record<string, import('./state').BattleState['units'][string]> = {}
  for (const spec of [me, ...foes]) {
    units[spec.tag] = {
      tag: spec.tag,
      side: spec.side,
      name: spec.name,
      hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      weapons: spec.weapons.map(() => 0),
    }
  }
  return {
    startedAtGameMs: nowMs,
    lastTickGameMs: nowMs,
    distanceM: 0, // 由调用方按 battleOpenM 赋值
    myDesireM,
    units,
    ammo: { kin: 0, exp: 0, pla: 0 },
    stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
    fx: [],
    fxSeq: 0,
    ended: null,
  }
}

/** 按规格把单位补入战斗（多波续刷/读档补缺用；已存在（含 hp 归零的尸体）不覆盖）。
 * enterReload（2026-09-09 波次转场）：增援单位入场需先完成一轮装填（weapons 满倒计时）
 * 才开火——给"增援抵达"一段自然哑火窗口（≈一次装填时长），不改变任何结算语义。 */
function seedUnit(b: import('./state').BattleState, spec: UnitSpec, opts: { enterReload?: boolean } = {}): void {
  if (b.units[spec.tag]) return
  b.units[spec.tag] = {
    tag: spec.tag,
    side: spec.side,
    name: spec.name,
    hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    weapons: opts.enterReload ? spec.weapons.map((w) => Math.max(1, w.reloadMs)) : spec.weapons.map(() => 0),
  }
}

/** 追加可视化开火事件（环缓冲 48 条，超长丢最旧；纯展示）。
 * seq 由战斗内计数器自增分配——环头部裁剪后序号仍单调，UI 按 seq>last 续播不受裁剪影响。
 * 导出仅供"事件环回归测试"锁定该语义；引擎内部调用。 */
export function pushBattleFx(
  b: import('./state').BattleState,
  ev: Omit<import('./state').BattleFx, 'seq'>,
): void {
  b.fx.push({ ...ev, seq: b.fxSeq++ })
  if (b.fx.length > 48) b.fx.splice(0, b.fx.length - 48)
}

/** 到港开战通用组装（主控与 AI 共用）：建状态 + 预载弹药；返回 battle 或 null（数据缺失）。
 * atGameMs = 开战时刻（应传"到港时刻"，让离线大推进能把后续时间全部推完）。
 * desireM = 玩家期望距离偏好（缺省 = 主武器有效射程中点）。 */
/** 本场战斗的目标卡（2026-09-10）：赏金任务·窝点按 tier 现场派生强化卡（威胁/波次/僚机/名称）；
 *  敌对派系活跃（factionActive）= 当日选中星系的常驻悬赏威胁 ×1.1；
 *  普通悬赏、低安遭遇（都没设）一律返回原卡。战斗构建、推进、展示共用此口，避免口径漂移。 */
export function battleAnomalyOf(
  ctx: SimContext,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
): AnomalyDef | undefined {
  const base = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!base) return undefined
  const card = lairTier ? lairAnomalyOf(base, lairTier) : base
  return factionActive ? factionAnomalyOf(card) : card
}
export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number,
): import('./state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = battleAnomalyOf(ctx, anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  // P0 承伤持久化：装甲/结构（=耐久合并属性）按场间残余开局；护盾每场满值重建
  const fleetShip = state.fleet[shipId]
  if (fleetShip) {
    const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
    const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
    me.hp.a = Math.max(0, me.hp.a * armorMul)
    me.hp.h = Math.max(0, me.hp.h * hullMul)
  }
  // 序章·苏醒：教学战加成（开战规格重建处也注入，命中/回避影响后续弹道与 UI 读到的克制无涉）
  if (isTutorialBattle(state, anomalyId, shipId)) applyTutorialBuff(me)
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离记忆可能来自更远射程的战斗：钳到本次开战距离内
  const rawDesire = desireM !== undefined && desireM > 0 ? Math.round(desireM) : desiredRangeFor(me, 'mid', bal)
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire)
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  battle.distanceM = openM
  // V18B-2：per-gun 多键预载——动能/爆破导弹/能量弹药各按自身装填估量装载
  // （纯激光船也能带上能量弹药；混装各型互不挤占）
  // 2026-09-09 弹药 MK2：按船装配档位（ammoPref）装载；配置档库存不足整族回退基础弹 +
  // 日志提示；实装弹 id 写入 battle.ammoIds（推进/退还/视图与实际弹种对齐）
  const totals = ammoLoadTotals(me, bal, state)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const [t, n] of Object.entries(totals)) {
    const type = t as DamageType
    const key = ammoKeyOf(type)
    const res = loadAmmoTier(state, ctx, shipId, type, n)
    battle.ammo[key] += res.loaded
    if (state.fleet[shipId]?.ammoPref?.[type] && res.loaded > 0) ammoIds[type] = res.id
    if (res.fellBack && res.loaded > 0) {
      const wantName = ctx.items.get(state.fleet[shipId]!.ammoPref![type]!)?.name ?? type
      const useName = ctx.items.get(res.id)?.name ?? type
      addLog(state, 'warn', `⚙ ${wantName}库存不足，本场改用${useName}（预载 ${res.loaded} 发）。`)
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // 机群生存池（2026-09-10 船长「无人机可被击落」）：按武器条目下标建池——只有 src='drone'
  // 的条目参战；机型三层血/抗性/闪避取自物品本体（DroneDefense，四型定位契约见 data/droneRoles.ts）
  const pools: Record<number, import('./state').DronePoolEntry> = {}
  // 无人机线技能（2026-09-10 船长）：耐久学（基础档）与强化学（进阶档）**乘算**放大三层血
  // （"全血条"）、规避学提闪避（封顶 0.9）
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  me.weapons.forEach((w, i) => {
    if (w.src !== 'drone' || !w.artId) return
    const d = ctx.items.get(w.artId)?.defense
    pools[i] = {
      s: Math.max(1, Math.round((d?.shieldHp ?? 1) * durMul)),
      a: Math.max(1, Math.round((d?.armorHp ?? 1) * durMul)),
      h: Math.max(1, Math.round((d?.hullHp ?? 1) * durMul)),
      alive: true,
      artId: w.artId,
      evasion: clamp(0, 0.9, (d?.evasion ?? 0) * evaMul),
      ...(d
        ? {
            resists: {
              ...(d.shieldResist ? { shield: d.shieldResist } : {}),
              ...(d.armorResist ? { armor: d.armorResist } : {}),
              ...(d.hullResist ? { hull: d.hullResist } : {}),
            },
          }
        : {}),
    }
  })
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    battle.droneLost = {}
    // 开战清单快照（战后判定"机群战损过半"→ 停重复清剿用）
    battle.droneLoadAtStart = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
  }
  // 近防炮调度（威胁 ≥ pdThreatFloor 的敌舰各装一台；与敌编队同序、独立冷却）
  if (pdEnabledFor(anomaly.threat, bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  // 船体维修装置（2026-09-09 船长定）：装配快照 + 修理组件预载（货舱优先、仓库兜底）；
  // 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1，战斗结束退还未用（与弹药同哲学）
  const repair = preloadRepairFor(state, ctx, shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    if (ready.length > 0) {
      repair.nextPulseAtMs = battle.startedAtGameMs + REPAIR_PULSE_MS // 开战 5 秒后第一跳
      const parts: string[] = []
      for (const u of repair.units) {
        const modName = ctx.modules.get(u.moduleId)?.name ?? u.moduleId
        // 无消耗自愈件（生体件）：不吃组件，单列说明
        if (u.free) {
          parts.push(`${modName}（自愈：每跳修甲 ${u.armorPerPulse} / 结构 ${u.hullPerPulse}，无需组件）`)
          continue
        }
        const n = repair.kits[u.kitId] ?? 0
        parts.push(`${modName}${u.stopped ? `（缺${ctx.items.get(u.kitId)?.name ?? u.kitId}停机）` : ` ×${n}枚组件`}`)
      }
      addLog(state, 'info', `🔧 船体维修装置待命：${parts.join('、')}——战斗中每 5 秒自动修复装甲/结构。`)
    } else {
      const first = repair.units[0]!
      const kitName = ctx.items.get(first.kitId)?.name ?? first.kitId
      addLog(state, 'warn', `🔧 已装维修装置但货舱/仓库没有${kitName}——本场不会自动修复，请先补给。`)
    }
    battle.repair = repair
  }
  return battle
}

/** 战斗射程带查询（小剧场距离条用）：返回双方主武器带与开战距离上限；无战斗返回 null */
export function battleZonesFor(state: GameState, ctx: SimContext): {
  openM: number
  me: { minM: number; maxM: number; name: string }
  foe: { minM: number; maxM: number }
} | null {
  const anomaly = battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const main = me.weapons.find((w) => w.kind === 'gun') ?? me.weapons[0]!
  let foeMin = 0
  let foeMax = 0
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
    }
  }
  return {
    openM: battleOpenM(me, foes, bal),
    me: { minM: main.minRangeM, maxM: main.maxRangeM, name: main.label },
    foe: { minM: foeMin, maxM: foeMax },
  }
}

/** 战斗可视化武器卡（战场射程弧/弹药颜色用）：返回双方射程带、当前弹药与开火弹型。
 * 我方逐武器展开：炮台颜色 = 与引擎同口径的"剩余最多弹型"（无弹 null，画虚线灰弧）；
 * 敌方整编队聚合一道（同型同射程）。无战斗/数据缺失返回 null。 */
export function battleArcsFor(
  state: GameState,
  ctx: SimContext,
): {
  nearM: number
  openM: number
  /** 敌方当前战术期望距离（与引擎推进同口径：按战术系数换算后钳制在开战距离内）——UI 判断敌舰意图方向用 */
  foeDesireM: number
  ammo: { kin: number; exp: number; pla: number }
  /** 弹药 MK2（2026-09-09）：本场实装弹名（键 → 弹药卡名；缺省 = UI 用默认弹型名） */
  ammoNames?: Partial<Record<'kin' | 'exp' | 'pla', string>>
  me: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    /** 武器装填周期毫秒（静态；UI 冷却条分母） */
    reloadMs: number
    /** 武器来源（2026-09-10：无人机条目据此出机群/弹道；缺省 = 旧口径） */
    src?: WeaponSrc
    /** 无人机机型 id（src='drone'）；UI 按机型出机体与弹点 */
    artId?: string
    /** 该条目合并的架数（无人机同机型多架合并为「机型 ×N」一条；非无人机为 1） */
    count?: number
  }>
  /** 我方各武器当前装填剩余毫秒（与 me 同序；0 = 可开火；战斗单位缺失时为空数组） */
  meReload: number[]
  foe: { minM: number; maxM: number; type: DamageType }
  /** 各单位三层满血量（UI 垂直血条按各自满值比例绘制） */
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
  /** 机群战损（2026-09-10）：本场已击落架数（机型 id → 架数）；缺省 = 无损失 */
  droneLost?: Record<string, number>
} | null {
  const anomaly = battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  const battle = state.expedition.battle
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId, battle.ammoIds) // 弹药 MK2：视图与实际弹种对齐
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const ammoLeft = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const dominant = nextAmmoType(battle.ammo)
  /** 我方各武器当前装填剩余（与 units['player'].weapons 同序；单位缺失 = 空） */
  const meRt = battle.units['player']?.weapons ?? []
  /**
   * 2026-09-10 船长批：无人机逐架条目在弧列表里合并为「机型 ×N」一条（16 架蜂鸟不再 16 条弧/16 条冷却条）。
   * 冷却剩余取组内最小值（任一可开火即视为群就绪）；非无人机条目原样一条。
   */
  const meArcs: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    reloadMs: number
    src?: WeaponSrc
    artId?: string
    count?: number
  }> = []
  const meReload: number[] = []
  const droneAt = new Map<string, number>()
  const droneN: number[] = []
  me.weapons.forEach((w, i) => {
    // 2026-09-10 船长「无人机可被击落」：被点防打掉的架次不出现在射程弧/机群计数里
    if (w.src === 'drone' && battle.dronePools?.[i]?.alive === false) return
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (w.kind === 'beam') type = battle.ammo.pla > 0 ? 'plasma' : null // 激光吃能量弹药键
    else if (ammoLeft > 0) type = dominant // 炮台弹型动态（消耗中可能切换）
    const rem = Math.max(0, Math.floor(meRt[i] ?? 0))
    if (w.src === 'drone') {
      const key = w.artId ?? 'drone'
      const at = droneAt.get(key)
      if (at !== undefined) {
        droneN[at] = (droneN[at] ?? 1) + 1
        meReload[at] = Math.min(meReload[at] ?? rem, rem)
        return
      }
      droneAt.set(key, meArcs.length)
      droneN.push(1)
      meArcs.push({
        label: w.label,
        kind: w.kind,
        type,
        minM: w.minRangeM,
        maxM: w.maxRangeM,
        reloadMs: w.reloadMs,
        src: w.src,
        artId: w.artId,
        count: 1,
      })
      meReload.push(rem)
      return
    }
    meArcs.push({
      label: w.label,
      kind: w.kind,
      type,
      minM: w.minRangeM,
      maxM: w.maxRangeM,
      reloadMs: w.reloadMs,
      src: w.src,
      count: 1,
    })
    meReload.push(rem)
  })
  meArcs.forEach((a, i) => {
    const n = droneN[droneAt.get(a.artId ?? '') ?? -1]
    if (a.src === 'drone' && n !== undefined) {
      a.count = n
      if (n > 1) a.label = `${a.label}×${n}`
    }
  })
  // 我方各武器当前装填剩余已在上面与 meArcs 同步构建（无人机按机型合并、组内取最小值）
  // 敌方整编队聚合：min/max 跨各单位武器取极值（min 以 +∞ 起步——否则 0 初值会把
  // 近盲带最小射程吞成 0，底部"敌方 X~Ym"显示错误，2026-09-08 玩家反馈）
  let foeMin = Number.POSITIVE_INFINITY
  let foeMax = 0
  let foeType: DamageType = 'kinetic'
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
      foeType = w.fixedType ?? 'kinetic'
    }
  }
  if (!Number.isFinite(foeMin)) foeMin = 0
  const openM = battleOpenM(me, foes, bal)
  // 各单位三层满血量（UI 垂直血条按各自满值比例绘制）：以战斗实况单位为准——
  // 2026-09-09 多波修复：foes 仅按"单波默认"重建，波次增援/多小队单位（w{n}-foe-* 等）不在其内，
  // 曾致后续波敌人血条为空（数值正常）；现优先 battle.units[tag].hpMax（引擎生成时写入），
  // 旧档缺省 hpMax 时以当前血兜底（读档中断局近似满值显示）。
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    foeMaxHp[tag] = u.hpMax ?? { s: Math.max(0.001, u.hp.s), a: Math.max(0.001, u.hp.a), h: Math.max(0.001, u.hp.h) }
  }
  // 弹药 MK2（2026-09-09）：本场实装弹名（仅当与基础弹不同时提供；UI 兜底用弹型名）
  const ammoNames: Partial<Record<'kin' | 'exp' | 'pla', string>> = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const id = battle.ammoIds?.[t]
    if (!id) continue
    const def = ctx.items.get(id)
    if (def?.name && id !== AMMO_IDS[t]) ammoNames[ammoKeyOf(t)] = def.name
  }
  return {
    nearM: bal.minDistanceM,
    openM,
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    ...(Object.keys(ammoNames).length > 0 ? { ammoNames } : {}),
    me: meArcs,
    meReload,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
    // 机群战损（2026-09-10）：本场已击落架数（UI 战报/提示用；缺省 = 无损失）
    ...(battle.droneLost && Object.keys(battle.droneLost).length > 0 ? { droneLost: battle.droneLost } : {}),
  }
}

/**
 * 预估胜率扩散（logit 空间线性拉伸，k>1）：
 * - 0.5 为不动点（五五开不变）；
 * - 越高的胜率加成越大（如 0.80 → ~0.90），保证"高胜率=高置信"，玩家不会在显示高胜率时
 *   因模型边缘误差而意外翻车；
 * - 越低的胜率惩罚越重（如 0.20 → ~0.10），杜绝"摸奖"式硬闯高难敌人。
 * 只作用于预估展示与 AI 接单门槛；实际战斗按实时引擎结算（随机性不受影响）。
 */
export function spreadWinChance(p: number, k: number): number {
  const t = clamp(0.001, 0.999, p)
  if (k <= 1) return clamp(0.02, 0.98, t)
  const logit = Math.log(t / (1 - t))
  const s = 1 / (1 + Math.exp(-k * logit))
  return clamp(0.02, 0.98, s)
}

/**
 * P0 承伤持久化：把装甲/结构残余写回船（结构 = 耐久合并属性；护盾不保留）。
 * cap 用该船当前满值（技能/装配同源 createPlayerSpec）——换装后残余按新上限比例折算。
 * 调用方在战斗结束（或手动撤退收场）后、其余结算（失利附加扣损等）之前调用；
 * battle.ended 为空也允许（撤退时记录当前残余）。
 */
export function persistFleetHullDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
): void {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return
  const unit = battle?.units['player']
  if (!unit) return
  const cap = createPlayerSpec(state, ctx, shipId)
  if (!cap) return
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  fleetShip.armorPct = cap.hp.a > 0 ? clamp01(unit.hp.a / cap.hp.a) : 1
  fleetShip.durability = cap.hp.h > 0 ? clamp01(unit.hp.h / cap.hp.h) : 0
}

/**
 * 机群战损结算（2026-09-10 船长拍板「无人机可被击落」+ **永久损失制**）：
 * 把本场被点防击落的架数从该船无人机舱清单里**永久扣除**（清单是"带上船的那批"，
 * 本就不在仓库里——扣清单即真实损失），并写事件日志 + 一次性提示（渲染层读到弹 toast）。
 * 胜负/撤退都照扣（打掉的飞机不会因为撤退飞回来）；在 resolveBattleOutcome 等结算入口调用，
 * 且必须在其它结算之前（战报文案要用损失摘要）。
 * 返回损失摘要文案（无损失 = null）。
 */
export function settleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
): string | null {
  const lost = battle?.droneLost
  if (!lost) return null
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  // 战后回收（2026-09-10 船长：回收损坏机体的 10%，回收学每级 +8%、满级 50%）——
  // 按机型四舍五入取回，**回无人机舱清单**继续服役；未回收部分才永久损失
  const rate = droneRecoveryRate(state)
  const load: Record<string, number> = { ...(fleetShip.droneLoad ?? {}) }
  const lostParts: string[] = []
  const backParts: string[] = []
  let total = 0
  let recovered = 0
  for (const [id, n] of Object.entries(lost)) {
    if (!n || n <= 0) continue
    const have = load[id] ?? 0
    const cut = Math.min(have, n)
    const back = Math.min(cut, Math.round(cut * rate)) // 回收（不超过损坏数）
    const gone = cut - back
    if (gone > 0) {
      const left = have - gone
      if (left > 0) load[id] = left
      else delete load[id]
    }
    total += cut
    recovered += back
    const name = ctx.items.get(id)?.name ?? id
    lostParts.push(`${name}×${cut}`)
    if (back > 0) backParts.push(`${name}×${back}`)
  }
  if (total <= 0) return null
  fleetShip.droneLoad = Object.keys(load).length > 0 ? load : undefined
  // 结算后清空战损账本（调用幂等：重复结算不会重复扣；战报/日志已带损失摘要）
  battle!.droneLost = undefined
  const text = lostParts.join('、')
  const ratePct = Math.round(rate * 100)
  const backTxt = backParts.length > 0 ? `，其中 ${backParts.join('、')} 已回收修复归队` : ''
  addLog(
    state,
    'warn',
    `⚠ 机群战损：损坏 ${text}（合计 ${total} 架）${backTxt}（回收率 ${ratePct}%，净损失 ${total - recovered} 架）——净损失已从无人机舱清单扣除，回港需补充。`,
  )
  state.droneLossNotice =
    recovered > 0
      ? `机群战损：损坏 ${total} 架，回收 ${recovered} 架归队（回收率 ${ratePct}%），净损失 ${total - recovered} 架。`
      : `机群战损：${text} 被近防炮击落（回收率 ${ratePct}%），回港后请补充无人机舱清单。`
  return text
}

/** 多波演出窗口总时长（2026-09-09）：单次大预算推进（胜率 MC/校准工具）把 state.gameMs * 一次设到 maxBattleMs+余量——若波次间隙（waveEnterGapMs，战斗时钟冻结）吃掉余量，末段
 * 跨窗口会提前耗尽预算判负。调用方应在预算外加本值（无 waves = 0）。 */
export function waveGapTotalMs(anomaly: Pick<AnomalyDef, 'waves'> | undefined, bal: BattleBalance): number {
  const n = anomaly?.waves?.length ?? 1
  return Math.max(0, n - 1) * Math.max(0, bal.waveEnterGapMs ?? 0)
}

/** 推进指定战斗（主控远征与 AI 远征通用）；结束后 ended 非空由调用方结算。
 *  favorAdv：AI 远征专属优势量 ∈[−1,1]（null = 玩家手动战斗，无 favor）——
 *  AI 方命中 ×(1+k·adv)（可到 100%），敌方 ×(1−k·adv)（上限保留 97%）。 */
export function advanceBattleFor(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipId: string,
  anomalyId: string | null,
  favorAdv: number | null = null,
  lairTier?: LairTier,
  factionActive?: boolean,
): void {
  if (!battle || battle.ended) return
  const anomaly = battleAnomalyOf(ctx, anomalyId, lairTier, factionActive)
  if (!anomaly) return
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 重建（回退同源）
  if (!me) {
    battle.ended = 'foe'
    return
  }
  // 序章·苏醒：教学战（教程步骤4 + 演习场 + 主控）给玩家舰 命中/回避加成（每拍规格重建处注入）
  if (isTutorialBattle(state, anomalyId, shipId)) applyTutorialBuff(me)
  const foes = createFoeSpecs(anomaly, bal)
  const foeDesire = foeDesiredRange(me, foes, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  // 多波次（2026-09-09）：按 AnomalyDef.waves 分批推进；无 waves = 单波（现行为）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const lastIdx = waves ? waves.length - 1 : 0
  const specsOf = (wi: number): UnitSpec[] =>
    waves
      ? createFoeSpecs(anomaly, bal, {
          units: waves[wi]!.units,
          hpShare: waves[wi]!.hpShare,
          tagPrefix: wi === 0 ? '' : `w${wi}-`,
        })
      : createFoeSpecs(anomaly, bal)
  let waveIdx = Math.min(battle.waveIdx ?? 0, lastIdx)
  let curFoes = specsOf(waveIdx)
  // 开战首波由 startBattleFor 生成（无装填延迟）；此处只兜读档中断补缺（视为增援入场）
  for (const f of curFoes) seedUnit(battle, f, { enterReload: true })
  let guard = 0
  while (state.gameMs > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    // 切波：当前波全灭且还有后续波 → 先走演出窗口（爆炸/残骸播完），窗口结束才续刷下一波。
    // 窗口语义（2026-09-09 船长反馈"切换突兀/爆炸未播完就刷下一波"）：
    // - 清空瞬间记 waveClearAt = 战斗时钟 + waveEnterGapMs；窗口内本拍只停表等待
    //   （battle.lastTickGameMs 不推进——与击杀慢镜同语义：演出时间不计入 maxBattleMs 超时）；
    // - 实时战斗中游戏时钟与墙钟 1:1，窗口 = 上一波最后一艘的爆炸 + 残骸淡出完整播完；
    // - 大步长/离线推进下 state.gameMs 越过窗口即立刻续刷，无额外等待。
    if (waves && waveIdx < lastIdx && !curFoes.some((f) => isAlive(battle, f.tag))) {
      const gapMs = Math.max(0, bal.waveEnterGapMs ?? 0)
      if (gapMs > 0 && battle.waveClearAt === undefined) {
        battle.waveClearAt = battle.lastTickGameMs + gapMs
        const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
        addLog(
          state,
          'warn',
          `⚔ 第 ${waveIdx + 1}/${waves.length} 波已全灭（${waveName ? waveName + '·' : ''}${anomaly.name}），敌方增援正在从远处入场…`,
        )
      }
      if (gapMs > 0 && battle.waveClearAt !== undefined && state.gameMs < battle.waveClearAt) break // 演出窗口未走完：停表等待，下一拍再续
      battle.waveClearAt = undefined
      waveIdx += 1
      battle.waveIdx = waveIdx
      curFoes = specsOf(waveIdx)
      for (const f of curFoes) seedUnit(battle, f, { enterReload: true }) // 增援入场装填（转场窗口）
      // 近防炮调度随波重建（pdCd 与敌编队同序）
      if (battle.pdCd && battle.dronePools) {
        battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
      }
      // 波次转场（2026-09-09 船长建议）：把战斗距离向开战距离回拉 waveReopenFrac 比例——
      // 增援从"更远的接战距离"进入，双方重新接近（重演接近期，kite/远程敌同样被拉回）；
      // 0 = 原地续战（旧行为），1 = 完整回到开战距离
      const reopen = bal.waveReopenFrac ?? 0
      if (reopen > 0 && Number.isFinite(openM)) {
        battle.distanceM = Math.round(openM * reopen + battle.distanceM * (1 - reopen))
      }
      const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
      addLog(
        state,
        'warn',
        `⚔ 第 ${waveIdx + 1}/${waves.length} 波来袭（${waveName ? waveName + '·' : ''}${anomaly.name}）：敌方增援自远处入场，重新接近中。`,
      )
      continue
    }
    const dt = Math.min(BATTLE_STEP_MS, state.gameMs - battle.lastTickGameMs)
    stepBattle(state, battle, me, curFoes, foeDesire, openM, bal, dt, favor, waves ? waveIdx < lastIdx : false)
    battle.lastTickGameMs += dt
    // 连续作战保险（2026-09-08 船长定，仅巡回场次 battle.hullEscapeFrac 有值）：
    // 本场结构损失过半（剩余 < 满值结构 × 阈值）→ 中止步进并请求自动撤退，绝不拖到弃船
    if (!battle.autoEscaped && battle.hullEscapeFrac !== undefined) {
      const pl = battle.units['player']
      if (pl && pl.hp.h < me.hp.h * battle.hullEscapeFrac) {
        battle.autoEscaped = true
        break
      }
    }
    // 船体维修装置脉冲（2026-09-09）：本拍内到期的脉冲补齐——修复发生在受伤结算之后
    // （≤1 拍延迟，保守口径）；战斗结束/自动撤退后不再补跳
    if (!battle.ended && battle.repair?.nextPulseAtMs !== undefined && battle.repair.nextPulseAtMs <= battle.lastTickGameMs) {
      let guardR = 0
      while (
        !battle.ended &&
        battle.repair.nextPulseAtMs !== undefined &&
        battle.repair.nextPulseAtMs <= battle.lastTickGameMs &&
        guardR < BATTLE_MAX_STEPS
      ) {
        pulseRepairs(state, ctx, battle, me)
        guardR++
      }
    }
  }
}

/** 推进当前主控远征的战斗（到耗尽时间或分出胜负） */
export function advanceBattle(state: GameState, ctx: SimContext): void {
  const battle = state.expedition.battle
  if (battle) advanceBattleFor(state, ctx, battle, state.shipId, state.expedition.anomalyId)
}

/* ══════════ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制） ══════════ */

/** 无人机线技能系数（2026-09-10 船长：四条新技能；接线点集中在此，改数值 = 同步 skills.ts 的 ⟦…⟧） */
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
  /** 无人机回收学：战后回收损坏机体，基础 10% + 8%/级（满级 50%） */
  recoveryBase: 0.1,
  recoveryPerLevel: 0.08,
  recoveryMax: 0.5,
} as const

/** 无人机技能等级读取（0~5） */
function droneSkillLv(state: GameState, id: string): number {
  return Math.min(5, state.skills.trained[id] ?? 0)
}

/** 战后损坏机体的回收比例（2026-09-10 船长：基础 10%，回收学满级 50%） */
export function droneRecoveryRate(state: GameState): number {
  const rate = DRONE_SKILL.recoveryBase + DRONE_SKILL.recoveryPerLevel * droneSkillLv(state, 'drone-recovery')
  return Math.min(DRONE_SKILL.recoveryMax, rate)
}

/** 该威胁的敌舰是否装近防炮（威胁 < pdThreatFloor 不装；2026-09-10 船长：60） */
export function pdEnabledFor(threat: number, bal: BattleBalance): boolean {
  return threat >= bal.pdThreatFloor
}
/**
 * 近防炮可选靶（存活放飞条目下标）：
 * - 默认**排除哨戒机**（2026-09-10 船长：近防炮不打哨戒无人机）；
 * - **非哨戒机全被摧毁后，近防炮转而攻击哨戒机**（2026-09-10 船长追加）——
 *   即"机群里还有别的机型就先打别的，只剩哨戒机时才打它"。
 */
function aliveDroneIndices(
  b: import('./state').BattleState,
  sentryIds: ReadonlySet<string> = SENTRY_DRONE_IDS,
): number[] {
  const pools = b.dronePools
  if (!pools) return []
  const others: number[] = []
  const sentries: number[] = []
  for (const [k, p] of Object.entries(pools)) {
    if (!p.alive) continue
    if (p.artId && sentryIds.has(p.artId)) sentries.push(Number(k))
    else others.push(Number(k))
  }
  return others.length > 0 ? others : sentries
}

/** 哨戒机机型 id（近防炮不打哨戒无人机；机型表变化时此处同步） */
const SENTRY_DRONE_IDS: ReadonlySet<string> = new Set(['drone-sentry'])

/** 存活放飞条目下标（近防炮选靶 / 开火跳过共用）；`droneTotalCount` 已随"取消单场上限"移除用途 */

/** 本场已击落架数 */
export function droneLostCount(b: import('./state').BattleState): number {
  return Object.values(b.droneLost ?? {}).reduce((s, n) => s + n, 0)
}

/**
 * 近防炮结算（每拍调用；2026-09-10 船长口径）：
 * - 每艘点防舰**独立**按 `pdJudgementMs`（0.5s）判定一次；
 * - 随机挑一架**正在攻击的放飞无人机**（存活；**默认不打哨戒机，但非哨戒机全灭后转而打它**）
 *   → 按 `pdAcc − 机型闪避` 掷命中；
 * - 命中按 `pdDmg` 走该机型三层抗性；血量打空 = 该架本场击落（停火 + 计入 droneLost）；
 * - **不看距离**（放飞出去就在威胁之下）；**战斗内可 100% 损坏**（2026-09-10 船长：
 *   取消原 50% 单场上限）——战后按回收率找回一部分（见 settleDroneLosses）；
 * - 近防炮不参与敌舰对玩家的常规攻击（独立系统）；全程消费 state.rng，确定性可复现。
 */
function resolvePointDefense(
  state: GameState,
  b: import('./state').BattleState,
  me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  dtMs: number,
): void {
  const pools = b.dronePools
  // 无近防炮调度 = 本场敌舰未达威胁门槛（或本改动前的旧战斗）：不结算
  if (!pools || b.pdCd === undefined) return
  const period = Math.max(100, Math.round(bal.pdJudgementMs))
  for (let fi = 0; fi < foes.length; fi++) {
    if (!isAlive(b, foes[fi]!.tag)) continue
    let cd = (b.pdCd[fi] ?? period) - dtMs
    let guard = 0
    while (cd <= 0 && guard < 64) {
      guard++
      cd += period
      const cands = aliveDroneIndices(b)
      if (cands.length === 0) break
      const idx = cands[Math.min(cands.length - 1, Math.floor(nextRandom(state.rng) * cands.length))]!
      const pool = pools[idx]!
      const w = me.weapons[idx]!
      const pHit = clamp(0, 1, bal.pdAcc - pool.evasion)
      if (nextRandom(state.rng) >= pHit) continue // 未命中（闪避生效）
      const res = applyDamage({ s: pool.s, a: pool.a, h: pool.h }, pool.resists ?? {}, bal.pdDmg, 'kinetic')
      pool.s = res.hp.s
      pool.a = res.hp.a
      pool.h = res.hp.h
      if (pool.s + pool.a + pool.h <= 0) {
        pool.alive = false
        const artId = w.artId ?? 'drone'
        b.droneLost = { ...(b.droneLost ?? {}) }
        b.droneLost[artId] = (b.droneLost[artId] ?? 0) + 1
        // 击落演出事件（side='me' + src='drone' + droneDown：UI 出小爆炸/坠落）
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: 'player',
          type: 'kinetic',
          src: 'drone',
          artId,
          hit: true,
          droneDown: true,
        })
      }
    }
    b.pdCd[fi] = cd
  }
}

function stepBattle(
  state: GameState,
  b: import('./state').BattleState,
  me: UnitSpec,
  foes: UnitSpec[],
  foeDesire: number,
  openM: number,
  bal: BattleBalance,
  dtMs: number,
  favor: { meMul: number; foeMul: number } | null = null,
  hasMoreWaves = false, // 多波（2026-09-09）：本波清空但还有后续波 → 不判胜，由推进方切波续刷
): void {
  const dtSec = dtMs / 1000

  // ── 距离机动（无过冲转向：每方朝自己期望距离推进，剩余距离不足本步航程时只走剩余，
  //    到位即停；双方意图相反时在中间形成无振荡角力平衡，杜绝"到点来回抖动"）──
  const meV = combatSpeed(me.speedMps, me.agility, bal)
  let foeV = 0
  for (const f of foes) if (isAlive(b, f.tag)) foeV = Math.max(foeV, combatSpeed(f.speedMps, f.agility, bal))
  // 敌方期望距离不得超出开战距离（近距开局下 kite 战术系数可能越界 → 钳制，避免一直想拉开）
  const foeDesireClamped = Math.min(openM, foeDesire)
  const rate = steerStep(b.distanceM, b.myDesireM, meV, dtSec) + steerStep(b.distanceM, foeDesireClamped, foeV, dtSec)
  b.distanceM = clamp(bal.minDistanceM, openM, b.distanceM + rate)

  // ── 我方开火（主炮 + 无人机条目） ──
  const meRt = b.units['player']
  if (meRt && isAlive(b, 'player')) {
    for (let wi = 0; wi < me.weapons.length; wi++) {
      const w = me.weapons[wi]!
      // 2026-09-10 船长「无人机可被击落」：已被点防打掉的架次不再开火（条目保留占位）
      if (w.src === 'drone' && b.dronePools?.[wi]?.alive === false) continue
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      if (!inRange(b.distanceM, w)) continue
      // V18B 随机目标（船长 2026-09-05）：每发武器在开火瞬间从存活敌人中独立抽取
      // （确定性 rng 种子，可复现；齐射可分散到不同目标）。目标死亡即时换人——
      // 修复旧"每步缓存单一集火目标、齐射轮内打已死目标浪费火力"的问题。
      // 2026-09-09 锁定装置：装上即切换"集火模式"——不再随机，全部武器打存活编队首位
      // （主舰优先，击毁自动接力下一艘；rng 零消耗，可复现性保持）
      const foeTarget = me.lockedDmgBonus ? firstAliveFoe(foes, b) : randomAliveFoe(state, b, foes)
      if (!foeTarget) continue
      let type: DamageType
      let dmg: number
      let autoHit = false
      if (w.kind === 'gun') {
        // V18B-2 per-gun 弹型：每件武器打自己的键（动能/爆破导弹/能量弹药混装各自供弹），
        // 该键弹尽 → 本武器停火（不拖累其它型）
        const pick = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
        if (!pick || b.ammo[ammoKeyOf(pick)] <= 0) {
          meRt.weapons[wi] = w.reloadMs // 无弹：等一轮再查（避免每步空转）
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        b.ammo[ammoKeyOf(pick)] -= 1
        meRt.weapons[wi] = w.reloadMs
      } else if (w.kind === 'beam') {
        // V18B-2 激光：必中光束——逐发扣能量弹药；威力随距离衰减（beamPowerFactor）
        if (b.ammo.pla <= 0) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = 'plasma'
        b.ammo.pla -= 1
        dmg = Math.max(1, Math.round((w.shotDmg ?? 0) * beamPowerFactor(b.distanceM, w)))
        meRt.weapons[wi] = w.reloadMs
        autoHit = true
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        meRt.weapons[wi] = w.reloadMs
      }
      b.stats.meShots += 1
      // AI favor：我方（AI 副船）命中按优势放大，上限放开到 100%（可必中）；
      // beam 已必中（autoHit），不掷骰、favor 不放大
      const meHit = autoHit ? 1 : hitChance(w, me, foeTarget, b.distanceM, bal)
      const meHitEff = autoHit ? 1 : favor ? clamp(0, 1, meHit * favor.meMul) : meHit
      const hit = dmg > 0 && (autoHit || nextRandom(state.rng) < meHitEff)
      if (hit) {
        b.stats.meHits += 1
        const rt = b.units[foeTarget.tag]!
        // 锁定装置：被锁目标受本舰伤害加深（对锁定目标的任意命中都乘入；2026-09-09）
        const dmgLocked = me.lockedDmgBonus ? Math.round(dmg * (1 + me.lockedDmgBonus)) : dmg
        const r = applyDamage(rt.hp, {}, dmgLocked, type)
        rt.hp = r.hp
        b.stats.meDmg += r.dealt
      }
      pushBattleFx(b, {
        atMs: b.lastTickGameMs + dtMs,
        side: 'me',
        tag: 'player',
        to: foeTarget.tag,
        type,
        src: w.src,
        artId: w.artId,
        hit,
      })
    }
  }

  // ── 敌方开火（集火我方） ──
  for (const f of foes) {
    const rt = b.units[f.tag]
    if (!rt || !isAlive(b, f.tag)) continue
    const w = f.weapons[0]!
    const cd = rt.weapons[0] ?? 0
    if (cd > 0) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    rt.weapons[0] = w.reloadMs
    // V18B（2026-09-05 船长拍板）：敌人近盲带（dist < minRange）内**不停火**——放行到
    // maxRange 内即可开火；伤害按 blindDmgMul 打折（玩家贴脸钻近盲不再零风险）。
    // 玩家武器无此待遇（近盲带内仍不开火）——双方在近盲带上行为区分。
    if (b.distanceM > w.maxRangeM || !meRt) continue
    b.stats.foeShots += 1
    const fType = w.fixedType ?? 'kinetic'
    // 2026-09-08（船长定）：能量（beam）= 必中——不掷命中骰；威力：近盲带内 ×blindDmgMul
    // （近盲带保留），带内至远端按 beamPowerFactor 距离衰减（与玩家激光同源语义）
    if (w.kind === 'beam') {
      const pow = b.distanceM < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(b.distanceM, w)
      const dmg = Math.max(1, Math.round((w.shotDmg ?? 0) * pow))
      b.stats.foeHits += 1
      const r = applyDamage(meRt.hp, me.resists, dmg, fType)
      meRt.hp = r.hp
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: 'player', type: fType, hit: true })
      continue
    }
    const blindMul = b.distanceM < w.minRangeM ? (w.blindDmgMul ?? 0.3) : 1
    const shotDmg = blindMul < 1 ? Math.max(1, Math.round((w.shotDmg ?? 0) * blindMul)) : (w.shotDmg ?? 0)
    // AI favor：敌方命中被优势压制，且始终保留 97% 命中上限（3% miss 底线不变）
    const foeHit = hitChance(w, f, me, b.distanceM, bal)
    const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
    const fHit = nextRandom(state.rng) < foeHitEff
    if (fHit) {
      b.stats.foeHits += 1
      const r = applyDamage(meRt.hp, me.resists, shotDmg, fType)
      meRt.hp = r.hp
    }
    pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: 'player', type: fType, hit: fHit })
  }

  // ── 敌方点防（2026-09-10 船长「无人机可被击落」）：对我方放飞机群逐架结算 ──
  resolvePointDefense(state, b, me, foes, bal, dtMs)

  // ── P0：护盾战中被动回充（EVE 式；损失不跨场，只回盾层）。
  // 甲/结构已打穿时停止回充——避免"只剩一层盾皮"的无限僵持（P2 可再调）──
  if (meRt && bal.shieldRegenPerSec > 0 && meRt.hp.s < me.hp.s && (meRt.hp.a > 0 || meRt.hp.h > 0)) {
    const regen = me.hp.s * bal.shieldRegenPerSec * dtSec
    if (regen > 0) meRt.hp.s = Math.min(me.hp.s, meRt.hp.s + regen)
  }

  // ── 结束判定 ──
  const meAlive = !!meRt && isAlive(b, 'player')
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    return
  }
  if (!foeAlive) {
    // 多波未完：本波清空不判胜（推进方下一拍切波续刷）；末波清空 = 胜利
    if (!hasMoreWaves) b.ended = 'me'
    return
  }
  if (b.lastTickGameMs - b.startedAtGameMs >= bal.maxBattleMs) {
    // 超时保险：剩余血量比（我方全编队 vs 敌方最优存活单位）
    const meRatio = totalHpRatio(b, 'player', me)
    let bestFoe = 0
    for (const f of foes) bestFoe = Math.max(bestFoe, totalHpRatio(b, f.tag, f))
    b.ended = meRatio >= bestFoe ? 'me' : 'foe'
  }
}

/**
 * 距离机动的单方转向步（米）：
 * - 已到位（差 <0.5m）不动；
 * - 否则以 ≤ 本步全速航程推进，且绝不越过期望距离 → 到达后下一拍即停，不产生过冲振荡。
 * 比例收尾段（剩余 < 本步航程时推力 = 剩余）让系统天然收敛，拔河也只在平衡点静止。
 */
export function steerStep(cur: number, desire: number, speedMps: number, dtSec: number): number {
  const gap = desire - cur
  if (Math.abs(gap) < 0.5) return 0
  const cap = Math.max(0.5, speedMps * dtSec)
  const step = Math.min(Math.abs(gap), cap)
  return gap > 0 ? step : -step
}

function isAlive(b: import('./state').BattleState, tag: string): boolean {
  const u = b.units[tag]
  return !!u && (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)
}

/** 锁定目标（2026-09-09 锁定装置）：存活编队首位（foes 生成序 = 主舰优先），
 * 主舰击毁自动接力下一艘——集火永不卡空；确定性、不消耗 rng */
function firstAliveFoe(foes: UnitSpec[], b: import('./state').BattleState): UnitSpec | null {
  for (const f of foes) if (isAlive(b, f.tag)) return f
  return null
}

/**
 * V18B 随机目标（船长 2026-09-05）：从存活敌人中均匀随机抽一个（确定性走 state.rng——
 * 种子固定则每场可复现；每发武器调用一次 = 齐射可分散到不同目标）。
 */
function randomAliveFoe(state: import('./state').GameState, b: import('./state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  const alive = foes.filter((f) => isAlive(b, f.tag))
  if (alive.length === 0) return null
  const i = Math.min(alive.length - 1, Math.floor(nextRandom(state.rng) * alive.length))
  return alive[i]!
}

function totalHpRatio(b: import('./state').BattleState, tag: string, spec: UnitSpec): number {
  const u = b.units[tag]
  if (!u) return 0
  const init = spec.hp.s + spec.hp.a + spec.hp.h
  if (init <= 0) return 0
  return (u.hp.s + u.hp.a + u.hp.h) / init
}

/* ═══════════ 预估胜率（确定性期望推演；UI/AI 门槛同源，不消耗 rng） ═══════════ */

/** 稳态距离近似：双方期望距离的中点（钳制在开战距离内） */
function steadyDistance(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  const dMe = desiredRangeFor(me, 'mid', bal)
  const dFoe = foeDesiredRange(me, foes, bal)
  const open = battleOpenM(me, foes, bal)
  return clamp(bal.minDistanceM, open, (dMe + dFoe) / 2)
}

/** 预估胜率核心（确定性期望推演；不消耗 rng）。
 * meMul/foeMul = 命中率缩放系数（AI favor 用；玩家手动 = 1/1），返回未扩散的模型胜率 raw ∈ [0,1] */
/** 稳态预览引擎（battleWinPreview 与带伤预警共用同一公式源——DPS/承伤/tick 换算与展示一一对应）。
 * 2026-09-09 修正（real sim 终验暴露低估，docs/design/wave-battles-20260909.md）：
 * ① 多波卡：敌方总血 = 全波预算；敌方火力 = 峰值波（各波不同时在场，不吃全波火力加成）；
 * ② 护盾回充进承伤模型（引擎 shieldRegenPerSec 实回，长盘显著）——回充窗口 ≈ 直到装甲击穿，
 *    净敌火 = foeDps − 回充率，破甲时间 tA = (盾+甲)/(净敌火)，可承受总伤 = 总 EHP + 回充量。 */
function steadyPreview(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): {
  me: UnitSpec
  meHpTotal: number
  foeHpTotal: number
  meDps: number
  foeDps: number
  ttrMe: number
  ttrFoe: number
} | null {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  // 敌血总预算（多波 = 全波；foeHpOverride/曲线同 createFoeSpecs 口径）
  const baseHp = anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)
  const foeHpTotal = baseHp
  // 敌方火力按"峰值波小队数"计（同族单位射程/单发相同；多波不吃全波同时在场加成）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const peakUnits = waves ? Math.max(...waves.map((w) => w.units)) : 1
  const foes = peakUnits > 1 ? createFoeSpecs(anomaly, bal, { units: peakUnits }) : createFoeSpecs(anomaly, bal)
  const steady = steadyDistance(me, foes, bal)

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h

  // 我方 DPS：逐武器（V17.2 炮台 = 固定弹种：按炮型 × 敌方血型克制精确计算；
  // V18B-2 激光 beam = 命中恒 1（必中）且按稳态距离折算威力衰减）
  let meDps = 0
  for (const w of me.weapons) {
    let shot = 0
    let ammoType: DamageType | null = null
    let hit = 0
    let power = 1
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
      hit = hitChance(w, me, foes[0]!, steady, bal)
    } else if (w.kind === 'beam') {
      ammoType = w.fixedType ?? 'plasma'
      shot = w.shotDmg ?? 0
      hit = 1 // 必中
      power = beamPowerFactor(steady, w)
    } else {
      shot = w.shotDmg ?? 0
      hit = hitChance(w, me, foes[0]!, steady, bal)
    }
    if (hit <= 0) continue
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    meDps += (shot * power * mult * hit * 1000) / w.reloadMs
  }
  // 敌方 DPS（打我，含类型克制与层抗；近盲带内伤害按 blindDmgMul 折算——
  // 2026-09-08：能量 beam 必中（hit=1）且威力走 beamPowerFactor/盲带，与实时引擎同源）
  let foeDpsPeak = 0
  for (const f of foes) {
    const w = f.weapons[0]!
    const isBeam = w.kind === 'beam'
    const hit = isBeam ? 1 : hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const power = isBeam ? (steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(steady, w)) : steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : 1
    const shot = Math.max(1, Math.round((w.shotDmg ?? 0) * power))
    const mult = avgLayerMult(meHpTotal, me, w.fixedType ?? 'kinetic')
    foeDpsPeak += (shot * mult * hit * 1000) / w.reloadMs
  }
  // 2026-09-09 减员修正（稳态把"敌人满员全程输出"当真相，多单位/多波严重高估承伤）：
  // 我方逐个击毁敌方单位 → 敌方在场火力近似线性衰减，全程平均 ≈ 峰值 × (N+1)/(2N)
  // （N = 峰值波单位数；随机目标下各单位击杀时刻 ≈ 按血量比例均匀分布）
  const foeUnitN = Math.max(1, foes.length)
  const foeDps = foeDpsPeak * ((foeUnitN + 1) / (2 * foeUnitN))

  // 承伤窗口含护盾回充（2026-09-09 修正）：净敌火 = foeDps×foeMul − 回充率；
  // 回充持续到装甲击穿（引擎语义：甲/结构任一在即回盾）→ 破甲前可承受总伤 = 盾+甲+回充量
  const foeDpsNet = foeDps * foeMul
  const regenPerSec = bal.shieldRegenPerSec * me.hp.s // 每秒回充 = 满盾 × 费率
  let ttrMe: number
  if (regenPerSec > 0 && me.hp.s > 0 && foeDpsNet > regenPerSec) {
    const tA = (me.hp.s + me.hp.a) / (foeDpsNet - regenPerSec) // 装甲被击穿时刻（此后无回充）
    ttrMe = (meHpTotal + regenPerSec * tA) / foeDpsNet
  } else if (regenPerSec > 0 && foeDpsNet <= regenPerSec) {
    ttrMe = Number.POSITIVE_INFINITY // 回充顶住敌火：只有超时血比才可能落败
  } else {
    ttrMe = foeDpsNet > 0 ? meHpTotal / foeDpsNet : Number.POSITIVE_INFINITY
  }
  const ttrFoe = meDps > 0 ? foeHpTotal / Math.max(1e-9, meDps * meMul) : Infinity // 我击毁敌方所需秒数
  return { me, meHpTotal, foeHpTotal, meDps, foeDps, ttrMe, ttrFoe }
}

function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const sp = steadyPreview(state, ctx, anomaly, shipId, meMul, foeMul)
  if (!sp) return 0
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) return 0.5
  if (!Number.isFinite(sp.ttrMe)) return 1 // 敌永远打不死我 → 必胜
  if (!Number.isFinite(sp.ttrFoe)) return 0 // 我永远打不死敌 → 必败
  return clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
}

/**
 * 带伤预警预估（2026-09-08 船长定）：在满耐久稳态模型上，把"预计承受总伤"按 盾→装甲→结构
 * 三层顺序分摊，得到预计装甲损耗比与结构损耗比（0~1）。战斗持续时长 = 先到者（我被击毁 /
 * 我击毁敌方），与实时引擎同源公式。
 */
export function bountyDamageForecast(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): { armorLoss: number; hullLoss: number; rawWin: number } {
  const sp = steadyPreview(state, ctx, anomaly, shipId, 1, 1)
  if (!sp) return { armorLoss: 0, hullLoss: 0, rawWin: 0 }
  let rawWin: number
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) rawWin = 0.5
  else if (!Number.isFinite(sp.ttrMe)) rawWin = 1
  else if (!Number.isFinite(sp.ttrFoe)) rawWin = 0
  else rawWin = clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
  const duration = Math.min(sp.ttrMe, sp.ttrFoe)
  const dmg = Number.isFinite(duration) ? sp.foeDps * duration : 0
  const afterShield = Math.max(0, dmg - sp.me.hp.s)
  const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, afterShield / sp.me.hp.a) : afterShield > 0 ? 1 : 0
  const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, Math.max(0, afterShield - sp.me.hp.a) / sp.me.hp.h) : afterShield > sp.me.hp.a ? 1 : 0
  return { armorLoss, hullLoss, rawWin }
}

/**
 * 【已退役的展示口径，2026-09-09】悬赏展示胜率 = 稳态解析 + 带伤扣分(旧方案)——探针实测双向
 * 大偏差(显示 2% 却常胜),被 winEstimate.ts 蒙特卡洛推演(玩家可见)取代。本函数保留仅作：
 * ①缓存预热完成前的临时回退显示；②活动远征视图/测试兼容。结算与 AI/工具口径 battleWinPreview 不变。
 * = 原显示胜率（满耐久基准 + logit 扩散）− 预计装甲损耗×winPenaltyArmorPerFull
 * − 预计结构损耗×winPenaltyHullPerFull（结构伤扣更重），下限 2%。
 */
export function bountyWinPercentGuarded(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): number {
  const f = bountyDamageForecast(state, ctx, anomaly, shipId)
  if (f.rawWin <= 0) return 0
  const shown = spreadWinChance(f.rawWin, ctx.balance.battle.winSpread)
  const bal = ctx.balance.battle
  const penalty = f.armorLoss * bal.winPenaltyArmorPerFull + f.hullLoss * bal.winPenaltyHullPerFull
  return Math.max(0.02, Math.min(0.98, shown - penalty))
}

/** 玩家口径预估胜率：无 favor 模型 + logit 扩散（悬赏卡/玩家手动战斗展示用；实际结算与之对应） */
export function battleWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string = state.shipId): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return spreadWinChance(raw, ctx.balance.battle.winSpread)
}

/** AI 远征 favor 优势量（与结算推进同一来源；指派与展示共用） */
export function aiFavorAdv(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return clamp(-1, 1, (raw - 0.5) * 2)
}

/** AI 口径预估胜率（"最终成功率"）：无 favor 模型 → 按 aiFavorStrength 修正命中 → logit 扩散。
 *  AI 接单门槛与 AI 指挥中心展示用它；数值 = AI 副船在该 favor 下的期望表现。 */
export function aiWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const k = ctx.balance.battle.aiFavorStrength
  const adv = aiFavorAdv(state, ctx, anomaly, shipId)
  const favored = winPreviewRaw(state, ctx, anomaly, shipId, 1 + k * adv, 1 - k * adv)
  return spreadWinChance(favored, ctx.balance.battle.winSpread)
}

/** 伤害类型 × 敌方三层占比的期望克制倍率（敌方无抗） */
function effectiveDmgMultAgainst(foes: UnitSpec[], type: DamageType): number {
  let total = 0
  let acc = 0
  for (const f of foes) {
    const s = f.hp.s + f.hp.a + f.hp.h
    total += s
    acc += f.hp.s * typeLayerMult(type, 'shield') + f.hp.a * typeLayerMult(type, 'armor') + f.hp.h * typeLayerMult(type, 'hull')
  }
  return total > 0 ? acc / total : 1
}

/** 我方三层占比 × 类型克制 × (1−层抗) 的期望倍率 */
function avgLayerMult(meHpTotal: number, me: UnitSpec, type: DamageType): number {
  if (meHpTotal <= 0) return 1
  const s = (me.hp.s / meHpTotal) * typeLayerMult(type, 'shield') * (1 - (me.resists.shield?.[type] ?? 0))
  const a = (me.hp.a / meHpTotal) * typeLayerMult(type, 'armor') * (1 - (me.resists.armor?.[type] ?? 0))
  const h = (me.hp.h / meHpTotal) * typeLayerMult(type, 'hull') * (1 - (me.resists.hull?.[type] ?? 0))
  return s + a + h
}
