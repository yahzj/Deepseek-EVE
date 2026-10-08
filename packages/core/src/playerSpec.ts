/**
 * **玩家规格乘数与抗性合成**（2026-10-02 从 `combat.ts` 拆出 · 批次 4g-1 · 零行为变化）。
 *
 * 本文件 = 我方单舰规格的**乘数件与抗性合成**（`createPlayerSpec` 主件 668 行体量大、4g-2 续搬；
 * 届时它从本文件借回这些件）。全部**纯读数/纯计算**（只依赖 state 类型 / types / combatMath /
 * equipment），无战斗引擎内部件。`combat.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */
import type { GameState } from './state'
import type { DamageResists, DamageType, ModuleDef, SimContext } from './types'
import { clamp, RESIST_FLOOR } from './combatMath'
import type { Hp3 } from './combatMath'
import { allFittedModules, cpuBudgetOf, curveMult, familyModules, fittedCpuUsed, gapCombine, weightedSum, equipmentPenaltiesOf } from './equipment'
import { moduleAllowedOnShip } from './shipFitting'
import { fleetDefOf } from './instances'
import { shipCategoryKeyOf } from './labels'
import { plugModulesOf } from './plugs'
import { shipDamageEffects } from './shipDamage'
import type { UnitSpec, WeaponSpec } from './combat'

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

