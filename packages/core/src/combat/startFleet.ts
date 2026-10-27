/** 战斗域：startFleet，从原引擎按职责迁移，保持结算顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext, DamageType } from '../types'
import type { FoeOverride, UnitSpec } from './model'
import { battleAnomalyOf, noteFoeShipsSeen, applyFoeOverride, wormholeDerivedAnomaly } from './cards'
import { wormholeMatterBattleModsOf, applyFleetDamageAura, fleetDamageAuraOf, applyFleetLockAura, applyMatterPlayerBuffs } from './fleetSpecs'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { wormholeAmmoIdsForSpec, loadWormholeBattleAmmo, ammoLoadTotals, ammoKeyOf, loadAmmoTier, ammoTierFallbackLog } from './combatAmmo'
import { ceilFinalQuantity } from '../quantity'
import { wormholeMatterBuffs } from '../wormholeMatter'
import { matterTechWhBuffs } from '../matterTech'
import { createFoeSpecs } from './foes/catalog'
import { battleOpenM, desiredRangeFor, rFamilyDesireOf, foeDesiredRange, battleMaxDistanceM } from './foes/tactics'
import { createBattleState, announceStealthStart, announceSupportCallStart, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { confirmedBattleDesire, battleCardRangeOf, battleRangeSnapshot } from './battleRangeMemory'
import { applyFoeRangeDebuff, meFoeRangeDebuffOf } from './foeRange'
import { buildDronePoolsFor } from './combatDrones'
import { initDroneLaunch } from './droneLaunch'
import { initDroneReviveStock, initDroneRevive } from '../droneRevive'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { preloadRepairFor, REPAIR_PULSE_MS, preloadShieldChargeFor, preloadShieldFieldFor } from './combatRepair'
import { equipmentCycleMsOf } from '../equipment'

/**
 * **多舰编队开战**（虫洞 D 批 · 船长 2026-09-13：「4 艘同时参战」）——与 `startBattleFor` 并列的
 * 第二条建档入口，**既有单船路径一字不动**。
 *
 * 口径（逐条见设计稿 §二 冲突 1 的 D 批落地表）：
 * - **主控 = `state.shipId`**（若在编队里，否则编队第一艘）；tag 恒为 `'player'`，僚舰 `'ally-1'..`；
 * - **逐船**按自己的装配/技能建三层血，并按自己的**场间残余**（`armorPct`/`durability`）开局；
 * - **弹药整队共用一个池，但池 = 每艘船各自装载量之和**（各船按自己的装配档与货仓装载、
 *   **照付成本**）；⚠ 多船混装**不同弹种档位**时，`battle.ammoIds` 与退还都按**主控优先**
 *   的档口（共用池记不住两套档位——已知简化，F 批可细化）；
 * - **不挂 `hullEscapeFrac`** ⇒ 副本内没有"结构过半自动脱离"保险（冲突 2 · 船长裁定「关闭」）；
 * - 僚舰的**无人机机群 / 近防炮 / 修理包不参战**（D 批边界；机群与点防的多单位化留 F 批）。
 */
