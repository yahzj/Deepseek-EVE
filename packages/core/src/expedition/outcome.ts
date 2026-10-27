/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import { lairAnomalyOf, factionAnomalyOf, lairBaseRewardIsk, factionBaseRewardIsk, LAIR_RARE_WRECK_GAIN, factionRareDropChanceOf, FACTION_RARE_DROP_PITY_ROLLS, FACTION_RARE_DROP_COUNT } from '../lairs'
import { weekendBattleInvolvedOf } from '../weekendBattle'
import { ceilFinalQuantity } from '../quantity'
import { rewardMulOf } from '../tuning'
import { settleDroneLosses, refundAmmo, refundRepairKitsAll, persistFleetHullDamage, repairUsageText, dcUsageText, captureBattleReport } from '../combat'
import { droneBattleOutcome, stopAutoLoopReason, autoLoopInvasionGalaxy, stopAutoLoopInvasion } from './loopState'
import { formatDurationMs } from '../time'
import { nextRandom, pickOne } from '../rng'
import { addItem } from '../inventory'
import { bumpFirst } from '../firstTasks'
import { weekendWreckInjectionOf, bountyWreckInjection, wreckInjectThreatOf, bountyEnemyCount, injectWeekendWreck, asFoeFamily, injectWreckDensity, weekendWreckDensityOf, wreckDensityOf, injectRareWreck } from '../salvage'
import { weekendWreckPenaltyFracOf } from '../weekendEvent'
import { noteStandingEarned, DSI_FACTION_ID } from '../standing'
import { settleBountyTaskVictory } from '../sideTasks'
import { setBountyCooldown } from './cooldown'
import { returnBackMs, LOCAL_RETURN_MS } from './travel'
import { RETURN_LEG_MUL } from '../balance'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from '../jumpFuel'
import { abandonChance } from './tactics'
import { loseShip } from '../shipyard'
import { shipDisplayName } from '../instances'

/** 漂流物打捞学（salvage-diving）：远征缴获物资数量系数，每级 +12%（主控与 AI 同享） */
export function lootFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  return 1 + 0.12 * lv
}

/** 赏金猎手学（bounty-hunting，2026-09-04 补全）：悬赏奖金加成系数，每级 +8%（满级 ×1.4） */
export function bountyRewardFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['bounty-hunting'] ?? 0)
  return 1 + 0.08 * lv
}

