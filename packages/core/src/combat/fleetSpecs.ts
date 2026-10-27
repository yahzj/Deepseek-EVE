/** 战斗域：fleetSpecs，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec } from './model'
import { type WormholeMatterBuffs, wormholeMatterBuffs, wormholeMatterThreatMul } from '../wormholeMatter'
import type { DamageType, SimContext, AnomalyDef } from '../types'
import type { GameState } from '../state'
import { matterTechWhBuffs } from '../matterTech'
import { foeMainDamageType } from '../wormholeFoes'
import { createPlayerSpec } from './player/create'
import { battleAmmoIdsFor } from './combatAmmo'
import { applyMeWebDebuff } from './captureWebs'
import { applyMeJammerDebuff, meJammerNetOf } from './foeRange'
import { isFirstBountyBattle, applyFirstBountyBuff } from '../firstTasks'
import { applyAlienCorrosion } from './alienCombat'

/**
 * 把一次开火的总伤害按火力构成**拆成逐系单发**（2026-09-10：窝点混伤）。
 * 取整口径：先按份额分配、**最后一条吃余数**，保证 Σ = 总单发（敌总伤不变，只改构成）。
 * 返回空数组 = 总伤为 0（调用方跳过）。
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts，本文件再导出） */

/** 敌方血型层占比（V17.2 导出；悬赏卡"敌型"展示——与 createFoeSpecs 同源）：
 * 盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33（盾/甲/结构）
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts，本文件再导出） */

/** 构建我方单位静态卡（V18 多件语义：全位装配生效——多炮/多矿枪/盾甲多件/无人机装置；null = 船记录缺失） */
/** 我方规格快照（手动/AI/MC/预估同源）。
 * ammoIds（弹药 MK2，2026-09-09）：战斗内实装弹 id 覆盖（缺货回退等）——
 * 推进/视图重建传 battle.ammoIds 使伤害与实装弹种一致；缺省 = 船装配 ammoPref，再缺省 = 基础弹。 */
/* ══════════ 2026-09-27 船长令：R4/R5 上位技能批 · 战斗侧乘数单点 ══════════
 * 每级值 = 父技能每级 ÷ 3；全部与父技能**同乘区乘算**。数值与技能 id 写在同一句里，
 * 既是唯一真相源，也让「技能说明契约」的现场复核（±400 字内找每级值）稳定命中。
 * （2026-10-02 批次 4g-1 迁到 playerSpec.ts，本文件借回 + 再导出） */


/** 我方主武器固定弹种（V18 多炮：取高槽第一门武器（炮台/导弹架）的 damageType；无武器
 * 也返回 kinetic——基础舰炮实际不消耗弹药）。多门异弹型武器的装载/消耗在出发预载时按
 * 主武器型装载（battle.ammo 单型；异型武器在主弹种耗尽后停火，见 E 台阶 per-gun 完整化）。
 * （2026-10-02 批次 4g-1 迁到 playerSpec.ts，本文件再导出） */


/**
 * **谜质 B1：我方静态增益**（F3c · 船长 2026-09-13）——**只在洞内战斗**里调用。
 *
 * 六类，全部按"从货仓现算"的派生值施加：
 * - **抗性**：对**敌队主伤害系**（单层单系）走既有"缺口削减"合成 `1 − (1−基础)×(1−值)`，
 *   三层各自上限 **0.9 不变**（不新增旋钮）；
 * - **命中 / 回避**：直接加（回避的**加成**在派生端已 +0.25 封顶）；
 * - **射程**：只放大 `maxRangeM`（放大 `minRangeM` 等于把近盲带往前推，反而吃亏 ⇒ 不放大）；
 * - **单发伤害**：与"全舰单发伤害光环"同款改法（`shotDmg` / `shotsByType` 同乘）；
 * - **装填周期**：周期 ×(1 − 削减)，物理下限 50ms（不封顶，但周期不能到 0）。
 */
