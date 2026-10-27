/** 战斗域：arcs，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { SimContext, AnomalyDef, DamageType } from '../types'
import { battleAnomalyOf } from './cards'
import { createPlayerSpec } from './player/create'
import { AMMO_IDS } from './player/factors'
import { createFoeSpecs, activeFoeSpecsOf } from './foes/catalog'
import { mainWeaponOf, battleOpenM, battleMaxDistanceM, foeDesiredRange } from './foes/tactics'
import { foesWithSupport } from './foes/reinforcements'
import type { WeaponSrc } from './model'
import { type BattleWeaponCycleView, battleWeaponCyclesOf } from './battleWeaponView'
import { type BattleDeviceCycleView, battleDeviceCyclesOf } from './battleDeviceView'
import { battleAmmoIdsFor, battleAmmoAvailable, battleWeaponAmmoCost, ammoKeyOf } from './combatAmmo'
import { applyAlienCorrosion } from './alienCombat'
import { applyMeWebDebuff } from './captureWebs'
import { syncCoronaFleetFocus } from './coronaFocus'
import { applyMeJammerDebuff, meJammerNetOf, foeDroneRangeOf, foeGunMaxRangeOf } from './foeRange'
import { playerGravekeeperSpecOf } from './gravekeeperGear'
import { buildMyUnitSpecs } from './fleetSpecs'
import { uidDefId } from '../labels'
import { shipDisplayName } from '../instances'
import { isAlive } from './combatMath'
import { thrusterPhase, unitThrusterCycle, unitSpeedMulOf } from './movement'
import { dronePoolOwner } from './combatDrones'
import { gravekeeperStatusesOf } from './gravekeeperCombat'

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
  const main = mainWeaponOf(me) ?? me.weapons[0]!
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
    me: { minM: main?.minRangeM ?? 0, maxM: main?.maxRangeM ?? 0, name: main?.label ?? '' },
    foe: { minM: foeMin, maxM: foeMax },
  }
}

/** 战斗可视化武器卡（战场射程弧/弹药颜色用）：返回双方射程带、当前弹药与开火弹型。
 * 我方逐武器展开：炮台颜色 = 与引擎同口径的"剩余最多弹型"（无弹 null，画虚线灰弧）；
 * 敌方整编队聚合一道（同型同射程）。无战斗/记录缺失返回 null。 */
