/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { lairAnomalyOf, lairNameOf } from '../lairs'
import { weekendFoeCardOf } from '../weekendEvent'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { settleDroneLosses, refundAmmo, refundRepairKitsAll, persistFleetHullDamage, createPlayerSpec, createFoeSpecs, foeDesiredRange, meFoeRangeDebuffOf, captureBattleReport } from '../combat'
import { formatDurationMs } from '../time'
import { type HullHit, applyArmorFirstDamage, firepowerHitHp, hitDamageText } from '../hullDamage'
import { nextRandom } from '../rng'
import { shipDisplayName } from '../instances'
import { autoLoopInvasionGalaxy, stopAutoLoopInvasion } from './loopState'
import { returnBackMs } from './travel'
import { RETURN_LEG_MUL } from '../balance'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from '../jumpFuel'

/**
 * 玩家指令：战斗中主动撤退（Q1乙 轻损：只损失少量舰船耐久、无弃船骰；**维修费已于 2026-09-15 按船长「删除撤离费」整条删除**）；
 * 耐久结算带下限保护——不足 0 时压到 5% 并显著告警，绝不因撤退直接弃船）。
 * 实现口径：扣损 = 战败扣损骰 ×0.5（约 8%~15%，最低 1%）——数值小，玩家侧只描述"少量损失"。
 * 仅"正在交火且未分胜负"时可撤；撤退即手动收手 → 同时停止重复清剿（Q3甲）。
 */
export function retreatBattle(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active || exp.phase !== 'battle' || !exp.battle) {
    return { ok: false, error: '当前不在交火中，无法撤退。', errorId: 'core.expedition.016' }
  }
  if (exp.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法撤退。', errorId: 'core.expedition.017' }
  }
  settleBattleRetreat(state, ctx, 'manual')
  return { ok: true }
}

/**
 * 撤退结算核心（2026-09-08：手动撤退与巡回自动撤退共用）：
 * 承伤写回 → 脱身那一口（按敌火扣装甲/结构，下限 5% 保护、绝不弃船）→ 停清剿 → 转返航。
 * **不收维修费**（船长 2026-09-15「删除撤离费」，旧 Q1乙 的"按比例维修费"整条作废）。
 * mode 四档：'manual' 玩家主动撤退；'auto' 连续作战保险（本场结构损失过半）；
 * 'timeout' **战斗打满上限判负**（2026-09-10 船长定：超时不再按残血比判胜，视同被迫撤退）；
 * 'cannot-engage' 够不着（一炮未发，2026-09-11 裁定）。
 */