export function applyMatterPlayerBuffs(spec: UnitSpec, b: WormholeMatterBuffs, foeMain: DamageType): void {
  /**
   * ⚠ **不要在这里按"装置台数"提前返回**（2026-09-19 修 · 船长实测会让"只点科技"完全无效）：
   * 原实现是 `if (b.devices === 0) return`，而 `devices` **只数货仓里的谜质装置台数**——
   * 谜质科技贡献（同一只袋子，字段由 `wormholeMatterBuffs` 合并进来）**不带装置也应当生效**。
   * 实测：3 级测距延展（+12%）在"0 台装置"时最长射程 7,350m **一动不动**，带 1 台装置才 8,232m。
   *
   * 现在**不设提前返回**：下面逐项都自带"零值即跳过"的判断（`add <= 0` / `!== 1` 等），
   * 空袋子（`WORMHOLE_MATTER_BUFFS_NONE`）走一遍等于没走 ⇒ 行为与"提前返回"逐字一致。
   * 同类事故第二次：第一次在 `wormholeMatterBattleModsOf`（同日已修），教训 = **袋子是"装置 + 科技"两只
   * 来源合并的，任何按单只来源判空的早退都会把另一只来源一起吞掉**。
   */
  spec.hitBonus += b.hitBonus
  if (b.evasion > 0) spec.evasion = spec.evasion + b.evasion
  const applyResist = (layer: 'shield' | 'armor' | 'hull', add: number): void => {
    if (add <= 0) return
    const cur = spec.resists[layer]
    const base = cur?.[foeMain] ?? 0
    const v = Math.min(0.9, 1 - (1 - base) * (1 - add))
    spec.resists[layer] = { ...(cur ?? {}), [foeMain]: v }
  }
  applyResist('shield', b.resistShield)
  applyResist('armor', b.resistArmor)
  applyResist('hull', b.resistHull)
  const rangeMul = 1 + b.weaponRangePct
  const dmgMul = 1 + b.damagePct
  const reloadMul = Math.max(0.1, 1 - b.reloadPct)
  for (const w of spec.weapons) {
    if (rangeMul !== 1) w.maxRangeM = Math.round(w.maxRangeM * rangeMul)
    if (dmgMul !== 1) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * dmgMul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * dmgMul
        }
      }
    }
    if (reloadMul !== 1) w.reloadMs = Math.max(50, Math.round(w.reloadMs * reloadMul))
  }
}

/**
 * **谜质在开战那一刻的快照**（F3c B1）：威胁乘数（按用途三档、各自 −50% 封顶）/ 敌队主伤害系 /
 * 敌方削弱两项。**只在洞内战斗里调用**（`state.wormhole.run?.hold` 就是本趟的装置）。
 *
 * ⚠ **2026-09-19 修**：科技树与装置是**同一个增益袋**，本快照必须**一并吃科技**
 * （原实现只传装置、且开头 `devices === 0` 直接返回 `null` ⇒ 「压制力场增幅 / 守卫解析 /
 * 信号噪化 / 近盲抑制」四个节点**只点科技、不带装置时完全无效**：真死线，本批修）。
 * 是否返回快照一律由下方 `any` 判据说话——它已逐项覆盖科技与装置的全部战斗字段。
 */
export function wormholeMatterBattleModsOf(
  state: GameState,
  ctx: SimContext,
  baseCard: AnomalyDef,
  kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn',
): { threatMul: number; foeMainType: DamageType; foeHitDown: number; blindReduce: number; volleyOverflow: boolean } | null {
  const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
  const bucket: 'node' | 'boss' | 'extract' = kind === 'boss' ? 'boss' : kind === 'extract' ? 'extract' : 'node'
  const threatMul = wormholeMatterThreatMul(buffs, bucket)
  /**
   * **只有真会改变战斗结果的装置才返回快照**（否则返回 `null` ⇒ 走改动前的老路径、存档形状也不变）：
   * 探索与作业类装置（测绘仪 / 时序核心 / 起重机 / 钻机 / 星云 / 富集器 / 扩展器）不影响战斗。
   */
  const any =
    threatMul < 1 ||
    buffs.enemyHitDown > 0 ||
    buffs.blindReduce > 0 ||
    buffs.resistShield > 0 ||
    buffs.resistArmor > 0 ||
    buffs.resistHull > 0 ||
    buffs.hitBonus > 0 ||
    buffs.evasion > 0 ||
    buffs.weaponRangePct > 0 ||
    buffs.damagePct > 0 ||
    buffs.reloadPct > 0 ||
    buffs.volleyOverflow
  if (!any) return null
  return {
    threatMul,
    foeMainType: foeMainDamageType(baseCard),
    foeHitDown: buffs.enemyHitDown,
    blindReduce: buffs.blindReduce,
    volleyOverflow: buffs.volleyOverflow,
  }
}