/** 交火结束结算（主控）：奖励/惩罚 → 转返航 */
export function resolveBattleOutcome(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  const battle = exp.battle
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  if (!battle || !anomaly) {
    exp.active = false
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined
    return
  }
  const won = battle.ended === 'me'
  const galaxy = ctx.galaxies.get(exp.foeGalaxyId ?? anomaly.galaxyId)
  // 赏金任务·窝点（2026-09-10）：本场是否打的是派生窝点，档位来自出击时锁定的 exp.lairTier。
  // 战报/奖金/残骸投放/失利维修费统一按"本场实际目标卡"走（窝点 = 主题悬赏按档位强化），
  // 避免"打了窝点却按主题悬赏报账"。普通悬赏 battleCard === anomaly，行为与旧版一致。
  const lairTier = exp.lairTier
  // 敌对派系活跃（2026-09-10 船长定）：本场打的是当日选中星系的常驻悬赏 → 威胁已 ×1.1（battleAnomalyOf），
  // 这里把奖金也 ×1.1（展示=到账口径），并在胜利后按概率掉稀有残骸。
  const factionActive = exp.factionActive === true
  const card0 = lairTier ? lairAnomalyOf(anomaly, lairTier, ctx.balance.battle) : anomaly
  const battleCard = factionActive ? factionAnomalyOf(card0) : card0
  const displayName = battleCard.name
  /**
   * **这一场是不是入侵战斗**（2026-09-25 船长令「**入侵舰队不应该有赏金**」）——
   * 判据走既有单点 `weekendBattleInvolvedOf`（远征落盘 `foeGalaxyId` 优先）；
   * 入侵场次**当场一分钱都不给**：收入改在活动结束时按进度统一结算
   * （`WEEKEND_PROGRESS_ISK_PER_PCT`），残骸也改记**独立池**（见下面的注入分支）。
   */
  const weekendInvolved = weekendBattleInvolvedOf(state, ctx, anomaly.id, state.wallMs ?? Date.now())
  const isInvasion = weekendInvolved !== undefined
  const baseRewardIskRaw = isInvasion
    ? 0
    : lairTier
      ? lairBaseRewardIsk(anomaly, lairTier)
      : factionActive
        ? factionBaseRewardIsk(anomaly)
        : /**
           * **入侵"主动出击每场重抽"的价钱口径**（2026-09-25）：敌舰每场换，但奖励恒 = 该星系原卡 ×1.4
           * ⇒ 出发时算好写进 `exp.rewardIskOverride`，这里优先用它；老路径（没写）逐字不变。
           * ⚠ 2026-09-25 当日晚些时候船长令「入侵舰队不应该有赏金」⇒ 入侵场次走上面的 `0` 分支，
           * 本式只服务非入侵的普通悬赏（`rewardIskOverride` 于是不再有调用方，保留不删以免动到老档路径）。
           */
          (exp.rewardIskOverride ?? anomaly.rewardIsk)
  // 限时倍率（2026-09-15）：`rewardIsk` 乘在悬赏结算基底上（窝点/派系/普通三支共用这一处）
  const baseRewardIsk = Math.max(0, ceilFinalQuantity(baseRewardIskRaw * rewardMulOf(state)))
  // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）：胜负/撤退一律照扣，
  // 且要在战报文案之前落账（战报要引用损失摘要）
  const droneLostText = settleDroneLosses(state, ctx, state.shipId, battle)
  // 机群战损过大 → 停重复清剿（永久损失制安全阀：2026-09-10 船长拍板）；读数与判定走单点（见下）
  const {
    before: droneBefore,
    after: droneAfter,
    attrition: droneAttritionRaw,
  } = droneBattleOutcome(state, battle)
  const droneAttrition = droneAttritionRaw && state.autoLoopAnomalyId === exp.anomalyId
  if (droneAttrition) {
    /** 补货**之后**的实载（用于文案：自动补足了没有；货源不足时差多少） */
    const droneNow = Object.values(state.fleet[state.shipId]?.droneLoad ?? {}).reduce((s, n) => s + n, 0)
    stopAutoLoopReason(
      state,
      droneNow >= droneBefore
        ? `机群战损过半（${droneBefore} → ${droneAfter} 架）——机群已自动补充到 ${droneNow} 架，确认配装后可重新开启重复清剿。`
        : `机群战损过半（${droneBefore} → ${droneAfter} 架）——货仓与物品仓库存货不足以补满（现 ${droneNow} 架），补充无人机后可重新开启重复清剿。`,
      droneAfter, // 记下停环时的机群架数（**补货前**）⇒ 再开前必须"确实补过货"（船长 2026-09-18）
    )
  }
  refundAmmo(state, battle.ammo, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 退回
  refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
  // P0 承伤持久化：先落装甲/结构残余（结构=耐久），失利附加扣损在其后叠加
  persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    /**
     * **实战胜利记录**（2026-09-24 船长令：「**③按敌卡。记录残血最多的一次，如果都是满血则不覆盖。
     * 夹回当前射程内。**」）——胜率预估"打过的卡按打过的距离算"那一支的**唯一写入点**：
     * 只在**真打赢**这一支写（模拟评估是只读克隆、根本不进本函数 ⇒ 不会自证）；
     * 键 = **本场目标卡 id**（窝点/派系是本卡的派生强化，按同一张卡记账，与星图卡片列表一致）；
     * 距离 = **本场实际期望距离**（`battle.myDesireM`，开战处已夹进当次射程），消费时再按现射程夹一道；
     * 剩余比例 = **（装甲 + 结构）÷ 满值**（护盾每场满值重建、不进分子；满值 = `hpMax`，即该舰未受损的值）。
     * **只在更高时覆盖**：`>` 严格比较 ⇒ 等值（含"两次都满血"）不写 ⇒ 记录稳定、不会来回抖。
     */
    const recNow = ((): number => {
      const u = battle.units['player']
      if (!u) return 0
      const cur = Math.max(0, u.hp.a) + Math.max(0, u.hp.h)
      // 老档/异常缺 `hpMax` ⇒ 回落当前值（当次读作满血，与视图血条的兜底同口径）
      const fullRef = u.hpMax ?? u.hp
      const full = Math.max(1, fullRef.a + fullRef.h)
      // 取到万分位：存档里不留浮点尾数（也让"两次几乎一样"的胜利稳定地判为等值、不来回改写）
      return Math.round(Math.min(1, Math.max(0, cur / full)) * 10_000) / 10_000
    })()
    const recPrev = state.winRecord?.[anomaly.id]
    if (battle.myDesireM > 0 && recNow > (recPrev?.remainPct ?? -1)) {
      state.winRecord = { ...(state.winRecord ?? {}), [anomaly.id]: { desireM: battle.myDesireM, remainPct: recNow } }
    }
    // ── 胜利：奖金（**无浮动 = 卡片展示值**，2026-09-10 船长）+ 情报彩蛋 + 战利品 + 声望 ──
    // rewardJitter 现为 0 → roll 恒为 1，展示口径（卡片 `rewardIsk × bountyRewardFactor`）即到账口径；
    // 保留本式以便将来需要时一行调回（唯一随机奖励 = 情报彩蛋 +10%，会在日志里说明）
    const jitter = ctx.balance.rewardJitter
    const roll = 1 - jitter + 2 * jitter * nextRandom(state.rng)
    let reward = Math.max(0, ceilFinalQuantity(baseRewardIsk * roll * bountyRewardFactor(state)))
    if (nextRandom(state.rng) < 0.15) {
      /** 三句彩头各挂 id（中文原串照写；`p1Id` 让英文侧也按语言出词） */
      const texts = [
        { text: '舰队返航时打捞到一枚漂流信标，协会收购了上面的航路情报', id: 'core.expedition.048' },
        { text: '编队顺手清理了一块导航浮标，空间站维修部发来感谢金', id: 'core.expedition.049' },
        { text: '舰载传感器捕获一段加密信号，协会情报处兑换了报酬', id: 'core.expedition.050' },
      ] as const
      const picked = pickOne(state.rng, texts)!
      const text = picked.text
      const bonus = ceilFinalQuantity(reward * 0.1)
      reward += bonus
      addLog(state, 'trade', `◆ ${text}（+${bonus.toLocaleString('zh-CN')} 信用点）`, 'core.expedition.047', {
        p1: text,
        p1Id: picked.id,
        p2: bonus.toLocaleString('zh-CN'),
      })
    }
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, ceilFinalQuantity(row.units * lootMul))
      addItem(state, row.itemId, units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${units}`)
    }
    state.wallet.isk += reward
  bumpFirst(state, 'bountyWins') // 第一次任务/链：讨伐胜场
    // B3 击杀注入（2026-09-10 船长定）：注入口径体量（`wreckThreat` ?? 威胁）×0.4 × (1 + 0.2×敌人数)，
    //   无上限（窝点按强化后威胁算）；**体量走 `wreckInjectThreatOf`** ⇒ 2026-09-25「冻结残骸经济」后
    //   改 `threat` 不再牵动回收线（见 `AnomalyDef.wreckThreat`）
    /**
     * **注入目标 = 这一场所在的星系**（2026-09-25 修）：入侵战斗的卡可能"不属于"它被打的那片星域
     * （H 族独立卡自带母港 `galaxy-hub`）⇒ 先问入侵归属（上面算好的 `weekendInvolved`），问到就用它的星系；
     * 非入侵战斗回落卡的星系（既有口径，逐字不变）。
     */
    const wreckGalaxyId = weekendInvolved?.galaxyId ?? anomaly.galaxyId
    /**
     * **残骸注入：入侵走独立池，普通悬赏走星系池**（船长 2026-09-25）：
     * 「入侵……添加的残骸是原星系的残骸密度，**需要独立的残骸条**（入侵残骸没有星系的残骸保底，
     * 因为随时间消减到最后会消失）」＋「**按照击败卡的威胁注入**」⇒ 注入量公式一字不改
     * （`weekendWreckInjectionOf` = 悬赏那条唯一公式），只是**记到另一个池子**里去。
     */
    const wreckInjected = isInvasion
      ? /**
         * **已夺回的星系 ⇒ 残骸半量**（**2026-10-02 船长令**：「我希望的是 100% 后能够继续刷，
         * 但是掉落残骸数量需要减半作为惩罚」）——折扣走单点 `weekendWreckPenaltyFracOf`
         * （进度满 ⇒ 0.5、否则 1）。⚠ 遇袭 / 旗舰挑战走遭遇结算、本来就是 0.5，不读这里。
         */
        weekendWreckInjectionOf(
          battleCard,
          state.weekendEvent !== undefined
            ? weekendWreckPenaltyFracOf(state, state.weekendEvent, wreckGalaxyId, state.wallMs ?? Date.now())
            : 1,
        )
      : bountyWreckInjection(wreckInjectThreatOf(battleCard), bountyEnemyCount(battleCard))
    // 来源族（2026-09-26 玩家报障）：击败的是哪一族就记哪一族 —— 打捞型号池据此在该星系
    // **即使已夺回 / 活动已结束**也并入那一族的独立入侵卡（残骸场比占领活得久）
    if (isInvasion) {
      injectWeekendWreck(
        state,
        wreckGalaxyId,
        wreckInjected,
        asFoeFamily(battleCard.foeFamily) ?? asFoeFamily(state.weekendEvent?.family),
      )
    }
    else injectWreckDensity(state, ctx, wreckGalaxyId, wreckInjected, battleCard.id)
    const wreckNow = isInvasion
      ? weekendWreckDensityOf(state, wreckGalaxyId)
      : wreckDensityOf(state, wreckGalaxyId, ctx)
    // 声望仅首胜发放（防低威胁目标被无限重复白刷声望；重复完成只拿 ISK/战利品）
    const firstBlood = !state.completedBounties.includes(anomaly.id)
    if (firstBlood) {
      // 声望获得走唯一入口（2026-09-26 起：**两条账同时加**——可支配 ＋ 累计）
      noteStandingEarned(state, DSI_FACTION_ID, anomaly.standingGain)
      state.completedBounties.push(anomaly.id)
    }
    const stats = `交火 ${durTxt}（开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}，我方护盾余 ${Math.round(battle.units['player']?.hp.s ?? 0)}/甲 ${Math.round(battle.units['player']?.hp.a ?? 0)}/结构 ${Math.round(battle.units['player']?.hp.h ?? 0)}）`
    const lootPart = lootText.length > 0 ? `，缴获 ${lootText.join('、')}` : ''
    const standPart = firstBlood ? `协会声望 +${anomaly.standingGain}` : '该悬赏已首胜过：本次无额外声望'
    const dronePart = droneLostText ? `，机群战损 ${droneLostText}` : ''
    // 船体维修装置：消耗数只进战报（2026-09-11 船长：不单独显示日志）
    const repairPart = (() => {
      const t = repairUsageText(battle, ctx)
      return t.length > 0 ? `，船体维修装置${t}` : ''
    })()
    /** 损伤管制装置：本场启动过就进战报（2026-09-25 船长令：战报单列一条） */
    const dcPart = (() => {
      const t = dcUsageText(battle, ctx)
      return t.length > 0 ? `，${t}` : ''
    })()
    // **结构化战报**（2026-09-14 船长定）：先把那句日志文案落到变量、再同时写日志与本记录
    // ⇒ 卡片正文与事件日志**逐字同源**（不再靠"找含『战报』二字的日志"那条脆弱做法）。
    /**
     * ⚠ **入侵场次另写一句**（2026-09-25 船长令「入侵舰队不应该有赏金……在结算时候直接按进度获取收入」）：
     * 旧文案里「奖金 N 信用点」在入侵场次恒为 0，照写就是"打了半天没钱还写个 0" ⇒ 换口径说明；
     * 残骸那一栏也改成**独立池**的读数（`入侵残骸沉积 X（本场 +Y）`），与星图上那条独立残骸条同源。
     */
    const winText = isInvasion
      ? `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！击退入侵舰队。${stats}${lootPart}${dronePart}${repairPart}${dcPart}，` +
        `本场无赏金：进度收入与夺回奖励在活动结束时统一发放。` +
        `入侵残骸沉积 ${wreckNow.toFixed(1)}（本场 +${wreckInjected.toFixed(1)}）`
      : `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！${stats}，奖金 ${reward.toLocaleString('zh-CN')} 信用点${lootPart}${dronePart}${repairPart}${dcPart}，${standPart}` +
        `。战场残骸密度 ${wreckNow.toFixed(1)}（本场 +${(battleCard.threat * 0.4).toFixed(1)}）`
    addLog(state, 'combat', winText)
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: winText })
    // 赏金任务·窝点结算（2026-09-10 船长定，排在战报之后）：①稀有残骸投放该星系残骸场
    // （按敌群记账、打捞必得）②命中本板该条赏金任务 → 酬金入账 + 下板 + 引导文案。
    // 投放不依赖任务是否还在板上：任务已过期也照样算窝点战果（打都打了，战利品不能吞）。
    if (lairTier) {
      injectRareWreck(state, anomaly.galaxyId, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier])
      settleBountyTaskVictory(state, ctx, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier])
    }
    // 敌对派系活跃（2026-09-10 船长定）：胜利后**按概率**掉稀有残骸（该星系残骸场、打捞必得）。
    // 这条**不因打赢而下板**（当天可反复刷），故只在命中时写一条日志说明掉了几件。
    // **保底（2026-09-11 船长定的机制；2026-09-20 船长把数值收紧为「每 10 次必出一个」）**：
    // 连续 9 次掷骰未出 ⇒ 第 10 次必掉（阈值走常量 `FACTION_RARE_DROP_PITY_ROLLS`，文案里的次数同源）。
    // 掷骰恒消耗一次随机数（保底触发时也掷、只取 `||`）——保持 rng 时序与未保底时一致，避免别的系统读数漂移。
    if (factionActive) {
      const streak = Math.max(0, Math.floor(state.rareWreckDryStreak ?? 0)) + 1
      // 限时倍率（2026-09-15）＋ 铁人 ×1.2（2026-09-23）：**两口乘区都走 `factionRareDropChanceOf`**
      // —— 读数（卡面 / `faction:audit`）与这里**同一函数**（2026-09-24 收口，见 `lairs.ts` 该函数注释）
      const hit = nextRandom(state.rng) < factionRareDropChanceOf(state)
      const pity = streak >= FACTION_RARE_DROP_PITY_ROLLS
      if (hit || pity) {
        injectRareWreck(state, anomaly.galaxyId, anomaly.id, FACTION_RARE_DROP_COUNT) // 内部清零空手计数
        /** 保底尾注（可选槽） */
        const pityTail = pity && !hit ? `（连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出，本次保底）` : ''
        addLog(
          state,
          'trade',
          `✦ 敌对派系活跃战果：${displayName} 的残骸里翻出稀有残骸 ×${FACTION_RARE_DROP_COUNT}` +
            `${pity && !hit ? `（连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出，本次保底）` : ''}` +
            `——可前往「${galaxy?.name ?? ''}」打捞（回站用回收炉解体可得额外战利品）。`,
          'core.expedition.051',
          {
            p1: displayName,
            p2: FACTION_RARE_DROP_COUNT,
            p3: pityTail,
            ...(pityTail !== '' ? { p3Id: 'core.expedition.052', p3p1: FACTION_RARE_DROP_PITY_ROLLS } : {}),
            p4: galaxy?.name ?? '',
          },
        )
      } else {
        state.rareWreckDryStreak = streak // 空手：累计（下次掷骰时判保底）
      }
    }
    // T8 悬赏冷却：结算时刻开始计时（与自动返航并行）
    setBountyCooldown(state, ctx, anomaly.id)
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined // 窝点一次性：结算完清档位，重复清剿回到主题悬赏（否则会无限复打窝点）
    exp.eventId = null
    exp.eventFired = false
    const targetGalaxy = exp.foeGalaxyId ?? anomaly.galaxyId
    const ret = returnBackMs(state, ctx, targetGalaxy)
    const rawBackMs = ret.ms > 0 ? ret.ms : exp.outMs * RETURN_LEG_MUL
    /** **跃迁燃料**（2026-09-29）：按**原返航时长**（不含燃料）每秒扣 1 单位，本趟倍率存进 `exp.fuelMul` */
    exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackMs)
    const backMs = jumpFuelLegMsOf(rawBackMs, exp.fuelMul)
    const baseName =
      ret.base === HOME_GALAXY_ID
        ? '母港'
        : ctx.galaxies.get(ret.base)?.name ?? ret.base
    exp.phase = 'back'
    exp.returnReason = 'victory'
    // 返航计时起点 = 战斗停表时刻（击杀/超时拍；2026-09-09 修复：此前按结算时的 state.gameMs
    // 起算——离线大步长下战斗结束即结算，离线剩余时间全部浪费，"上线才刚开始返航"）
    const endAt = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
    exp.returnAtGameMs = endAt
    exp.finishAtGameMs = endAt + backMs
    if ((ret.base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) && backMs !== LOCAL_RETURN_MS) {
      // ⟪文案调整 2026-10-22⟫ 加速/调试本地返航复用无固定报时日志，实际秒数由既有点火日志提供。
      addLog(state, 'fleet', '舰队开始返航（去程时间并入返航）。', 'core.expedition.027')
    } else if (ret.base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) {
      // 本地悬赏（2026-09-08 船长定）：目标星系即返航基准 → 固定返港段 120s，防零航程白刷
      addLog(
        state,
        'combat',
        '战果已入账：舰队返港中（本地悬赏返航段约 2 分钟，胜利返航不可召回）。',
        'core.expedition.026',
      )
    } else {
      addLog(
        state,
        'combat',
        `战果已入账：舰队自动返航「${baseName}」（去程并入返航 · 约 ${Math.max(1, Math.round(backMs / 60_000))} 分钟，胜利返航不可召回）——到站自动卸货入仓库，可维修或让重复清剿自动续打。`,
        'core.expedition.053',
        { p1: baseName, p2: Math.max(1, Math.round(backMs / 60_000)) },
      )
    }
    return
  } else {
    // 失利：扣耐久 + 弃船骰 + 维修费（沿用旧机制）；若正处于重复清剿环 → 停环
    if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
      stopAutoLoopReason(state, '本次出击失利，舰队自动返航（可修整后再开）。')
    }
    if (autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined) {
      stopAutoLoopInvasion(state, '本次出击失利，舰队自动返航。', 'core.invasionLoop.004')
    }
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[state.shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 1
    let abandoned = false
    if (durabilityAfter <= 0) {
      abandoned = true
    } else if (nextRandom(state.rng) < abandonChance(state, battleCard.threat, ctx)) {
      abandoned = true
    }
    if (abandoned) {
      // 弃船：无维修费，船+货仓+装备全损
      const abandonRepair = repairUsageText(battle, ctx)
      const abandonDc = dcUsageText(battle, ctx)
      const abandonText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：遭重创（交火 ${durTxt}${abandonRepair.length > 0 ? `，船体维修装置${abandonRepair}` : ''}${abandonDc.length > 0 ? `，${abandonDc}` : ''}）……`
      addLog(state, 'combat', abandonText)
      // 战报（2026-09-14）：弃船 = 我方全灭那一档 ⇒ `lose`；沉船名单走推导（三层血已归零）
      captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: abandonText })
      loseShip(
        state,
        state.shipId,
        ctx,
        `远征失利（${galaxy?.name ?? ''}·${displayName}）后遭追击`,
        // 2026-09-26：正常星系损毁 ⇒ 在这一格留「<船名>的残骸」（`foeGalaxyId` 优先 =
        // 打的是被占星系的驻留舰队时落在那个星系；缺省回落到本场目标卡所在星系）
        exp.foeGalaxyId ?? anomaly.galaxyId,
        { cause: 'expedition-lost' },
      )
      exp.active = false
      exp.battle = null
      exp.anomalyId = null
      exp.lairTier = undefined
    exp.factionActive = undefined
      return
    }
    if (fleetShip && loss > 0) {
      fleetShip.durability = Math.max(0, Math.round((fleetShip.durability - loss) * 1000) / 1000)
    }
    // 维修费按本场目标强度计（窝点 = 强化后奖金 × 比例）：越硬的窝点打输越贵，与"酬金跟强度"同口径
    const repair = Math.min(state.wallet.isk, ceilFinalQuantity(baseRewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const shipName = shipDisplayName(state, ctx, state.shipId)
    const dronePartLose = droneLostText ? ` 机群战损 ${droneLostText}（永久损失）。` : ''
    const loseRepair = repairUsageText(battle, ctx)
    const loseDc = dcUsageText(battle, ctx)
    const loseText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：失利（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）……${shipName} 耐久 -${Math.round(loss * 100)}%，维修花去 ${repair.toLocaleString('zh-CN')} 信用点。${loseRepair.length > 0 ? `船体维修装置${loseRepair}。` : ''}${loseDc.length > 0 ? `${loseDc}。` : ''}${dronePartLose}练练炮术学，记得给船做保养。`
    addLog(state, 'combat', loseText)
    // 战报（2026-09-14）：走到这里就是"打输了、船没沉"⇒ `lose`（沉船那一支在上面 return 了）
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: loseText })
  }
  // 转返航（2026-09-08：基准 = 目标星系最近已建成站；本地 = 固定 120s；失利返航可召回）
  exp.battle = null
  exp.lairTier = undefined
    exp.factionActive = undefined // 窝点档位随本场结束作废（含失利；任务仍在板上可再打一次）
  exp.phase = 'back'
  exp.returnReason = 'defeat'
  // 返航计时起点 = 战斗停表时刻（2026-09-09 修复：同胜利路径——离线大步长下不让离线剩余浪费）
  const endAtD = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtD
  const retD = returnBackMs(state, ctx, exp.foeGalaxyId ?? anomaly.galaxyId)
  const rawBackD = retD.ms > 0 ? retD.ms : exp.outMs * RETURN_LEG_MUL
  /** 跃迁燃料（同胜利路径；失利返航照吃 —— 玩家开的是"这个活动用燃料"，不是"打赢才用"） */
  exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackD)
  exp.finishAtGameMs = endAtD + jumpFuelLegMsOf(rawBackD, exp.fuelMul)
  addLog(state, 'fleet', '舰队开始返航（去程时间并入返航）。', 'core.expedition.027')
}
