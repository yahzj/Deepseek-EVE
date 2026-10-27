/** 战斗域：startSingle，从原引擎按职责迁移，保持结算顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext, DamageType } from '../types'
import type { FoeOverride } from './model'
import { applyFoeOverride, battleAnomalyOf, noteFoeShipsSeen } from './cards'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { ceilFinalQuantity } from '../quantity'
import { isFirstBountyBattle, applyFirstBountyBuff } from '../firstTasks'
import { createFoeSpecs } from './foes/catalog'
import { battleOpenM, desiredRangeFor, rFamilyDesireOf, battleMaxDistanceM } from './foes/tactics'
import { createBattleState, announceStealthStart, announceSupportCallStart, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { confirmedBattleDesire, battleCardRangeOf, battleRangeSnapshot } from './battleRangeMemory'
import { applyFoeRangeDebuff } from './foeRange'
import { ammoLoadTotals, ammoKeyOf, loadAmmoTier, ammoTierFallbackLog } from './combatAmmo'
import { buildDronePoolsFor } from './combatDrones'
import { initDroneLaunch } from './droneLaunch'
import { initDroneReviveStock, initDroneRevive } from '../droneRevive'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { preloadRepairFor, REPAIR_PULSE_MS, preloadShieldChargeFor, preloadShieldFieldFor } from './combatRepair'
import { equipmentCycleMsOf } from '../equipment'

export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  /**
   * 目标距离：`number > 0` = 显式指定；**`null` = 强制"射程中段"、不吃该星系的玩家设定**
   * （2026-09-11 船长「只有主控吃」⇒ AI 副船走这一档）；`undefined` = 用该星系设定、没设过则射程中段。
   */
  desireM?: number | null,
  /** **敌群强度覆写**（2026-09-23 入侵用：伏击 39/60；缺省 = 原行为，一字不变） */
  foeOverride?: FoeOverride,
  /** 入侵保留跨场目标；实际距离仍由当前波战场上限约束。 */
  preserveDesire = false,
): import('../state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = applyFoeOverride(battleAnomalyOf(ctx, anomalyId, state.expedition.lairTier, state.expedition.factionActive), foeOverride)
  // **记下这一场的敌方舰级**（船长 2026-09-16：首次遭遇劫掠电子舰后发通讯）
  if (anomaly) noteFoeShipsSeen(state, anomaly)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  /**
   * **满值上限**（血条分母）——必须在**承伤持久化之前**留一份。
   *
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：洞内多舰路径把
   * `hpMax` 取自**打完折之后**的规格（下面那两行 `me.hp.a *= armorMul`），于是"上限"跟着场间残余
   * 一起缩水（装甲剩 60% ⇒ 血条分母只有满值的 60%、开局读作满格）；而**单船路径的视图上限**
   * （`battleArcsFor` 的 `maxHp.me`）用的是**现建的满值规格** ⇒ 洞外 60%、洞内 100%，两条路不一致。
   * 语义定案：**上限恒为该舰的满值**，承伤持久化只打"当前值"（与护盾每场满值重建同一条口径）。
   */
  const meFullHp = { ...me.hp }
  // P0 承伤持久化：装甲/结构（=耐久合并属性）按场间残余开局；护盾每场满值重建
  const fleetShip = state.fleet[shipId]
  if (fleetShip) {
    const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
    const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
    me.hp.a = Math.max(0, ceilFinalQuantity((me.hp.a - (me.shieldArmorHp ?? 0)) * armorMul)) + (me.shieldArmorHp ?? 0)
    if (me.shieldArmorHp !== undefined) me.hp.coating = { armor: me.hp.a - me.shieldArmorHp, maxArmor: meFullHp.a - me.shieldArmorHp }
    me.hp.h = Math.max(0, ceilFinalQuantity(me.hp.h * hullMul))
  }
  // 照会战加成（开战规格重建处也注入，命中/回避影响后续弹道与 UI 读到的克制无涉）
  if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 船长2026-10-21：显式距离/战前确认 → 实际卡记忆 → 主武器默认档；null为自动距离。
  // 普通战斗将记忆钳到本次开战距离；入侵保留跨波目标，实际距离仍受逐拍上限约束。
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (confirmedBattleDesire(state, anomalyId) ?? battleCardRangeOf(state, anomalyId)?.desireM ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.max(bal.minDistanceM, preserveDesire ? rawDesire : Math.min(openM, rawDesire))
  /**
   * 🔴 **R 族族格：以"玩家的射程盲区"为期望距离**（**船长 2026-10-01 三次澄清 · 正解**，原话照抄）：
   *
   * > 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。等于R族敌人会寻找
   * > 玩家的射程漏洞，玩家如果射程短，则R族采取风筝玩家，如果玩家射程长，有近盲区，则R族会主动贴身。**」
   *
   * 口径与落点见 `rFamilyDesireOf` 的头注；**非 R 族一律不动**（返回 `null`）。返回 `null` ⇒
   * 期望距离与开战距离都逐字走原口径。
   */
  const rDesire = rFamilyDesireOf(me, foes, bal)
  const battle = createBattleState(me, foes, atGameMs, desire)
  /**
   * **把本场的敌群覆写照原样存下**（2026-09-25 修）：`advanceBattleFor` 每拍从 `ctx` 重建敌卡，
   * 不存就会**只有第 0 波吃到覆写**——多波卡的后续波会回到满强度（H 族遇袭 ×0.75 的 2 波卡首当其冲）。
   */
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  /**
   * **把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 是按"传入规格"写 `hp`/`hpMax` 的，而上面已经把规格的装甲/结构按场间残余打过折
   * ⇒ 分母跟着缩水。这里显式改回**满值**，只让 `hp`（当前值）吃那份折扣。
   */
  const meRt0 = battle.units['player']
  if (meRt0) meRt0.hpMax = meFullHp
  // **电子舰 · 压制敌舰射程**（2026-09-18）：单船路径同样按编队（= 它自己）算一次
  applyFoeRangeDebuff(state, ctx, battle, [shipId])
  announceStealthStart(battle) // 隐秘行动装置：开战那一刻的提示条（没装装置的场次不推）
  announceSupportCallStart(battle, foes) // 支援呼叫装置：开战即告诉玩家"有一支援军在路上"（没挂的不推）
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  /**
   * 🔴 **开场距离 = `openM`，与族格/期望距离/按星系记忆一律无关**（**船长 2026-10-03 报障修**：
   * 「**开场双方距离的规则已经很明确了，现在的情况是BUG**」）。
   *
   * 规则出处 = `docs/design/desire-band-20260915.md`（船长 2026-09-15 裁定）：
   * ① 开场距离 = `battleOpenM` = 双方所有武器最远射程 ×1.0 ＋ 缓冲 `max(100m, 10%)`；
   * ② 期望距离只决定**稳态**（"t=30s 起停在期望位"）；
   * ③ 该文档 §二 的「**明确不动的**」清单第一条就是**开战距离公式**。
   *
   * ⚠ **旧写法**（2026-10-02 及以前）：`battle.distanceM = rDesire ?? openM` —— R 族场次**用族格值
   * 当开场距离** ⇒ **一开场就贴脸**（船长实测：回音荒区 512 m），把上面规则 ① 顶掉了。
   * R 族"主动贴身"应当是**它自己走过来**（`foeDesireRangeM` 那一支照旧钉着），不是"开局就站在脸上"。
   */
  battle.distanceM = openM
  /**
   * 🔴 **R 族族格：只钉"敌人自己"的期望距离**（**船长 2026-10-01 正解原话**：
   * 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。**」）。
   *
   * ⚠ **旧写法还多改了一行 `battle.myDesireM = rDesire`**（用**敌人**的偏好去改**我方**的期望距离）
   * ——与船长的澄清**直接冲突**（等于 R 族场次里玩家拖距离条/按星系记忆全都不算数）⇒ **2026-10-03 删掉**。
   * 我方期望距离照旧走既有的三级链：显式传入 → 按星系记忆 → 默认档 `desireBandMid`。
   */
  if (rDesire !== null) {
    // 把 R 族自己那几艘的期望距离钉到"我方射程盲区"位置（`foeDesiredRange` 读 `foeDesireRangeM`）
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  // V18B-2：per-gun 多键预载——动能/爆破导弹/能量弹药各按自身装填估量装载
  // （纯激光船也能带上能量弹药；混装各型互不挤占）
  // 2026-09-09 弹药 MK2：按船装配档位（ammoPref）装载；**取档口径 2026-09-16 船长改判**——
  // 同族取"能装得最多"的那一档、允许装不满（细则见 `loadAmmoTier`）。
  // ⚠ `battle.ammoIds` **只要有实装就记实际档**（哪怕实际档 = 基础弹）：推进重建（`ammoIdFor`）
  //   与退还都按它走 —— 若这里漏记，重建会回落到 `ammoPref`（= MK2 口径伤害）而实际烧的是基础弹。
  const totals = ammoLoadTotals(me, bal, state)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const [t, n] of Object.entries(totals)) {
    const type = t as DamageType
    const key = ammoKeyOf(type)
    // 2026-10-02 批次 4i：ammoLoadTotals 迁出后其 Partial 返回的 entries 值类型在模块边界解析为
    // `number | undefined`；运行期 out 只写数字键 ⇒ `n ?? 0` 为纯类型微调、零行为变化
    const res = loadAmmoTier(state, ctx, shipId, type, n ?? 0)
    battle.ammo[key] += res.loaded
    if (res.loaded > 0) ammoIds[type] = res.id
    if (res.fellBack && res.loaded > 0) {
      addLog(state, 'warn', ammoTierFallbackLog(state, ctx, shipId, type, res.id, res.loaded))
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池（2026-09-10 船长「无人机可被击落」）：**逐舰**建池（2026-09-14 船长「逐舰机群」），
  // 键 = `舰tag:武器下标`；只有 src='drone' 的条目参战。
  const pools: Record<string, import('../state').DronePoolEntry> = {}
  // 无人机线技能（2026-09-10 船长）：耐久学（基础档）与强化学（进阶档）**乘算**放大三层血
  // （"全血条"）、规避学提闪避（封顶 0.9）
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  buildDronePoolsFor(ctx, me, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    initDroneLaunch(battle, [me])
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照（战后判定"机群战损过半"→ 停重复清剿用）：单船路径只有主控一份
    const load = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStart = load
    battle.droneLoadAtStartBy = { [me.tag ?? 'player']: load }
    // **无人机储备甲板建档**（2026-09-27 船长令）：装了这件才开账（没装 ⇒ 一个字段都不写）
    // ⚠ **先拍库存快照**（复活预算，全队一本），再建逐舰的队列/周期账 —— 快照要读 `battle.dronePools`
    initDroneReviveStock(state, ctx, battle, [shipId])
    initDroneRevive(state, ctx, battle, shipId, me.tag ?? 'player')
  }
  // 敌机机群生存池（2026-09-11 机群批）：与敌方编队同建；无 `foeDrones` 的敌舰不建池 ⇒ 零行为变化
  initFoeDronePools(battle, foes);
  // **挂载件「船体修理装置」账本**（2026-09-24 船长）：只为挂了这件、且账本里还没有的单位建一条
  initFoeRepairPulses(battle, foes);
  // 近防炮调度（威胁 ≥ pdThreatFloor 的敌舰各装一台；与敌编队同序、独立冷却）
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  // 船体维修装置（2026-09-09 船长定）：装配快照 + 修理组件预载（货舱优先、仓库兜底）；
  // 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1，战斗结束退还未用（与弹药同哲学）。
  // 2026-09-11 船长：「船体修理装置不单独显示日志。只将消耗组件数量显示到战后总结」
  // ⇒ 开战的「待命 / 缺组件」两条日志**取消**（装备效果与"是否吃组件"在装配页与手册里已写明，
  //   战斗中是否运转由战斗界面底部状态灯表达），消耗数只在战报里以「消耗 …×N」出现。
  const repair = preloadRepairFor(state, ctx, shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    // **逐台排首跳**（2026-09-21 逐型号独立回转）：每台各带自己的计时器，开战 5 秒后第一跳
    for (const u of repair.units) {
      if (u.stopped) continue
      u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    }
    if (ready.length > 0) repair.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    battle.repair = repair
  }
  // 护盾充能装置（2026-09-14）：**独立 15 秒计时**（与维修装置的 5 秒互不干扰），开战 15 秒后第一跳；
  // **逐型号一路**（2026-09-21）：每路各排各的首跳
  const shieldCharge = preloadShieldChargeFor(state, ctx, shipId)
  if (shieldCharge) {
    for (const s of shieldCharge.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldCharge = shieldCharge
  }
  /**
   * **力场（高槽）也要在单船路径建账本**（**2026-09-21 修**）：此前只有多舰路径（`startFleetBattleFor`）
   * 建 `shieldFieldBy`，单船路径**根本没有这一块** ⇒ 悬赏卡 / 低安遭遇 / AI 副船这些单船场次里，
   * 装了力场也**一跳都不跳**（我写本条用例时探针实测：`battle.shieldFieldBy` 为 `undefined`）。
   * 属"装置静默失效"，与 2026-09-16「僚舰装了也白装」同一类缺陷。
   */
  const shieldField = preloadShieldFieldFor(state, ctx, shipId)
  if (shieldField) {
    for (const s of shieldField.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldFieldBy = { [me.tag ?? 'player']: shieldField }
  }
  if (desireM !== null) battle.rangeMemory = battleRangeSnapshot(anomalyId, [me], Math.max(bal.minDistanceM, rawDesire), battleMaxDistanceM(battle, me, foes, bal), bal.minDistanceM)
  return battle
}
