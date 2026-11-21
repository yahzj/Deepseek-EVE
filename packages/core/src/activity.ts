import type { GameState, TrainingItem } from './state'
import { busyLabel, type BusyLabel } from './busyLabels'
import { commandShipDeployed } from './combat/command/locks'
import type { SimContext, SkillCatalog } from './types'
import { trainingLevelProgress } from './training'
import type { HeadTrainingInfo, QueueView } from './engine'
import { miningStatus, shipInReturn } from './mining'
import { wormholeScanWindowMs, wormholeStockFull, wormholeStockMaxOf, wormholeStockOf } from './wormholeScan'
import { matterTechScanCut } from './matterTech'
import { wormholeAutoRunsOf } from './state'
import { manufacturingRunViews } from './manufacturing'
import { industryAvailable } from './industry'
import { refineRunViews } from './industry'
import { labRunViews } from './lab'
import { expeditionStatus, bountyCooldownRemainingMs, bountyCooldownMsFor, autoLoopWaitLabel, autoLoopInvasionPlanOf, autoLoopInvasionGalaxy } from './expedition'
import { standbyStatus, transitStatus } from './location'
import { aiTaskView, aiCoreName } from './ai'
import { shipDisplayName } from './instances'
import { salvageReturnMs, outboundLegMsFor, salvageFleetCyclesOf } from './salvaging'
import { haulEndpointName } from './hauling'
import { travelMinutesEff } from './travel'
import { weekendFoePoolOf } from './weekendEvent'
import { pendingStationActivityView } from './stationActivityPending'
import { departureView } from './departure'

export type ActivityKind =
  | 'train'
  | 'mining'
  | 'scan'
  | 'whscan'
  | 'whauto'
  | 'salvage'
  | 'manufacture'
  | 'refine'
  | 'expedition'
  | 'ai'
  | 'return'
  | 'transit'
  | 'standby'
  | 'loop'
  | 'invasion-loop'
  | 'wormhole'
  | 'courier'
  | 'hauling'
  | 'lab'

export type ActivityStopKind =
  | 'remove-training'
  | 'stop-mining'
  | 'stop-scan'
  | 'stop-whscan'
  | 'stop-whauto'
  | 'stop-salvage'
  | 'cancel-manufacture'
  | 'stop-refine'
  | 'recall-expedition'
  | 'retreat-battle'
  | 'cancel-ai'
  | 'recall-standby'
  | 'cancel-deliver-trip'
  | 'stop-loop'
  | 'stop-invasion-loop'
  | 'stop-hauling'
  | 'stop-lab'
  | 'cancel-station-pending'

export interface ActivityView {
  badge?: 'invasion'
  labelId?: string
  labelParams?: Readonly<Record<string, string | number>>
  subId?: string
  subParams?: Readonly<Record<string, string | number>>
  id: string
  kind: ActivityKind
  label: string
  sub: string
  percent: number | null
  remainingMs: number | null
  stopable: boolean
  stopReason?: string
  stopReasonId?: string
  aiGroup?: 'ship' | 'industry'
  aiWorkKind?: 'mining' | 'salvage' | 'standby' | 'refine' | 'reclaim' | 'craft'
  stop: ActivityStopKind | null
  stopParam?: string
}