export function startFleetBattleFor(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number | null,
  /**
   * **虫洞战斗标记**（F 批 · 2026-09-13）：给了就按层派生敌卡（`wormholeAnomalyOf`），
   * 并把 `{cardId, depth, kind, waves}` 写进 `battle.wormhole` ⇒ 逐拍重建同源。
   * **不给 = 普通多舰战斗**（既有行为）。
   * `strengthMul` = **校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   */
  wormhole?: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    desireRangeMul?: number
    strengthMul?: number
    /**
     * **谜质装置在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：
     * 战斗是"逐拍重建规格"的（`buildMyUnitSpecs` / `createFoeSpecs` 每拍按敌卡重建）
     * ⇒ 把**这一场**吃到的四个值随标记写进 `battle.wormhole`，逐拍重建时**同一份**，不各算各的。
     * - `threatMul`：威胁乘数（压制力场/守卫解析仪/撤离掩护器，**三档各自 −50% 封顶**）；
     * - `foeMainType`：敌队主伤害类型（护盾/装甲/结构三张谐振片**只对它**加抗性）；
     * - `foeHitDown`：敌方命中 −（干扰发射器，**−0.25 封顶**）；
     * - `blindReduce`：敌方近盲带伤害比例 −（盲区压制器，下限 0）。
     */
    threatMul?: number
    foeMainType?: DamageType
    foeHitDown?: number
    blindReduce?: number
  },
  /** **敌群强度覆写**（2026-09-23 入侵旗舰用：120 威胁 · 4 波；缺省 = 原行为） */
  foeOverride?: FoeOverride,
  /** 入侵旗舰沿用核心星系目标，不因首波射程而缩小。 */
  preserveDesire = false,
): import('../state').BattleState | null {
  if (!anomalyId || shipIds.length === 0) return null
  // 虫洞内的敌卡取**原卡**（不套窝点派生/派系活跃——那是悬赏线的口径），再按层派生
  const baseCard = battleAnomalyOf(ctx, anomalyId)
  // **记下这一场的敌方舰级**（用**原卡**，两处派生之前；船长 2026-09-16）
  if (baseCard) noteFoeShipsSeen(state, baseCard)
  if (!baseCard) return null
  /**
   * **谜质在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：威胁乘数（三档各自 −50% 封顶）、
   * 敌队主伤害系（三张谐振片"单层单系"只对它加抗性）、敌方削弱两项。
   * 快照随 `battle.wormhole` 落进战斗 ⇒ 逐拍重建读同一份。
   */
  const matterMods = wormhole ? wormholeMatterBattleModsOf(state, ctx, baseCard, wormhole.kind) : null
  // 洞内敌卡：按层派生（**与逐拍重建同源**，见 `wormholeDerivedAnomaly` 的注释）
  /**
   * **敌群强度覆写**（2026-09-23 入侵）：旗舰要打**120 威胁 · 4 波**（绝对值），而族卡自带自己的强度
   * ⇒ 派生之后套一层覆写。**不传 ⇒ 一字不变**（虫洞与既有调用方都不传）。
   */
  const anomaly = applyFoeOverride(
    wormhole
      ? wormholeDerivedAnomaly(ctx, baseCard, {
        ...wormhole,
        ...(matterMods
          ? {
              ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
              ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
              ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            }
          : {}),
      })
    : baseCard,
    foeOverride,
  )
  const bal = ctx.balance.battle
  // 编队顺序：**主控置首**（`state.shipId` 在编队里就提到第一位），其余保持传入顺序
  const ordered = [...shipIds]
  const leaderIdx = ordered.indexOf(state.shipId)
  if (leaderIdx > 0) {
    ordered.splice(leaderIdx, 1)
    ordered.unshift(state.shipId)
  }
  const specs: UnitSpec[] = []
  const fleet: NonNullable<import('../state').BattleState['myFleet']> = []
  /** 逐船规格（弹药装载要按船各算一次，故留一份） */
  const specOf = new Map<string, UnitSpec>()
  /**
   * **逐船满值三层血**（血条分母）——必须在承伤持久化**之前**留一份。
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：见 `startBattleFor`
   * 里同款注释（洞内多舰路径原先拿"打完折的规格"当初始 `hpMax` ⇒ 上限凭空缩水、与洞外口径不一致）。
   * 语义定案：**上限恒为该舰满值**，承伤持久化只打"当前值"。
   */
  const fullHpOf = new Map<string, { s: number; a: number; h: number }>()
  for (let i = 0; i < ordered.length; i++) {
    const sid = ordered[i]!
    let spec = createPlayerSpec(state, ctx, sid)
    // 主力船记录缺失 = 与单船路径同样的"开不了战"（不让它退化成"打头的变成僚舰"）
    if (!spec) {
      if (i === 0) return null
      continue
    }
    if (wormhole && state.wormhole.run?.supplyVersion === 1) {
      const ids = wormholeAmmoIdsForSpec(state, ctx, sid, spec, state.wormhole.run.supplies?.items ?? {})
      spec = createPlayerSpec(state, ctx, sid, ids)!
    }
    spec.tag = i === 0 ? 'player' : `ally-${i}`
    fullHpOf.set(spec.tag, { ...spec.hp })
    // P0 承伤持久化：装甲/结构（=耐久合并属性）按**各自**场间残余开局；护盾每场满值重建
    const fleetShip = state.fleet[sid]
    if (fleetShip) {
      const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
      const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
      spec.hp.a = Math.max(0, ceilFinalQuantity((spec.hp.a - (spec.shieldArmorHp ?? 0)) * armorMul)) + (spec.shieldArmorHp ?? 0)
      if (spec.shieldArmorHp !== undefined) spec.hp.coating = { armor: spec.hp.a - spec.shieldArmorHp, maxArmor: fullHpOf.get(spec.tag)!.a - spec.shieldArmorHp }
      spec.hp.h = Math.max(0, ceilFinalQuantity(spec.hp.h * hullMul))
    }
    specs.push(spec)
    specOf.set(sid, spec)
    fleet.push({ tag: spec.tag, shipId: sid })
  }
  if (specs.length === 0) return null
  // **全舰单发伤害光环**（2026-09-13 船长：指挥舰「提高全舰的单发伤害 15%」）——
  // 建完各舰规格后统一乘；**多艘同类只取最高、不叠加**（与"同项取优"惯例一致）。
  // ⚠ **2026-09-17**：乘算抽成 `applyFleetDamageAura` 单点，**每拍重建处（`buildMyUnitSpecs`）也要调**
  // ——原先只在这里乘一次，而开火读的是每拍重建后的规格 ⇒ 光环从未生效（真 BUG，同批已修）。
  applyFleetDamageAura(specs, 1 + fleetDamageAuraOf(state, ctx, ordered))
  // **目标锁定阵列：全队生效**（船长 2026-09-17）——见 `applyFleetLockAura` 的注释：
  // 开战这一刻的规格也要置上（首拍用）；**真正的每拍生效靠 `buildMyUnitSpecs` 里同一次调用**。
  applyFleetLockAura(specs)
  // **谜质 B1：我方静态增益**（抗性 / 命中 / 回避 / 射程 / 单发 / 装填）——只在洞内战斗里生效
  if (matterMods) {
    const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
    for (const spec of specs) applyMatterPlayerBuffs(spec, buffs, matterMods.foeMainType)
  }
  const me = specs[0]!
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 船长2026-10-21：编队手动战同样按卡读取，自动探索传null不采用玩家记录。
  // ⚠ **2026-09-15 船长裁定：星图与洞内同一个默认档**（`desireBandMid` = 射程带 0.8 高位；
  // 当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (confirmedBattleDesire(state, anomalyId) ?? battleCardRangeOf(state, anomalyId)?.desireM ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.max(bal.minDistanceM, preserveDesire ? rawDesire : Math.min(openM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire, specs.slice(1))
  // **敌群覆写照原样存下**（2026-09-25 修）：后续波由 `advanceBattleFor` 从 `ctx` 重建敌卡，不存就只有第 0 波吃到覆写
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  /**
   * **逐船把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 按"传入规格"写 `hp`/`hpMax`，而上面已按各舰的场间残余打过折 ⇒ 分母跟着缩水
   * （洞内 4 条舰的血条开局全是满格、上限比洞外小）。这里显式改回**各自满值**。
   */
  for (const [tag, full] of fullHpOf) {
    const rt = battle.units[tag]
    if (rt) rt.hpMax = full
  }
  // **电子舰 · 压制敌舰射程**（2026-09-18）：按本场编队算一次（每拍还会在 `advanceBattleFor` 里重算）
  applyFoeRangeDebuff(state, ctx, battle, ordered)
  announceStealthStart(battle) // 隐秘行动装置：开战那一刻的提示条（逐舰各一条，没装的船不推）
  announceSupportCallStart(battle, foes) // 支援呼叫装置：开战即告诉玩家"有一支援军在路上"（没挂的不推）
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  //
  // ⚠ **虫洞内战斗的特殊规则（船长 2026-09-13）**：洞内**不吃**上面那条常规开战距离 ——
  //   ① **非近战敌人**：初始距离 = **其目标距离**（敌人一开场就站在自己想打的位置）；
  //   ② **近战敌人**：初始距离 = **玩家的中距离位置**（贴脸怪一开场就在你脸上）。
  //   动机：常规口径下长射程编队能把近程敌人**永远钉在射程外**（F1 校准实测「敌开火 0」），
  //   洞内要的是"进去就得挨打"的搜打撤张力。混合编成按"**卡内任一近战单位 ⇒ 走近战口径**"。
  /**
   * **R 族想站的期望距离**（以"玩家的射程盲区"为目标）——在开战距离的 if/else **之前**先算出来，
   * 因为两条路径都要用它。非 R 族 ⇒ `null`。
   */
  const rDesire = rFamilyDesireOf(me, foes, bal)
  if (wormhole) {
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    // ⚠ 近战怪的开局距离走**独立的洞内档** `wormholeBrawlOpenBand`（0.5 = 中段）——船长选定「乙」：
    // 默认期望抬到 0.8 时**不把它一起带走**（2026-09-13「贴脸怪一开场就在你脸上」的张力保住）。
    const want = anyBrawl
      ? desiredRangeFor(me, 'mid', bal, bal.wormholeBrawlOpenBand)
      : // 电子舰削减之后，敌人也**在洞里**主动压近（船长 2026-09-18：「削减射程后，敌人的期望距离也要随之改变」）
        foeDesiredRange(me, foes, bal, meFoeRangeDebuffOf(state, ctx, ordered))
    battle.distanceM = Math.max(bal.minDistanceM, Math.min(openM, Math.round(want)))
  } else {
    /**
     * **开战距离（非洞内）= `openM`，与族格无关**（**船长 2026-10-03 报障修**：「**开场双方距离的规则
     * 已经很明确了，现在的情况是BUG**」）——规则出处 `docs/design/desire-band-20260915.md`：
     * 开场距离 = `battleOpenM`（双方最远射程 ×1.0 ＋ 缓冲 10%），且该文档 §二 的「**明确不动的**」
     * 清单第一条就是**开战距离公式**。⚠ 旧写法 `rDesire ?? openM` 让 R 族场次**用族格值当开场距离**
     * ⇒ **一开场就贴脸**（船长实测：回音荒区 512 m）。R 族"主动贴身"由它**自己走过来**
     * （`foeDesireRangeM` 那一支照旧钉着），不是"开局就站在脸上"。
     */
    battle.distanceM = openM
  }
  /**
   * 🔴 **R 族族格：只钉"敌人自己"的期望距离**（**船长 2026-10-01 正解原话**：
   * 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。**」）——
   * **放在 `if (wormhole) / else` 之外**：洞内洞外都要生效（洞内的开场距离有自己的口径，
   * 但"R 族想站哪"这件事与洞口径无关）。
   * ⚠ **旧写法还多改了一行 `battle.myDesireM = rDesire`**（用**敌人**的偏好改**我方**的期望距离）
   * ——与船长的澄清**直接冲突** ⇒ **2026-10-03 删掉**；我方期望距离走既有三级链。
   * ⚠ 非 R 族 `rDesire === null` ⇒ 这一段整体不执行，**既有各族零行为变化**。
   */
  if (rDesire !== null) {
    // 把 R 族自己那几艘的期望距离钉到"我方射程盲区"位置（`foeDesiredRange` 读 `foeDesireRangeM`）
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  battle.myFleet = fleet
  if (wormhole) battle.wormhole = { cardId: anomalyId, ...wormhole }
  if (wormhole?.desireRangeMul) battle.myDesireM = Math.min(battle.myDesireM, openM * wormhole.desireRangeMul)
  // 弹药：**逐船装载、汇入同一个池**（成本按各船各付；档口按主控优先）
  // **取档口径 2026-09-16 船长改判**：同族取"能装得最多"的那一档、允许装不满（细则见 `loadAmmoTier`）
  const ammoIds: Partial<Record<DamageType, string>> = {}
  if (!loadWormholeBattleAmmo(state, ctx, battle, specOf)) for (const entry of fleet) {
    const spec = specOf.get(entry.shipId)!
    const totals = ammoLoadTotals(spec, bal, state)
    for (const [t, n] of Object.entries(totals)) {
      const type = t as DamageType
      const key = ammoKeyOf(type)
      // 同上（批次 4i 类型微调）：n 运行期恒为数字键的值
      const res = loadAmmoTier(state, ctx, entry.shipId, type, n ?? 0)
      battle.ammo[key] += res.loaded
      // ⚠ 只要有实装就记实际档（含"实际 = 基础弹"）：推进重建与退还都按它走，漏记会串档
      if (res.loaded > 0 && ammoIds[type] === undefined) ammoIds[type] = res.id
      if (res.fellBack && res.loaded > 0) {
        addLog(state, 'warn', ammoTierFallbackLog(state, ctx, entry.shipId, type, res.id, res.loaded))
      }
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池：**逐舰建池**（2026-09-14 船长「逐舰机群」——此前只有主控的机群参战，僚舰的
  // 无人机条目被 `stepBattle` 跳过；键 = `舰tag:武器下标`，逐舰各自的机型/技能/舱位口径）
  const pools: Record<string, import('../state').DronePoolEntry> = {}
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  for (const spec of specs) buildDronePoolsFor(ctx, spec, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    initDroneLaunch(battle, specs)
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照：**逐舰**一份（战后按舰扣各自的机舱清单）；老字段 `droneLoadAtStart` 仍是主控那份
    const by: Record<string, Record<string, number>> = {}
    for (const e of fleet) by[e.tag] = { ...(state.fleet[e.shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStartBy = by
    battle.droneLoadAtStart = { ...(state.fleet[fleet[0]!.shipId]?.droneLoad ?? {}) }
    // **无人机储备甲板建档**（2026-09-27 船长令）：**逐舰**一份（每舰各自的复位周期与队列）
    // ⚠ 预算快照**全队只拍一本**（`initDroneReviveStock`）——按舰各拍一份会从同一只仓库里超补
    initDroneReviveStock(state, ctx, battle, fleet.map((e) => e.shipId))
    for (const e of fleet) initDroneRevive(state, ctx, battle, e.shipId, e.tag)
  }
  initFoeDronePools(battle, foes);
  // 挂载件「船体修理装置」账本（2026-09-24 船长）：与多舰编队路径同一处（幂等，缺省不建）
  initFoeRepairPulses(battle, foes);
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  /**
   * **维修装置 / 护盾充能装置：逐舰预载**（2026-09-16 船长裁定「甲：逐舰维修」——
   * 起因是玩家报障「船体维修装置在虫洞里无效」：旧口径只预载主控，装置装在僚舰上就完全不工作）。
   *
   * - 每艘参战船**各自的装置、各自的组件**（**本舰货舱**优先、仓库兜底）、各自被修；
   * - `battle.repair` / `battle.shieldCharge` 仍是**主控那一份**（老读法零迁移；主控没装而僚舰装了
   *   ⇒ 指向第一份有的，界面状态灯据此仍能显示"运转中"，逐舰明细走 `*By`）；
   * - 逐舰账本在 `repairBy` / `shieldChargeBy`（键 = tag）；退款与战报**只认逐舰入口**
   *   （`refundRepairKitsAll` / `repairUsageText`）⇒ 不会与别名重复结算。
   */
  const repairBy: Record<string, import('../state').BattleRepairLedger> = {}
  const shieldChargeBy: Record<string, import('../state').BattleShieldChargeLedger> = {}
  /** 力场账本（2026-09-20 新增；与上面两套**各自计时**） */
  const shieldFieldBy: Record<string, import('../state').BattleShieldFieldLedger> = {}
  for (const e of fleet) {
    const r = preloadRepairFor(state, ctx, e.shipId, bal.maxBattleMs)
    if (r) {
      const ready = r.units.filter((u) => !u.stopped)
      /**
       * **逐台排首跳**（**2026-09-21 船长令：逐型号独立回转**）：每台装置各带自己的
       * `nextPulseAtMs`，首跳 = 开战 + 该型号自己的间隔（本族现为常量 `REPAIR_PULSE_MS`）。
       * ⚠ 旧档在途战斗没有逐台字段 ⇒ `advanceBattleFor` 里走迁移分支（借账本那一个值）。
       * 账本上的 `nextPulseAtMs` **仍然保留**：它现在是"最近一台的首跳"（旧档/外部读法的兼容读数）。
       */
      for (const u of r.units) {
        if (u.stopped) continue
        u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      }
      if (ready.length > 0) r.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      repairBy[e.tag] = r
    }
    const sc = preloadShieldChargeFor(state, ctx, e.shipId)
    if (sc) {
      for (const s of sc.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldChargeBy[e.tag] = sc
    }
    const sf = preloadShieldFieldFor(state, ctx, e.shipId)
    if (sf) {
      // **逐路排首跳** = 开战 + 该型号自带冷却（与另两套装置同款：开场即排第一跳）
      for (const s of sf.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldFieldBy[e.tag] = sf
    }
  }
  if (Object.keys(repairBy).length > 0) {
    battle.repairBy = repairBy
    battle.repair = repairBy['player'] ?? Object.values(repairBy)[0]!
  }
  if (Object.keys(shieldChargeBy).length > 0) {
    battle.shieldChargeBy = shieldChargeBy
    battle.shieldCharge = shieldChargeBy['player'] ?? Object.values(shieldChargeBy)[0]!
  }
  if (Object.keys(shieldFieldBy).length > 0) battle.shieldFieldBy = shieldFieldBy
  /**
   * **敌方后勤账本**（船长 2026-09-16）：**只在敌阵里真有 `repairPct > 0` 的舰时才建**
   * （缺省 ⇒ `battle.foeRepair` 不写、tick 里那一块直接跳过 ⇒ 零开销、零行为变化）。
   * 首跳 = 开战 + `REPAIR_PULSE_MS`（与维修装置同节拍）。
   */
  if (foes.some((f) => (f.repairPct ?? 0) > 0)) {
    battle.foeRepair = { nextPulseAtMs: battle.startedAtGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
  }
  // **虫洞战斗标记**（F 批）：写进 battle ⇒ 每拍按同一份派生重建敌卡（`advanceBattleFor` 读它）；
  // F3c B1 起，谜质在开战那一刻的快照（威胁乘数 / 敌主伤害系 / 敌方削弱）**一并写进去**，
  // 逐拍重建与下一波补刷都读这一份（不各算各的）。
  if (wormhole) {
    battle.wormhole = {
      cardId: anomalyId,
      ...wormhole,
      /**
       * 谜质快照**只写真正生效的项**（没带战斗类装置时 `matterMods` = null ⇒ 一个字段都不写）：
       * 于是"没带装置"的洞内战斗与改动前**逐字一致**（存档形状、既有用例、战报都不受影响）。
       */
      ...(matterMods
        ? {
            ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
            ...(matterMods.foeMainType ? { foeMainType: matterMods.foeMainType } : {}),
            ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
            ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            ...(matterMods.volleyOverflow ? { volleyOverflow: true } : {}),
          }
        : {}),
    }
  }
  // ⚠ **刻意不写 `battle.hullEscapeFrac`**：副本内无"结构过半自动脱离"保险（冲突 2 · 船长裁定）。
  if (desireM !== null) battle.rangeMemory = battleRangeSnapshot(anomalyId, specs, Math.max(bal.minDistanceM, rawDesire), battleMaxDistanceM(battle, me, foes, bal, specs) * (wormhole?.desireRangeMul ?? 1), bal.minDistanceM)
  return battle
}