export function createPlayerSpec(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  ammoIds?: Partial<Record<DamageType, string>> | null,
  /** **干扰压制的基准账**（2026-09-24 加；缺省不传 ⇒ 逐字走老路径）：逐件记下
   *  「该武器基准射程」与「该系射程加成倍率 (1+bonus)」——`applyMeJammerDebuff` 按船长**加法口径**
   *  反解施加系数要用（见 `meRangeMulOf`）。⚠ 只记不改，不参与本函数的任何算式。 */
  refs?: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> },
): UnitSpec | null {
  const ship = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!ship || !fleet) return null
  const bal = ctx.balance.battle
  const fitted = ship.civilianFittingOnly === true
    ? Object.fromEntries((['high', 'mid', 'low'] as const).map((rack) => [rack, fleet.fitted[rack].map((id) => {
      const mod = id ? ctx.modules.get(id) : undefined
      return mod && !moduleAllowedOnShip(ship, mod) ? null : id
    })])) as typeof fleet.fitted
    : fleet.fitted

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
  /**
   * **隐秘行动装置**（2026-09-15 船长：「高槽，效果是自身武器开火前，隐身 30 秒（不被锁定，不被攻击）」；
   * 六问六答 Q4 = 两档 MK2/MK3 = **20 / 30 秒**、极度吃 CPU；Q3 = **只护装了装置的那一艘**）：
   * 窗口 = 所装件里**最长**的一件（多件不叠加）。
   *
   * ⚠ **推进器禁令**（船长同日追加：「**有推进器类的时候直接解除隐身**」）：默认 `propDefs` 非空即判 0 ——
   * 判在**装配期**（推进器不会中途装卸）⇒ 等价于"带着推进器就没有隐身"。
   * ⚠ **2026-09-16 船长给侦察舰开了口子**：「**侦查舰添加特性，隐秘行动装置所需CPU降低50%，且移除
   * 推进器失效惩罚**」（口径四答取「甲：完全移除」）⇒ 本船 `stealthIgnoresPropulsion === true` 时
   * **推进器不再解除隐身**（开火立即现形、超时现形两条照旧）。判据走**数据字段**（照「后勤舰」先例），
   * 不在引擎里硬判子分类。
   */
  const stealthMs =
    propDefs.length > 0 && ship.stealthIgnoresPropulsion !== true
      ? 0
      : allFittedModules(fitted, ctx).reduce((m, d) => Math.max(m, d.stealthMs ?? 0), 0)
  /**
   * **墨潮捕获网的周期**（**船长 2026-09-26**）：取所装件里**最短**的一件（缺省 0 = 本舰不带网）。
   * 与隐身取最长相反 —— 这是攻击性装置，重叠装没有收益。消费见 `advanceMyCaptureWebs`。
   */
  const penalties = equipmentPenaltiesOf(state, ctx, shipId, fitted)
  const webCycleBaseMs = allFittedModules(fitted, ctx).reduce<number>(
    (m, d) => (d.captureWebCycleMs === undefined ? m : m === 0 ? d.captureWebCycleMs : Math.min(m, d.captureWebCycleMs)),
    0,
  )
  const webCycleMs = Math.round(webCycleBaseMs * penalties.reload)
  /**
   * **墨潮捕获网的三项读数**（**2026-09-29 船长令**：「将一些关键属性（比如射程，减速幅度）放进属性里」）：
   * 投网射程 / 断开距离 / 减速倍率改为**从件上取**（多件取**最有利**的一件：射程取最长、断开取最远、
   * 减速取最狠），缺省回落引擎常量 ⇒ 数据没写时与改动前**逐值相同**。
   * 卡面参数行渲染的就是这三项（`ui/shipInfo`），说明文案不再手写数字。
   */
  const webDefs = allFittedModules(fitted, ctx).filter((d) => d.captureWebCycleMs !== undefined)
  const webRangeM = webDefs.reduce((m, d) => Math.max(m, d.captureWebRangeM ?? MY_WEB_RANGE_M), MY_WEB_RANGE_M)
  const webBreakM = webDefs.reduce((m, d) => Math.max(m, d.captureWebBreakM ?? WEB_BREAK_DIST_M), WEB_BREAK_DIST_M)
  const webSlowMul = webDefs.reduce((m, d) => Math.min(m, d.captureWebSlowMul ?? 0.5), 0.5)

  // 盾/甲：容量加成加算求和；抗性按系逐件缺口乘入（mergeResist 链；V18.1 同系可多件）
  let shieldHpMult = 1
  for (const m of shieldDefs) shieldHpMult += m.shieldHpBonus ?? 0
  /**
   * **甲容量 = 全件加算**（2026-09-17 玩家报障修复：「**赃物强化仓的护甲增加效果无效**」）。
   *
   * ⚠ 原先只在 `armorDefs`（**装甲槽件**）里求和 ⇒ 跨族的「**赃物强化舱**」（低槽货舱件 · 甲容量 15%）
   * **引擎从来没算过**，而界面自 2026-09-11 起就显示「装甲容量 +15%」（`shipInfo.tsx` 的
   * `crossFamilyLines`，体检白名单也登记了 `mod-lair-cargo-a:armorHpBonus`）⇒ 玩家看到的是不兑现的承诺。
   * 现改为与**其余跨族字段同口径**（`hullHpBonus` · `hullResistAdd` · `speedBonusPct` · `evasionGapPct` ·
   * `rangeCutPct` · `reloadPenaltyPct` · `rangeTypeBonusPct` 全都是"全件扫描"）⇒ 装甲槽件照旧各算一次、
   * **不重复计入**；全表只有赃物强化舱这一件的生效值发生变化（其余 6 个带该字段的件本就是装甲槽）。
   * 连带自动跟随：`layerAmpOf`（维修装置每跳修复量与修理组件共用的一把尺）取的就是本函数 ⇒ 「容量变厚、
   * 修得也更多」两条口径同步。
   */
  let armorHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) armorHpMult += m.armorHpBonus ?? 0
  // 结构层容量（2026-09-10 船长：E 族巨构骨架引出）——任何槽位都可能带，按件加算求和，
  // 与甲容同口径；技能（船体加固理论/装甲舰操作）再乘于其上
  let hullHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) hullHpMult += m.hullHpBonus ?? 0
  /**
   * **舰种操作四技能**（2026-09-22 船长令）：判据 = **舰种 `ship.tier`**（T1 护卫舰 / T2 驱逐舰 / T3 巡洋舰 /
   * T4 战列舰，见 `SHIP_SIZE_CLASS`），**只对主控正在驾驶的这一艘**生效（与武装舰/装甲舰操作同口径；
   * 那两条按"类别"判、本组按"舰种"判 ⇒ 互不冲突、可叠加）。口径（船长同日逐条裁定）：**闪避/命中加百分点**；
   * **单发伤害与容量相对乘算**；**抗性只对已有条目相对乘算**（没有抗性的层不动，上限 90%）。
   * ⚠ 每级值（0.02/0.05/0.03）在下方**各使用点**出现，`content:check` 的现场复核按 `srcNear:false` 登记。
   */
  const tierOpsLv = (tier: number, id: string): number => (ship.tier === tier ? Math.min(5, state.skills.trained[id] ?? 0) : 0)
  const frigateOpsLv = tierOpsLv(1, 'frigate-ops')
  const destroyerOpsLv = tierOpsLv(2, 'destroyer-ops')
  const cruiserOpsLv = tierOpsLv(3, 'cruiser-ops')
  const battleshipOpsLv = tierOpsLv(4, 'battleship-ops')
  // 批次三技能（2026-09-05）：护盾操作学（盾容量 +4%/级）/ 船体加固理论（甲+结构 +4%/级）——乘于装备件之上
  const shOpLv = Math.min(5, state.skills.trained['shield-operation'] ?? 0)
  const hullLv = Math.min(5, state.skills.trained['hull-upgrades'] ?? 0)
  // 批次五：装甲舰操作（判据 = 类别 `shipCategoryKeyOf`；船长 2026-09-16「两个舰操作各自只影响自身分类」）
  const armoredOpsLv = shipCategoryKeyOf(ship) === 'armored' ? Math.min(5, state.skills.trained['armored-ops'] ?? 0) : 0
  const hullSkillMult =
    (1 + 0.04 * hullLv) * (1 + 0.04 * armoredOpsLv) * (1 + 0.03 * battleshipOpsLv) // 末项 = 战列操作（三容量同乘）
  /**
   * 🔴 **舰船插件的固定值：加在计算的最前端**（**2026-09-27 船长令**：「**插件给予的加成是直接加在
   * 舰船面板上的。（放在计算的最前端，吃各种装备效果的放大）**」）。
   *
   * 落法：插件固定值先并入**基线**（船型裸值 ＋ 插件），再依次吃 **装备百分比 → 技能 → 舰种操作**
   * ⇒ 护盾插板那 80 点会被 `shieldHpBonus` 一类百分比放大（"面板上直接加、且吃放大"是同一把尺）。
   *
   * ⚠ **改动前这三格是空头承诺**：`plugShieldAdd` / `plugArmorAdd` / `plugHullAdd` 只在下面那段里累加、
   * **全仓没有任何消费点**（`grep plugShieldAdd` 只有"声明 ＋ 累加"两行）⇒ 插件加血**一点都没生效**；
   * 速度那两格同理。本段把它们提到基线处，旧的死累加随之删除。
   */
  const plugDefs = plugModulesOf(state, ctx, shipId)
  const damage = shipDamageEffects(fleet.damagePlugs)
  const plugHpAdd = {
    s: plugDefs.reduce((n, p) => n + (p.shieldHpAdd ?? 0), 0),
    a: plugDefs.reduce((n, p) => n + (p.armorHpAdd ?? 0), 0),
    h: plugDefs.reduce((n, p) => n + (p.hullHpAdd ?? 0), 0),
  }
  /** 速度固定值（推进插件 ＋ / 装甲插板 −）：同口径并进基线，再吃百分比与技能 */
  const plugSpeedMps = plugDefs.reduce((n, p) => n + (p.speedAddMps ?? 0) - (p.speedPenaltyMps ?? 0), 0)
  /** **基线三层血** = 船型裸值 ＋ 插件固定值（下面三行各自再乘装备/技能/舰种操作的百分比） */
  const baseHp = {
    s: (ship.shieldHp ?? 0) + plugHpAdd.s,
    a: (ship.armorHp ?? 0) + plugHpAdd.a,
    h: (ship.hullHp ?? 0) + plugHpAdd.h,
  }
  const hp: Hp3 = {
    s: baseHp.s * Math.max(1, shieldHpMult) * (1 + 0.04 * shOpLv) * (1 + 0.03 * battleshipOpsLv) * damage.shield,
    a: baseHp.a * Math.max(1, armorHpMult) * hullSkillMult * damage.armor,
    h: baseHp.h * Math.max(1, hullHpMult) * hullSkillMult * damage.hull,
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
  /**
   * 巡洋舰操作 / 战列操作：**已有抗性条目**相对 +2%/级（满级 ×1.1，上限 90%）。
   * 一艘船只有一个舰种 ⇒ 两条至多一条非零，取 max 即可；**没有抗性的层不动**（武装舰多数三层全空）。
   */
  const tierResistLv = Math.max(cruiserOpsLv, battleshipOpsLv)
  if (tierResistLv > 0) {
    const f = 1 + 0.02 * tierResistLv
    for (const layer of [shieldRes, armorRes, hullRes]) {
      for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
        const v = layer[t]
        if (v !== undefined) layer[t] = Math.min(0.9, Math.max(0, v * f))
      }
    }
  }
  const resists = { shield: shieldRes, armor: armorRes, hull: hullRes }
  /**
   * **损伤管制装置**（2026-09-25 船长令）：本舰是否装了带 `hullSaveKit` 的件；装了就取它的组件 id。
   * 同舰唯一（`unique`）由装配层保证 ⇒ 这里取第一件即可。
   */
  const dcKit = allFittedModules(fitted, ctx).find((m) => m.hullSaveKit !== undefined)?.hullSaveKit

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
  }
  /**
   * **闪避缺口：全件扫描**（2026-09-17 · 与甲容量同一批修，由玩家报障「赃物强化舱的护甲增加效果无效」引出）。
   *
   * ⚠ 原先这一行与支援件族那几个字段同放（`for (const m of supportDefs)`）⇒ 跨族的
   * 「**掠袭折射涂层**」（**装甲槽** · 被命中缺口 −28%，物品说明与界面都写着）**引擎从来没算过**。
   * 口径与 **2026-09-13「速度加成不再只认推进器槽」**（见下方推进器段）一致 ⇒ 改为任意槽位携带。
   * 姿态陀螺三件本身是支援槽 ⇒ 照旧各算一次（**不重复计入**）。
   */
  for (const m of allFittedModules(fitted, ctx)) if (m.evasionGapPct !== undefined) evadeGaps.push(m.evasionGapPct)
  const hitEq = curveMult(hitEqs)
  // 2026-09-05 一号按盘点补：规避机动学——舰船被命中缺口每级收窄 5%（与姿态陀螺缺口复合）
  const evLv = Math.min(5, state.skills.trained[bal.evasionSkillId] ?? 0)
  if (evLv > 0) evadeGaps.push(bal.evasionPerLevel * evLv)
  const evasion = gapCombine(evadeGaps, Math.min(0.9, (ship.evasion ?? 0.12) + 0.02 * frigateOpsLv))
  const reloadDiv = 1 + Math.min(0.9, rofCut)
  /* ═══ 2026-09-13 虫洞专属装备引出的新旋钮（船长逐条给定；设计稿 §3.6/§3.8）═══
   * 全部走"全件扫描"口径；四项缺省 0 ⇒ 既有装备零行为变化。 */
  const allDefs = allFittedModules(fitted, ctx)
  /**
   * ═══ **舰船插件**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）═══
   *
   * 插件**不在 `fitted` 里**（走 `FleetShipState.plugs` 的独立插件槽）⇒ `allDefs` 扫不到它们，
   * 本段**单独累加**。累加口径 = 船长裁决「**③不吃**」：**多件全额、不进 `stackingOf` 的收敛池**
   * （加算/乘算直接叠加，与"命中/速度走 EVE 曲线"那几支无关）。
   *
   * 已接的效果：三层血固定值 · 速度固定值加减 · 单发伤害 · 命中 · 射程 · CPU 预算 ·
   * **选靶权重**（靶标 ×2 / 隐匿 ×0.4，消费在 `pickMyUnitTarget`）。
   */
  let plugDmg = 0
  let plugHitMul = 1
  /** **射程加成**（2026-09-27 起走正向字段 `plugRangeBonusPct`；多件加算、不吃递减） */
  let plugRangeBonus = 0
  /** **被选中权重**（船长：靶标插件 ×3 / 隐匿插件 ×0.7）——多件相乘、缺省 1 */
  let plugTargetWeight = 1
  for (const p of plugDefs) {
    plugDmg += p.damageBonusPct ?? 0
    if (p.hitBonusPct !== undefined) plugHitMul *= 1 + p.hitBonusPct
    if (p.targetWeightMul !== undefined) plugTargetWeight *= p.targetWeightMul
    plugRangeBonus += p.plugRangeBonusPct ?? 0
  }
  // 2026-10-08船长确认：负面继承收益权重，百分比相乘、抗性百分点相减。
  const resistPen = penalties.resist
  /** 按系射程加成（幽灵弹道校正器「动能武器射程 +22%」）：按系加算 */
  const rangeBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  for (const m of allDefs) {
    for (const [rt, v] of Object.entries(m.rangeTypeBonusPct ?? {})) rangeBonus[rt as DamageType] += v ?? 0
  }
  // **船体固有按系射程加成**（2026-09-13 船长：炮艇「动能武器射程 +30%」）——与模块同链加算
  for (const [rt, v] of Object.entries(ship.weaponRangeBonusPct ?? {})) rangeBonus[rt as DamageType] += v ?? 0
  /** 武器**基准射程** = 装备自带射程 × (1−削减)；下限 500 m（不许被压成 0）。
   *  ⚠ 与"实际射程"分家只为**干扰压制**：船长的加法口径要按"基准 + 加成"拆开算
   *  （见 `meRangeMulOf`；`refs.weaponRanges` 记的就是这两份数）。 */
  const rangeBase = (base: number): number => Math.max(500, Math.round(base * Math.max(.1, penalties.range)))
  /**
   * 🔴 **射程插件的 +25% 并进"战前射程加成池"**（**2026-09-26 船长令**：「**射程插件和增加射程的装备，
   * 应该提高的是战斗前的数据，电子舰和战斗中触发的射程增加减少是独立的加减算法的乘区**」）。
   *
   * 落法 = 与装备的按系射程加成**同池加算**（三系各 +25%，多件全额），**不是**在外面再乘一层。
   * 为什么必须这样：干扰压制那条链（`meRangeMulOf` / `applyMeJammerDebuff`）要吃"**该件的射程加成**"
   * 来按加法口径反解（`(1 + bonus − 净削减) ÷ (1 + bonus)`）——若插件只在外层乘，`refs.weaponRanges`
   * 记下的 `bonusMul` 就漏掉它 ⇒ 带插件的武器会被**多压**。并进池后：
   * 只有装备 +22% ⇒ bonus 0.22；同一门炮再装射程插件 ⇒ bonus **0.47**（船长口径的加法）。
   */
  const plugRangeBonusTotal = plugRangeBonus
  if (plugRangeBonusTotal > 0) {
    rangeBonus.kinetic += plugRangeBonusTotal
    rangeBonus.explosive += plugRangeBonusTotal
    rangeBonus.plasma += plugRangeBonusTotal
  }
  /** 武器实际射程 = 基准 × (1+该系加成)（按系加成 = 模块 + 船体固有 + **射程插件**，加算后一次乘） */
  const rangeOf = (base: number, type: DamageType): number =>
    Math.max(500, Math.round(rangeBase(base) * (1 + rangeBonus[type])))
  /** 通用单发伤害加成（亡军火控「伤害 +6%」）：与按系稳定器同链、加算、只进炮台/光束。
   *  ⚠ **插件并进同一个加算池**（火力强化插件 +12%；多件全额、不吃递减 —— 它本就不在 `allDefs` 里）。 */
  const dmgFlat = allDefs.reduce((s, m) => s + (m.damageBonusPct ?? 0), 0) + plugDmg
  // 全层抗性削减：三层同时扣、**下限 RESIST_FLOOR（可成负数＝易伤）**——放在抗性合成与调谐之后 ⇒ 作用于最终值
  if (resistPen > 0) {
    for (const layer of ['shield', 'armor', 'hull'] as const) {
      for (const rt of ['kinetic', 'explosive', 'plasma'] as const) {
        resists[layer][rt] = Math.max(RESIST_FLOOR, (resists[layer][rt] ?? 0) - resistPen)
      }
    }
  }

  // 速度收益折权加算；命中代价使用对应收益权重后相乘。
  // 2026-09-13 虫洞专属（生体脉搏加速器）：速度加成**不再只认推进器槽**——任意槽位携带
  // `speedBonusPct` 都计入（与 speedPenaltyPct / hitPenalty 的"全件扫描"同口径）；
  // 既有装备只有推进器带本字段 ⇒ 行为零变化。
  const propSpeeds = allFittedModules(fitted, ctx)
    .map((m) => m.speedBonusPct ?? 0)
    .filter((v) => v > 0)
  /**
   * **推进器多件 = 折权加算**（**2026-09-20 船长**：「**基础改为加算，但是依旧有多件衰减**」）：
   * 单体加成按 `stackWeight`（100% / 87% / 57% / 28% / 11%…）折减后**相加** ⇒ 件件递减、总额收敛。
   * ⚠ 原为 `curveMult`（乘积形 `Π(1+pᵢ·wᵢ)`）：对 +250% 这种大额件会**放大**（2 件 ×11.10、3 件 ×26.95），
   * 现 2 件 ×5.67、3 件 ×7.10。判据单点 = `equipment.weightedSum`；收敛分组见 `stackingOf`（`weighted`）。
   * ⚠ 命中 / 跃迁速度 / 目标锁定**仍是 EVE 曲线**（本裁定只动速度）。
   */
  const speedEq = 1 + weightedSum(propSpeeds)
  /**
   * **本单位推进器的点火周期**（2026-09-14 船长新增「微型跃迁引擎」：点火 10 秒 / 冷却 60 秒）。
   * 取**装配里点火最短的那件**（同长再取冷却更短的那件）——没有覆盖件的装配 ⇒ `cycle` 与全局值相同
   * ⇒ 下面**不写这两个字段**，走 `balance.battle`（**旧读数逐字不变**）。
   */
  const propCycle = propDefs
    .map((p) => ({
      boostMs: p.thrusterBoostMs ?? bal.thrusterBoostMs,
      cooldownMs: p.thrusterCooldownMs ?? bal.thrusterCooldownMs,
    }))
    .sort((a, b) => a.boostMs - b.boostMs || a.cooldownMs - b.cooldownMs)[0]
  const cycleOverridden =
    propCycle !== undefined &&
    (propCycle.boostMs !== bal.thrusterBoostMs || propCycle.cooldownMs !== bal.thrusterCooldownMs)
  // 锁定装置（2026-09-09 船长拍板：集火 + 被锁目标受击加深 8/12/20% 档；多件 EVE 曲线收敛）
  const lockEq = curveMult(targetLockDefs.map((m) => m.lockDmgBonus ?? 0))

  const weapons: WeaponSpec[] = []
  const gunneryLv = state.skills.trained[ctx.balance.combat.gunnerySkillId] ?? 0
  // 批次五：武装舰操作（**武装舰**驾驶 +3%/级 全武器单发，乘于炮术学之外）
  // 2026-09-16 船长：「装甲舰操作和武装舰操作各自只影响自身分类的舰船。」⇒ 判据由 `role` 改为**类别**
  // （`shipCategoryKeyOf`）⇒ 归入装甲线的牛鲨 + E 族三艘**不再吃**这一条（它们改吃装甲舰操作）
  // 2026-09-27 船长令（R4/R5 上位技能批）：上位技能的伤害乘数走单点（见 damageUpgradeMult）
  const dmgUpgradeMult = damageUpgradeMult(state)
  const arOpsLv = shipCategoryKeyOf(ship) === 'armed' ? Math.min(5, state.skills.trained['armed-ops'] ?? 0) : 0
  // 舰种操作（2026-09-22 船长令）：驱逐舰操作 +5%/级、巡洋舰操作 +3%/级——单发伤害进同一乘链
  const dmgScale =
    (1 + bal.gunneryDmgPerLevel * gunneryLv) *
    (1 + (ship.powerBonus ?? 0)) *
    (1 + 0.03 * arOpsLv) *
    (1 + 0.05 * destroyerOpsLv) *
    (1 + 0.03 * cruiserOpsLv) *
    dmgUpgradeMult

  // 兜底武器：基础舰炮恒在（弱；无炮/无弹仍可还击）
  // **基准账**（`refs.weaponRanges`）：与武器条目**逐条一一对齐**（第 i 条 = 第 i 门武器的
  // `{基准射程, 该件射程加成倍率}`）——基础舰炮无射程加成 ⇒ `bonusMul = 1`。
  // ⚠ 少入一条账，后面所有武器的"逐件加成反解"就整体错位（2026-09-26 修）。
  refs?.weaponRanges?.push({ baseM: 2500, bonusMul: 1 })
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
    reloadMs: Math.round(3500 * penalties.reload),
  })
  // 同型仍合并展示/装填/弹药账，伤害字段为该组总量；开火时逐门独立命中。
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
    // ⟪2026-09-22 船长令⟫ 单轮发数 shots（缺省 1）：陵卫连装炮 = 4.6 × 2 ⇒ 单轮总伤与改前 9.2 逐字等价
    const mult = (turret.dmgMult ?? 1) * (turret.shots ?? 1)
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
    // 2026-09-27 船长令（R4/R5 上位技能批）：武器族专精各挂一条上位（动能射击学 / 导弹制导学 / 光束聚焦学），
    // 每级 +1.5%，与族专精乘算叠加；族与族之间照旧互不串乘——映射与数值都在 familyUpgradeMult 单点里。
    famMult *= familyUpgradeMult(state, famKey)
    // V18.1：伤害稳定器（该系加算）乘入单发；射速计算机缩短装填
    // 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——按本武器固定弹型乘入，
    // 装别族武器 = 无加成（仍可用）；无人机与基础舰炮不在此链上，天然豁免
    const shipFam = ship.weaponFamilyBonus?.[type] ?? 0
    const perShot = Math.round(
      (ammoDef?.dmg ?? 0) * mult * dmgScale * famMult * (1 + dmgBonus[type]) * (1 + shipFam) * (1 + dmgFlat),
    )
    // 第二批技能（2026-09-05）：火控阵列学 命中 +3%/级（仅非必中 gun）；武器装填技术 −4%/级（≥60%，gun/beam 共用装填）
    const fireLv = Math.min(5, state.skills.trained['fire-control'] ?? 0)
    // 2026-09-27 起为 `let`：火控统合学要在同一条乘链上再乘一次
    let fireMult = fireLv > 0 ? 1 + 0.03 * fireLv : 1
    // 2026-09-27 上位技能：火控统合学（单点 = hitUpgradeMult，与火控阵列学同乘区）
    fireMult *= hitUpgradeMult(state)
    /**
     * **索敌统合（命中技能）· 2026-09-14 船长改判**（原话：「**索敌统合也改为炮台命中，缩减为 2% 每级**」）：
     * 与「火控阵列学」**同口径**（乘在武器基础命中上、两者**乘算叠加**），每级 `bal.hitPerLevel`（现 2%）。
     * 旧口径是"舰船命中加成 ×(1+5%/级)"——乘在 `ship.hitBonus` 那个小基数上、且进括号后还要被距离
     * 衰减再乘一次 ⇒ 满级实测只值 **+3.3pp**（探针实测）；改到这里后它才真正是"炮台命中"。
     */
    const targetMult = 1 + bal.hitPerLevel * Math.min(5, state.skills.trained[bal.hitSkillId] ?? 0)
    // 装填代价独立乘区，动态装填的步长与下限同乘，不能绕过代价。
    const reload = Math.max(
      100,
      Math.round(
        (turret.reloadMs / reloadDiv) *
          (1 - 0.04 * Math.min(5, state.skills.trained['reload-drills'] ?? 0)) *
          reloadUpgradeMult(state) *
          penalties.reload,
      ),
    )
    if (turret.slot === 'laser') {
      // V18B-2 激光炮：beam 条目——必中（开火不掷命中）、逐发扣能量弹药、
      // 距离衰减作用于威力（幅度 = 命中衰减的 50%，开火时按当前距离计算）
      refs?.weaponRanges?.push({ baseM: rangeBase(turret.maxRangeM), bonusMul: 1 + rangeBonus['plasma'] })
      weapons.push({
        label: count > 1 ? `${turret.name}×${count}` : turret.name,
        kind: 'beam',
        src: 'laser',
        fixedType: 'plasma',
        count,
        shotDmg: perShot * count,
        maxRangeM: rangeOf(turret.maxRangeM, 'plasma'),
        minRangeM: turret.minRangeM ?? 0,
        hitRate: 1,
        falloff: turret.falloff ?? 0.3,
        reloadMs: reload,
        // **叠光同款 · 装填自加速**（船长 2026-10-01 令）：只有带该字段的件（R 族叠光激光炮）才写
        ...(turret.overlayDrive !== undefined ? { overlayDrive: {
          stepMs: turret.overlayDrive.stepMs * penalties.reload,
          floorMs: Math.round(turret.overlayDrive.floorMs * penalties.reload),
        } } : {}),
        // **三连射**（船长 2026-10-03 令）：只有带该字段的件（R 族三叉戟光束炮）才写；
        // 消费点 = 我方开火环（`combat.meBurstReloadOf`，与敌方旗舰那把同款排期）。
        ...(turret.burst !== undefined ? { burst: turret.burst } : {}),
        /**
         * **防空（属性）也认激光件**（**船长 2026-10-02 令**：「**在添加一个激光的近防炮给R族…**」
         * ⇒ R 族「PD激光」是**带防空属性的激光**）。
         *
         * ⚠ 此前只有**炮台分支**折这两个字段（`canHitDrones` / `antiDroneMul`）⇒ 激光件即便写了
         * `antiDrone` 也**筛不到敌方机群**（"近防"本职直接失效，且静默无报错）。两处口径现一致：
         * ①能筛到机群（`canHitDrones`）②打机群伤害 ×该值（`antiDroneMul`，对舰伤害不受影响）。
         * 缺省不写 ⇒ **既有全部激光件零行为变化**（现役三档近防炮都是炮台、走下面那条分支）。
         */
        ...(turret.antiDrone !== undefined
          ? { canHitDrones: true, antiDroneMul: turret.antiDrone }
          : {}),
      })
      continue
    }
    const shotsByType: Partial<Record<DamageType, number>> = {}
    shotsByType[type] = perShot * count
    refs?.weaponRanges?.push({ baseM: rangeBase(turret.maxRangeM), bonusMul: 1 + rangeBonus[type] })
    weapons.push({
      label: count > 1 ? `${turret.name}×${count}` : turret.name,
      kind: 'gun',
      src: turret.slot === 'missile' ? 'missile' : 'turret',
      shotsByType,
      count,
      eqHitMul: (hitEq * plugHitMul) > 1 ? hitEq * plugHitMul : undefined,
      maxRangeM: rangeOf(turret.maxRangeM, type),
      minRangeM: turret.minRangeM ?? 0,
      hitRate: (turret.hitRate ?? 0.5) * fireMult * targetMult,
      // 2026-09-13 虫洞专属（掠袭破片炮）：附加伤害段 + 每次耗弹数——缺省不写 ⇒ 既有武器零变化
      ...(turret.secondaryDamagePct !== undefined && turret.secondaryDamagePct > 0
        ? {
            secondaryDamagePct: turret.secondaryDamagePct,
            secondaryDamageType: turret.secondaryDamageType ?? 'kinetic',
          }
        : {}),
      ...(turret.ammoPerShot !== undefined && turret.ammoPerShot > 1 ? { ammoPerShot: turret.ammoPerShot } : {}),
      // 2026-09-13 虫洞专属（C 孢子导弹巢）：「对所有敌方同时攻击」——缺省不写 ⇒ 既有武器零变化
      ...(turret.hitsAllFoes === true ? { allFoes: true } : {}),
      falloff: turret.falloff ?? 0.3,
      reloadMs: reload,
      // **防空（属性）**（2026-09-11 机群批 S4 + 2026-09-12 船长「给近防炮系列添加一个属性'防空'」）：
      // 装备带 `antiDrone` ⇒ 一条属性带两件事——①能筛到敌方机群（`canHitDrones`）
      // ②打机群伤害 ×该值（`antiDroneMul`）。缺省不写 ⇒ 看不到机群（既有装备零行为变化）。
      ...(turret.antiDrone !== undefined
        ? { canHitDrones: true, antiDroneMul: turret.antiDrone }
        : {}),
    })
  }

  // 无人机装载（2026-09-08 无人机舱大改：只放飞该船 droneLoad 清单——不再从仓库/货仓自动贪心；
  // 甲板扩展 +bay、战术导控 +dmg 不变。装入时 CPU 已在装配预算内预占（UI 钳制），此处为防御：
  // 装配变化导致舱容/CPU 不足时按清单顺序整型裁到装得下，装不下的类型跳过）
  let bayLimit = ship.droneBayM3 ?? 0
  let droneDmgBonus = 0
  /**
   * 无人机中继天线（2026-09-10 船长：百分比制乘入机型基础射程）。
   *
   * ⚠ **2026-09-14 船长「对无人机的射程插件添加叠加惩罚」→「按推荐折算」**：由"全额线性相加"改为
   * **折权加算**（`weightedSum`）——四件同池（制式 MK1/2/3 + G 族「流亡中继桅」）按**加成从强到弱**排位，
   * 第 2 件起乘 `stackWeight` 的 87% / 57% / 28% / 11% 后相加 ⇒ 件件递减（读数：3×MK1 由 +60% → +48.8%、
   * 3×MK3 由 +240% → +195.2%）。判据单点 = `equipment.weightedSum`，收敛分组 = `stackingOf` 的 `weighted`。
   */
  const droneRangePcts: number[] = []
  for (const g of droneGear) {
    bayLimit += g.droneBayBonusM3 ?? 0
    droneDmgBonus += g.droneDmgBonus ?? 0
    if ((g.droneRangeBonusPct ?? 0) > 0) droneRangePcts.push(g.droneRangeBonusPct!)
  }
  /**
   * 无人机射程倍率 = 1 + Σ(中继天线，折权加算)。
   * ⚠ **2026-09-26 船长口径**：射程插件属于"**战斗前的射程加成**"，与中继天线**同一池加算**
   * （插件的 +25% 直接加到本倍率里）。这样 `refs.weaponRanges` 记的 `bonusMul` 也含它 ⇒
   * 干扰压制那条加法反解不会把带插件的机群**多压**。
   */
  const droneRangeMult = 1 + weightedSum(droneRangePcts) + Math.max(0, plugRangeBonus)


  let bayUsed = 0
  // CPU 余量 = 预算总额（船体 CPU + 已装协处理器加成；2026-09-11 新增件）− 已装模块占用
  // ⚠ 传 `shipDef`：含**本船特性折算**（侦察舰的隐秘行动装置 CPU 减半，见 `equipment.cpuUseOf`）
  let cpuLeft = cpuBudgetOf(state, ctx, shipId) - fittedCpuUsed(fitted, ctx, ship)
  const droneLoad = ship.civilianFittingOnly === true ? {} : fleet.droneLoad ?? {}
  // 批次五更正（船长 2026-09-05）：无人机整备学改折装填（CPU 不打折）——每级 −4%
  //（与武器装填技术同口径，均为乘算；武器装填技术不含无人机，两者独立乘算）
  // 2026-09-10 船长（配合出击-返航动画节奏）：装填基准 2200→**4400ms**、单发同步 ×2
  // ——每轮更重、节奏更舒缓，**净 DPS 不变**（故既有校准矩阵口径不变，无需复跑）。
  // 机型级装填（2026-09-11 船长「哨卫将攻击周期翻倍」）：`def.reloadMs` 优先，缺省 = 基准 4400ms；
  // 整备学折减口径不变（每级 −4%）。
  // 2026-09-13 虫洞专属（掠袭机库「无人机攻击间隔 −8%」）：船长澄清 = **无人机出击周期**——
  // 与整备学（每级 −4%）同口径乘算；多件加算，合计上限 0.9（避免周期被压到 0）。
  const droneCycleCut = Math.min(
    0.9,
    droneGear.reduce((s, g) => s + (g.droneCycleCutPct ?? 0), 0),
  )
  const droneReloadOf = (def: { reloadMs?: number }): number =>
    Math.round(
      (def.reloadMs ?? 4400) *
        (1 - 0.04 * Math.min(5, state.skills.trained['drone-servicing'] ?? 0)) *
        droneReloadUpgradeMult(state) *
        (1 - droneCycleCut) * penalties.reload,
    )
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
        // **基准账**：无人机每架也是一条武器条目 ⇒ 逐架入账（基准 = 机型射程、加成 = 中继天线那套
        // `droneRangeMult`）——不入账就会被当成"无加成"压（2026-09-26 修）。
        refs?.weaponRanges?.push({ baseM: def.maxRangeM ?? 2600, bonusMul: droneRangeMult })
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
          reloadMs: droneReloadOf(def),
        })
      }
    }
  }

  if (damage.range !== 1) {
    for (const weapon of weapons) weapon.maxRangeM = Math.round(weapon.maxRangeM * damage.range)
    for (const range of refs?.weaponRanges ?? []) range.baseM *= damage.range
  }
  return {
    tag: 'player',
    name: ship.name,
    side: 'me',
    // 虫洞 D 批（2026-09-13）：我方单位的**档位/定位**——供敌方选靶模式「打最小/最大/打非战斗船」判定。
    // 单船路径不读这两项 ⇒ 只多两个字段，零行为变化。
    shipTier: ship.tier,
    shipRole: ship.role,
    /**
     * **被选中权重**（**2026-09-26 船长令**：靶标插件「**增加被选中的权重**」×2 · 隐匿插件
     * 「**减少被攻击的权重**」×0.4）。消费点 = `pickMyUnitTarget` 的加权抽取；
     * 缺省 1 ⇒ 没装插件时与改动前**逐位等价**（见该函数的加权说明）。
     */
    ...(plugTargetWeight !== 1 ? { targetWeightMul: plugTargetWeight } : {}),
    // 2026-09-16 船长：后勤舰的维修装置改修队友（**数据字段驱动**，见 `ShipDef.repairPulseTargetsFleet`；
    // 同日追批「并添加到船体特性属性中」⇒ 判据从 `subClass === '后勤舰'` 改为读字段，界面「船体特性」栏同源）
    ...(ship.repairPulseTargetsFleet === true ? { logistics: true } : {}),
    /**
     * **截击舰特性 · 不会被网子选为目标**（**2026-09-30 船长令**；数据字段驱动，同上一行「后勤舰」先例）。
     * 只带出这一个旗标，判定在 `fireFoeCaptureWeb`（敌方捕获网的入口守卫）。
     */
    ...(ship.interceptorImmuneToWeb === true ? { interceptorImmuneToWeb: true } : {}),
    /** 损伤管制装置（2026-09-25 船长令）：本舰装没装、启动时吃哪种组件；`shipId` 供"从本舰货仓取组件"用 */
    shipId: ship.id,
    ...(dcKit !== undefined ? { hullSaveKit: dcKit } : {}),
    hp,
    resists,
    // 本舰无人机结构层加成（模块求和；2026-09-13 船长：鱿蜂结构层「提高无人机 80% 的结构」）
    droneHullBonusPct: allDefs.reduce((s, m) => s + (m.droneHullHpBonusPct ?? 0), 0),
    // 本舰无人机护盾层加成（模块求和；2026-09-27 船长令：无人机护盾投射仪 MK2/MK3 = +70%/+100%，多件线性相加不设上限）
    droneShieldBonusPct: allDefs.reduce((s, m) => s + (m.droneShieldHpBonusPct ?? 0), 0),
    /**
     * 本舰"对方对机群的命中收窄"（模块求和；**2026-09-29 船长令**：巨构导控塔 −5%）。
     * ⚠ 缺省**不写字段**（`> 0` 才写）：没有这件装备时 `UnitSpec` 与改动前**逐位等价**，
     *   既有战斗快照/存档的字段面不受影响。
     */
    ...(allDefs.some((m) => (m.droneHitGapPct ?? 0) > 0)
      ? { droneHitGapPct: allDefs.reduce((s, m) => s + (m.droneHitGapPct ?? 0), 0) }
      : {}),
    // V18.1：回避 = 船体基础 + 姿态陀螺缺口复合（1−(1−基础)Π(1−x)）
    evasion,
    // ⚠ 2026-09-14 船长改判：**索敌统合不再放大舰船命中加成**（改去乘炮台基础命中，见上 `targetMult`）
    // ⇒ 这里恢复成**纯静态舰船值**（装配台那一行「命中加成 +N%」自此与实际完全一致）。
    // 2026-09-22 舰种操作：驱逐舰操作加**百分点**（+2pp/级）——与敌方闪避同处那条减法式（船长裁定「加百分点」）
    hitBonus: (ship.hitBonus ?? 0) + 0.02 * destroyerOpsLv,
    // 装备命中代价逐件折权相乘；索敌收益仍走炮台条目eqHitMul。
    // 2026-09-10 船长：本值 = **点火期**的命中乘子；冷却期不开火失稳（stepBattle 用 meAtk 置 1）
    hitMul: penalties.hit,
    signatureM: ship.signatureM ?? 80,
    scanResMm: ship.scanResMm ?? 500,
    // V17 矢量推进器 = 加力推进；V18.1 多件速度加成 EVE 曲线收敛；矢量机动操作（舰船）再乘 +5%/级
    // 常驻速度代价逐件相乘，保留原安全下限。
    // 2026-09-10 船长（推进器周期化）：**基础速度不含推进器**——推进器改走 thrusterBoost，
    // 只在爆发窗口内生效（见 thrusterPhase），冷却期回到本值。
    speedMps:
      ((ship.maxSpeedMps ?? 200) + plugSpeedMps) *
      (1 + bal.speedPerLevel * Math.min(5, state.skills.trained[bal.speedSkillId] ?? 0)) *
      Math.max(0.1, penalties.speed) * damage.speed,
    // 推进器爆发倍率（多件 EVE 曲线收敛后的合成值 − 1）：0 = 未装；爆发窗口内才乘上去
    ...(speedEq > 1 ? { thrusterBoost: speedEq - 1 } : {}),
    // 本单位自己的点火周期（只在有覆盖件时写；没写 = 全局 60/60，见 `unitThrusterCycle`）
    ...(cycleOverridden ? { thrusterBoostMs: propCycle!.boostMs, thrusterCooldownMs: propCycle!.cooldownMs } : {}),
    /**
     * **跃迁规避装置**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
     * 但是冷却时间延长到12秒。」）—— 中槽件里带 `blink` 的那件（R 族 `mod-lair-blink-r`）。
     * 多件装 ⇒ 取**拉开距离最大、同距取冷却最短**那一件（与推进器周期同一把"挑最有利的一件"的尺）。
     * 没装 ⇒ 不写字段 ⇒ 零行为变化。
     */
    ...(() => {
      const blinks = allFittedModules(fitted, ctx).filter((m) => m.blink !== undefined)
      if (blinks.length === 0) return {}
      const pick = [...blinks].sort(
        (a, b) => b.blink!.distanceM - a.blink!.distanceM || a.blink!.cooldownMs - b.blink!.cooldownMs,
      )[0]!
      return { meBlink: { ...pick.blink! } }
    })(),
    agility: ship.agility,
    weapons,
    // 锁定装置（2026-09-09）：被锁目标受击加深等效比例（>0 同时开启集火模式）
    ...(lockEq > 1 ? { lockedDmgBonus: lockEq - 1 } : {}),
    // **隐秘行动装置**（2026-09-15 船长）：隐身窗口取所装件里**最长**的一件；
    // **装了任何推进器 ⇒ 直接解除**（船长同日追加的禁令）⇒ 这里不写字段（= 无隐身）。
    ...(stealthMs > 0 ? { stealthMs } : {}),
    /**
     * **墨潮捕获网**（**船长 2026-09-26**，H 族势力装备）：带本字段 = 本舰担任"网手"。
     * 周期取所装件里**最短**的一件（多件 = 更快的那台说了算，与隐身取最长相反：
     * 这是攻击性装置，重叠装没有收益）；账本与判定见 `advanceMyCaptureWebs`。
     * ⚠ 射程 / 断开 / 减速三项随件上字段走（见上方 `webRangeM` 一族）。
     */
    ...(webCycleMs > 0
      ? { myCaptureWeb: { cycleMs: webCycleMs, rangeM: webRangeM, breakM: webBreakM, slowMul: webSlowMul } }
      : {}),
    foeTactic: null,
  }
}

const AMMO_IDS: Record<DamageType, string> = {
  kinetic: 'ammo-kinetic-l',
  explosive: 'ammo-explosive-l',
  plasma: 'ammo-plasma-l',
}
export { AMMO_IDS }

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