export function settleBattleRetreat(
  state: GameState,
  ctx: SimContext,
  mode: 'manual' | 'auto' | 'timeout' | 'cannot-engage',
): void {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  /**
   * **本次交火实际用的那张卡**（2026-09-14 船长裁定「顺手对齐」）：
   * 窝点的界面胜率/威胁、以及开战时的敌编成（见本文件开战路径的 `card0`）**一律按档位派生后的卡**
   * （`lairAnomalyOf`：威胁 ×1.3/1.6/2.0），唯独撤退/无法交战这里的取数原先读**基础卡** ⇒ 窝点档被少算。
   * 派生卡只放大威胁与条目的 hp/dmg 锚点，单发/射程/编成/战术一律不动 ⇒ 交距读数不受影响。
   * ⚠ **奖赏与命名那条链仍走基础卡 + `exp.lairTier`**（`lairBaseRewardIsk` / `lairNameOf`），
   * 换成派生卡会把档位倍率二次乘上 ⇒ 奖金虚高，务必别顺手改。
   */
  const threatCard = anomaly && exp.lairTier ? lairAnomalyOf(anomaly, exp.lairTier, ctx.balance.battle) : anomaly
  const battle = exp.battle
  if (!battle) return
  /**
   * **入侵结算也要走一遍**（2026-09-25 补 · 由船长「撤退会重抽吗」一问查出）：
   * 母舰伤害是在**战斗收尾**那一步量进血池的，而**撤退 / 超时 / 无法交战走的是这条路径** ⇒
   * 原先这一场对母舰打出的伤害白打；设计稿写的是「按对母舰造成的伤害决定」（撤退 / 战败照记）。
   * 按"没打赢"结算：**只记伤害 · 不给进度 · 不判击沉**（`victory: false`；非入侵战斗内部直接 no-op）。
   */
  {
    const ev = state.weekendEvent
    const galaxyId = exp.foeGalaxyId
    if (ev !== undefined && ev.endedAtWallMs === undefined && galaxyId !== undefined) {
      const isFlagship =
        exp.anomalyId !== null && exp.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && galaxyId === ev.coreId
      weekendApplyBattleOutcome(state, ctx, exp.anomalyId ?? null, false, state.wallMs ?? Date.now(), battle, {
        kind: isFlagship ? 'flagship' : 'assault',
        galaxyId,
        source: 'battle',
      })
    }
  }
  // 机群战损（2026-09-10 船长「无人机可被击落」）：撤退也照扣——被打掉的飞机不会飞回来
  settleDroneLosses(state, ctx, state.shipId, battle)
  refundAmmo(state, battle.ammo, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 退回
  refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
  // P0 承伤持久化：撤退也保留本场已损装甲/结构（脱身那一口在其后叠加）
  persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)
  // 「无法交战」战报要用的两个数字（**与引擎同源、不手写**）：我方主武器最远射程 + 敌编队典型交距
  const meSpec = createPlayerSpec(state, ctx, state.shipId)
  const myTopRangeM = meSpec ? meSpec.weapons.reduce((m, w) => Math.max(m, w.maxRangeM), 0) : 0
  const foesNow = threatCard ? createFoeSpecs(threatCard, ctx.balance.battle) : []
  const foeTypicalRangeM =
    meSpec && foesNow.length > 0
      ? // 电子舰削减后敌人会主动压近（船长 2026-09-18）⇒ 战报这条读数与引擎同源
        foeDesiredRange(meSpec, foesNow, ctx.balance.battle, meFoeRangeDebuffOf(state, ctx, [state.shipId]))
      : 0

  // 脱身那一口（2026-09-11 船长：「希望能将其应用到战斗中撤退」）：
  // 一口 = 敌群火力（威胁 × foeDpsPerThreat）× combat.retreatHitFirepowerSec，
  // **先扣装甲、吸完再进结构**，结构 5% 底线（算法单点 hullDamage.ts，与低安遇袭受损档同一套）。
  // 取代旧口径「轻损 = 失利扣损骰 ×0.5 = 结构 −7.5%~15%（与敌人强弱无关、装甲不动）」；
  // 旧档/异常无 anomalyId 时无从取敌群火力 ⇒ 退回旧半损骰兜底（有日志说明）。
  // ⚠ **2026-09-14 船长改判：「玩家撤离战斗按照 10 秒算」⇒ 旧值 1 秒作废**；**2026-09-26 再改判
  // 「甲：单纯削减时间」⇒ 10 → 5 秒**（与低安遇袭那口同口径）。四档（主动撤退 /
  // 结构<50% 自动脱离 / 超时 / 无法交战）**同一 K**；虫洞撤离战不在此列（走真实战斗损伤）；
  // **不计玩家抗性**（船长令「之前没有抗性就算了」，见 `balance.combat.retreatHitFirepowerSec`）。
  const bal = ctx.balance.combat
  const threat = threatCard ? Math.max(1, threatCard.threat) : 0
  let hit: HullHit | null = null
  let legacyLossPct = 0
  if (threat > 0) {
    hit = applyArmorFirstDamage(state, ctx, state.shipId, firepowerHitHp(ctx, threat, bal.retreatHitFirepowerSec))
    if (hit?.floored) {
      addLog(
        state,
        'combat',
        mode === 'timeout'
          ? '⚠ 超时撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
          : mode === 'auto'
            ? '⚠ 自动撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
            : '⚠ 撤退时船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。',
        mode === 'timeout' ? 'core.expedition.054' : mode === 'auto' ? 'core.expedition.055' : 'core.expedition.056',
      )
    }
  } else {
    const fleetShipLegacy = state.fleet[state.shipId]
    const baseLoss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const loss = Math.max(0.01, Math.round(baseLoss * 500) / 1000)
    legacyLossPct = Math.round(loss * 100)
    if (fleetShipLegacy) fleetShipLegacy.durability = Math.min(1, Math.max(0.05, fleetShipLegacy.durability - loss))
  }
  const fleetShip = state.fleet[state.shipId]
  /**
   * **撤退不收维修费**（船长 2026-09-15：「**删除撤离费**」）。
   *
   * 旧口径（2026-09-04 Q1乙）：撤退 = 轻损 + 无弃船骰 + **按比例维修费**
   * （`min(钱包, 该卡期望奖励 × defeatCostRatio(0.5) × 0.5)` = 奖励的 25%，四档——手动撤退 /
   * 结构<50% 自动脱离 / 打满上限超时 / 无法交战——**一起收**）⇒ 已**整条删除**：
   * 现在撤退**只损失舰船耐久（脱身那一口）**，钱包一个信用点不动。
   * ⚠ **失利的维修费不受影响**（那条是"打输了"的惩罚，`× defeatCostRatio` 全额，见上面失利分支）；
   * 本函数里 `retreatBaseIsk` 随收费一起删除（它只服务这两行）。
   */
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : exp.anomalyId ?? '目标'
  const dmgTxt = hit ? hitDamageText(hit) : `结构 -${legacyLossPct}%（旧档兜底）`
  const retreatText =
    mode === 'timeout'
      ? `⏱ 战斗超时（${targetName}）：舰船被迫撤退，正在返航——${dmgTxt}。`
      : mode === 'cannot-engage'
        ? // 无法交战（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：写明**我方射程 × 敌站位**，
          // 让玩家看懂"不是打不过，是够不着"，并知道该换装配（推进器/更远的武器）。
          `⚔ 无法交战（${targetName}）：我方主武器最远射程 ${myTopRangeM.toLocaleString('zh-CN')} m，` +
          `敌编队停在约 ${foeTypicalRangeM.toLocaleString('zh-CN')} m 外（交火 ${durTxt}，一炮未发）——` +
          `${shipName} 已脱离交火并返航。${dmgTxt}。`
        : mode === 'auto'
          ? `⚔ 自动撤退（${targetName}）：结构损失过半，${shipName} 自动脱离交火（交火 ${durTxt}）——${dmgTxt}，正在返航。`
          // 2026-09-12 合并：主树「手动撤退 = **立刻回港**」的新文案（本块两侧各改一处 ⇒ 并集）
          // 2026-09-15 船长「删除撤离费」⇒ 四档文案一律去掉「维修花去 N 信用点」（钱包不再变动）
          : `⚔ 撤退（${targetName}）：${shipName} 主动脱离交火（交火 ${durTxt}）——${dmgTxt}，即刻回港。`
  addLog(state, 'combat', retreatText)
  /**
   * 战报（2026-09-14 船长定）：**四档里的「脱离」那一档** —— 这四种都是"没分出胜负就收场"
   * （结构撤退 / 打满上限超时 / 无法交战 / 玩家主动撤退），故 `outcome: 'break'`，
   * 只在 `breakReason` 上区分原因（判定词不变）。⚠ 超时在本引擎里"按被迫撤退处理"是**结算口径**
   * （轻损、不弃船），与这里给的**判定词**是两件事。
   */
  captureBattleReport(state, battle, {
    source: 'expedition',
    outcome: 'break',
    breakReason: mode === 'timeout' ? 'timeout' : mode === 'cannot-engage' ? 'cannot-engage' : mode === 'auto' ? 'hull' : 'manual',
    summary: retreatText,
  })
  // 收手 → 停清剿（若有；手动撤退与自动撤退都会终止重复清剿）
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    const armorPct = Math.round((fleetShip?.armorPct ?? 1) * 100)
    const structPct = Math.round((fleetShip?.durability ?? 1) * 100)
    const text =
      mode === 'manual'
        ? `重复清剿已停止（手动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
        : mode === 'timeout'
          ? `重复清剿已停止（战斗超时）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
          : mode === 'cannot-engage'
            ? `重复清剿已停止（无法交战，已脱离）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
            : `重复清剿已停止（本场结构损失过半，自动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
    addLog(state, 'combat', text)
    // 2026-09-10 船长定：除事件日志外，玩家在线时弹窗告知（心跳读取即清）
    if (mode === 'auto' || mode === 'cannot-engage') state.autoLoopStopNotice = text
  }
  if (autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined) {
    stopAutoLoopInvasion(state, '本次出击已撤离，修整后可重新开启。', 'core.invasionLoop.005')
  }
  // 转返航（2026-09-08：基准 = 目标星系最近已建成站；本地 = 固定 120s；沿用失利返回流程）
  exp.battle = null
  exp.lairTier = undefined
    exp.factionActive = undefined // 撤退/自动撤退：本场作废，窝点档位不带到下一场
  exp.phase = 'back'
  exp.returnReason = 'retreat'
  // 返航计时起点 = 战斗停表时刻（2026-09-09 修复：自动撤退由大步长推进触发时,离线剩余时间
  // 应计入返航,而不是从结算时（=离线末）才起步）
  const endAtR = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtR
  // **手动撤退 = 立刻回港**（2026-09-11 船长：「玩家战斗手动撤退后应该是立刻回港，现在战斗撤退有返港时间」）：
  // 玩家主动收手不再走返航航程（到港时刻 = 停表时刻，下一拍即入港卸货）；
  // 自动撤退（结构损失过半）与超时判负仍按原口径返航（"被迫撤离，正在返航"）。
  if (mode === 'manual') {
    exp.finishAtGameMs = endAtR
    addLog(state, 'combat', '舰队脱离战场，即刻返回最近的空间站。', 'core.expedition.028')
    return
  }
  const retR = anomaly ? returnBackMs(state, ctx, exp.foeGalaxyId ?? anomaly.galaxyId) : { ms: 0, base: HOME_GALAXY_ID }
  const rawBackR = retR.ms > 0 ? retR.ms : exp.outMs * RETURN_LEG_MUL
  exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackR)
  exp.finishAtGameMs = endAtR + jumpFuelLegMsOf(rawBackR, exp.fuelMul)
  addLog(state, 'combat', '舰队脱离战场，自动返航（去程时间并入返航）。', 'core.expedition.029')
}
