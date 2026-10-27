/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import type { WeekendBattleSpec } from './specs'
import { weekendIsBossFamily, weekendNoteFlagshipDamage, weekendFlagshipDefeated, weekendProgressAt, weekendWinGainOf, weekendNoteContribution, WEEKEND_GAIN_OFFLINE_REPEL, WEEKEND_GAIN_REPEL, weekendNoteFlagshipKilled, weekendOccupiedIds, type WeekendEventState, weekendContributionShareAt, weekendContributionTier, weekendProgressIncomeIsk, weekendPlayerContribution, weekendLastHitByPlayer, type WeekendResultSnapshot, weekendFlagshipOutcomeOf, weekendFlagshipSharesOf, weekendStandingGainOf, weekendFoeCardOf } from '../../weekendEvent'
import { weekendRareWreckUnits, WEEKEND_FLAGSHIP_WRECK, weekendSyncReclaimRewards, weekendRareWreckIdFor, weekendBlackBoxItemIdOf, weekendGrantRewards, noteReward } from './rewards'
import { noteStandingEarned, DSI_FACTION_ID } from '../../standing'

export type WeekendOutcome = 'win' | 'repel' | 'offlineRepel' | 'loss'

export interface WeekendResolveResult {
  /** 本次推进的进度增量（0 = 没推进） */
  progressGain: number
  /** 战果说明（供日志；中文原串，界面按 id 映射另接） */
  note: string
  /**
   * 这次是否**夺回了某处**（只记"这件事发生了" —— **不带金额**）。
   *
   * ⚠ **2026-09-29 船长令（乙案）后金额要按"最终投入比例"算**（`weekendReclaimAwardOf`），
   * 夺回那一刻算不出最终值 ⇒ 金额一律归**结算拍**（`weekendSettleAndGrant`）。
   */
  reclaimed?: { galaxyId: string; allClear: boolean }
  /** 击毁旗舰 ⇒ 黑匣（**按爆率表掷出来的结果**，可能不爆）＋ 稀有残骸（必给） */
  flagshipKilled?: { blackBox: boolean; wreck: number }
}

/**
 * 结算一场入侵相关战斗（**唯一入口**）：
 * - `assault` + `win` ⇒ 主动推进（外围 +5% / 核心 +5%；外围 2026-10-01 由 10% 降至 5%）→ 若该星系进度满 ⇒ **夺回奖励**（稀有残骸 ×8 ＋ 2M；全部夺回再 +5M）；
 * - `assault`/`ambush` + `repel` ⇒ **击退也加进度**（+3%；离线自动结算 +1%）；
 * - `loss` ⇒ **只受损、不动进度**（第 5 条）；
 * - 目标是核心且**核心条满**时打赢 ⇒ **击毁旗舰**（黑匣 ＋ 稀有残骸 ×3）并结束本场。
 */