/**
 * **本场我方的单位规格**（虫洞 D 批 · 每拍重建）：
 * - **单船路径**（`battle.myFleet` 未写）：等价于改动前的单点 `createPlayerSpec(shipId)` + 教学战加成；
 * - **多单位路径**（写了）：按 `myFleet` 逐条重建（各自装配/技能/血条/装填），并把 `tag` 覆盖成
 *   编队标识（`player` / `ally-N`）。**弹药按同一份 `battle.ammoIds` 口径**（共用池的"主控优先档口"，
 *   见 `startFleetBattleFor` 注释）。
 * 返回**空数组** = 主力船记录缺失（调用方按判负收场，与改动前 `!me` 同路径）。
 */
export function buildMyUnitSpecs(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  shipId: string,
  anomalyId: string | null,
  /**
   * **本场敌阵的单位规格**（2026-09-24 加；缺省不传）——只用于算**敌方干扰舰的射程压制率**
   * （`meRangeMulOf`：净削减率 = 我方电子舰 + 敌方干扰舰，相加抵消）。不传 = 无压制（老行为）。
   */
  foes?: readonly UnitSpec[],
): UnitSpec[] {
  const fleet = battle.myFleet
  /**
   * **谜质 B1**：洞内战斗的每拍重建也要吃同一份增益（否则"开战吃、之后几拍又吐回去"）。
   * 快照里的 `foeMainType` 决定三张谐振片对哪一系加抗性。
   */
  const wh = battle.wormhole
  const matterBuffs = wh ? wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx)) : null
  const matterFoeMain: DamageType = wh?.foeMainType ?? 'kinetic'
  /**
   * **干扰压制的基准账**：逐件记「基准射程 + 该系加成倍率」，供 `applyMeJammerDebuff` 按船长
   * **加法口径**（`1 + bonus − 净削减`）反解施加系数。缺省不传时该函数退化为"相对当前射程直接乘
   * `1 − 净`"（= 只对不带任何射程加成的武器正确）⇒ 所以这两条路径**必须传**。
   */
  const jammerRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }>, legacyWeaponCount: battle.units.player?.weapons.length }
  if (!fleet || fleet.length === 0) {
    const me = createPlayerSpec(state, ctx, shipId, battleAmmoIdsFor(battle, 'player'), jammerRefs)
    if (!me) return []
    if (matterBuffs) applyMatterPlayerBuffs(me, matterBuffs, matterFoeMain)
    // **捕获网**（船长 2026-09-16）：每拍重建后重新施加（否则下一拍就"复活"）
    const web0 = battle.meWebDebuffs?.[me.tag]
    if (web0) applyMeWebDebuff(me, web0)
    // **敌干扰压制**（H 族墨潮干扰舰 · 2026-09-24）：与我方电子舰的削减相加抵消后缩小我方射程
    // ⚠ 传的是**净削减率**（0.35 = 压掉三成半），不是射程系数（2026-09-26 修正）
    applyMeJammerDebuff(me, meJammerNetOf(battle, foes ?? []), jammerRefs.weaponRanges)
    // 「第一次完成悬赏」的照会战加成（演习场 + 主控 + 任务未完成；每拍规格重建处注入）
    if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
    // **指挥舰全舰单发光环**（2026-09-17 修：原先只在开战那一刻乘 ⇒ 被每拍重建冲掉、从未生效）
    applyFleetDamageAura([me], 1 + fleetDamageAuraOf(state, ctx, [shipId]))
    applyAlienCorrosion(me, battle.alienCorrosion ?? 0)
    return applyFleetLockAura([me])
  }
  const out: UnitSpec[] = []
  for (const entry of fleet) {
    const shipRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }>, legacyWeaponCount: battle.units[entry.tag]?.weapons.length }
    const spec = createPlayerSpec(state, ctx, entry.shipId, battleAmmoIdsFor(battle, entry.tag), shipRefs)
    if (!spec) continue
    if (matterBuffs) applyMatterPlayerBuffs(spec, matterBuffs, matterFoeMain)
    spec.tag = entry.tag
    if (entry.tag === 'player' && isFirstBountyBattle(state, anomalyId, entry.shipId)) {
      applyFirstBountyBuff(spec)
    }
    // **捕获网**（船长 2026-09-16）：同上，逐舰按账本施加
    const web = battle.meWebDebuffs?.[entry.tag]
    if (web) applyMeWebDebuff(spec, web)
    // **敌干扰压制**：逐舰施加（同上——每拍重建后重新施加，否则下一拍就"恢复"）；同样传**净削减**
    applyMeJammerDebuff(spec, meJammerNetOf(battle, foes ?? []), shipRefs.weaponRanges)
    out.push(spec)
  }
  // **指挥舰全舰单发光环**：全队取最高一份、不叠加（同批修：见 `applyFleetDamageAura` 的注释）
  applyFleetDamageAura(out, 1 + fleetDamageAuraOf(state, ctx, fleet.map((e) => e.shipId)))
  for (const spec of out) applyAlienCorrosion(spec, battle.alienCorrosion ?? 0)
  return applyFleetLockAura(out)
}

