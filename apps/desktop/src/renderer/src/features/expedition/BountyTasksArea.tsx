/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameEngine } from '../../game/engine'
import { type ToastFn, MONEY_GLYPH } from '../../pages/common'
import { standingOf, DSI_FACTION_ID, type SideTask, factionAnomalyOf, bountyDamageForecast, bountyWinPercentGuarded, factionBaseRewardIsk, isExplored, bountyCooldownRemainingMs, calcPower, factionRareDropChanceOf, FACTION_RARE_DROP_COUNT, lairAnomalyOf, LAIR_RARE_WRECK_GAIN, ceilFinalQuantity, lairBaseRewardIsk, bountyRewardFactor, isLairCandidate, lairLevelOf } from '@whale/core'
import { useState, useRef } from 'react'
import { useFoeArtFit, FoeArt, foeCardShipIdOf, secTone, secText } from '../../panels/StarMap'
import { cmdText, tr } from '../../i18n/locale'
import { lairTierText } from '../../ui/labelsText'
import { fmtDayClock } from '../../i18n/fmt'
import { foeFamilyOf } from '../../ui/shipArt'
import { FoeDamageMix, ProfileChip } from '../../ui/shipInfo'
import { Glyph, ICO_TONES } from '../../ui/Glyphs'

/**
 * 赏金任务区（2026-09-10 船长定）：任务中心第四个子页——临时战斗任务，目标 = 「敌人窝点」。
 * - 与资源/快递同周期（20 分钟整点）整板刷新，每轮 2 张，过期作废无惩罚；
 * - 窝点 = 该星系主题悬赏按档位派生（档位上限由协会声望决定）：威胁更高、加僚机与波次；
 * - 必须亲自出击（AI 不能代劳）；打赢 → 窝点奖金 + 赏金任务酬金入账，并在该星系留下
 *   稀有残骸 ×档位件数（打捞必得，回站精炼炉「残骸回收」当高级箱开）；
 * - 卡片结构与资源/快递卡同族（app-station-card 家族），只多一行窝点情报与档位徽标。
 */