export function activityOverview(state: GameState, ctx: SimContext): ActivityView[] {
  const out: ActivityView[] = []

  const q = skillQueueStatus(state, ctx.skills)
  if (q.head) {
    out.push({
      id: 'train',
      kind: 'train',
      label: q.head.skillName,
      sub: `训练至 Lv${q.head.targetLevel}（当前 Lv${q.head.currentLevel}）`,
      percent: q.head.percent,
      remainingMs: q.head.remainingMs,
      stopable: true,
      stop: 'remove-training',
    })
  }

  const mv = miningStatus(state, ctx)
  if (mv.active) {
    out.push({
      id: 'mining',
      kind: 'mining',
      label: mv.beltName,
      sub: mv.phaseLabel,
      percent: mv.percent,
      remainingMs: mv.phase !== 'mining' ? mv.remainingMs : null,
      stopable: true,
      stop: 'stop-mining',
    })
  }

  const svg = state.salvaging
  if (svg.active) {
    const gName = svg.galaxyId ? (ctx.galaxies.get(svg.galaxyId)?.name ?? svg.galaxyId) : ''
    const phaseTxt = svg.phase === 'returning' ? '返航卸货' : svg.phase === 'outbound' ? '出航' : '打捞中'
    let percent: number | null = null
    let remainingMs: number | null = null
    if (svg.galaxyId) {
      if (svg.phase === 'outbound') {
        const leg = Math.max(1, outboundLegMsFor(state, ctx, svg.galaxyId))
        percent = Math.min(100, Math.round((svg.phaseAccMs / leg) * 100))
        remainingMs = Math.max(0, leg - svg.phaseAccMs)
      } else if (svg.phase === 'returning') {
        const leg = salvageReturnMs(state, ctx, svg.galaxyId)
        percent = Math.min(100, Math.round((svg.phaseAccMs / leg) * 100))
        remainingMs = Math.max(0, leg - svg.phaseAccMs)
      } else {
        const cycles = salvageFleetCyclesOf(state, ctx)
        const step = cycles.length > 0 ? Math.min(...cycles) : 0
        if (step > 0) percent = Math.min(100, Math.round((svg.cycleAccMs / step) * 100))
      }
    }
    out.push({
      id: 'salvage',
      kind: 'salvage',
      label: gName ? `打捞 · ${gName}` : '打捞作业',
      sub: phaseTxt,
      percent,
      remainingMs: svg.phase === 'salvaging' ? null : remainingMs,
      stopable: true,
      stop: 'stop-salvage',
    })
  }

  const hg = state.hauling
  if (hg.active) {
    const leg = Math.max(1, hg.legMs)
    out.push({
      id: 'hauling',
      kind: 'hauling',
      label: `长途运输 · 往「${haulEndpointName(ctx, hg.toSiteId)}」`,
      ...(hg.fleetLeg?.returning ? { labelId: 'ui.industrial.007' } : {}),
      sub: `航线 ${haulEndpointName(ctx, hg.routeA)} ⇄ ${haulEndpointName(ctx, hg.routeB)} · 本段实际约 ${Math.max(1, travelMinutesEff(state, ctx, hg.legMinutes))} 分钟`,
      percent: Math.min(100, Math.round((hg.phaseAccMs / leg) * 100)),
      remainingMs: Math.max(0, leg - hg.phaseAccMs),
      stopable: !hg.fleetLeg?.abortAfterBattle,
      stop: hg.fleetLeg?.abortAfterBattle ? null : 'stop-hauling',
    })
  }


  if (state.wormholeScan?.active === true) {
    const windowMs = wormholeScanWindowMs(state, matterTechScanCut(state, ctx))
    const done = Math.min(windowMs, state.wormholeScan.progressMs)
    out.push({
      id: 'whscan',
      kind: 'whscan',
      label: '扫描虫洞',
      labelId: 'ui.explorationName.009',
      subId: 'ui.explorationName.013',
      subParams: { p1: wormholeStockOf(state).length, p2: wormholeStockMaxOf(state) },
      sub:
        wormholeStockFull(state)
          ? `已囤满 ${wormholeStockMaxOf(state)} 处 · 待处理`
          : `深空扫描中 · 已囤 ${wormholeStockOf(state).length}/${wormholeStockMaxOf(state)} 处`,
      percent: Math.max(0, Math.min(100, Math.round((done / windowMs) * 100))),
      remainingMs: Math.max(0, windowMs - done),
      stopable: true,
      stop: 'stop-whscan',
    })
  }

  for (const run of wormholeAutoRunsOf(state)) {
    const span = Math.max(1, run.finishAtGameMs - run.startedAtGameMs)
    const done = Math.max(0, Math.min(span, state.gameMs - run.startedAtGameMs))
    out.push({
      id: `whauto:${run.id}`,
      kind: 'whauto',
      label: '自动探索',
      labelId: run.expeditionRules === 2 ? 'ui.explorationName.011' : 'ui.explorationName.010',
      subId: run.expeditionRules === undefined ? 'ui.signalAuto.003' : 'ui.explorationName.012',
      subParams: { p1: run.shipIds.length },
      sub:
        run.expeditionRules === undefined ? `${run.shipIds.length} 条舰` : run.shipIds.length > 1
          ? `${run.shipIds.length} 条舰 · 整队占 1 枚 AI 核心`
          : `${run.shipIds.length} 条舰 · 占 1 枚 AI 核心`,
      percent: Math.max(0, Math.min(100, Math.round((done / span) * 100))),
      remainingMs: Math.max(0, run.finishAtGameMs - state.gameMs),
      stopable: true,
      stop: 'stop-whauto',
      stopParam: run.id,
    })
  }

  for (const mfv of manufacturingRunViews(state, ctx)) {
    const aiProd = mfv.worker !== null && mfv.worker !== 'pilot'
    const who = mfv.worker === null ? '旧作业' : mfv.worker === 'pilot' ? '主控亲自' : `${mfv.workerLabel}驱动`
    out.push({
      id: aiProd ? `ai-prod-m:${mfv.id}` : `manufacture:${mfv.id}`,
      kind: aiProd ? 'ai' : 'manufacture',
      ...(aiProd ? { aiGroup: 'industry' as const, aiWorkKind: 'craft' as const } : {}),
      label: mfv.productName,
      sub: `${who} · ${mfv.kind === 'ship' ? '造船中' : '制造中'}`,
      percent: mfv.percent,
      remainingMs: mfv.remainingMs,
      stopable: true,
      stop: 'cancel-manufacture',
      stopParam: String(mfv.id),
    })
  }

  for (const rv of refineRunViews(state, ctx)) {
    const aiProd = rv.worker !== 'pilot'
    const isWreck = rv.itemId ? ctx.items.get(rv.itemId)?.kind === 'wreck' : false
    const remainUnits = rv.itemId ? industryAvailable(state, ctx, rv.itemId) : 0
    const stockNote = rv.claimedUnits !== undefined ? `本炉料余 ×${rv.claimedUnits}` : `仓库余 ×${remainUnits}`
    out.push({
      id: aiProd ? `ai-prod-r:${rv.id}` : `refine:${rv.id}`,
      kind: aiProd ? 'ai' : 'refine',
      ...(aiProd ? { aiGroup: 'industry' as const, aiWorkKind: (isWreck ? 'reclaim' : 'refine') as 'reclaim' | 'refine' } : {}),
      label: `${isWreck ? '残骸回收' : '精炼炉'} · ${rv.itemName}`,
      sub: `${rv.workerLabel}驱动 · 已 ${rv.batchesDone} 批 / ${stockNote}（每批 ${rv.batchUnits} 单位）`,
      percent: rv.percent,
      remainingMs: rv.remainingMs,
      stopable: true,
      stop: 'stop-refine',
      stopParam: String(rv.id),
    })
  }

  for (const lv of labRunViews(state, ctx)) {
    const aiProd = lv.worker !== 'pilot'
    out.push({
      id: aiProd ? `ai-prod-l:${lv.id}` : `lab:${lv.id}`,
      kind: aiProd ? 'ai' : 'lab',
      ...(aiProd ? { aiGroup: 'industry' as const, aiWorkKind: 'craft' as const } : {}),
      label: `实验室 · ${lv.recipeName}`,
      sub:
        `${lv.worker === 'pilot' ? '主控亲自运转' : `${aiCoreName(lv.worker)}驱动`} · 每批 ${lv.batchUnits} 单位` +
        (lv.loopProduced > 0 ? ` · 本轮已出 ${lv.loopProduced} 批` : ''),
      percent: lv.percent,
      remainingMs: lv.remainingMs,
      stopable: true,
      stop: 'stop-lab',
      stopParam: String(lv.id),
    })
  }

  const ev = expeditionStatus(state, ctx)
  if (ev.active) {
    const inBattle = ev.phase === 'combat'
    const canStop = inBattle || ev.recallable
    const invasionEvent = state.weekendEvent
    const actualGalaxyId = state.expedition.foeGalaxyId
    const invasion = invasionEvent !== undefined && actualGalaxyId !== undefined && ev.anomalyId !== null
      && (actualGalaxyId === invasionEvent.coreId || invasionEvent.peripheryIds.includes(actualGalaxyId))
      && weekendFoePoolOf(invasionEvent.family, actualGalaxyId === invasionEvent.coreId).includes(ev.anomalyId)
    const loopReturning = state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === ev.anomalyId && ev.phase === 'back'
    const invasionReturning = autoLoopInvasionGalaxy(state) !== null && state.expedition.foeGalaxyId !== undefined && ev.phase === 'back'
    let sub: string
    let stopable: boolean
    let stop: ActivityStopKind | null
    if (invasionReturning) {
      sub = '返航中 · 重复出击中；停止后本趟返航照常完成'
      stopable = true
      stop = 'stop-invasion-loop'
    } else if (loopReturning) {
      sub = '返航中 · 重复清剿中——停止清剿后本趟返航照常完成'
      stopable = true
      stop = 'stop-loop'
    } else if (inBattle) {
      sub = '实时交火中'
      stopable = true
      stop = 'retreat-battle'
    } else {
      sub = `${ev.phaseLabel}（${ev.galaxyName}）`
      stopable = canStop
      stop = canStop ? 'recall-expedition' : null
    }
    out.push({
      id: 'expedition',
      kind: 'expedition',
      label: ev.anomalyName,
      sub,
      ...(invasion ? {
        badge: 'invasion' as const,
        subId: 'ui.invasionActivity.002',
        subParams: { p1: ev.galaxyName, p2: ev.phaseLabel,
          p2Id: inBattle ? 'ui.invasionActivity.003' : ev.phase === 'back' ? 'ui.invasionActivity.004' : 'ui.invasionActivity.005' },
      } : invasionReturning ? { subId: 'ui.invasionLoop.005' } : {}),
      percent: ev.percent,
      remainingMs: ev.remainingMs,
      stopable,
      stop,
    })
  }

  const whRun = state.wormhole.run
  if (whRun) {
    const where = whRun.battle
      ? '交火中'
      : whRun.phase === 'extracting'
        ? '撤离中'
        : `第 ${whRun.depth} 层 · 节点 ${Math.min(whRun.nodeIndex + 1, whRun.nodesPerLayer)}/${whRun.nodesPerLayer}`
    out.push({
      id: 'wormhole',
      kind: 'wormhole',
      label: `虫洞探索 · ${where}`,
      labelId: whRun.expeditionRules === 2 ? 'ui.explorationName.002' : 'ui.explorationName.001',
      labelParams: { p1: where, p1Id: whRun.battle ? 'ui.explorationName.003' : whRun.phase === 'extracting' ? 'ui.explorationName.004' : 'ui.explorationName.005', p1p1: whRun.depth },
      subId: 'ui.explorationName.006',
      subParams: { p1: whRun.turnsLeft, p2: whRun.turnsTotal, p3: whRun.bag.length, p4: whRun.attending === true ? '探索中' : '已暂停，进度已保存', p4Id: whRun.attending === true ? 'ui.explorationName.007' : 'ui.explorationName.008' },
      sub:
        `回合 ${whRun.turnsLeft}/${whRun.turnsTotal} · 货仓 ${whRun.bag.length} 类物资` +
        (whRun.attending === true ? ' · 人在洞里' : ' · 已离开（进度已保存）'),
      percent: whRun.turnsTotal > 0 ? Math.round((1 - whRun.turnsLeft / whRun.turnsTotal) * 100) : null,
      remainingMs: null,
      stopable: false,
      stopReason: '洞内那趟要自己走完：在虫洞界面里发起「撤离」把货带回来，或全损收场。',
      stopReasonId: whRun.expeditionRules === 2 ? 'ui.explorationName.022' : 'ui.explorationName.021',
      stop: null,
    })
  }
  const loopId = state.autoLoopAnomalyId
  if (loopId !== null) {
    const inFlight = state.expedition.active && state.expedition.anomalyId === loopId
    if (!inFlight) {
      const aName = ctx.anomalies.get(loopId)?.name ?? loopId
      const cdMs = bountyCooldownRemainingMs(state, loopId)
      const waitFor = autoLoopWaitLabel(state)
      let percent: number | null = null
      if (cdMs > 0) {
        const total = Math.max(1, bountyCooldownMsFor(state, ctx))
        percent = Math.min(100, Math.max(0, Math.round(((total - cdMs) / total) * 100)))
      }
      out.push({
        id: 'loop',
        kind: 'loop',
        label: '重复清剿',
        sub:
          waitFor !== null
            ? `目标「${aName}」——等待${waitFor}结束，自动再出击`
            : cdMs > 0
              ? `目标「${aName}」——正在扫描新敌人`
              : `目标「${aName}」——即将自动再出击`,
        percent,
        remainingMs: cdMs > 0 ? cdMs : null,
        stopable: true,
        stop: 'stop-loop',
      })
    }
  }

  const invasionPlan = autoLoopInvasionPlanOf(state, ctx)
  const invasionInFlight = state.expedition.active && state.expedition.foeGalaxyId === autoLoopInvasionGalaxy(state)
  if (invasionPlan.status === 'ready' && !invasionInFlight) {
    const name = ctx.galaxies.get(invasionPlan.galaxyId)?.name ?? invasionPlan.galaxyId
    const waitFor = invasionPlan.waitFor
    const waitingIds: Record<string, string> = {
      '本次出击': 'core.busy.013', '采矿': 'core.busy.002', '残骸打捞': 'core.busy.005',
      '航行': 'ui.invasionLoop.006', '亲自开炉': 'core.activity.002', '亲自开线': 'core.activity.003',
      '实验室作业': 'core.busy.030',
      '战前准备': 'ui.weekend.062',
    }
    out.push({
      id: 'invasion-loop', kind: 'invasion-loop', badge: 'invasion', label: '重复出击', labelId: 'ui.invasionLoop.001',
      sub: waitFor !== null ? `目标「${name}」；等待${waitFor}结束`
        : invasionPlan.remainingMs > 0 ? `目标「${name}」；正在扫描新敌人` : `目标「${name}」；即将自动出击`,
      subId: waitFor !== null ? 'ui.invasionLoop.002' : invasionPlan.remainingMs > 0 ? 'ui.invasionLoop.003' : 'ui.invasionLoop.004',
      subParams: { p1: name, ...(waitFor !== null ? { p2: waitFor, p2Id: waitingIds[waitFor] } : {}) },
      percent: waitFor !== null ? null : invasionPlan.percent,
      remainingMs: waitFor === null && invasionPlan.remainingMs > 0 ? invasionPlan.remainingMs : null,
      stopable: true, stop: 'stop-invasion-loop',
    })
  }

  for (const [shipId, assignment] of Object.entries(state.aiAssignments)) {
    const shipName = shipDisplayName(state, ctx, shipId)
    const task = assignment.task
    const v = aiTaskView(state, ctx, shipId)
    if (task.kind === 'mining') {
      const beltName = ctx.belts.get(task.beltId)?.name ?? task.beltId
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        aiGroup: 'ship',
        aiWorkKind: 'mining',
        label: `${shipName} · 采矿`,
        sub: `${beltName}（${v?.label ?? '作业中'}）`,
        percent: v?.percent ?? null,
        remainingMs: v?.remainingMs ?? null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else if (task.kind === 'expedition') {
      const aName = ctx.anomalies.get(task.anomalyId)?.name ?? task.anomalyId
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        aiGroup: 'ship',
        aiWorkKind: 'standby',
        label: `${shipName} · 远征`,
        sub: `${aName}（${v?.label ?? '作业中'}）`,
        percent: v?.percent ?? null,
        remainingMs: v?.remainingMs ?? null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else if (task.kind === 'salvage') {
      const gName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        aiGroup: 'ship',
        aiWorkKind: 'salvage',
        label: `${shipName} · 打捞`,
        sub: `${gName}（${v?.label ?? '作业中'}）`,
        percent: v?.percent ?? null,
        remainingMs: v?.remainingMs ?? null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else {
      const gName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        aiGroup: 'ship',
        aiWorkKind: 'standby',
        label: `${shipName} · 掩护巡逻`,
        sub: task.phase === 'out' ? `前往 ${gName}（去程）` : `留守「${gName}」`,
        percent: v?.percent ?? null,
        remainingMs: v?.remainingMs ?? null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    }
  }

  for (const [shipId, ret] of Object.entries(state.shipReturns)) {
    if (state.pendingStationActivity?.shipId === shipId) {
      const pending = pendingStationActivityView(state, ctx)
      if (pending) { out.push(pending); continue }
    }
    const shipName = shipDisplayName(state, ctx, shipId)
    const beltName = ret.beltId ? ctx.belts.get(ret.beltId)?.name ?? ret.beltId : ''
    const remainingMs = Math.max(0, ret.legMs - ret.phaseAccMs)
    const percent = ret.legMs > 0 ? Math.min(100, (ret.phaseAccMs / ret.legMs) * 100) : 0
    out.push({
      id: `return-${shipId}`,
      kind: 'return',
      label: `${shipName} · 返航卸货`,
      sub: beltName ? `换船善后（原：${beltName}）` : '换船善后',
      percent,
      remainingMs,
      stopable: false,
      stopReason: '自动善后：到港自动卸货入仓库，不可取消',
      stop: null,
    })
  }

  const tv = transitStatus(state, ctx)
  if (tv.active) {
    const delivering = tv.trip === 'deliver-to-site' || tv.trip === 'deliver-to-station'
    out.push({
      id: 'transit',
      kind: 'transit',
      label: delivering
        ? tv.trip === 'deliver-to-site'
          ? `建站交付 · 前往「${tv.siteName ?? '工地'}」`
          : '建站交付 · 返航中'
        : `返航空间站（${tv.toName}）`,
      sub: delivering
        ? tv.trip === 'deliver-to-site'
          ? tv.fromName
            ? `自「${tv.fromName}」启程 · 到点自动交付建材并返航`
            : '到点自动交付建材并返航'
          : `工地交付完成 · 返回「${tv.toName}」`
        : tv.fromName
          ? `自「${tv.fromName}」启程`
          : '野外返航',
      percent: tv.percent,
      remainingMs: tv.remainingMs,
      stopable: delivering,
      stop: delivering ? 'cancel-deliver-trip' : null,
      stopReason: delivering ? undefined : '返航行程不可取消',
    })
  }

  const sbv = standbyStatus(state, ctx)
  if (sbv.active) {
    out.push({
      id: 'standby',
      kind: 'standby',
      label: `前往 ${sbv.targetName} 掩护巡逻`,
      sub: '去程中',
      percent: sbv.percent,
      remainingMs: sbv.remainingMs,
      stopable: true,
      stop: 'recall-standby',
    })
  }

  const cd = state.sideTasks.deliver
  if (cd !== null) {
    const totalLeg = Math.max(0, cd.arriveAtGameMs - cd.departAtGameMs)
    const remain = Math.max(0, cd.arriveAtGameMs - state.gameMs)
    const siteName = ctx.stations.get(cd.stationId)?.name ?? cd.stationId
    const galaxyName = ctx.galaxies.get(cd.galaxyId)?.name ?? cd.galaxyId
    out.push({
      id: 'courier',
      kind: 'courier',
      label: '快递投送',
      sub: `向「${siteName}」（${galaxyName}）投送中`,
      percent:
        totalLeg > 0 ? Math.min(100, Math.max(0, Math.round(((totalLeg - remain) / totalLeg) * 100))) : 100,
      remainingMs: remain,
      stopable: false,
      stopReason: '投送不可取消：到站自动结算酬金',
      stop: null,
    })
  }

  const departure = departureView(state)
  if (departure) {
    if (departure.kind === 'flagship') out.push({ id: 'flagship-departure', kind: 'expedition',
      label: state.encounter.name || (state.encounter.anomalyId ? ctx.anomalies.get(state.encounter.anomalyId)?.name ?? '' : ''),
      sub: '', badge: 'invasion', percent: departure.percent, remainingMs: departure.remainingMs, stopable: false, stop: null })
    const kind = { mining: 'mining', salvaging: 'salvage', expedition: 'expedition', hauling: 'hauling',
      deliver: 'courier', siteDeliver: 'transit', wormhole: 'wormhole', flagship: 'expedition' }[departure.kind]
    const row = out.find(item => item.kind === kind)
    if (row) {
      row.sub = ''
      row.subId = departure.textId
      delete row.subParams
      row.percent = departure.percent
      row.remainingMs = departure.remainingMs
    }
  }
  if (state.expedition.active && state.expedition.phase === 'back' && state.expedition.returnReason === 'victory') {
    const row = out.find(item => item.id === 'expedition')
    if (row) { row.sub = ''; row.subId = 'core.departure.003'; delete row.subParams }
  }
  return out
}

export function shipBusyLabel(state: GameState, ctx: SimContext, shipId: string): BusyLabel | null {
  if (shipId !== state.shipId && commandShipDeployed(state, shipId)) return busyLabel('expedition')
  if ((state.wormholeAuto ?? []).some(run => run.shipIds.includes(shipId))) return busyLabel('wormhole')
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return busyLabel('planetDelivery')
  if ((state.wormhole.run?.fleet ?? []).includes(shipId)) return busyLabel('wormhole')
  if (state.wormhole.run?.attending === true && shipId === state.shipId) return busyLabel('wormhole')
  if (shipId === state.shipId) {
    const mv = miningStatus(state, ctx)
    if (mv.active) {
      if (state.mining.phase === 'mining') return busyLabel('mining')
      return busyLabel(state.mining.phase === 'outbound' ? 'miningOut' : 'miningBack')
    }
    if (state.salvaging.active) {
      if (state.salvaging.phase === 'outbound') return busyLabel('salvageOut')
      return busyLabel(state.salvaging.phase === 'returning' ? 'salvageBack' : 'salvage')
    }
    if (state.hauling.active) return busyLabel('hauling')
    if (state.sideTasks.deliver !== null) return busyLabel('courier')
    const sb = standbyStatus(state, ctx)
    if (sb.active) return busyLabel('patrolTo', { p1: sb.targetName })
    if (state.wormholeScan?.active === true) return busyLabel('whscan')
    const ev = expeditionStatus(state, ctx)
    if (ev.active) {
      if (ev.phase === 'out') return busyLabel('expOut')
      if (ev.phase === 'combat') return busyLabel('expCombat')
      return busyLabel('expBack')
    }
    if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('refine')
    if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('manufacture')
    if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return busyLabel('lab')
    if (state.transit.active && state.transit.delivery !== null) return busyLabel('deliver')
    return null
  }
  if (shipInReturn(state, shipId)) return busyLabel('unload')
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return null
  const task = assignment.task
  if (task.kind === 'mining') {
    if (task.phase === 'mining') return busyLabel('aiMining')
    return busyLabel(task.phase === 'outbound' ? 'aiMiningOut' : 'aiMiningBack')
  }
  if (task.kind === 'standby') return busyLabel(task.phase === 'out' ? 'aiPatrolTo' : 'aiPatrol')
  if (task.phase === 'out') return busyLabel('aiExpOut')
  if (task.phase === 'battle') return busyLabel('aiExpCombat')
  return busyLabel('aiExpBack')
}

export function skillQueueStatus(state: GameState, catalog: SkillCatalog): QueueView {
  const queue = state.skills.queue
  if (queue.length === 0) return { head: null, pending: [], totalRemainingMs: 0 }
  const item = queue[0]!
  const def = catalog.get(item.skillId)
  const currentLevel = state.skills.trained[item.skillId] ?? 0
  const intoLevel = currentLevel + 1
  const progress = def ? trainingLevelProgress(state, def, intoLevel, item.progressMs) : null
  const levelTimeMs = progress?.levelTimeMs ?? 0
  const remainingMs = progress?.remainingMs ?? 0
  const percent = progress?.percent ?? 0
  const head: HeadTrainingInfo = {
    skillId: item.skillId,
    skillName: def ? def.name : `未知技能「${item.skillId}」`,
    targetLevel: item.targetLevel,
    currentLevel,
    intoLevel,
    levelTimeMs,
    progressMs: progress?.progressMs ?? 0,
    remainingMs,
    percent,
  }
  let cursorMs = remainingMs
  const pending = queue.slice(1).map((p: TrainingItem, i) => {
    const pDef = catalog.get(p.skillId)
    const progress = pDef ? trainingLevelProgress(state, pDef, p.targetLevel, p.progressMs) : null
    const levelMs = progress?.levelTimeMs ?? 0
    const progressMs = progress?.progressMs ?? 0
    const etaMs = cursorMs
    cursorMs += levelMs - progressMs
    return {
      queueIndex: i + 1,
      skillId: p.skillId,
      skillName: pDef?.name ?? `未知技能「${p.skillId}」`,
      targetLevel: p.targetLevel,
      levelMs,
      progressMs,
      remainingMs: levelMs - progressMs,
      etaMs,
    }
  })
  return { head, pending, totalRemainingMs: cursorMs }
}