/**
 * **目标锁定阵列：增伤与集火「全队生效」**（船长 2026-09-17：「**增伤改为全队生效。**」＋「**集火也是全队生效**」）——
 * 编队内任一舰装了 `lockDmgBonus` 件 ⇒ **全队取最高一份**（各舰先按自己那几件走 `curveMult` 收敛、再取最大），
 * 全队每舰的 `lockedDmgBonus` 都置为该值（船长裁定甲：与指挥舰「全队单发 +15% 取最高不叠加」同口径）。
 *
 * 为什么放在这里而不是只写一次：该字段在 `stepBattle` 里**一处驱动两件事**——
 * ① **集火**「存活编队首位」（`unit.lockedDmgBonus ? firstAliveFoe : randomAliveFoe`：主舰优先、击毁接力）；
 * ② **增伤**：本舰伤害 ×(1 + 值)（只对"打舰"生效；打敌机不吃，见 `stepBattle` 的机群分支）。
 * ⇒ 置满全队 = 增伤与集火**同时**全队化。而战斗是**逐拍重建规格**的（`buildMyUnitSpecs`）⇒ 必须在这一处施加，
 * 与「谜质增益 / 捕获网 / 教学战加成」同一处纪律（只写在开战那一刻会被下一拍冲掉）。
 *
 * **零份 ⇒ 一个字段都不写**（没装阵列的编队逐字不变）；**单舰路径取到的就是它自己 ⇒ 逐字等价**
 * （远征单人 / 遭遇战 / 虫洞单舰的读数不受影响）。件数值（8/12/20/30%）一个不动，**零存档迁移**。
 */
export function applyFleetLockAura(specs: UnitSpec[]): UnitSpec[] {
  let best = 0
  for (const s of specs) best = Math.max(best, s.lockedDmgBonus ?? 0)
  if (best > 0) for (const s of specs) s.lockedDmgBonus = best
  return specs
}

/**
 * **指挥舰「全舰单发伤害 ×(1+光环)」光环的取用口径**（原 +15%，2026-09-26 起陵卫/虎鲸两艘都是 +20%）：编队（或单舰）里**取最高一份**、**不叠加**
 * （2026-09-13 船长口径：「提高全舰的单发伤害 15%」＋"多艘同类只取最高"，与"同项取优"惯例一致）。
 * 数据来源 = `ShipDef.fleetDamageBonusPct`（2026-09-26 起两艘：陵卫指挥舰 0.20 · 虎鲸级指挥舰 0.20）。
 */
export function fleetDamageAuraOf(state: GameState, ctx: SimContext, shipIds: readonly string[]): number {
  return Math.max(
    0,
    ...shipIds.map((sid) => {
      const defId = state.fleet[sid]?.defId
      return (defId ? ctx.ships.get(defId)?.fleetDamageBonusPct : 0) ?? 0
    }),
  )
}

/**
 * **把全舰单发光环乘进这一份规格的每条武器**（`mul` = 1 + 光环值；`<= 1` 直接跳过）。
 *
 * ⚠ **2026-09-17 修一个真 BUG（船长「本批一起修」）**：这段乘算原先是**内联写在
 * `startFleetBattleFor` 里的**——只乘**开战那一刻**的规格，而战斗是**逐拍重建规格**的
 * （`buildMyUnitSpecs` → `createPlayerSpec`，后者不认识 `fleetDamageBonusPct`）⇒ 那些被乘过的值
 * **一拍都没用上**，指挥舰的光环自始至终是**死代码**。真引擎 A/B 取证（同编队同种子、只差光环船那 15%、
 * 双方都不死比每发均值）：带光环 **每发 91.640 / 命中 25** 与无光环**逐位相同** ⇒ 比值 **1.000**
 * （生效应 ≈1.15）。⇒ 现在统一由**每拍重建处**（`buildMyUnitSpecs`）调用，`startFleetBattleFor`
 * 也调一次同一函数（开战首拍的规格同源，避免两处各写一份乘算）。
 */
export function applyFleetDamageAura(specs: readonly UnitSpec[], mul: number): void {
  if (mul <= 1) return
  for (const spec of specs) {
    for (const w of spec.weapons) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * mul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * mul
        }
      }
    }
  }
}