export function weekendResolveBattle(
  state: GameState,
  /** 保留参数位：奖励发放若需 ctx（物品表/日志）时用；当前纯记账不需要 */
  ctx: SimContext,
  spec: WeekendBattleSpec,
  outcome: WeekendOutcome,
  nowWallMs: number,
  /**
   * **BOSS 池：这一场对母舰造成的原始伤害**（2026-09-24 第二轮令；缺省 0 = 该场没打到母舰 ⇒ 0 进度）。
   * 由引擎用 `combat.flagshipBattleLedger` 量出来（"按对母舰造成的伤害决定"）。
   */
  flagshipDmg = 0,
  /** **这一场战斗的身份**（`battle.startedAtGameMs`）——同一场被结算两次时保证幂等 */
  flagshipRunId?: number,
): WeekendResolveResult {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return { progressGain: 0, note: '本场入侵已结束' }

  /**
   * **旗舰 BOSS 池先记账**（跨场累计；撤退/战败**照样记**——船长口径："按对母舰造成的伤害决定"）。
   * 归类不按胜负：`win` = 打赢（BOSS 口径下"打空池子"才算击沉），`repel`/`loss` = 没打赢但伤害照记。
   */
  if (spec.kind === 'flagship' && weekendIsBossFamily(ev)) {
    // 幂等键 = 这一场战斗的身份（同一场被结算两次时不会记两遍）
    weekendNoteFlagshipDamage(ev, flagshipDmg, flagshipRunId)
  }
  /** **BOSS 口径下的"成了"**：这一场把池子打空了（单场不死 ⇒ 不看战斗本身的胜负） */
  const bossDown = spec.kind === 'flagship' && weekendIsBossFamily(ev) && weekendFlagshipDefeated(ev)

  if (outcome === 'loss' && !bossDown) return { progressGain: 0, note: '战败：只受损，进度不动（第 5 条）' }

  const wasReclaimed = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1
  /** 本场**开打前**该星系的进度读数（% —— 只给下面那条"夺回进度 a% → b%"反馈文案用；与 `weekendProgressAt` 同源） */
  const beforePct = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100
  /** 本场是否被**核心门禁**挡下（只有核心、且外围没清完、且核心读数还停在 0）——给反馈文案分流用 */
  let gatedThisBattle = false
  let gain = 0
  if (outcome === 'win') {
    /** 主动胜利的推进量：**调试模式 = +50%（两场收复，船长令）**；正常 = 外围 5% / 核心 5%（外围 2026-10-01 由 10% 降至 5%） */
    gain = weekendWinGainOf(state, ev, spec.galaxyId)
    // 核心：门禁未解时**不给进度**（`weekendNoteContribution` 会记台账，但读数侧仍被门禁挡住 ⇒ 这里只在门禁已解时记）
    const gated = spec.galaxyId === ev.coreId && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) <= 0 && !peripheryCleared(state, ev, nowWallMs)
    gatedThisBattle = gated
    if (!gated) weekendNoteContribution(ev, spec.galaxyId, gain)
    else gain = 0
  } else {
    gain = outcome === 'offlineRepel' ? WEEKEND_GAIN_OFFLINE_REPEL : WEEKEND_GAIN_REPEL
    weekendNoteContribution(ev, spec.galaxyId, gain)
  }

  const res: WeekendResolveResult = { progressGain: gain, note: '' }

  // 旗舰：**BOSS 口径 ⇒ 池子打空才算击沉**（单场不死）；老口径 ⇒ 核心已满 + 打赢即击毁
  if (spec.kind === 'flagship' && (bossDown || (outcome === 'win' && !weekendIsBossFamily(ev)))) {
    if (weekendNoteFlagshipKilled(state, nowWallMs)) {
      /**
       * **击杀 BOSS ⇒ 黑匣必给 1 枚**（**2026-09-28 船长令**：「让玩家击杀BOSS就能获得黑匣，
       * 取消之前的复杂判定」）—— 这里**不再掷骰**；残骸照旧必给 ×3（船长 2026-09-25 四答之三"残骸不变"）。
       * 走到这里 = 玩家把共享血池打空（或非 BOSS 族的老口径取胜）⇒ 击杀成立。
       */
      res.flagshipKilled = { blackBox: true, wreck: weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK) }
      res.note = bossDown ? '旗舰血量归零：击沉（跨场累计）· 黑匣入手' : '旗舰被击毁：战利品归玩家（含黑匣）'
      return res
    }
  }

  // 夺回：这一次越过 100% ⇒ 只记下"这处刚夺回"这件事（**金额不在这里算**：按最终投入比例，见 `weekendReclaimAwardOf`）
  if (!wasReclaimed && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1) {
    const allClear = weekendOccupiedIds(ev).every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
    res.reclaimed = { galaxyId: spec.galaxyId, allClear }
    res.note = allClear ? '全部占领区夺回：全清追加待结算' : '该星系夺回：奖励待结算'
  } else if (res.note === '') {
    res.note = outcome === 'win' ? '推进进度' : '击退遇袭'
  }
  /**
   * **每场入侵战斗的进度反馈**（**2026-09-25 船长批「甲」**）。
   *
   * 起因（船长真档实测）：主动出击胜利**原来一句日志都没有**（`expedition.ts` 丢弃本函数的返回值，
   * 只有"夺回/旗舰"才写日志）⇒ 玩家连清同一处时，除了星图上该星系那条细进度条**没有任何反馈**，
   * 而活动栏那三块读数（外围夺回 X/Y · 核心 % · 已夺回 N/M）都是"满 100% 才 +1"的计数 ⇒
   * 观感就是「重复清缴不加进度条」（玩家报障原话）。
   *
   * 口径：
   * - **夺回**那一场不写本行（上面已有 `✦ 夺回…` 那条，说了更重要的信息）；
   * - **战败**（gain = 0 且非门禁）不写（进度本来就没动，避免噪声）；
   * - **核心门禁**未解 ⇒ 写"本次不计进度"那一行（`core.weekend.036`），把白打讲明白；
   * - 读数取**该星系自己的进度**（与星图/星系详细同源 `weekendProgressAt`，含 NPC 铺底）。
   *
   * 🔴 **级别 = `combat`**（**船长 2026-09-26 裁决**：「**「事件日志重新分类」以一号为优先。**」）——
   * 本条曾按同日另一条令（「**包括玩家夺回进度的更新**」）从 `info` 提为 `warn`，现按本条裁决**改回
   * `combat`**：与"事件日志重新分类"那批（战斗/工业/舰队/打捞四类）保持同一分类口径，不让同一类
   * 日志分在两个页签里。⚠ 两条令的先后与取舍见 `docs/development-conventions-changelog.md`。
   */
  if (res.reclaimed === undefined) {
    const gname0 = ctx.galaxies.get(spec.galaxyId)?.name ?? spec.galaxyId
    if (gain > 0) {
      const pctBefore = Math.round(beforePct)
      const pctAfter = Math.round(weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100)
      /**
       * ⚠ **合并解冲突（2026-09-26）**：两边改的是**同一格的档位**，只能取一个 ——
       * **取我方 `warn`**（船长 2026-09-26 明令「**包括玩家夺回进度的更新**」⇒ 提到警告档、要醒目）；
       * main 侧（一号「事件日志重新分类」）把这两条归入 `combat`。**两条裁定不同源、待船长确认**：
       * 按「新令压旧令」先落 warn；若船长要跟一号的分类走，把下面两处 `'warn'` 改回 `'combat'` 即可。
       */
      /**
       * 🔴 **档位 = `combat`**（**船长 2026-09-26 裁决**：「**「事件日志重新分类」以一号为优先。**」）——
       * 与本文件里其余战斗类日志同一档；原先我曾按同日另一条令提为 `warn`，现按本条裁决改回 `combat`。
       */
      addLog(state, 'combat', `✦ ${gname0}：夺回进度 ${pctBefore}% → ${pctAfter}%`, 'core.weekend.035', {
        p1: gname0,
        p2: pctBefore,
        p3: pctAfter,
      })
    } else if (gatedThisBattle) {
      /** 同上：`combat`（与 `.035` 那条同一裁决） */
      addLog(state, 'combat', `✦ ${gname0}：外围未清完，本次不计夺回进度`, 'core.weekend.036', { p1: gname0 })
    }
  }
  return res
}