export function BountyTasksArea({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const view = engine.sideTasksView()
  const tasks = view.bounty
  const standing = standingOf(state, DSI_FACTION_ID)
  // T4 延后项：采矿中可「转战」（卡片内联两步确认，与常驻悬赏卡同口径）
  const [goAsk, setGoAsk] = useState<number | null>(null)
  // —— 舰影列自适应（2026-09-13 船长：赏金任务窝点卡与派系活跃置顶卡也加敌族舰影）——
  // 两处共用同一个测量点：本区根容器 .app-sidetasks（宽度 = 面板内容宽，已扣面板体滚动条）。
  const areaRef = useRef<HTMLDivElement | null>(null)
  const showFoeArt = useFoeArtFit(areaRef)

  function go(t: SideTask): void {
    const miningActive = state.mining.active
    if (miningActive && goAsk !== t.id) {
      setGoAsk(t.id)
      return
    }
    setGoAsk(null)
    const r = engine.startLairExpeditionAt(t.anomalyId ?? '', (t.lairTier ?? 1) as 1 | 2 | 3, miningActive)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
    else if (miningActive) onToast(tr("ui.Expedition.151"))
    else onToast(tr("ui.Expedition.285"))
  }

  // 当日席位构成（档位随机发放，但保证每天三档各至少一张）：按实际板统计，供头部摘要
  const tierCount = (lv: 1 | 2 | 3): number => tasks.filter((t) => (t.lairTier ?? 1) === lv).length
  const tierSummary = tr("ui.Expedition.232", { p1: tasks.length, p2: lairTierText(1), p3: tierCount(1), p4: lairTierText(2), p5: tierCount(2), p6: lairTierText(3), p7: tierCount(3) })
  // 敌对派系活跃（2026-09-10 船长定：置顶那一条）——目标 = 当日选中星系的**常驻悬赏**（不是窝点）
  const faction = view.faction
  const factionCard = faction?.anomalyId ? engine.ctx.anomalies.get(faction.anomalyId) : undefined
  const factionGalaxy = faction?.galaxyId ? engine.ctx.galaxies.get(faction.galaxyId) : undefined

  function goFaction(): void {
    const miningActive = state.mining.active
    if (miningActive && goAsk !== faction!.id) {
      setGoAsk(faction!.id)
      return
    }
    setGoAsk(null)
    const r = miningActive
      ? engine.startExpeditionFromMiningAt(faction!.anomalyId ?? '')
      : engine.startExpeditionAt(faction!.anomalyId ?? '')
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
    else if (miningActive) onToast(tr("ui.Expedition.151"))
    else onToast(tr("ui.Expedition.270"))
  }

  return (
    <div className="app-sidetasks" ref={areaRef}>
      <div className="app-sidetasks-head">
        <span>
          {tr("ui.Expedition.286")}
          {tasks.length > 0 ? <span className="app-dim"> · {tierSummary}</span> : null}
          {faction ? <span className="app-dim">{tr('ui.Expedition.405')}</span> : null}
        </span>
        {view.bountyOpened || tasks.length > 0 ? (
          <span
            className="app-st-time"
            title={tr("ui.Expedition.233")}
          >
            {tr("ui.Expedition.281")} {fmtDayClock(view.bountyRemainingMs)}{tr('ui.Expedition.370')}
          </span>
        ) : (
          <span className="app-dim">{tr("ui.Expedition.234")}</span>
        )}
      </div>
      {/* 2026-09-11 修复（玩家反馈「清空赏金任务后敌对派系活跃消失了」）：派系活跃卡**不随 5 席清空而消失**——
          原先它被放在「tasks.length === 0 ? 空态 : 列表」的**列表分支里**，玩家打完全部 5 席后整块被空态替换，
          于是置顶的派系活跃卡一起被吞掉（而 core 侧当天照常生效：该星系常驻悬赏 +10% 奖金/威胁、照常掉稀有残骸）。
          现改为：只要当天有派系活跃（`factionCard` 可解析）就照常渲染，空态行只在"确实没有派系卡"时占位。 */}
      {tasks.length === 0 && !(faction && factionCard && factionGalaxy) ? (
        <div className="app-dim app-exp-idle">
          {view.bountyOpened
            ? tr("ui.Expedition.235")
            : tr("ui.Expedition.236")}
        </div>
      ) : (
        <>
          {/* ── 敌对派系活跃（2026-09-10 船长定）：置顶一条；目标 = 该星系**常驻悬赏**（不是窝点），
              奖金 ×1.1、威胁 ×1.1、胜利概率掉稀有残骸；**打赢不下板**，当天可反复刷 ── */}
          {faction && factionCard && factionGalaxy ? (
            (() => {
              const boostCard = factionAnomalyOf(factionCard)
              const sec = factionGalaxy.security
              const fc2 = bountyDamageForecast(state, engine.ctx, boostCard)
              const pWin2 = bountyWinPercentGuarded(state, engine.ctx, boostCard, state.shipId) * 100
              // 2026-09-23 船长：「不再夹到 98%」——三处显示同一口径（算出来多少显示多少）
              const chance2 = Math.max(2, Math.round(pWin2))
              const tone2 = chance2 >= 70 ? tr("ui.Expedition.318") : chance2 >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
              const reward2 = factionBaseRewardIsk(factionCard)
              const inFlightSelf2 = state.expedition.active && state.expedition.anomalyId === faction.anomalyId
              const inFlightOther2 = state.expedition.active && !inFlightSelf2
              const exploreOk2 = isExplored(state, factionGalaxy.id)
              const cd2 = bountyCooldownRemainingMs(state, faction.anomalyId ?? '')
              const locked2 = !exploreOk2
                ? tr("ui.Expedition.287")
                : state.transit.active
                  ? tr("ui.Expedition.167")
                  : inFlightSelf2
                    ? tr("ui.Expedition.288")
                    : inFlightOther2
                      ? tr("ui.Expedition.289")
                      : cd2 > 0
                        ? tr("ui.Expedition.054", { p1: factionCard.name, p2: Math.max(1, Math.ceil(cd2 / 1000)) })
                        : undefined
              const canGo2 = locked2 === undefined || (goAsk === faction.id && !inFlightOther2)
              // 2026-09-10 船长定：派系置顶卡加「循环剿灭」——**复用同一条重复清剿开关**
              // （state.autoLoopAnomalyId；与其它悬赏卡的「重复清剿」共用，开这里会顶掉那边），
              // 引擎零改动：开/关走 engine.bountyLoopAt，推进/自动暂停/停环全沿用既有机器。
              const loopOn2 = state.autoLoopAnomalyId === faction.anomalyId
              const busyOther2 =
                state.mining.active ||
                state.transit.active ||
                (state.expedition.active && state.autoLoopAnomalyId !== faction.anomalyId)
              const reqMet2 = standing >= (factionCard.standingReq ?? 0)
              return (
                <div className="app-station-card is-foe-art is-faction">
                  {/* 舰影列（2026-09-13 船长）：族取**置顶那张代表悬赏卡**的族——与卡面标的出击目标同一张卡，不另算族 */}
                  {showFoeArt ? <FoeArt fam={foeFamilyOf(factionCard)} shipId={foeCardShipIdOf(factionCard)} /> : null}
                  <div className="app-foe-main">
                  <div className="app-station-head">
                    <span className="app-station-name">
                      {tr("ui.Expedition.055")}{factionCard.name}
                      <em className="app-chip is-rare">{tr("ui.Expedition.056")}</em>
                      <em className="app-chip" title={tr("ui.Expedition.237")}>
                        {tr("ui.Expedition.168")}
                      </em>
                    </span>
                    {/* 换新倒计时走**派系自己那条界碑**（本地 12:00；2026-09-29 船长令「只挪活跃」） */}
                    <span className="app-dim">{tr("ui.Expedition.114")} {fmtDayClock(view.factionRemainingMs)}</span>
                  </div>
                  <div className="app-lair-kv">
                    <span>{tr("ui.Expedition.290")}{factionGalaxy.name}」</span>
                    {sec !== undefined ? (
                      <span className={`app-sec-chip app-sec-chip-${secTone(sec)}`} title={tr("ui.Expedition.271")}>
                        {secText(sec)}
                      </span>
                    ) : null}
                    <span>
                      <span className="app-lair-key">{tr("ui.Expedition.089")}</span> {boostCard.threat}
                      <span className="app-dim">{tr("ui.Expedition.333")} {factionCard.threat}，+10%）</span>
                    </span>
                    <span>
                      <span className="app-lair-key">{tr("ui.Expedition.099")}</span> {MONEY_GLYPH} {reward2.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                      <span className="app-dim">{tr("ui.Expedition.333")} {factionCard.rewardIsk.toLocaleString('zh-CN')}，+10%）</span>
                    </span>
                  </div>
                  <div className="app-ano-win">
                    {tr("ui.Expedition.217")} {calcPower(state, engine.ctx)} → <span className="app-lair-key">{tr("ui.Expedition.334")}</span>{' '}
                    <b
                      className={`app-win-${tone2}`}
                      title={tr("ui.Expedition.169", { p1: Math.round(fc2.armorLoss * 100), p2: Math.round(fc2.hullLoss * 100) })}
                    >
                      {chance2}%
                    </b>
                    <span
                      className="app-dim"
                      title={tr("ui.Expedition.238")}
                    >
                      {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={boostCard} />
                    </span>
                  </div>
                  <div className="app-ano-reward">
                    <span className="app-lair-key">{tr("ui.IndustryPage.009")}</span>{' '}
                    {/* ⚠ **2026-09-24 修**（船长报障「铁人模式的残骸掉率加成似乎没应用到？」）：
                        这里原先写死 `Math.round(FACTION_RARE_DROP_CHANCE * 100)` = 恒 30% ⇒
                        **卡面把限时倍率与铁人 ×1.2 挡在读数之外**（机制本身一直生效）。
                        现改走 `factionRareDropChanceOf(state)`——**与 `expedition.ts` 那条掷骰同一函数**。 */}
                    {Math.round(factionRareDropChanceOf(state) * 100)}{tr('ui.Expedition.406')}{FACTION_RARE_DROP_COUNT}
                    <span className="app-dim" title={tr("ui.Expedition.117")}>
                      {tr("ui.Expedition.335")}
                    </span>
                  </div>
                  <div className="app-ano-desc">
                    {tr('ui.Expedition.407')}
                  </div>
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {state.mining.active
                        ? tr("ui.Expedition.170")
                        : tr("ui.Expedition.171", { standing: standing, p2: factionCard.standingReq })}
                    </span>
                    {inFlightSelf2 ? (
                      <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.288")}>
                        {tr("ui.Expedition.057")}
                      </span>
                    ) : (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!canGo2}
                        title={goAsk === faction.id ? tr("ui.Expedition.058") : locked2 ?? tr("ui.Expedition.118", { p1: factionGalaxy.name, p2: factionCard.name })}
                        onClick={goFaction}
                      >
                        {goAsk === faction.id ? tr("ui.Expedition.291") : tr("ui.Expedition.101")}
                      </button>
                    )}
                    <button
                      className={`app-btn is-small${loopOn2 ? ' is-warn' : ''}`}
                      disabled={!reqMet2 || !exploreOk2 || busyOther2}
                      title={
                        !reqMet2
                          ? tr("ui.Expedition.336", { p1: factionCard.standingReq, standing: standing })
                          : !exploreOk2
                            ? tr("ui.Expedition.059")
                            : busyOther2
                              ? tr("ui.Expedition.172")
                              : loopOn2
                                ? tr("ui.Expedition.060")
                                : tr("ui.Expedition.173")
                      }
                      onClick={() => {
                        if (!faction.anomalyId) return
                        const r = engine.bountyLoopAt(loopOn2 ? null : faction.anomalyId)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
                      }}
                    >
                      {loopOn2 ? (
                        tr('ui.Expedition.408')
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} />
                          </span>
                          {tr("ui.Expedition.174")}
                        </>
                      )}
                    </button>
                  </div>
                  </div>
                </div>
              )
            })()
          ) : null}
          {/* 5 席已清空时：派系活跃卡仍在（上方），这里补一行说明为什么席位是空的。
              ⚠ **2026-09-29 起分两态**（活跃切换时间改本地 12 点、赏金板仍 0 点，两个时点不再相同）：
              有活跃卡 ⇒ 用 `.447`（尾句讲"活跃星系明天中午 12 点重选"）；没有活跃卡 ⇒ 用 `.409`
              （尾句讲"赏金板 0 点刷新"）。此前共用 `.409`，活跃在跑时会把赏金板的 0 点说成活跃的时点。 */}
          {tasks.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {faction && factionCard && factionGalaxy ? tr('ui.Expedition.447') : tr('ui.Expedition.409')}
            </div>
          ) : null}
          {tasks.map((t) => {
          const base = t.anomalyId ? engine.ctx.anomalies.get(t.anomalyId) : undefined
          const tier = (t.lairTier ?? 1) as 1 | 2 | 3
          const card = base ? lairAnomalyOf(base, tier, engine.ctx.balance.battle) : undefined
          const galaxy = engine.ctx.galaxies.get(t.galaxyId ?? '')
          const galaxyName = galaxy?.name ?? t.galaxyId ?? '？'
          const waves = card?.waves?.length ?? 0
          const rareGain = LAIR_RARE_WRECK_GAIN[tier]
          // 胜率预估（2026-09-10 船长定：赏金卡也要有）——按**本档位强化后的卡**算，与实战同口径；
          // 口径 = 带伤预警推演（与常驻悬赏卡缓存未就绪时的回退同一套），损耗同一推演给出。
          const power = calcPower(state, engine.ctx)
          const fc = card ? bountyDamageForecast(state, engine.ctx, card) : null
          const pWin = card ? bountyWinPercentGuarded(state, engine.ctx, card, state.shipId) * 100 : 0
          // 2026-09-23 船长：「不再夹到 98%」——三处显示同一口径（算出来多少显示多少）
          const chance = Math.max(2, Math.round(pWin))
          const chanceTone = chance >= 70 ? tr("ui.Expedition.318") : chance >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
          // 赏金 = 窝点奖金 + 任务酬金（胜利时**一起到账**）：2026-09-10 船长定——两张卡别写两个数，
          // 合并成一条「赏金」。窝点奖金含赏金猎手学系数（展示=到账），任务酬金为刷出时锁定值。
          const lairRewardIsk = base ? ceilFinalQuantity(lairBaseRewardIsk(base, tier) * bountyRewardFactor(state)) : 0
          const totalIsk = lairRewardIsk + t.rewardIsk
          const inFlightSelf = state.expedition.active && state.expedition.anomalyId === t.anomalyId
          const inFlightOther = state.expedition.active && !inFlightSelf
          const expired = view.remainingMs <= 0
          const unexplored = t.galaxyId ? !isExplored(state, t.galaxyId) : true
          const notCandidate = base ? !isLairCandidate(base) : true
          // 声望门槛 = **接取条件**（2026-09-10 船长定）：不够也能在板上看见，但出发被拒
          const reqStanding = base?.standingReq ?? 0
          const standingMet = standing >= reqStanding
          const lockedTxt = !base || notCandidate
            ? tr("ui.Expedition.292")
            : !standingMet
              ? tr("ui.Expedition.119", { reqStanding: reqStanding, standing: standing })
              : unexplored
                ? tr("ui.Expedition.287")
                : expired
                  ? tr("ui.Expedition.230")
                  : inFlightSelf
                    ? tr("ui.Expedition.293")
                    : inFlightOther
                      ? tr("ui.Expedition.289")
                      : state.transit.active
                        ? tr("ui.Expedition.167")
                        : undefined
          const canGo = lockedTxt === undefined || (goAsk === t.id && !inFlightOther)
          return (
            <div key={t.id} className={`app-station-card is-foe-art${standingMet ? '' : ' is-locked'}`}>
              {/* 舰影列（2026-09-13 船长）：族取该任务**主题悬赏卡**（档位强化卡与原卡同族，`lairAnomalyOf` 不改族） */}
              {showFoeArt && base ? <FoeArt fam={foeFamilyOf(base)} shipId={foeCardShipIdOf(base)} /> : null}
              <div className="app-foe-main">
              <div className="app-station-head">
                <span className="app-station-name">
                  {tr("ui.Expedition.061")}{t.lairName ?? card?.name ?? t.anomalyId}
                  <em className="app-chip">{lairTierText(tier)}{tr("ui.Expedition.294")}</em>
                  {reqStanding > 0 ? (
                    <em className={`app-chip${standingMet ? '' : ' is-dim'}`} title={tr("ui.Expedition.175", { reqStanding: reqStanding, standing: standing })}>
                      {standingMet ? (
                        tr("ui.Expedition.337", { reqStanding: reqStanding })
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} />
                          </span>
                          {tr("ui.Expedition.338")} {reqStanding}
                        </>
                      )}
                    </em>
                  ) : null}
                </span>
                <span className="app-dim">{tr("ui.Expedition.114")} {fmtDayClock(view.bountyRemainingMs)}</span>
              </div>
              {/* 目标行：星系 + 安全等级 + 威胁 + 守军波次（关键字变色；2026-09-10 船长定） */}
              <div className="app-lair-kv">
                <span>{tr("ui.Expedition.283")}{galaxyName}」</span>
                {galaxy?.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`} title={tr("ui.Expedition.271")}>
                    {secText(galaxy.security)}
                  </span>
                ) : null}
                {card ? (
                  <span>
                    <span className="app-lair-key">{tr("ui.Expedition.089")}</span> {card.threat}
                    {base && card.threat !== base.threat ? <span className="app-dim">{tr("ui.Expedition.339")} {base.threat}）</span> : null}
                  </span>
                ) : null}
                {waves >= 2 ? (
                  <span>
                    <span className="app-lair-key">{tr("ui.Expedition.120")}</span> {waves}{tr('ui.Expedition.410')}
                  </span>
                ) : null}
                {/* 地图级别提示（2026-09-10 船长定）：级别 < 3 的星系出不了高档位，不写清楚玩家会当成 bug */}
                {base && lairLevelOf(base) < 3 ? (
                  <span title={tr("ui.Expedition.295")}>
                    <span className="app-lair-key">{tr("ui.Expedition.239")}</span> {lairTierText(lairLevelOf(base))}
                  </span>
                ) : null}
              </div>
              {/* 胜率行：与常驻悬赏卡同口径（火力 → 预估胜率%·损耗 + 敌主伤/敌型 chip） */}
              <div className="app-ano-win">
                {tr("ui.Expedition.217")} {power} → <span className="app-lair-key">{tr("ui.Expedition.334")}</span>{' '}
                <b
                  className={`app-win-${chanceTone}`}
                  title={
                    card
                      ? tr("ui.Expedition.176", { p1: Math.round((fc?.armorLoss ?? 0) * 100), p2: Math.round((fc?.hullLoss ?? 0) * 100) })
                      : tr("ui.Expedition.296")
                  }
                >
                  {Math.round(chance)}%
                </b>
                {card ? (
                  <span
                    className="app-dim"
                    title={tr("ui.Expedition.240")}
                  >
                    {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={card} />
                  </span>
                ) : null}
                {card
                  ? (() => {
                      const p = card.defProfile ?? 'balanced'
                      const cn = p === 'shield' ? tr("ui.Expedition.272") : p === 'armor' ? tr("ui.Expedition.273") : tr("ui.Expedition.098")
                      return (
                        <span className="app-dim" title={tr("ui.Expedition.241")}>
                          {' '}{tr('ui.Expedition.367')}<ProfileChip profile={p} text={cn} />
                        </span>
                      )
                    })()
                  : null}
              </div>
              {/* 收益行：赏金 = 窝点奖金 + 任务酬金（合并成一条，避免两个数重复）；稀有残骸为战利品 */}
              <div className="app-ano-reward">
                <span className="app-lair-key">{tr("ui.Expedition.297")}</span> {MONEY_GLYPH} {totalIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                <span className="app-dim" title={tr("ui.Expedition.298", { p1: lairRewardIsk.toLocaleString('zh-CN'), p2: t.rewardIsk.toLocaleString('zh-CN') })}>
                  {' '}{tr("ui.Expedition.340")} {lairRewardIsk.toLocaleString('zh-CN')} {tr("ui.Expedition.062")} {t.rewardIsk.toLocaleString('zh-CN')}）
                </span>
                {' · '}
                <span className="app-lair-key">{tr("ui.IndustryPage.009")}</span> ×{rareGain}
              </div>
              <div className="app-ano-desc">
                {tr("ui.Expedition.299")}
              </div>
              <div className="app-station-deliver">
                <span className="app-dim">
                  {state.mining.active
                    ? tr("ui.Expedition.170")
                    : tr("ui.Expedition.177", { standing: standing })}
                </span>
                {inFlightSelf ? (
                  <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.293")}>
                    {tr("ui.Expedition.057")}
                  </span>
                ) : (
                  <button
                    className="app-btn is-small is-primary"
                    disabled={!canGo}
                    title={goAsk === t.id ? tr("ui.Expedition.063") : lockedTxt ?? tr("ui.Expedition.121", { galaxyName: galaxyName, p2: t.lairName ?? '' })}
                    onClick={() => go(t)}
                  >
                    {goAsk === t.id ? tr("ui.Expedition.291") : tr("ui.Expedition.101")}
                  </button>
                )}
              </div>
              </div>
            </div>
          )
        })}
        </>
      )}
    </div>
  )
}
