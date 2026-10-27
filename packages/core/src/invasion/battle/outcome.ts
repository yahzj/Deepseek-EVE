/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { type WeekendOutcomeHint, type WeekendBattleKind, weekendBattleInvolvedOf, weekendFlagshipSpecOf, weekendAmbushSpecOf, weekendAssaultSpecOf } from './specs'
import { weekendZoneLiveAt, weekendIsBossFamily, weekendFlagshipSlotOf, weekendBossPoolView, weekendFlagshipDefeated, WEEKEND_CARD_PREFIX, weekendFlagshipSharesOf } from '../../weekendEvent'
import { flagshipBattleLedger } from '../../combat'
import { ceilFinalQuantity } from '../../quantity'
import { type WeekendOutcome, weekendResolveBattle } from './settle'
import { injectWeekendRareWreck, asFoeFamily } from '../../salvage'
import { weekendRareWreckIdFor, weekendGrantRewards, weekendBlackBoxItemIdOf, noteReward } from './rewards'

/**
 * **战后一口气结算**（引擎在"这一场打完了"那一拍调用）：
 * 判归属 → 取 spec → `weekendResolveBattle` → **奖励真正入账**（ISK 进钱包、稀有残骸进仓库）。
 * 返回 null = 这一场与入侵无关（引擎什么都不用做）。
 *
 * `hint` 给了 `kind` + `galaxyId` ⇒ **直接采信**（遭遇系统与远征系统都准确地知道自己在打什么）；
 * 不给 ⇒ 按 `weekendBattleInvolvedOf` 从状态反推（老调用方逐字不变）。
 */