export function peripheryCleared(state: GameState, ev: WeekendEventState, nowWallMs: number): boolean {
  return ev.peripheryIds.every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

export interface WeekendSettlePlan {
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  wreck: number
  isk: number
  /**
   * **进度收入**（2026-09-25 船长令「在结算时候直接按进度获取收入」；单价 20 万/1%，
   * 只结玩家投入那一份 —— 见 `weekendEvent.WEEKEND_PROGRESS_ISK_PER_PCT`）。
   * 与贡献四档奖**并列**、一起在结束那一刻发放。
   */
  progressIsk: number
  /** 玩家参与度（玩家投入合计 ÷ 该场"打满一处"的进度量）*/
  progressPct: number
  /** 玩家是否击毁了旗舰（⇒ 黑匣归玩家；章鱼人得手 ⇒ 黑匣归零） */
  blackBoxToPlayer: boolean
}

/** 结束结算：按贡献占比发奖（Q5 四档）＋ 进度收入；黑匣只在"玩家击毁"时给 */
export function weekendSettlePlanOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): WeekendSettlePlan {
  const share = weekendContributionShareAt(state, ev, nowWallMs)
  const tier = weekendContributionTier(share)
  return {
    share,
    tier: tier.tier,
    wreck: weekendRareWreckUnits(tier.wreck),
    isk: tier.isk,
    progressIsk: weekendProgressIncomeIsk(ev),
    progressPct: weekendPlayerContribution(ev),
    /**
     * **黑匣是否归玩家**（**2026-09-28 船长令改口径**）＝ **玩家击杀了 BOSS 就给**，
     * 判据取单点 `weekendEvent.weekendLastHitByPlayer`（留档优先）。
     * ⚠ 旧口径是"掷骰结果 `ev.flagshipBlackBox`"（章鱼人得手也可能爆、玩家击沉也可能不爆）——已作废。
     */
    blackBoxToPlayer: weekendLastHitByPlayer(ev),
  }
}

