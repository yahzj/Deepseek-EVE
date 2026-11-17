import type { GameEngine } from '../../game/engine'
import { type AnomalyDef, calcPower, isFactionBounty, factionAnomalyOf, bountyDamageForecast, bountyWinPercentGuarded, nearestStationGalaxyId, shortestTravelMinutes, travelLegMs, RETURN_LEG_MUL, ceilFinalQuantity, factionBaseRewardIsk, bountyRewardFactor, standingOf, DSI_FACTION_ID, isExplored, shipDisplayName, fleetDefOf, weekendZoneLiveAt, weekendProgressAt, weekendCoreGateView, weekendFoePoolOf, bountyCooldownRemainingMs, weekendFoeCardIdToFightOf, autoLoopReopenBlockReason, travelMinutesEff, foeLayerSplit } from '@whale/core'
import { type ToastFn, MONEY_GLYPH } from '../../pages/common'
import { tr, cmdText } from '../../i18n/locale'
import { useState } from 'react'
import { shipRoleText } from '../../ui/labelsText'
import { FoeArt, foeCardShipIdOf, secTone, secText, FOE_TACTIC_HINTS } from '../../panels/StarMap'
import { foeFamilyOf } from '../../ui/shipArt'
import { Glyph, ICO_TONES } from '../../ui/Glyphs'
import { fmtDuration } from '../../i18n/fmt'
import { FoeDamageMix, ProfileChip } from '../../ui/shipInfo'
import { RangeEwPreview } from '../combat/RangeEwPanel'
import { departureDurationMs } from '@whale/core'


