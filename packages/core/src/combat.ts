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
import type { AnomalyDef, BattleBalance, DamageResists, DamageType, DefProfile, FoeTactic, ModuleDef, SimContext } from './types'
import { nextRandom } from './rng'
import { cargoItemsOf, countWare, removeItem, removeWare, addWare } from './inventory'
import { fleetDefOf } from './instances'
import { allFittedModules, familyModules, fittedCpuUsed } from './equipment'

/** 战斗基本步长（毫秒） */
export const BATTLE_STEP_MS = 100
/** 步数守卫上限（防失控循环） */
export const BATTLE_MAX_STEPS = 40_000

/** 三层血量形状 */
export interface Hp3 {
  s: number
  a: number
  h: number
}

/** 静态武器卡 */
export interface WeaponSpec {
  label: string
  /** gun = 我方炮台（吃弹药，按 shotsByType 给单发伤害）；fixed = 固定单发（基础舰炮/无人机/敌方） */
  kind: 'gun' | 'fixed'
  /** fixed 的固定伤害类型 */
  fixedType?: DamageType
  /** fixed 单发伤害 */
  shotDmg?: number
  /** gun：弹型 → 单发伤害（构建期含 dmgMult×(1+炮术×5%)×(1+powerBonus)） */
  shotsByType?: Partial<Record<DamageType, number>>
  maxRangeM: number
  minRangeM: number
  hitRate: number
  falloff: number
  reloadMs: number
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
  /** V17.1 开火失稳乘子：加力推进装配后 <1（命中整体 ×hitMul），默认 1 */
  hitMul?: number
  signatureM: number
  scanResMm: number
  speedMps: number
  agility: number
  weapons: WeaponSpec[]
  foeTactic: FoeTactic | null
}

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 层位克制系数（远行星号体系削弱版） */
export function typeLayerMult(t: DamageType, layer: 'shield' | 'armor' | 'hull'): number {
  if (t === 'kinetic') return layer === 'shield' ? 1.5 : layer === 'armor' ? 0.5 : 1
  if (t === 'explosive') return layer === 'shield' ? 0.5 : layer === 'armor' ? 1.5 : 1
  return layer === 'shield' ? 0.75 : 1 // plasma（能量）
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
  weapon: { hitRate: number; minRangeM: number; maxRangeM: number; falloff: number },
  attacker: { hitBonus: number; scanResMm?: number; hitMul?: number },
  defender: { evasion: number; signatureM?: number },
  dist: number,
  bal: BattleBalance,
): number {
  const df = distFactor(dist, weapon)
  const raw = (weapon.hitRate + attacker.hitBonus) * df - defender.evasion
  return clamp(bal.hitMin, bal.hitMax, raw * (attacker.hitMul ?? 1))
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
export function createPlayerSpec(state: GameState, ctx: SimContext, shipId: string): UnitSpec | null {
  const ship = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!ship || !fleet) return null
  const bal = ctx.balance.battle
  const fitted = fleet.fitted

  // V18：家族件列表（全位；可叠件复数、抗/容系唯一件由装配层保证）
  const shieldDefs = familyModules(state, ctx, shipId, 'shield')
  const armorDefs = familyModules(state, ctx, shipId, 'armor')
  const propDefs = familyModules(state, ctx, shipId, 'propulsion')
  const turretDefs = familyModules(state, ctx, shipId, 'turret')
  // 无人机装置（高槽 rack 件；甲板扩展/战术导控按字段判别）
  const droneGear = allFittedModules(fitted, ctx).filter(
    (d) => d.droneBayBonusM3 !== undefined || d.droneDmgBonus !== undefined,
  )

  // 盾/甲：容量加成求和；抗性按系逐件缺口乘入（mergeResist 链）
  let shieldHpMult = 1
  for (const m of shieldDefs) shieldHpMult += m.shieldHpBonus ?? 0
  let armorHpMult = 1
  for (const m of armorDefs) armorHpMult += m.armorHpBonus ?? 0
  const hp: Hp3 = {
    s: (ship.shieldHp ?? 0) * Math.max(1, shieldHpMult),
    a: (ship.armorHp ?? 0) * Math.max(1, armorHpMult),
    h: ship.hullHp ?? 0,
  }
  const shieldRes = mergeResist(ship.shieldResist, undefined)
  for (const m of shieldDefs) applyAdds(shieldRes, m.shieldResistAdd)
  const armorRes = mergeResist(ship.armorResist, undefined)
  for (const m of armorDefs) applyAdds(armorRes, m.armorResistAdd)
  const resists = { shield: shieldRes, armor: armorRes, hull: ship.hullResist ?? {} }

  // 推进器（装配层唯一）：速度加成乘入 + 命中失稳
  const propMod = propDefs[0]

  const weapons: WeaponSpec[] = []
  const gunneryLv = state.skills.trained[ctx.balance.combat.gunnerySkillId] ?? 0
  const dmgScale = (1 + bal.gunneryDmgPerLevel * gunneryLv) * (1 + (ship.powerBonus ?? 0))

  // 兜底武器：基础舰炮恒在（弱；无炮/无弹仍可还击）
  weapons.push({
    label: '基础舰炮',
    kind: 'fixed',
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
    const ammoDef = ctx.items.get(AMMO_IDS[type])
    const perShot = Math.round((ammoDef?.dmg ?? 0) * mult * dmgScale)
    const shotsByType: Partial<Record<DamageType, number>> = {}
    shotsByType[type] = perShot * count
    weapons.push({
      label: count > 1 ? `${turret.name}×${count}` : turret.name,
      kind: 'gun',
      shotsByType,
      maxRangeM: turret.maxRangeM,
      minRangeM: turret.minRangeM ?? 0,
      hitRate: turret.hitRate ?? 0.5,
      falloff: turret.falloff ?? 0.3,
      reloadMs: turret.reloadMs,
    })
  }

  // 无人机装载（V18：甲板扩展 +bay、导控 +dmg；贪心受舱容 + CPU 余量约束）
  let bayLimit = ship.droneBayM3 ?? 0
  let droneDmgBonus = 0
  for (const g of droneGear) {
    bayLimit += g.droneBayBonusM3 ?? 0
    droneDmgBonus += g.droneDmgBonus ?? 0
  }
  let bayUsed = 0
  let cpuLeft = (ship.cpu ?? 0) - fittedCpuUsed(fitted, ctx)
  if (bayLimit > 0 && cpuLeft > 0) {
    const stock: Array<{ def: NonNullable<ReturnType<SimContext['items']['get']>>; units: number }> = []
    for (const [id, units] of Object.entries(cargoItemsOf(state))) {
      const def = ctx.items.get(id)
      if (def?.kind === 'drone' && units > 0) stock.push({ def, units })
    }
    for (const [id, units] of Object.entries(state.warehouse.items)) {
      const def = ctx.items.get(id)
      if (def?.kind === 'drone' && units > 0) stock.push({ def, units })
    }
    stock.sort((a, b) => (b.def.dmg ?? 0) / Math.max(1, b.def.cpuUse ?? 1) - (a.def.dmg ?? 0) / Math.max(1, a.def.cpuUse ?? 1))
    outer: for (const { def, units } of stock) {
      for (let i = 0; i < units; i++) {
        if (bayUsed + def.unitM3 > bayLimit || cpuLeft - (def.cpuUse ?? 0) < 0) break outer
        bayUsed += def.unitM3
        cpuLeft -= def.cpuUse ?? 0
        weapons.push({
          label: def.name,
          kind: 'fixed',
          fixedType: def.damageType ?? 'kinetic',
          // V18 战术导控阵列：无人机单发伤害 ×(1+Σ导控)
          shotDmg: Math.round((def.dmg ?? 0) * (1 + droneDmgBonus)),
          maxRangeM: 2600,
          minRangeM: 200,
          hitRate: 0.6,
          falloff: 0.35,
          reloadMs: 2200,
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
    evasion: ship.evasion ?? 0.12,
    hitBonus: ship.hitBonus ?? 0,
    // V17.1：加力推进失稳——装配推进器后我方全部武器命中 ×(1−hitPenalty)（常驻；进胜率推演同源）
    hitMul: 1 - (propMod?.hitPenalty ?? 0),
    signatureM: ship.signatureM ?? 80,
    scanResMm: ship.scanResMm ?? 500,
    // V17：矢量推进器 = 加力推进——战斗速度加成直接乘入（进 combatSpeed 的距离操纵力）
    speedMps: (ship.maxSpeedMps ?? 200) * (1 + (propMod?.speedBonusPct ?? 0)),
    agility: ship.agility,
    weapons,
    foeTactic: null,
  }
}

/** 我方主武器固定弹种（V18 多炮：取高槽第一门炮的 damageType；无炮也返回
 * kinetic——基础舰炮实际不消耗弹药）。多门异弹型炮的装载/消耗在出发预载时按主炮型
 * 装载（battle.ammo 单型；异型炮在本主炮弹尽后停火，见 E 台阶 per-gun 完整化）。 */
export function playerAmmoType(state: GameState, ctx: SimContext, shipId: string): DamageType {
  const turrets = familyModules(state, ctx, shipId, 'turret')
  return (turrets[0]?.damageType as DamageType | undefined) ?? 'kinetic'
}

/* ═══════════ 敌方编队 ═══════════ */

const PROFILE_SPLIT: Record<string, Hp3> = {
  shield: { s: 0.5, a: 0.25, h: 0.25 },
  armor: { s: 0.2, a: 0.55, h: 0.25 },
  balanced: { s: 0.34, a: 0.33, h: 0.33 },
}

/** 敌方战术 → 武器射程带（贴合作战风格）：
 * brawl 贴脸肉搏 = 无最小射程的近身喷子；orbit 环绕 = 中距小炮；kite 放风筝 = 高最小射程的远距炮。 */
const TACTIC_RANGE: Record<FoeTactic, { max: number; min: number }> = {
  brawl: { max: 2200, min: 0 },
  orbit: { max: 4600, min: 350 },
  kite: { max: 9200, min: 1200 },
}

/** 展开敌方编队（threat 卡面 = 总战力） */
export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance): UnitSpec[] {
  const tactic = anomaly.tactic ?? 'orbit'
  const split = PROFILE_SPLIT[anomaly.defProfile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
  const escorts = Math.max(0, Math.min(2, anomaly.escorts ?? 0))
  const mainThreat = anomaly.threat / (1 + 0.6 * escorts)
  const mainType = pickTopType(anomaly.dmgMix)
  const range = TACTIC_RANGE[tactic]!

  const make = (tag: string, name: string, uThreat: number, type: DamageType): UnitSpec => {
    const totalHp = uThreat * bal.foeHpPerThreat
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    const dps = uThreat * bal.foeDpsPerThreat
    const shotDmg = Math.max(1, Math.round((dps * bal.foeReloadMs) / 1000 / bal.foeHitRate))
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
      speedMps: anomaly.foeSpeedMps ?? Math.round(bal.foeSpeedBaseMps * (0.85 + (uThreat / anomaly.threat) * 0.3)),
      agility: 0.3,
      weapons: [
        {
          label: `${name} 武器组`,
          kind: 'fixed',
          fixedType: type,
          shotDmg,
          maxRangeM: range.max,
          minRangeM: range.min,
          hitRate: bal.foeHitRate,
          falloff: bal.foeFalloff,
          reloadMs: bal.foeReloadMs,
        },
      ],
      foeTactic: tactic,
    }
  }
  const specs: UnitSpec[] = [make('foe-0', anomaly.name, mainThreat, mainType)]
  for (let i = 1; i <= escorts; i++) {
    specs.push(make(`foe-${i}`, `${anomaly.name}·僚机`, mainThreat * 0.6, mainType))
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

/** 开战距离 = 双方最大射程 ×factor + pad */
export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  return Math.round(top * bal.openRangeFactor + bal.openRangePadM)
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

/** 主炮总需求（时间上限/装填 ×余量） */
export function ammoLoadTotal(me: UnitSpec, bal: BattleBalance): number {
  const main = me.weapons.find((w) => w.kind === 'gun')
  if (!main) return 0
  return Math.max(1, Math.ceil((bal.ammoTimeCapMs / main.reloadMs) * bal.ammoMargin))
}

/**
 * V17.2 单型装载：只装载炮台固定弹种的那一型（炮族制——炮台 damageType 决定弹种，
 * battle.ammo 其余键恒 0；开火/退还/UI dominant 仍走既有三键结构，无需第二套）。
 * 货仓优先、仓库兜底；返回实装各型数量（只有目标型非零）。
 */
export function loadAmmo(state: GameState, ctx: SimContext, type: DamageType, total: number): { kin: number; exp: number; pla: number } {
  const out = { kin: 0, exp: 0, pla: 0 }
  if (total <= 0) return out
  const id = AMMO_IDS[type]
  const key = ammoKeyOf(type)
  const stock = Math.floor((cargoItemsOf(state)[id] ?? 0) + countWare(state, id))
  if (stock <= 0) return out
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
  out[key] = got
  return out
}

/** 剩余弹药退回物品仓库 */
export function refundAmmo(state: GameState, ammo: { kin: number; exp: number; pla: number }): void {
  const map: Array<[DamageType, number]> = [
    ['kinetic', ammo.kin],
    ['explosive', ammo.exp],
    ['plasma', ammo.pla],
  ]
  for (const [t, n] of map) {
    if (n > 0) addWare(state, AMMO_IDS[t], Math.floor(n))
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

/* ═══════════ 战斗状态推进 ═══════════ */

/** 初始化战斗动态状态 */
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
export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number,
): import('./state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离记忆可能来自更远射程的战斗：钳到本次开战距离内，保证开局总是"从射程外稍远处开始接近"
  const rawDesire = desireM !== undefined && desireM > 0 ? Math.round(desireM) : desiredRangeFor(me, 'mid', bal)
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire)
  battle.distanceM = openM
  const ammoType = playerAmmoType(state, ctx, shipId)
  const total = ammoLoadTotal(me, bal)
  if (total > 0) {
    battle.ammo = loadAmmo(state, ctx, ammoType, total)
  }
  return battle
}

/** 战斗射程带查询（小剧场距离条用）：返回双方主武器带与开战距离上限；无战斗返回 null */
export function battleZonesFor(state: GameState, ctx: SimContext): {
  openM: number
  me: { minM: number; maxM: number; name: string }
  foe: { minM: number; maxM: number }
} | null {
  const anomaly = state.expedition.anomalyId ? ctx.anomalies.get(state.expedition.anomalyId) : undefined
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
  me: Array<{
    label: string
    kind: 'gun' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    /** 武器装填周期毫秒（静态；UI 冷却条分母） */
    reloadMs: number
  }>
  /** 我方各武器当前装填剩余毫秒（与 me 同序；0 = 可开火；战斗单位缺失时为空数组） */
  meReload: number[]
  foe: { minM: number; maxM: number; type: DamageType }
  /** 各单位三层满血量（UI 垂直血条按各自满值比例绘制） */
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
} | null {
  const anomaly = state.expedition.anomalyId ? ctx.anomalies.get(state.expedition.anomalyId) : undefined
  const battle = state.expedition.battle
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const ammoLeft = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const dominant = nextAmmoType(battle.ammo)
  const meArcs = me.weapons.map((w) => {
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (ammoLeft > 0) type = dominant // 炮台弹型动态（消耗中可能切换）
    return { label: w.label, kind: w.kind, type, minM: w.minRangeM, maxM: w.maxRangeM, reloadMs: w.reloadMs }
  })
  // 我方各武器当前装填剩余（与 meArcs 同序：units['player'].weapons；单位缺失给空数组）
  const meReload = (battle.units['player']?.weapons ?? []).map((n) => Math.max(0, Math.floor(n)))
  let foeMin = 0
  let foeMax = 0
  let foeType: DamageType = 'kinetic'
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
      foeType = w.fixedType ?? 'kinetic'
    }
  }
  const openM = battleOpenM(me, foes, bal)
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  for (const f of foes) foeMaxHp[f.tag] = { s: f.hp.s, a: f.hp.a, h: f.hp.h }
  return {
    nearM: bal.minDistanceM,
    openM,
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    me: meArcs,
    meReload,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
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
): void {
  if (!battle || battle.ended) return
  const anomaly = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!anomaly) return
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) {
    battle.ended = 'foe'
    return
  }
  const foes = createFoeSpecs(anomaly, bal)
  const foeDesire = foeDesiredRange(me, foes, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  let guard = 0
  while (state.gameMs > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    const dt = Math.min(BATTLE_STEP_MS, state.gameMs - battle.lastTickGameMs)
    stepBattle(state, battle, me, foes, foeDesire, openM, bal, dt, favor)
    battle.lastTickGameMs += dt
  }
}

/** 推进当前主控远征的战斗（到耗尽时间或分出胜负） */
export function advanceBattle(state: GameState, ctx: SimContext): void {
  const battle = state.expedition.battle
  if (battle) advanceBattleFor(state, ctx, battle, state.shipId, state.expedition.anomalyId)
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
    const foeTarget = firstAliveFoe(b, foes)
    for (let wi = 0; wi < me.weapons.length; wi++) {
      const w = me.weapons[wi]!
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      if (!inRange(b.distanceM, w) || !foeTarget) continue
      let type: DamageType
      let dmg: number
      if (w.kind === 'gun') {
        const pick = nextAmmoType(b.ammo)
        if (!pick) {
          meRt.weapons[wi] = w.reloadMs // 无弹：等一轮再查（避免每步空转）
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        b.ammo[ammoKeyOf(pick)] -= 1
        meRt.weapons[wi] = w.reloadMs
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        meRt.weapons[wi] = w.reloadMs
      }
      b.stats.meShots += 1
      // AI favor：我方（AI 副船）命中按优势放大，上限放开到 100%（可必中）
      const meHit = hitChance(w, me, foeTarget, b.distanceM, bal)
      const meHitEff = favor ? clamp(0, 1, meHit * favor.meMul) : meHit
      const hit = dmg > 0 && nextRandom(state.rng) < meHitEff
      if (hit) {
        b.stats.meHits += 1
        const rt = b.units[foeTarget.tag]!
        const r = applyDamage(rt.hp, {}, dmg, type)
        rt.hp = r.hp
        b.stats.meDmg += r.dealt
      }
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'me', tag: 'player', type, hit })
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
    if (!inRange(b.distanceM, w) || !meRt) continue
    b.stats.foeShots += 1
    const fType = w.fixedType ?? 'kinetic'
    // AI favor：敌方命中被优势压制，且始终保留 97% 命中上限（3% miss 底线不变）
    const foeHit = hitChance(w, f, me, b.distanceM, bal)
    const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
    const fHit = nextRandom(state.rng) < foeHitEff
    if (fHit) {
      b.stats.foeHits += 1
      const r = applyDamage(meRt.hp, me.resists, w.shotDmg ?? 0, fType)
      meRt.hp = r.hp
    }
    pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, type: fType, hit: fHit })
  }

  // ── 结束判定 ──
  const meAlive = !!meRt && isAlive(b, 'player')
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    return
  }
  if (!foeAlive) {
    b.ended = 'me'
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

function firstAliveFoe(b: import('./state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  for (const f of foes) if (isAlive(b, f.tag)) return f
  return null
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
function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return 0
  const foes = createFoeSpecs(anomaly, bal)
  const steady = steadyDistance(me, foes, bal)

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h
  const foeHpTotal = foes.reduce((a, f) => a + f.hp.s + f.hp.a + f.hp.h, 0)

  // 我方 DPS：逐武器（V17.2 炮台 = 固定弹种：按炮型 × 敌方血型克制精确计算）
  let meDps = 0
  for (const w of me.weapons) {
    const hit = hitChance(w, me, foes[0]!, steady, bal)
    if (hit <= 0) continue
    let shot = 0
    let ammoType: DamageType | null = null
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
    } else {
      shot = w.shotDmg ?? 0
    }
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    meDps += (shot * mult * hit * 1000) / w.reloadMs
  }
  // 敌方 DPS（打我，含类型克制与层抗）
  let foeDps = 0
  for (const f of foes) {
    const w = f.weapons[0]!
    const hit = hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const mult = avgLayerMult(meHpTotal, me, w.fixedType ?? 'kinetic')
    foeDps += ((w.shotDmg ?? 0) * mult * hit * 1000) / w.reloadMs
  }

  const ttrMe = foeDps > 0 ? meHpTotal / Math.max(1e-9, foeDps * foeMul) : Infinity // 我被击毁所需秒数
  const ttrFoe = meDps > 0 ? foeHpTotal / Math.max(1e-9, meDps * meMul) : Infinity // 我击毁敌方所需秒数
  if (!Number.isFinite(ttrMe) && !Number.isFinite(ttrFoe)) return 0.5
  if (!Number.isFinite(ttrMe)) return 1 // 敌永远打不死我 → 必胜
  if (!Number.isFinite(ttrFoe)) return 0 // 我永远打不死敌 → 必败
  return clamp(0, 1, ttrMe / (ttrMe + ttrFoe))
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