/** 贡献奖实发结果（`weekendSettleAndGrant` 的返回值） */
export interface WeekendSettleGrant {
  /** 贡献占比（0~1，按**结束时刻**评估） */
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  /** 实发（已入账）数量 */
  isk: number
  wreck: number
  /** 其中属于**进度收入**的那一部分（2026-09-25；面板/汇报要能分开说） */
  progressIsk: number
}

/**
 * **战果快照**（结束时写一次 · 每场覆盖）：结算面板与结算通讯读它。
 * 逐处占领区的读数**按结束时刻**取（与贡献占比同一把尺）⇒ 面板上的"贡献 x%"与档位算得对得上。
 */
export function weekendResultSnapshotOf(
  state: GameState,
  ctx: SimContext,
  ev: WeekendEventState,
  atWallMs: number,
  plan: WeekendSettlePlan,
  wreckItemId?: string,
  /**
   * **本场那一枚黑匣的物品 id**（**2026-10-02 船长令「甲」**，按族给）——
   * 写进快照 ⇒ 结算面板与结算信（`weekendRewardLinesOf`）显示的是**玩家真到手的那一件**
   * （光环期显示「光环旗舰黑匣」而非墨潮）。缺省 = 本批之前结束的场次（那时只有墨潮一件）。
   */
  blackBoxItemId?: string,
): WeekendResultSnapshot {
  const led = ev.rewardLedger ?? { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} }
  const galaxies = weekendOccupiedIds(ev).map((galaxyId) => {
    const put = ev.contributed[galaxyId] ?? 0
    const progress = weekendProgressAt(state, ev, galaxyId, atWallMs)
    const g = led.byGalaxy[galaxyId] ?? { isk: 0, wreck: 0 }
    return { galaxyId, put, progress, reclaimed: progress >= 1, isk: g.isk, wreck: g.wreck }
  })
  const hpMax = ev.flagshipHpMax
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  /**
   * **归属 = 一处判据**（`weekendEvent.weekendFlagshipOutcomeOf`，**留档优先**）：
   * 有"玩家亲手击沉"的留档 ⇒ 一律玩家击沉（与池子算术无关）；否则读 `flagshipDown`；
   * 都没有 ⇒ 窗口到点。引擎结束那一刻的日志读**同一个**它（免得界面一处、报告一处各判一遍）。
   */
  const playerKill = ev.flagshipPlayerKill
  const flagshipOutcome: WeekendResultSnapshot['flagshipOutcome'] = weekendFlagshipOutcomeOf(ev)
  /**
   * `defeated` = **这面「已击沉 / 未击沉」的判据与黑匣同源**（代码见下面 `flagshipOutcome === 'player'`）。
   * ⚠ **2026-09-28 更正注释**：这里原先写「＝`flagshipDown === 'player'`」——那是**半套判据**
   * （2026-09-28 报障那一场正是"留档说玩家打爆了、`flagshipDown` 却是 `octopus`"），
   * 代码读的是**单点**`weekendFlagshipOutcomeOf`（留档优先），面板才不会与结算信打架。
   *
   * ⚠ **2026-09-25 船长报障修**：原判据写的是 `hpDone >= hpMax`（**玩家自己打的那份 ≥ 池子总量**）——
   * 那是"共享血条"落地**之前**的口径。改共享血条后，血条 = `池子 −（玩家 ＋ 章鱼人）`，
   * 船长的规则是「**玩家的这一击把血条打空**（哪怕前面已被章鱼削掉一半）就算**玩家击沉**」（见
   * `weekendEvent.weekendFlagshipDefeated` 的注释）。船长实录：`hpDone = 149,385` ＋ 章鱼 `615.25`
   * ⇒ 血条清零、`flagshipDown = 'player'`、**黑匣照发**，可面板照旧算 `149,385 < 150,000` ⇒
   * 打出「**未击沉**」＋ 奖励里却有旗舰黑匣 —— 一句话自相矛盾（船长原话：
   * 「入侵结算内，显示我未击沉，且给了我一个旗舰黑匣」）。
   * ⇒ 判据改为**读结局**（与 `weekendSettlePlanOf.blackBoxToPlayer` 同一把尺），面板与实发从此一致。
   */
  const flagship =
    hpMax !== undefined
      ? (() => {
          /** 两份占比走**玩家优先**口径（船长 2026-09-27：玩家允许挤掉章鱼人的输出） */
          const shares = weekendFlagshipSharesOf(ev)
          return {
            hpMax,
            hpDone,
            defeated: flagshipOutcome === 'player',
            playerFrac: shares.player,
            octopusFrac: shares.octopus,
          }
        })()
      : undefined
  void ctx // 目前不需要 ctx（星系名由界面现查）；保留参数位以免将来解析物品时改签名
  /**
   * **本期入侵按贡献获得的协会声望**（**2026-09-26 船长令**：「关于入侵的结算界面和结束通讯处，
   * 需要提及玩家获得了多少声望」）——**与实发同源**：同一条公式 `round(占比 × 15)`，
   * 结算那一拍（`weekendSettleAndGrant`）用它发、快照用它写 ⇒ 面板与信件上的数 = 真正加进账的数。
   */
  const standingGain = weekendStandingGainOf(ev, plan.share)
  return {
    seq: ev.seq,
    family: ev.family,
    coreId: ev.coreId,
    endedAtWallMs: atWallMs,
    flagshipOutcome,
    share: plan.share,
    tier: plan.tier,
    galaxies,
    ...(flagship !== undefined ? { flagship } : {}),
    /** 玩家亲手击沉的留档（换场即随事件对象消失；面板/通讯读它说"谁打沉的"） */
    ...(playerKill !== undefined
      ? { flagshipPlayerKill: { atWallMs: playerKill.atWallMs, ...(playerKill.waveIdx !== undefined ? { waveIdx: playerKill.waveIdx } : {}) } }
      : {}),
    // **进度收入**（2026-09-25）：读数与实发同源（同一对纯函数）⇒ 面板上的数与到账的数一致
    progressPct: weekendPlayerContribution(ev),
    progressIsk: plan.progressIsk,
    ...(standingGain > 0 ? { standing: standingGain } : {}),
    isk: led.isk,
    wreck: led.wreck,
    blackBox: led.blackBox,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
    /** 本场那一枚匣是哪一件（按族；缺省 = 老快照 ⇒ 面板/信件按落款墨潮匣显示，与史实一致） */
    ...(blackBoxItemId !== undefined ? { blackBoxItemId } : {}),
  }
}