export function battleArcsFor(
  state: GameState,
  ctx: SimContext,
  /**
   * **显式战斗上下文**（2026-09-13 F 批）：不给 = 既有"远征战斗"口径（逐字不变）；
   * 给了 = 按这套上下文出视图（虫洞战斗由 `wormholeBattleViewOf` 传进来，与远征互不干扰）。
   */
  override?: {
    battle: import('../state').BattleState
    anomaly: AnomalyDef
    /** 视图锚（我方主视角/主控）的船型 uid */
    leaderShipId: string
  } | null,
): {
  nearM: number
  openM: number
  /**
   * **战场远端 = 距离上限**（2026-09-19 船长裁定「甲」新增）：
   * 按**当前**双方有效射程现算（含我方技能/科技增程、敌方受击增程），只增不减；
   * **无增程时逐字等于 `openM`** ⇒ 常规战斗的界面几何/距离尺一字不变。
   */
  maxM: number
  desireMaxM: number
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
    /** **主武器**（战术距离口径，同 `mainWeaponOf`：射程最远、并列取名义火力大的）——
     *  UI 据此在射程弧端画米数刻度（2026-09-12 船长裁定「甲」后单点下发，界面不再自己 find(kind==='gun')） */
    isMain?: boolean
  }>
  /** 我方各武器当前装填剩余毫秒（与 me 同序；0 = 可开火；战斗单位缺失时为空数组） */
  meReload: number[]
  weapons: BattleWeaponCycleView[]
  devices: BattleDeviceCycleView[]
  /** **我方编队逐舰读数**（F 批「4 条舰影 + 血条」；单船路径 = 一条 = 主控） */
  myUnits: Array<{
    tag: string
    /** 编队 uid（`船型id#序号`）：血条 / 名称 / 装配查找用它 */
    shipId: string
    /** 船型 id（`sh-thresher`）：**画舰影必须用它**（uid 查不到舰形资产表 ⇒ 会退回兜底剪影） */
    defId: string
    name: string
    className: string
    /** 主控（视图锚） */
    leader: boolean
    /**
     * **本舰的机群机体清单**（2026-09-14 船长「逐舰机群」）：按该舰**存活**的池条目归并
     * （`artId → 架数`）。界面据此**逐舰**画机体（挂在各舰自己的锚点上）；
     * 键里带 owner，故主控那条与旧口径同源（同 artId、同架数、同锚点 ⇒ 逐像素不变）。
     * 缺省/空数组 = 该舰没有机群（或不参战）。
     */
    drones: Array<{ artId: string; count: number; deployed?: number }>
    hp: { s: number; a: number; h: number }
    hpMax: { s: number; a: number; h: number }
    alive: boolean
    /** 本舰推进器当前有效点火状态，含逐舰周期与捕获网压制。 */
    boosting: boolean
    ammoIds?: Partial<Record<DamageType, string>>
  }>
  /** 敌方各武器射程带（聚合）：`minM~maxM` 跨全部单位取极值，`type` = 遍历到的最后一件武器弹种 */
  foe: { minM: number; maxM: number; type: DamageType }
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长反馈"敌方射程不一致时只显示其中一个"）：
   * 按 (min, max, 弹种) 去重、外圈在前；`count` = 用该带的**敌舰艘数**，`names` = 舰名（悬停说明用）。
   * 只有一条带时界面观感与旧版完全一致（同一条「敌方 X~Ym」）；多条带时界面逐带各出一条。
   */
  foeBands: Array<{ minM: number; maxM: number; type: DamageType; count: number; names: string[]; mounts?: string[] }>
  /** 各单位三层满血量（UI 垂直血条按各自满值比例绘制） */
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
  /** 机群战损（2026-09-10）：本场已击落架数（机型 id → 架数）；缺省 = 无损失 */
  droneLost?: Record<string, number>
  /** 推进器爆发倍率（2026-09-10 船长定：0 = 未装；点火期乘在战斗机动上）——UI 冷却格显示用 */
  thrusterBoost: number
  /** **我方首舰的推进器周期**（2026-09-14 逐单位周期：微型跃迁引擎 = 10 秒点火）——UI 冷却格与倒计时读它 */
  thrusterCycle: { boostMs: number; cooldownMs: number }
  /** 敌方是否有突进资格（威胁 ≥ 门槛 且 近战）——UI「突进中」标记用（未突进时为 false） */
  foeCanCharge: boolean;
  /** 本波存活且正在冲锋的敌舰，含支援舰；战斗结束后为空。 */
  foeChargingTags: string[]
  /**
   * **双方当前速度（m/s）**（2026-09-16 船长：距离条两端显示；同日裁「只改战斗显示数值」）——
   * **面板同源口径**：单位 `speedMps` × 机动倍率（我方点火期含推进器倍率、敌方冲锋期含冲锋倍率），逐单位平均；
   * 与装配页「机动速度」同一把尺（**不含**引擎内部的 ×0.6 折算）。
   * **开战首拍之前缺省**（老档在途战斗同样缺省 ⇒ 界面不显示这一格）。
   */
  meSpeedMps?: number
  foeSpeedMps?: number
  /**
   * **敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——本场敌方挂了哪些件
   * （去重展示名，如「劫掠冲锋推进器」）；**缺省 = 本场敌人没挂件**（既有战斗零变化）。
   */
  foeMounts?: string[]
  gravekeeperStatuses?: import('./gravekeeperCombat').GravekeeperStatus[]
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMounts` 下标对齐）——界面按当前语言挑一列
   * （`BattleScreen.mountNamesTextOf`）；**缺省**（老档在途战斗）⇒ 回退中文名数组。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /**
   * **捕获网连线**（船长 2026-09-16）：每条形如 `{ from: 施放者 tag, to: 被钉舰 tag }`；
   * 渲染层画一条蓝色光束、**持续到解除**（击杀发动者即消失）。缺省 = 本场没有网。
   */
  webLinks?: Array<{ from: string; to: string; fromName: string; toName: string; slowPct: number }>
  /** **敌方机群**（2026-09-11 机群批 S5）——按敌单位 tag 汇总：机型 id / 机库存量 / **现存架数**。
   *  表现层据此在**敌舰旁**画出警戒机群（与我方机群层共用 `droneArt` 的机体资产）。
   *  **缺省 = 本场没有敌机**（既有战斗零行为变化）。 */
  foeDrones?: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（见 `FoeShipDef.droneRangeMulOnHit`）——表现层把机群阵位后撤、出击线拉长 */
    rangeBuff: boolean
    /** **机库余量**（备用机库：在库待命的架数；2026-09-12 船长「损坏后补充敌机」）——缺省 = 无备用 */
    hangar?: number
  }>
} | null {
  const anomaly =
    override?.anomaly ??
    battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  const battle = override?.battle ?? state.expedition.battle
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const leaderShipId = override?.leaderShipId ?? state.shipId
  /** 干扰压制的基准账（见 `applyMeJammerDebuff`）——视图锚舰同样要吃这份基准 */
  const leaderTag = battle.myFleet?.find((e) => e.shipId === leaderShipId)?.tag ?? 'player'
  const meRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }>, legacyWeaponCount: battle.units[leaderTag]?.weapons.length }
  const me = createPlayerSpec(state, ctx, leaderShipId, battleAmmoIdsFor(battle, leaderTag), meRefs)
  if (!me) return null
  me.tag = leaderTag
  applyAlienCorrosion(me, battle.alienCorrosion ?? 0)
  // **捕获网**（船长 2026-09-16）：视图锚舰被钉时同样施加四层效果 ⇒ 面板速度/射程带与引擎同尺
  {
    const web = battle.meWebDebuffs?.[me.tag]
    if (web) applyMeWebDebuff(me, web)
  }
  /**
   * **敌干扰压制**（H 族墨潮干扰舰 · 2026-09-24）：视图锚舰与引擎**同一处口径**——
   * 不然射程弧 / 底部射程标签会拿"没被压过"的射程去画（与引擎实际开火门不一致）。
   * ⚠ 敌阵取**当前波**（`activeFoeSpecsOf`，与引擎 `specsOf(waveIdx)` 同源）：多波卡里干扰舰只在
   * 某一波出场 ⇒ 取第 0 波会漏判。
   */
  const foes = foesWithSupport(battle, activeFoeSpecsOf(anomaly, bal, battle.waveIdx))
  syncCoronaFleetFocus(battle, foes)
  applyMeJammerDebuff(me, meJammerNetOf(battle, foes), meRefs.weaponRanges)
  Object.assign(me, playerGravekeeperSpecOf(battle, me, true))
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
    isMain?: boolean
  }> = []
  const meReload: number[] = []
  const droneAt = new Map<string, number>()
  const droneN: number[] = []
  // 主武器（战术距离口径）：与三按钮/射程带/预估同源——弧上米数刻度照它出
  const mainW = mainWeaponOf(me)
  me.weapons.forEach((w, i) => {
    if (w.disabled) return
    // 2026-09-10 船长「无人机可被击落」：被点防打掉的架次不出现在射程弧/机群计数里
    if (w.src === 'drone' && battle.dronePools?.[i]?.alive === false) return
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (w.kind === 'beam') type = battleAmmoAvailable(battle, leaderTag, 'plasma') >= battleWeaponAmmoCost(battle, leaderTag, i, 'plasma', w) ? 'plasma' : null
    else {
      /**
       * **炮台 / 导弹架：报"这件武器自己打的那一型"**，不是全船主流弹种。
       *
       * ⚠ **2026-09-24 船长报障（玩家截图）**：「攻坚炮台 MK3·动能型背后写着**能量弹药**，巡航导弹架 MK3
       * 也写着」——根因就是这里：旧口径取 `nextAmmoType(battle.ammo)`（**全船剩余最多的那一型**），
       * 于是只要场上有激光/能量弹占多数，**每一门炮**（含动能炮、导弹架）的弹种徽标与射程弧颜色
       * 都会被写成"能量"。现按**这件武器自己的弹种**判（与 `stepBattle` 的取弹口径逐字同源：
       * 弹型 = `shotsByType` 的键、耗弹 = 门数 × 每发耗弹数），该型打光 ⇒ `null`（界面照既有口径
       * 显示"无弹/虚线弧"，不再假装有弹）。
       */
      const own = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? w.fixedType ?? null
      const need = own !== null ? battleWeaponAmmoCost(battle, leaderTag, i, own, w) : 1
      type = own !== null && battleAmmoAvailable(battle, leaderTag, own) >= need ? own : null
    }
    const rem = Math.max(0, Math.floor(meRt[i] ?? 0))
    if (w.src === 'drone') {
      const key = w.artId ?? 'drone'
      const at = droneAt.get(key)
      if (at !== undefined) {
        droneN[at] = (droneN[at] ?? 1) + 1
        meReload[at] = Math.min(meReload[at] ?? rem, rem)
        if (w === mainW) meArcs[at]!.isMain = true // 同机型合并条目：主武器落在组内也标上
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
        ...(w === mainW ? { isMain: true } : {}),
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
      ...(w === mainW ? { isMain: true } : {}),
    })
    meReload.push(rem)
  })
  meArcs.forEach((a) => {
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
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长：「战斗场景内，假如敌方的舰船射程不一致，只会显示其中一个的射程」
   * ——指屏幕下方那条「敌方 X~Ym」标签）。上面那条聚合带只够表达"最远的威胁"：编队里短射程的船
   * （如快速艇 1~1883 对头目舰 1~2210）会被并集吃掉、看起来只剩一个射程。这里按
   * (最小射程, 最大射程, 弹种) 分组去重下发，界面照**我方逐武器一条**的同款做法逐带出一条。
   */
  const foeBandMap = new Map<string, { minM: number; maxM: number; type: DamageType; units: number; names: Set<string>; mounts: Set<string> }>()
  for (const f of foes) {
    // 同一单位的多件同带武器只算一艘；`count` = **用该带的敌舰艘数**（三艘同名快艇 = 3，不是 1）
    const seenBandOfUnit = new Set<string>()
    for (const w of f.weapons) {
      // **敌机射程要读"实战射程"**（2026-09-12 船长实测反馈：「无人机射程变更后，下方的射程标签内数值
      // 也要变动」）：敌机武器条目的 `maxRangeM` 是**机型射程**（原始值），而实战射程 = 机型射程 ×
      // **受击增程倍率**（`foeDroneRangeOf`，母舰被命中后 ×4）⇒ 标签若读原始值，就会出现
      // "打得着 20km、标签还写 5km"。**与开火射程门同源**（见 `resolvePointDefense` 上游那处）✓
      const wMin = w.minRangeM
      const wMax =
        w.src === 'drone'
          ? foeDroneRangeOf(battle, w, f)
          : foeGunMaxRangeOf(battle, f, w)
      foeMin = Math.min(foeMin, wMin)
      foeMax = Math.max(foeMax, wMax)
      const type = w.fixedType ?? 'kinetic'
      foeType = type
      const key = `${wMin}|${wMax}|${type}`
      let band = foeBandMap.get(key)
      if (!band) {
        band = { minM: wMin, maxM: wMax, type, units: 0, names: new Set<string>(), mounts: new Set<string>() }
        foeBandMap.set(key, band)
      }
      band.names.add(f.name)
      // 该带的敌方挂载件（2026-09-16 船长：敌舰悬停要能看到挂载）
      for (const m of f.foeMountNames ?? []) band.mounts.add(m)
      if (!seenBandOfUnit.has(key)) {
        seenBandOfUnit.add(key)
        band.units += 1
      }
    }
  }
  if (!Number.isFinite(foeMin)) foeMin = 0
  // 外圈在前（远 → 近），同远者近端更小者在前——与界面"从外往里读"一致
  const foeBands = [...foeBandMap.values()]
    .map((b) => ({
      minM: b.minM,
      maxM: b.maxM,
      type: b.type,
      count: b.units,
      names: [...b.names],
      ...(b.mounts.size > 0 ? { mounts: [...b.mounts] } : {}),
    }))
    .sort((a, b) => b.maxM - a.maxM || a.minM - b.minM)
  const openM = battleOpenM(me, foes, bal)
  // 各单位三层满血量（UI 垂直血条按各自满值比例绘制）：以战斗实况单位为准——
  // 2026-09-09 多波修复：foes 仅按"单波默认"重建，波次增援/多小队单位（w{n}-foe-* 等）不在其内，
  // 曾致后续波敌人血条为空（数值正常）；现优先 battle.units[tag].hpMax（引擎生成时写入），
  // 旧档缺省 hpMax 时以当前血兜底（读档中断局近似满值显示）。
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  /**
   * **母舰血条的分母 = 池子口径的三层容量**（船长 2026-09-25：「母舰哪怕残血，在战斗中血上限依旧保持不变」
   * ＋「**当前血条按 护盾 → 装甲 → 结构 的顺序扣除**」）：
   * 单位自己的 `hpMax` 是"本场开打那一刻的分层血量"（可能护盾已经是 0、装甲只半满）⇒ 直接当分母会让
   * 血条越打越"满"。这里三行分母改用 `FoeOverride.bossMaxLayers`（= 池子总量 × 卡面 split，恒定）。
   * ⚠ **只改这一份显示读数**：`battle.units[tag].hpMax` 与伤害台账（`flagshipBattleLedger`）都保持原值，
   * 跨场累计不会重复计。
   */
  const bossShipId = battle.foeOverride?.bossShipId
  const bossHpMax = battle.foeOverride?.bossHpMax
  const bossMaxLayers = battle.foeOverride?.bossMaxLayers
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    const max = u.hpMax ?? { s: Math.max(0.001, u.hp.s), a: Math.max(0.001, u.hp.a), h: Math.max(0.001, u.hp.h) }
    const isBoss = bossShipId !== undefined && u.foeShipId === bossShipId
    /** ① 首选：显式三层容量（池子口径；与"当前值"分开给的那份） */
    const layered =
      isBoss &&
      bossMaxLayers !== undefined &&
      Number.isFinite(bossMaxLayers.s) &&
      Number.isFinite(bossMaxLayers.a) &&
      Number.isFinite(bossMaxLayers.h) &&
      bossMaxLayers.s + bossMaxLayers.a + bossMaxLayers.h > 0
        ? { s: Math.max(0, bossMaxLayers.s), a: Math.max(0, bossMaxLayers.a), h: Math.max(0, bossMaxLayers.h) }
        : null
    /** ② 兜底（老档/只给了总量）：按 `bossHpMax ÷ 本场满值` 等比放大三层 */
    const sum = max.s + max.a + max.h
    const scale =
      layered === null &&
      isBoss &&
      bossHpMax !== undefined &&
      Number.isFinite(bossHpMax) &&
      bossHpMax > 0 &&
      sum > 0 &&
      bossHpMax > sum
        ? bossHpMax / sum
        : 1
    foeMaxHp[tag] =
      layered !== null
        ? layered
        : scale === 1
          ? max
          : { s: max.s * scale, a: max.a * scale, h: max.h * scale }
  }
  // 弹药 MK2（2026-09-09）：本场实装弹名（仅当与基础弹不同时提供；UI 兜底用弹型名）
  const ammoNames: Partial<Record<'kin' | 'exp' | 'pla', string>> = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const id = battleAmmoIdsFor(battle, leaderTag)?.[t]
    if (!id) continue
    const def = ctx.items.get(id)
    if (def?.name && id !== AMMO_IDS[t]) ammoNames[ammoKeyOf(t)] = def.name
  }
  // 敌方机群（2026-09-11 机群批 S5）：按 tag 汇总"机型 / 机库存量 / 现存架数"给表现层——
  // 敌机与母舰同建同灭（母舰阵亡 ⇒ 其池不再参战），故这里只汇总**当前波存活单位**的池。
  const foeDroneWings: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（2026-09-11 船长）——表现层据此把机群阵位后撤、出击/攻击线拉长 */
    rangeBuff: boolean
  }> = []
  /**
   * ⚠ **支援舰的机群也要画**（2026-09-27）：它的池由 `resolveFoeRevive` 建（`initFoeDronePools(b, [spec])`），
   * 而"参战敌阵"含支援舰（`foesWithSupport`）⇒ 它复活的战列巡洋舰**真会放飞那架重袭机**；
   * 若这里只遍历编成条目，那架无人机会**打人却看不见**（引擎与画面两套口径）。
   */
  for (const f of foesWithSupport(battle, foes)) {
    const pools = battle.foeDronePools?.[f.tag]
    if (!pools || pools.length === 0) continue
    // **备用机库**（2026-09-12）：在库待命的架次**不算出战架数**（画面不画、血条不计），
    // 单独以 `hangar` 报给界面（可显示"机库余量"）。
    const active = pools.filter((p) => p.inHangar !== true)
    const hangarN = pools.length - active.length
    const byArt = new Map<string, { count: number; alive: number }>()
    for (const p of active) {
      const id = p.artId ?? 'drone'
      const cur = byArt.get(id) ?? { count: 0, alive: 0 }
      cur.count += 1
      if (p.alive) cur.alive += 1
      byArt.set(id, cur)
    }
    for (const [artId, v] of byArt)
      foeDroneWings.push({
        tag: f.tag,
        artId,
        count: v.count,
        alive: v.alive,
        rangeBuff: (battle.foeDroneRangeBuff ?? 1) > 1,
        ...(hangarN > 0 ? { hangar: hangarN } : {}),
      })
  }
  /**
   * **我方编队逐舰读数**（2026-09-13 F 批「4 条舰影 + 血条」的数据源）：
   * 单船路径 = 只有主控一条（`tag='player'`）；多单位路径 = 主控 + 僚舰（各自三层血）。
   */
  const mySpecs = new Map(buildMyUnitSpecs(state, ctx, battle, leaderShipId, anomaly.id, foes).map(spec => [spec.tag, playerGravekeeperSpecOf(battle, spec, true)]))
  const myUnits = (battle.myFleet && battle.myFleet.length > 0
    ? battle.myFleet
    : [{ tag: 'player', shipId: leaderShipId }]
  ).map((e) => {
    const u = battle.units[e.tag]
    const def = ctx.ships.get(uidDefId(e.shipId))
    const spec = mySpecs.get(e.tag)
    return {
      tag: e.tag,
      /** **编队 uid**（`船型id#序号`）—— 血条 / 名称 / 装配查找都用它 */
      shipId: e.shipId,
      /**
       * **船型 id**（`sh-thresher` 这种）—— **画舰影必须用它**。
       *
       * ⚠ 2026-09-14 修船长报障「**在虫洞内，友方舰船的图形不正确**」：战斗界面多舰路径原先拿
       * `shipId`（uid）去查 `SHIP_ART` ⇒ `sh-thresher#3` 查不到资产表 ⇒ **退回 role 兜底剪影**
       * （于是洞里 4 条友舰都成了"通用突击舰/作业船"轮廓）。单船路径一直传的是 `ShipDef.id`，
       * 所以只有洞内多舰战斗会错。这里直接把 defId 一并给出去，界面不必再自己拆 uid。
       */
      defId: uidDefId(e.shipId),
      name: shipDisplayName(state, ctx, e.shipId),
      className: def?.name ?? e.shipId,
      leader: e.tag === 'player',
      hp: u ? { ...u.hp } : { s: 0, a: 0, h: 0 },
      hpMax: u?.hpMax ?? { s: 0, a: 0, h: 0 },
      alive: !!u && u.hp.s + u.hp.a + u.hp.h > 0,
      boosting: battle.ended === null && isAlive(battle, e.tag) && !!spec && (spec.thrusterBoost ?? 0) > 0 && thrusterPhase(battle, bal, unitThrusterCycle(spec, bal)).boosting,
      ...(battle.expeditionAmmo ? { ammoIds: battleAmmoIdsFor(battle, e.tag) } : {}),
      /** 逐舰机群机体清单（见上方类型注释；只算**该舰存活**的池条目） */
      drones: (() => {
        const byArt = new Map<string, { count: number; deployed: number }>()
        for (const [k, p] of Object.entries(battle.dronePools ?? {})) {
          if (!p.alive || !p.artId) continue
          if (dronePoolOwner(k) !== e.tag) continue
          const row = byArt.get(p.artId) ?? { count: 0, deployed: 0 }
          row.count++
          if (p.launched !== false) row.deployed++
          byArt.set(p.artId, row)
        }
        return [...byArt].map(([artId, counts]) => ({ artId, ...counts }))
      })(),
    }
  })
  const cycleUnits = myUnits.flatMap(unit => {
    const spec = mySpecs.get(unit.tag)
    return spec ? [{ spec, shipId: unit.shipId, name: unit.name }] : []
  })
  return {
    nearM: bal.minDistanceM,
    openM,
    /**
     * **战场远端（距离上限）**——2026-09-19 船长裁定「甲」后新增：界面那把距离尺/泳道几何按它定"拉开"那一端，
     * 这样敌方挨打增程（或我方科技增程）把战场撑宽时，画面与引擎**同一把尺**（无增程时 = `openM`，逐像素不变）。
     */
    maxM: battleMaxDistanceM(battle, me, foes, bal),
    desireMaxM: battleMaxDistanceM(battle, me, foes, bal) * (battle.wormhole?.desireRangeMul ?? 1),
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal, battle.meFoeRangeDebuff ?? 0, battle)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    ...(Object.keys(ammoNames).length > 0 ? { ammoNames } : {}),
    me: meArcs,
    meReload,
    weapons: battleWeaponCyclesOf(battle, cycleUnits, ctx),
    devices: battleDeviceCyclesOf(state, ctx, battle, cycleUnits,
      spec => thrusterPhase(battle, bal, unitThrusterCycle(spec, bal))),
    myUnits,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    foeBands,
    gravekeeperStatuses: gravekeeperStatusesOf(battle, foes),
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
    // 机群战损（2026-09-10）：本场已击落架数（UI 战报/提示用；缺省 = 无损失）
    ...(battle.droneLost && Object.keys(battle.droneLost).length > 0 ? { droneLost: battle.droneLost } : {}),
    // 推进器爆发倍率与敌方突进资格（2026-09-10 船长定）——UI 与引擎同源
    thrusterBoost: me.thrusterBoost ?? 0,
    /** **我方首舰（= 距离/读数锚）的推进器周期**（2026-09-14 逐单位周期后，战斗界面那一格读它） */
    thrusterCycle: unitThrusterCycle(me, bal),
    // 双方战斗机动速度（2026-09-16 船长：距离条两端显示）——读引擎逐拍落的那份，界面不自己算
    ...(battle.meSpeedMps !== undefined ? { meSpeedMps: battle.meSpeedMps } : {}),
    ...(battle.foeSpeedMps !== undefined ? { foeSpeedMps: battle.foeSpeedMps } : {}),
    foeCanCharge: foes.some((f) => f.foeCanCharge === true),
    foeChargingTags: battle.ended === null
      ? foesWithSupport(battle, foes).filter(f => isAlive(battle, f.tag) && unitSpeedMulOf(f, battle, bal, 'foe') > 1).map(f => f.tag)
      : [],
    // **捕获网连线**（船长 2026-09-16：「动画效果为一根蓝色的光速连着命中舰船」）——
    // 渲染层按 (from = 施放者 tag, to = 被钉舰 tag) 画一条蓝色光束，**持续到效果解除**。
    // ⚠ **2026-09-26 起两个方向都下发**：敌方网钉我方（`meWebDebuffs`）＋ 我方网钉敌方（`foeWebDebuffs`，
    //   墨潮捕获网）——同一份 `webLinks` 结构，渲染层一行不用改。
    ...(() => {
      const links = [
        ...Object.entries(battle.meWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
        ...Object.entries(battle.foeWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
      ].filter(link => isAlive(battle, link.from) && isAlive(battle, link.to)).map(link => ({ ...link,
        fromName: battle.units[link.from]?.name ?? link.from, toName: battle.units[link.to]?.name ?? link.to }))
      return links.length > 0 ? { webLinks: links } : {}
    })(),
    // **敌方挂载件**（去重展示名）——界面/战报同源；空 = 本场敌人没挂件（老档同样缺省）
    // ⚠ 2026-09-24 起**连同双语名对**一起下发（两条数组下标对齐，见 `foeMountNamePairs`）
    ...(() => {
      const pairs = new Map<string, readonly [string, string]>()
      for (const f of foes) {
        const names = f.foeMountNames ?? []
        const ps = f.foeMountNamePairs ?? []
        for (let i = 0; i < names.length; i++) {
          const n = names[i]!
          if (!pairs.has(n)) pairs.set(n, ps[i] ?? [n, n])
        }
      }
      return pairs.size > 0 ? { foeMounts: [...pairs.keys()], foeMountNamePairs: [...pairs.values()] } : {}
    })(),
    ...(foeDroneWings.length > 0 ? { foeDrones: foeDroneWings } : {}),
  }
}