export function weekendApplyBattleOutcome(
  state: GameState,
  ctx: SimContext,
  anomalyId: string | null | undefined,
  victory: boolean,
  nowWallMs: number,
  /**
   * **打出这一场胜负的 `BattleState`**（2026-09-24 加；缺省 = 老调用方 ⇒ 台账恒 0）：
   * 旗舰 BOSS 要用它量"这一场对母舰造成了多少原始伤害"（`combat.flagshipBattleLedger`）。
   */
  battle?: import('../../state').BattleState | null,
  hint?: WeekendOutcomeHint,
): { galaxyId: string; kind: WeekendBattleKind; gain: number; isk: number; wreck: number; note: string } | null {
  const involved: { galaxyId: string; kind: WeekendBattleKind } | undefined = (() => {
    const ev = state.weekendEvent
    if (hint === undefined || ev === undefined || ev.endedAtWallMs !== undefined || hint.galaxyId.length === 0) {
      return weekendBattleInvolvedOf(state, ctx, anomalyId, nowWallMs)
    }
    /**
     * 提示的**有效性闸门**：伏击要求该星系是活的占领区；旗舰要求"星系 = 本场核心"。
     * ⚠ 旗舰**不能**套"活的占领区"这条 —— 核心条满正是旗舰现身的前提，那一刻 `weekendZoneLiveAt`
     * 已经为假（进度 = 1）⇒ 套上去会把旗舰战打回"什么都不结算"（2026-09-24 那个 bug 的翻版）。
     */
    if (hint.kind === 'flagship') {
      return hint.galaxyId === ev.coreId ? { galaxyId: hint.galaxyId, kind: 'flagship' } : undefined
    }
    return weekendZoneLiveAt(state, hint.galaxyId, nowWallMs)
      ? { galaxyId: hint.galaxyId, kind: hint.kind }
      : undefined
  })()
  if (!involved) return null
  const spec =
    involved.kind === 'flagship'
      ? weekendFlagshipSpecOf(state, ctx, nowWallMs)
      : involved.kind === 'ambush'
        ? weekendAmbushSpecOf(state, ctx, involved.galaxyId, nowWallMs)
        : weekendAssaultSpecOf(state, ctx, involved.galaxyId)
  if (!spec) return null
  /**
   * **旗舰 BOSS：这一场对母舰的原始伤害**（船长 2026-09-24 第二轮令）。
   * 从 `battle.units` 的 `hpMax − hp` 量（`flagshipBattleLedger`；认舰靠单位上的 `foeShipId`）。
   * ⚠ 2026-09-25：池子总量改成**固定常量**（船长「BOSS 血条 15 万来算」）⇒ 不再算"下限"。
   */
  let flagshipDmg = 0
  if (involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent)) {
    const card = ctx.anomalies.get(spec.cardId)
    /**
     * 🔴 **认母舰走 `weekendFlagshipSlotOf`（族无关 · 从卡自身认 T5）** —— **2026-10-02 修**：
     * 原先这里用写死 H 族的 `weekendIsFlagshipShipId` 过滤 ⇒ **R 族（本期入侵族）一条都对不上**
     * ⇒ 台账恒 0 ⇒ 打进池子的伤害记不上（"单场不死 / 跨场累计"整条失灵，母舰血条退回自身满值）。
     */
    const flagship = weekendFlagshipSlotOf(card)
    const flagshipIds = flagship !== undefined ? [flagship.ship.id] : []
    if (battle) {
      const led = flagshipBattleLedger(battle, flagshipIds)
      flagshipDmg = led.rawDmg
      // 兼容旧战斗的四舍五入入场HP及读档削血取整；只补已确认击沉后至多1HP的尾差。
      const poolLeft = weekendBossPoolView(state, state.weekendEvent)?.hpLeft ?? 0
      const roundingGap = poolLeft - flagshipDmg
      const killedBoss = battle.bossDownAtMs !== undefined && battle.foeOverride?.bossShipId === flagship?.ship.id
        && Object.values(battle.units).some(unit => unit.side === 'foe' && unit.foeShipId === flagship?.ship.id
          && unit.hp.s + unit.hp.a + unit.hp.h <= 0)
      if (led.flagshipSeq === 1 && killedBoss && roundingGap > 0 && roundingGap <= 1) flagshipDmg += 1
      // 入场HP及伤害取整不能代替击沉观测；仍存活时至少保留共享池最后一格。
      if (!killedBoss && poolLeft > 0) flagshipDmg = Math.min(flagshipDmg, Math.max(0, ceilFinalQuantity(poolLeft) - 1))
    }
  }
  /**
   * ⚠ **BOSS 口径下"战斗打赢"不再等于"击沉旗舰"**（单场不死）：这一场把池子打空才算。
   * 其余情形（没打空）照常按胜负记进度 —— 撤退/战败的伤害也已经记进池子了。
   */
  const bossDown =
    involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent) && weekendFlagshipDefeated(state.weekendEvent)
  /**
   * **胜负 → 进度档**（设计稿「玩家推进」：主动胜利 外围 +5% / 核心 +5% · **主动击退遇袭 +3%** ·
   * **离线自动结算击退 +1%** · 战败只受损、进度不动）。
   *
   * ⚠ 2026-09-25 修（原式 `victory || bossDown ? 'win' : (ambush ? 'repel' : 'loss')` **两头都反了**）：
   * 遇袭打赢被记成"主动胜利"（+5% 而不是 +3%），遇袭打输却被记成"击退"（+3% 而不是 0）。
   * 现在按 `kind` 分流：**伏击**看 `victory`（赢 = 击退 · 输 = 战败），**主动出击**赢 = 胜利、输 = 战败；
   * 文字结算（`hint.source === 'text'`）的击退走 **+1%** 那一档。
   */
  const outcome: WeekendOutcome = bossDown
    ? 'win'
    : involved.kind === 'ambush'
      ? victory
        ? hint?.source === 'text'
          ? 'offlineRepel'
          : 'repel'
        : 'loss'
      : victory
        ? 'win'
        : 'loss'
  const r = weekendResolveBattle(state, ctx, spec, outcome, nowWallMs, flagshipDmg, battle?.startedAtGameMs)
  /**
   * **卡的稀有残骸掉落**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」＋追问落点答
   * 「**进残骸场**」）。
   *
   * 落点 = **该星系的入侵残骸场**（`weekendWrecks.rare/rareBy`）⇒ 打捞时**稀有池优先、本轮必出一件**
   * （物品 = 该卡所属组的稀有残骸，主力舰队即 `wreck-rare-h-hi`）。
   *
   * 口径（本次一并定下）：
   * - **认"这一场实际打的那张卡"**（`anomalyId`，`wk-` 前缀先剥掉），**不是** `spec.cardId` ——
   *   出击/遇袭的 spec 是按池子**另抽**的，只有 `anomalyId` 才是玩家真正打赢的那支舰队；
   * - **只有战斗打赢算**：主动出击全歼（`win`）与迎袭击退（`repel`）都算；
   *   **文字结算**（`offlineRepel`：离线 / 无人应答自动结算）与失利（`loss`）**不算**；
   * - **不设每场上限**（船长同日令）；
   * - 落账按**打它的那张卡**记账 ⇒ 打捞时据此归族取箱子。
   */
  const foughtCardId =
    typeof anomalyId === 'string' && anomalyId.startsWith(WEEKEND_CARD_PREFIX)
      ? anomalyId.slice(WEEKEND_CARD_PREFIX.length)
      : typeof anomalyId === 'string'
        ? anomalyId
        : ''
  const rareDrop = foughtCardId.length > 0 ? (ctx.anomalies.get(foughtCardId)?.rareWreckDrop ?? 0) : 0
  if (rareDrop > 0 && (outcome === 'win' || outcome === 'repel')) {
    injectWeekendRareWreck(state, involved.galaxyId, foughtCardId, rareDrop, asFoeFamily(ctx.anomalies.get(foughtCardId)?.foeFamily))
    const gnameDrop = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
    addLog(
      state,
      'trade',
      `✦ 击退「${gnameDrop}」的入侵舰队：残骸场里留下 ${rareDrop} 具稀有残骸 —— 可前往该星系打捞（回站用回收炉解体可得额外战利品）。`,
      'core.weekend.043',
      { p1: gnameDrop, p2: rareDrop },
    )
  }
  /**
   * **即时发放的只有"旗舰掉落"**（2026-09-25 船长令：「**夺回星区的奖励不要即时发放，放入结束后结算发放**」）：
   * 夺回奖励（逐处 ×8 ＋ 2M · 全清追加 5M）**只记台账**，等 `weekendSettleAndGrant` 在活动结束时连贡献奖一起发
   * （⇒ 玩家在结算通讯/结算面板里一次看清全部到手；见 `ev.reclaimPending`）。
   * ⚠ 旗舰击沉发生在**活动结束那一刻**，它的掉落仍即时入账（那之后玩家已经没有"下一次"可言）。
   */
  const isk = 0
  const wreck = r.flagshipKilled?.wreck ?? 0
  // **稀有残骸的真实物品 id**：按这一场打的那张卡所属残骸组取（H 族 ⇒ `wreck-rare-h-hi`）
  const wreckItemId = weekendRareWreckIdFor(spec.cardId, ctx)
  const granted = weekendGrantRewards(state, {
    isk,
    wreck,
    /** 黑匣：**这一场是"击沉旗舰"那一支 ⇒ 必给 1 枚**（2026-09-28 船长令「击杀BOSS就能获得黑匣」） */
    blackBox: r.flagshipKilled !== undefined,
    /**
     * **这一枚按族取**（**2026-10-02 船长令「甲」**）：R 族（光环）期发「光环旗舰黑匣」，
     * H 族（墨潮）期发「墨潮旗舰黑匣」——此前这里写死流到 `weekendGrantRewards` 的墨潮匣
     * ⇒ 玩家报障「光环入侵结束给的黑匣还是墨潮的」。
     */
    blackBoxItemId: weekendBlackBoxItemIdOf(state.weekendEvent, ctx),
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  /**
   * **入账日志**（2026-09-25 补 · id 制）：只记**里程碑** —— 夺回 / 全部夺回 / 旗舰击沉。
   * ⚠ 2026-09-25 船长改口径后，夺回那两条日志**不再说"已入账"**（钱要到活动结束才发）——
   * 它们改说「待结算时统一发放」，措辞见 `core.weekend.001/002`。
   */
  const gname = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
  /**
   * 到手台账（夺回按星系记、旗舰掉落记全局）——结算面板与结算通讯的奖励清单读它，不另算一遍；
   * **夺回那部分另记进 `reclaimPending`**，等 `weekendSettleAndGrant` 一次性发放（船长令：不即时发）。
   */
  const evNow = state.weekendEvent
  if (evNow !== undefined) {
    /**
     * **夺回奖不在这里记**（**2026-09-29 船长令 · 乙案**）：金额 = 全额 × 玩家在**该处**的最终投入比例，
     * 而"最终"要到结算才知道 ⇒ 记账收口在**结算那一拍**（`weekendSettleAndGrant` 的幂等早退之前）。
     * ⚠ 这里原先那次 `weekendSyncReclaimRewards` 调用已删除：它会在"打完这一拍"按**当时**比例记账，
     * 之后玩家再为该处出力也补不回来（同一行为算出不同奖励），且与结算拍的口径会打架。
     */
    if (r.flagshipKilled !== undefined) {
      /**
       * 台账记的是**实际入账**的那一份（`granted`），不是"应该发的那一份"（`r.flagshipKilled`）——
       * 2026-09-26 船长批「甲」的第②条：没真发出去时**不许**记「已获得」，
       * 否则结算面板/结算通讯又会显示玩家手里没有的东西（账实分离）。
       */
      noteReward(evNow, undefined, { wreck: granted.wreck, blackBox: granted.blackBox })
      /** 真发出去了才写已结清，未到账不能计作已获得。 */
      if (granted.blackBox > 0) evNow.flagshipBlackBox = true
    }
  }
  if (r.reclaimed !== undefined) {
    /**
     * **夺回那两条日志不再报金额**（**2026-09-29 船长令 · 乙案**）：金额 = 全额 × 玩家在该处的
     * **最终**投入比例，夺回这一刻算不出（他后面还能继续为这处出力）⇒ 文案只写规格，数额到
     * **结算面板 / 结算通讯**里逐处列明（那两处读的是实发台账）。⚠ 旧的 `p2/p3` 参数已删除。
     */
    if (r.reclaimed.allClear) {
      addLog(
        state,
        'trade',
        `✦ 全部占领区夺回：「${gname}」是最后一处 —— 夺回奖励与全清额外奖励按玩家的投入比例结算，活动结束时统一发放。`,
        'core.weekend.002',
        { p1: gname },
      )
    } else {
      addLog(
        state,
        'trade',
        `✦ 夺回「${gname}」：夺回奖励按玩家在该星系的投入比例结算，活动结束时统一发放。`,
        'core.weekend.001',
        { p1: gname },
      )
    }
  }
  if (r.flagshipKilled !== undefined) {
    /**
     * 黑匣**爆或不爆**分两条文案（2026-09-25 船长令改爆率后，"必掉黑匣"不再成立）；
     * 件数一律取**实际入账**的 `granted`，落点写明「物品仓库」（船长 2026-09-26 批「甲」第④条：
     * 原先只说"战利品已入账"，玩家会去货舱里找）。
     *
     * 🔴 **2026-09-27 船长令（措辞分档）**：「**只记录作为判定，根据不同情况改变措辞**（玩家只抢最后一下
     * 但是没多少输出就说玩家参与度过低……）」⇒ 两条文案都点明**是玩家击沉的**；未爆那一条**把占比写出来**
     * （`{p2}`，走 `weekendFlagshipSharesOf` 的玩家优先口径），让玩家明白是"输出占比未过半"而不是被系统吞了。
     */
    const box = granted.blackBox
    const sharePct = Math.round(weekendFlagshipSharesOf(evNow).player * 100)
    addLog(
      state,
      'trade',
      box
        ? `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 旗舰黑匣 ×1 ＋ 稀有残骸 ×${granted.wreck} 已存入物品仓库。`
        : `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 稀有残骸 ×${granted.wreck} 已存入物品仓库；玩家输出占比 ${sharePct}% 未过半，旗舰黑匣未爆。`,
      box ? 'core.weekend.003' : 'core.weekend.016',
      { p1: granted.wreck, p2: sharePct },
    )
  }
  return { galaxyId: involved.galaxyId, kind: involved.kind, gain: r.progressGain, isk: granted.isk, wreck: granted.wreck, note: r.note }
}