/**
 * **活动结束 ⇒ 贡献奖结算 ＋ 真正入账**（设计稿 ⑥「结束与结算」· M1-b 收尾 · 2026-09-25）。
 *
 * 设计稿原文：「结束时：① 统计贡献占比 → 发贡献奖 ② 玩家击毁 ⇒ 另发黑匣 ＋ 稀有残骸 ③ 所有占领恢复」。
 * 其中 ② 的**黑匣与旗舰残骸在"击沉那一刻"就发了**（`weekendApplyBattleOutcome` 的 `flagshipKilled`）
 * ⇒ 这里**不重复发**，只发 ① 的贡献四档奖（Q5：≥80% ⇒ ×12＋8M · 50~80% ⇒ ×8＋5M ·
 * 20~50% ⇒ ×4＋2M · <20% ⇒ ×1 · **0% ⇒ 无**）。
 *
 * 三条口径：
 * - **按结束时刻评估**（`ev.endedAtWallMs`）：NPC 铺底是**时间函数**，玩家离线几天后再结算会把铺底算高
 *   ⇒ 占比被算低、奖励少发；锁在结束那一刻则与"结束时统计"逐字一致，且**重复调用读数恒定**；
 * - **幂等**：`ev.prizePaidAtWallMs` 随档落盘 ⇒ 引擎每拍调、离线跨过结束点后补调，都只会发一次
 *   （0% 也算"已结"：标记照写，免得每拍重算）；
 * - **残骸物品 id** 取本族**旗舰卡**所属残骸组（`wreck-rare-h-hi` 一类；与旗舰掉落同一件）——
 *   解析不到就**不发**（绝不发不存在的 id，见 `weekendRareWreckIdFor` 的旧账）。
 *
 * 返回 `null` = 什么都不用做（没有入侵 / 还没结束 / 已经结过）。
 */