export function AnomalyCard({
  engine,
  anomaly,
  onToast,
  showFoeArt,
}: {
  engine: GameEngine
  anomaly: AnomalyDef
  onToast: ToastFn
  showFoeArt: boolean
}) {
  const state = engine.state
  const galaxy = engine.ctx.galaxies.get(anomaly.galaxyId)
  const power = calcPower(state, engine.ctx)
  const factionHit = isFactionBounty(state, anomaly)
  const shownCard = factionHit ? factionAnomalyOf(anomaly) : anomaly
  const mc = factionHit ? null : engine.winEstimateOf(anomaly.id)
  const fc = factionHit ? bountyDamageForecast(state, engine.ctx, shownCard) : null
  const pending = !factionHit && mc === null
  const armorLoss = mc ? mc.armorLoss : fc?.armorLoss ?? 0
  const hullLoss = mc ? mc.hullLoss : fc?.hullLoss ?? 0
  const chance = mc
    ? Math.max(2, Math.round(mc.winRate * 100))
    : pending
      ? null
      : Math.max(2, Math.round(bountyWinPercentGuarded(state, engine.ctx, shownCard) * 100))
  const chanceTone = chance === null ? '' : chance >= 70 ? tr("ui.Expedition.318") : chance >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
  const combatMs = anomaly.combatSeconds * 1000
  const retBase = nearestStationGalaxyId(state, engine.ctx, anomaly.galaxyId)
  const localTarget = anomaly.galaxyId === retBase
  const retMins = localTarget ? NaN : shortestTravelMinutes(engine.ctx, retBase, anomaly.galaxyId)
  const retMs = localTarget ? 120_000 : Number.isFinite(retMins) ? travelLegMs(state, engine.ctx, retMins) * RETURN_LEG_MUL : 0
  const departureMs = departureDurationMs(engine.ctx, 'expedition', retBase, anomaly.galaxyId).totalMs
  const roundTripMs = Math.max(1, departureMs + combatMs + retMs)
  const grossIsk = ceilFinalQuantity((factionHit ? factionBaseRewardIsk(anomaly) : anomaly.rewardIsk) * bountyRewardFactor(state))
  const iskPerHour = roundTripMs > 0 ? grossIsk / (roundTripMs / 3_600_000) : 0
  const iskPerHourTxt =
    iskPerHour >= 1000
      ? `${(iskPerHour / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}k`
      : Math.round(iskPerHour).toLocaleString('zh-CN')
  const standing = standingOf(state, DSI_FACTION_ID)
  const reqMet = standing >= anomaly.standingReq
  const unexplored = galaxy ? !isExplored(state, galaxy.id) : false
  const [goAsk, setGoAsk] = useState(false)
  const lootText = anomaly.loot
    .map((l) => `${engine.ctx.items.get(l.itemId)?.name ?? l.itemId}×${l.units}`)
    .join(tr("ui.MatterTechTab.017"))
  const mining = state.mining
  const miningActive = mining.active
  const pilotName = shipDisplayName(state, engine.ctx, state.shipId)
  const pilotRoleLabel = (() => {
    const role = fleetDefOf(state, engine.ctx, state.shipId)?.role
    return role ? shipRoleText(role) : ''
  })()
  const inFlightSelf = state.expedition.active && state.expedition.anomalyId === anomaly.id
  const inFlightOther = state.expedition.active && !inFlightSelf
  const invadedHere = weekendZoneLiveAt(state, anomaly.galaxyId, Date.now())
  const reclaimedHere =
    invadedHere && state.weekendEvent !== undefined && weekendProgressAt(state, state.weekendEvent, anomaly.galaxyId, Date.now()) >= 1
  const coreGate =
    invadedHere && state.weekendEvent !== undefined && anomaly.galaxyId === state.weekendEvent.coreId
      ? weekendCoreGateView(state, state.weekendEvent, Date.now())
      : null
  const invadedThreats = invadedHere
    ? weekendFoePoolOf(
        state.weekendEvent?.family ?? 'A',
        anomaly.galaxyId === state.weekendEvent?.coreId,
      )
        .map((id) => engine.ctx.anomalies.get(id)?.threat ?? 0)
        .filter((t) => t > 0)
    : []
  const invadedLo = invadedThreats.length > 0 ? Math.min(...invadedThreats) : 0
  const invadedHi = invadedThreats.length > 0 ? Math.max(...invadedThreats) : 0
  const invasionLoopOn = invadedHere && state.weekendEvent?.autoLoopGalaxyId === anomaly.galaxyId
  const bountyCleared = state.completedBounties.includes(anomaly.id)
  const cdRemain = bountyCooldownRemainingMs(state, weekendFoeCardIdToFightOf(state, anomaly.id, anomaly.galaxyId))
  const looping = !invadedHere && state.autoLoopAnomalyId === anomaly.id
  const loopOn = invadedHere ? invasionLoopOn : looping
  const busyOther =
    state.mining.active ||
    state.transit.active ||
    (state.expedition.active && state.expedition.anomalyId !== anomaly.id)
  const reopenBlock = loopOn ? null : autoLoopReopenBlockReason(state)
  const goDisabled =
    !reqMet || unexplored || cdRemain > 0 || state.transit.active || inFlightSelf || inFlightOther

  function handleGoClick(): void {
    if (miningActive && !goAsk) {
      setGoAsk(true)
      return
    }
    if (!goAsk) {
      const r = engine.startExpeditionAt(anomaly.id, anomaly.galaxyId)
      if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
      else onToast(tr("ui.Expedition.270"))
      return
    }
    setGoAsk(false)
    const r = engine.startExpeditionFromMiningAt(anomaly.id, anomaly.galaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.392'), true)
    else onToast(tr("ui.Expedition.151"))
  }

  function toggleLoop(): void {
    const r = invadedHere
      ? engine.invasionLoopAt(invasionLoopOn ? null : anomaly.galaxyId)
      : engine.bountyLoopAt(looping ? null : anomaly.id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
  }

  const locked = !reqMet || unexplored

  return (
    <div className={`app-ano-card is-foe-art${locked ? ' is-locked' : ''}`}>
      {/* 舰影列：固定尺寸、置卡片最左侧；容器过窄时整列不渲染（样式 .app-ano-card.is-foe-art） */}
      {showFoeArt ? <FoeArt fam={foeFamilyOf(anomaly)} shipId={foeCardShipIdOf(anomaly)} /> : null}
      <div className="app-foe-main">
      <div className="app-ano-top">
        <span className="app-ano-name" title={invadedHere ? anomaly.name : undefined}>
          {invadedHere ? tr('ui.weekend.092') : anomaly.name}
          {factionHit ? (
            <em className="app-chip is-rare" title={tr("ui.Expedition.213")}>
              {tr("ui.Expedition.198")}
            </em>
          ) : null}
        </span>
        <span className={`app-chip${locked ? ' is-dim' : ''}`}>
          {unexplored ? (<><span className="app-ico"><Glyph name="ico-scan" size={12} color={ICO_TONES["ico-scan"]} /></span>{tr("ui.Expedition.214")}</>) : reqMet ? (invadedHere ? tr('ui.weekend.093', { p1: invadedLo, p2: invadedHi }) : tr("ui.Expedition.095", { p1: shownCard.threat, p2: factionHit ? '（+10%）' : '' })) : (<><span className="app-ico"><Glyph name="ico-lock" size={12} color={ICO_TONES["ico-lock"]} /></span>{tr("ui.Expedition.319")}{anomaly.standingReq}</>)}
        </span>
      </div>
      <div className="app-ano-meta">
        {galaxy ? (unexplored ? tr("ui.Expedition.215") : (
          <>
            {galaxy.name}
            {galaxy.security !== undefined ? (
              <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`} title={tr("ui.Expedition.271")}>
                {secText(galaxy.security)}
              </span>
            ) : null}
          </>
        )) : '？'} ·{' '}
        {(() => {
          // 2026-09-06：去程取消（下达即开战）；胜利自动返航（2026-09-08：基准 = 最近已建成站；
          // 本地悬赏 = 固定返港 2 分钟不可召回；异星系 = 单程 × RETURN_LEG_MUL（现值 1×）不可召回）
          const homeTarget = localTarget
          const backTxt =
            homeTarget
              ? ''
              : !Number.isFinite(retMins)
                ? ''
                : tr("ui.Expedition.355", { p1: Math.max(1, Math.round(travelMinutesEff(state, engine.ctx, retMins) * RETURN_LEG_MUL)) })
          return (
            <>
              {tr("ui.Expedition.096")} {fmtDuration(anomaly.combatSeconds * 1000)}
              {homeTarget ? tr("ui.Expedition.356") : backTxt}
            </>
          )
        })()}
        {cdRemain > 0 ? (
          <span className="app-dim" title={tr("ui.Expedition.097")}>
            {' '}· <span className="app-ico"><Glyph name="ico-clock" size={12} color={ICO_TONES['ico-clock']} /></span>{tr("ui.Expedition.037")} {Math.max(1, Math.ceil(cdRemain / 1000))}{tr('ui.Expedition.418')}
          </span>
        ) : null}
      </div>
      {anomaly.tactic ? (
        <div className="app-ano-meta">
          <span className="app-dim" title={tr("ui.Expedition.216")}>
            <span className="app-ico"><Glyph name="ico-tact" size={12} color={ICO_TONES["ico-tact"]} /></span>{FOE_TACTIC_HINTS[anomaly.tactic] ?? tr("ui.Expedition.152", { p1: anomaly.tactic })}
          </span>
        </div>
      ) : null}
      <div className="app-ano-win">
        {/**
         * **入侵舰队的卡不出胜率预估**（**2026-09-26 船长令**：「**入侵舰队的悬赏卡因为是随机抽取的敌人，
         * 胜率不固定的，所以在做预估胜率的时候忽略入侵舰队的卡，替换为提示'遭遇随机入侵舰队，敌人未知'。
         * 并且将入侵卡标红，打上危险的标签。**」）。
         *
         * 判据 = `invadedHere`（被占星系的悬赏位已被 `weekendBountyCardsOf` 换成入侵舰队，与"赏金栏改显
         * 结算口径"同一把尺）⇒ 这一支**既不显示我方战力指数、也不显示百分比**，只给一句"敌人未知"；
         * 旁边按船长令挂一枚**危险**芯片（`.app-chip.is-danger`）。
         */}
        {invadedHere ? (
          <>
            <em className="app-chip is-danger" title={tr('ui.Expedition.440')}>
              {tr('ui.Expedition.439')}
            </em>{' '}
            <span className="app-dim">{tr('ui.Expedition.438')}</span>
          </>
        ) : (
          <>
            {tr("ui.Expedition.217")} {power} {tr("ui.Expedition.038")}{' '}
            <b
              className={chance === null ? `app-dim` : `app-win-${chanceTone}`}
              title={
                mc
                  ? tr("ui.Expedition.426", {
                      p1: Math.round(mc.armorLoss * 100),
                      p2: Math.round(mc.hullLoss * 100),
                      p3: Math.round(mc.worstWinRate * 100),
                    })
                  : pending
                    ? tr("ui.Expedition.425")
                    : tr("ui.Expedition.153", { p1: Math.round(armorLoss * 100), p2: Math.round(hullLoss * 100) })
              }
            >
              {chance === null ? tr("ui.Expedition.425") : `${Math.round(chance)}%`}
            </b>
          </>
        )}
        {!reqMet ? <span className="app-dim">{tr("ui.Expedition.320")} {standing}/{anomaly.standingReq}）</span> : null}
        {/* V17：敌方主伤害类型色 chip——护盾/装甲增强器按系配抗的换装依据
            2026-09-10 船长（混伤）：改为「敌火力 主 80% · 副 20%」——构成与战斗结算同源 */}
        <span
          className="app-dim"
          title={tr("ui.Expedition.218")}
        >
          {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={anomaly} />
        </span>
        {/* V17.2：敌方血型色 chip——选弹种依据：动能克盾 ×1.5 / 高爆克甲 ×1.5 */}
        {(() => {
          const p = anomaly.defProfile ?? 'balanced'
          const split = foeLayerSplit(p)
          const cn = p === 'shield' ? tr("ui.Expedition.272") : p === 'armor' ? tr("ui.Expedition.273") : tr("ui.Expedition.098")
          return (
            <span
              className="app-dim"
              title={tr("ui.Expedition.219", { p1: Math.round(split.s * 100), p2: Math.round(split.a * 100), p3: Math.round(split.h * 100) })}
            >
              {' '}{tr('ui.Expedition.367')}<ProfileChip profile={p} text={cn} />
            </span>
          )
        })()}
      </div>
      <div className="app-ano-reward">
        <RangeEwPreview state={state} ctx={engine.ctx} card={invadedHere ? undefined : shownCard} />
        {invadedHere ? (
          <>{reclaimedHere ? tr('ui.weekend.116') : tr('ui.weekend.096')}</>
        ) : (
          <>
            {tr("ui.Expedition.099")} {grossIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
            {factionHit ? <span className="app-dim" title={tr("ui.Expedition.220", { p1: anomaly.rewardIsk.toLocaleString('zh-CN') })}>{tr("ui.Expedition.321")}</span> : null}
            {anomaly.loot.length > 0 ? ` + ${lootText}` : ''}{tr('ui.Expedition.368')}{anomaly.standingGain}
          </>
        )}
        {bountyCleared ? <span className="app-dim" title={tr("ui.Expedition.274")}>{tr("ui.Expedition.322")}</span> : null}
        {/**
         * **核心门禁提示**（**船长批「丙」** · 2026-09-25）：外围没清完时，打核心**一点夺回进度都不给**
         * （`weekendResolveBattle` 的 gated 分支连台账都不记）⇒ 在**常驻悬赏这一行**就写明，
         * 别让玩家白打一场威胁最高的舰队。文案与「星系详细」那张卡**同源**（`ui.weekend.104/105`），
         * 读数也同源（`weekendCoreGateView` = `weekendCoreProgressAt` 那一条门禁）。
         */}
        {coreGate?.gated ? (
          <span className="app-dim" title={tr('ui.weekend.104')}>
            {coreGate.missing >= coreGate.total
              ? tr('ui.weekend.104')
              : tr('ui.weekend.105', { p1: String(coreGate.missing) })}
          </span>
        ) : null}
      </div>
      {/* 入侵场次没有即时赏金 ⇒ "估算奖励/小时"整条不显示（免得拿 0 去估一个数出来） */}
      {invadedHere ? null : (
        <div
          className="app-ano-econ"
          title={`${grossIsk.toLocaleString('zh-CN')} / ${fmtDuration(roundTripMs)}`}
        >
          {MONEY_GLYPH} {tr("ui.Expedition.040")}{iskPerHourTxt} {tr("ui.Expedition.041")}
        </div>
      )}
      <div className="app-ano-bottom">
        <span className="app-ano-desc">
          {unexplored ? tr("ui.Expedition.275") : anomaly.description}
        </span>
        <div className="app-ano-btns">
          <button
            className={`app-btn is-small${loopOn ? ' is-warn' : ''}`}
            disabled={!reqMet || unexplored || busyOther || reopenBlock !== null}
            title={
              !reqMet || unexplored
                ? tr("ui.Expedition.042")
                : busyOther
                  ? tr("ui.Expedition.154")
                  : reopenBlock !== null
                    ? cmdText(reopenBlock)
                    : loopOn
                      ? tr("ui.Expedition.043")
                      : invadedHere
                        ? tr('ui.weekend.107')
                        : tr("ui.Expedition.155")
            }
            onClick={toggleLoop}
          >
            {loopOn ? (
              tr("ui.Expedition.044")
            ) : (
              <>
                <span className="app-ico"><Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} /></span>
                {invadedHere ? tr('ui.weekend.106') : tr("ui.Handbook.294")}
              </>
            )}
          </button>
          <button
            className={`app-btn is-small ${miningActive && !goAsk ? 'is-warn is-primary' : goAsk ? 'is-dim' : 'is-primary'}`}
            disabled={goDisabled || goAsk}
            title={
              goAsk
                ? tr("ui.Expedition.276")
                : cdRemain > 0
                ? tr("ui.Expedition.323", { p1: Math.max(1, Math.ceil(cdRemain / 1000)) })
                : !reqMet || unexplored
                  ? tr("ui.Expedition.042")
                  : state.transit.active
                    ? tr("ui.Expedition.324")
                    : inFlightSelf
                      ? tr("ui.Expedition.277")
                      : inFlightOther
                        ? tr("ui.Expedition.314")
                        : miningActive
                          ? tr("ui.Expedition.325")
                          : ''
            }
            onClick={handleGoClick}
          >
            {cdRemain > 0 ? tr("ui.Expedition.100") : miningActive ? tr("ui.Expedition.045") : tr("ui.Expedition.101")}
          </button>
        </div>
      </div>
      {/* T4 延后项：采矿中转战的醒目内联警示（操作按钮正下方全宽，取代易忽略的底部提示） */}
      {goAsk ? (
        <div className="app-ano-switch-confirm">
          <div className="app-sell-warn">
            {tr("ui.Expedition.046")} <b>{tr("ui.MapPage.037")}</b>{tr('ui.Expedition.419')}
            <b> {mining.tripUnits} {tr("ui.Expedition.102")}</b>{tr("ui.Expedition.278")}
            <b> {tr("ui.Expedition.156")}</b>{tr("ui.Expedition.279")}{anomaly.name}{tr("ui.Expedition.047")}
          </div>
          <div className="app-ano-pilot-note">
            {tr("ui.Expedition.157")}{pilotName}」{pilotRoleLabel ? tr("ui.Expedition.307", { pilotRoleLabel: pilotRoleLabel }) : ''}
          </div>
          <div className="app-sell-confirm-btns">
            <button className="app-btn is-small is-danger" onClick={handleGoClick}>
              {tr("ui.Expedition.280")}
            </button>
            <button className="app-btn is-small" onClick={() => setGoAsk(false)}>
              {tr("ui.ActivityBar.004")}
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  )
}