export function weekendSettleAndGrant(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): WeekendSettleGrant | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs === undefined) return null
  if (ev.prizePaidAtWallMs !== undefined) return null
  weekendSyncReclaimRewards(state, ev, ev.endedAtWallMs)
  const plan = weekendSettlePlanOf(state, ev, ev.endedAtWallMs)
  const wreckItemId = weekendRareWreckIdFor(weekendFoeCardOf(ev.family, 'flagship'), ctx)
  /**
   * **这一次把"贡献奖 ＋ 待到账的夺回奖励"一起发**（2026-09-25 船长令：夺回奖励不即时发、结束统一发）。
   * ⚠ 台账 `rewardLedger` 在夺回那一刻**就已经记过**那几笔 ⇒ 这里只把 `plan`（贡献奖）记进台账，
   * 否则总数会被算两遍；`reclaimPending` 发完清零。
   */
  const pending = ev.reclaimPending ?? { isk: 0, wreck: 0 }
  /** **这一场该显示哪一件匣**（按族 · 2026-10-02 船长令「甲」）。 */
  const boxItemId = weekendBlackBoxItemIdOf(ev, ctx)
  /**
   * **这一笔发三样**：贡献四档奖（`plan`）＋ 待到账的夺回奖励（`pending`）＋ **进度收入**（`plan.progressIsk`，
   * 船长 2026-09-25「按进度获取收入」）。
   */
  const granted = weekendGrantRewards(state, {
    isk: plan.isk + pending.isk + plan.progressIsk,
    wreck: plan.wreck + pending.wreck,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  ev.prizePaidAtWallMs = nowWallMs
  ev.reclaimPending = { isk: 0, wreck: 0 }
  /**
   * **按贡献占比发协会声望**（**2026-09-26 船长令**：「**玩家完成入侵后根据贡献获得一定量声望**」）。
   *
   * 口径 = `round(占比 × 15)`（单场 **0~15 点**）：占比 100% ⇒ 15 · 83% ⇒ 12 · 50% ⇒ 8 · 10% ⇒ 2 · 0% ⇒ 0。
   * 走 `noteStandingEarned` 唯一入口 ⇒ **两条账同时加**（可支配 ＋ 累计）。
   * ⚠ 与"贡献四档奖"同在一处（`prizePaidAtWallMs` 保证只走一遍）⇒ 声望也跟着**只发一次**。
   */
  const standing = weekendStandingGainOf(ev, plan.share)
  if (standing > 0) noteStandingEarned(state, DSI_FACTION_ID, standing)  /** 贡献奖与进度收入入账 ⇒ 记进到手台账，并**写本场战果快照**（面板与结算通讯读它） */
  /**
   * ⚠ **残骸只记"贡献奖那一份"**（`granted.wreck − pending.wreck`）——
   * 上面那两行注释早就警告过"总数会被算两遍"，只因以前 `pending` 恒为 0 从未暴露；
   * **2026-09-27 修夺回奖后 pending 真有钱了**，再写 `granted.wreck` 就会让台账多出夺回那一份
   * （实测：快照 1410 m³ vs 仓库实数 930 m³，差的就是夺回那 480）。
   * ISK 那半本来就只记 `plan`，无需改。
   */
  noteReward(ev, undefined, {
    isk: plan.isk + plan.progressIsk,
    wreck: Math.max(0, granted.wreck - pending.wreck),
  })
  state.weekendLastResult = weekendResultSnapshotOf(state, ctx, ev, ev.endedAtWallMs, plan, wreckItemId, boxItemId)
  return { share: plan.share, tier: plan.tier, isk: granted.isk, wreck: granted.wreck, progressIsk: plan.progressIsk }
}
