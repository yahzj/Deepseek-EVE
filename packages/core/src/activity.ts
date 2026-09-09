/**
 * 活动总览（T1）：顶部活动窗口的数据源——把当前所有进行中的"活动/作业"聚合成统一只读视图。
 *
 * 扩展约定（未来耗时作业，如"提炼耗时化"）：新增作业种类只需
 * 1) 扩展 ActivityKind 联合类型；2) 在本文件末尾按 kind 追加视图生成；
 * 3) UI 侧登记该 kind 的图标与停止动作。停止动作一律由"分发函数"承接，框架零改动。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import { skillQueueStatus } from './engine'
import { miningStatus, shipInReturn } from './mining'
import { scanStatus } from './explore'
import { manufacturingRunViews } from './manufacturing'
import { oreAvailable } from './industry'
import { refineRunViews } from './industry'
import { expeditionStatus, bountyCooldownRemainingMs, bountyCooldownMsFor } from './expedition'
import { standbyStatus, transitStatus } from './location'
import { shipDisplayName } from './instances'
import { legMsFor, outboundLegMsFor, salvagerCyclesOf } from './salvaging'
import { haulEndpointName } from './hauling'
import { travelMinutesEff } from './travel'

/** 活动种类（UI 据此渲染图标；新增耗时作业在此扩展） */
export type ActivityKind =
  | 'train'
  | 'mining'
  | 'scan'
  | 'salvage'
  | 'manufacture'
  | 'refine'
  | 'expedition'
  | 'ai'
  | 'return'
  | 'transit'
  | 'standby'
  | 'loop'
  | 'courier'
  | 'hauling'

/** 停止动作标识（UI → desktop engine 方法映射；停止参数如副船 id 放 param） */
export type ActivityStopKind =
  | 'remove-training'
  | 'stop-mining'
  | 'stop-scan'
  | 'stop-salvage'
  | 'cancel-manufacture'
  | 'stop-refine'
  | 'recall-expedition'
  | 'retreat-battle'
  | 'cancel-ai'
  | 'recall-standby'
  | 'cancel-deliver-trip'
  | 'stop-loop'
  | 'stop-hauling'

/** 一条活动（只读视图；引擎/指令仍是唯一修改入口） */
export interface ActivityView {
  /** 稳定 key（AI 任务用副船 id，其余用 kind） */
  id: string
  kind: ActivityKind
  label: string
  /** 阶段/目标补充说明（可空） */
  sub: string
  /** 0~100；null = 无进度概念（如 AI 往返中） */
  percent: number | null
  /** 剩余毫秒（null = 无法精确给出） */
  remainingMs: number | null
  /** 是否提供终止入口 */
  stopable: boolean
  /** 不可终止时的原因说明 */
  stopReason?: string
  /** 终止动作（stopable=true 时非空） */
  stop: ActivityStopKind | null
  /** 终止动作参数（cancel-ai 时为副船 id） */
  stopParam?: string
}

/** 当前全部进行中活动的只读视图（顺序：训练 → 主控作业 → AI） */
export function activityOverview(state: GameState, ctx: SimContext): ActivityView[] {
  const out: ActivityView[] = []

  // ── 技能训练（队首） ──
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

  // ── 主控采矿 ──
  const mv = miningStatus(state, ctx)
  if (mv.active) {
    out.push({
      id: 'mining',
      kind: 'mining',
      label: mv.beltName,
      sub: mv.phaseLabel,
      percent: mv.percent,
      // 返航阶段给出精确剩余；采掘阶段只给循环进度（去程已取消并入返航）
      remainingMs: mv.phase !== 'mining' ? mv.remainingMs : null,
      stopable: true,
      stop: 'stop-mining',
    })
  }

  // ── 主控打捞（B3：自动循环作业；2026-09-09 补齐活动栏进度条——出航/返航 = 行程进度，
  //    打捞中 = 主循环周期进度（最短打捞器周期档），与矿带页 salvageProgressOf 同源） ──
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
        // 返航腿 = 满载返航 + 空船去程（去程并入返航）
        const leg = Math.max(1, legMsFor(state, ctx, svg.galaxyId) + outboundLegMsFor(state, ctx, svg.galaxyId))
        percent = Math.min(100, Math.round((svg.phaseAccMs / leg) * 100))
        remainingMs = Math.max(0, leg - svg.phaseAccMs)
      } else {
        const cycles = salvagerCyclesOf(state, ctx, state.shipId)
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
      remainingMs: svg.phase === 'salvaging' ? null : remainingMs, // 打捞循环 = 周期条（无总剩余），行程 = 剩余倒计时
      stopable: true,
      stop: 'stop-salvage',
    })
  }

  // ── 长途运输（2026-09-09：两站间真实航程往返；到站自动结算续段；停止 = 立即返航出发站） ──
  const hg = state.hauling
  if (hg.active) {
    const leg = Math.max(1, hg.legMs)
    out.push({
      id: 'hauling',
      kind: 'hauling',
      label: `长途运输 · 往「${haulEndpointName(ctx, hg.toSiteId)}」`,
      sub: `航线 ${haulEndpointName(ctx, hg.routeA)} ⇄ ${haulEndpointName(ctx, hg.routeB)} · 本段实际约 ${Math.max(1, travelMinutesEff(state, ctx, hg.legMinutes))} 分钟`,
      percent: Math.min(100, Math.round((hg.phaseAccMs / leg) * 100)),
      remainingMs: Math.max(0, leg - hg.phaseAccMs),
      stopable: true,
      stop: 'stop-hauling',
    })
  }

  // ── 扫描探索（2026-09-06：窗口完成 → 自动返航段不可终止，只读展示） ──
  const sv = scanStatus(state)
  if (sv.active) {
    out.push({
      id: 'scan',
      kind: 'scan',
      label: sv.returning ? '扫描 · 自动返航' : '扫描探索',
      sub: sv.returning ? '情报已录入 · 返回母港' : '未知信号',
      percent: sv.percent,
      remainingMs: sv.remainingMs,
      stopable: !sv.returning,
      stop: sv.returning ? null : 'stop-scan',
    })
  }

  // ── 制造（v21 多工位：每条制造线一条活动；逐线可取消；2026-09-08 线带劳动者：主控/AI 核心/旧作业）──
  // 2026-09-08（船长反馈）：AI 核心驱动的生产线不占"玩家活动"位——并入 ⚙ AI 徽标计数
  // （kind='ai'）；主控亲自/旧作业仍逐条展示。
  for (const mfv of manufacturingRunViews(state, ctx)) {
    const aiProd = mfv.worker !== null && mfv.worker !== 'pilot'
    const who = mfv.worker === null ? '旧作业' : mfv.worker === 'pilot' ? '主控亲自' : `${mfv.workerLabel}驱动`
    out.push({
      id: aiProd ? `ai-prod-m:${mfv.id}` : `manufacture:${mfv.id}`,
      kind: aiProd ? 'ai' : 'manufacture',
      label: mfv.productName,
      sub: `${who} · ${mfv.kind === 'ship' ? '造船中' : '制造中'}`,
      percent: mfv.percent,
      remainingMs: mfv.remainingMs,
      stopable: true,
      stop: 'cancel-manufacture',
      stopParam: String(mfv.id),
    })
  }

  // ── 精炼炉运转（v20 多台并行：每个资源/残骸可多台、逐台一条活动；主控/AI 核心驱动）──
  // 2026-09-08（同制造口径）：AI 核心驱动的炉不占"玩家活动"位——并入 ⚙ AI 徽标计数
  for (const rv of refineRunViews(state, ctx)) {
    const aiProd = rv.worker !== 'pilot'
    const isWreck = rv.itemId ? ctx.items.get(rv.itemId)?.kind === 'wreck' : false
    const remainUnits = rv.itemId ? oreAvailable(state, rv.itemId) : 0
    out.push({
      id: aiProd ? `ai-prod-r:${rv.id}` : `refine:${rv.id}`,
      kind: aiProd ? 'ai' : 'refine',
      label: `${isWreck ? '残骸回收' : '精炼炉'} · ${rv.itemName}`,
      sub: `${rv.workerLabel}驱动 · 已 ${rv.batchesDone} 批 / 仓库余 ×${remainUnits}（每批 ${rv.batchUnits} 单位）`,
      percent: rv.percent,
      remainingMs: rv.remainingMs,
      stopable: true,
      stop: 'stop-refine',
      stopParam: String(rv.id),
    })
  }

  // ── 远征（去程/返航/交火；2026-09-06：胜利自动返航不可召回 → 无停止按钮） ──
  const ev = expeditionStatus(state, ctx)
  if (ev.active) {
    const inBattle = ev.phase === 'combat'
    const canStop = inBattle || ev.recallable
    // 2026-09-08（船长）：重复清剿中的本趟返航不另开独立活动行——在本次讨伐行内提供
    // 「停止清剿」（胜利返航原本不可召回，但允许停掉后续自动再出击）
    const loopReturning = state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === ev.anomalyId && ev.phase === 'back'
    let sub: string
    let stopable: boolean
    let stop: ActivityStopKind | null
    if (loopReturning) {
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
      percent: ev.percent,
      remainingMs: ev.remainingMs,
      stopable,
      stop,
    })
  }

  // ── 重复清剿（autoLoop：非出击/非返航的等待/冷却窗口行——2026-09-08 船长：出击/返航期间
  // 不再显示独立行，停止入口并入上方本次讨伐行） ──
  const loopId = state.autoLoopAnomalyId
  if (loopId !== null) {
    const inFlight = state.expedition.active && state.expedition.anomalyId === loopId
    if (!inFlight) {
      const aName = ctx.anomalies.get(loopId)?.name ?? loopId
      const cdMs = bountyCooldownRemainingMs(state, loopId)
      const busyOther = state.mining.active || state.scanning.active || state.transit.active || state.standby.active
      // 冷却段给进度条（总时长按当前驾驶船扫描属性估算；等待其它作业结束无确定终点 → 无条）
      let percent: number | null = null
      if (cdMs > 0) {
        const total = Math.max(1, bountyCooldownMsFor(state, ctx))
        percent = Math.min(100, Math.max(0, Math.round(((total - cdMs) / total) * 100)))
      }
      out.push({
        id: 'loop',
        kind: 'loop',
        label: '重复清剿',
        sub: busyOther
          ? `目标「${aName}」——等待当前作业结束，自动再出击`
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

  // ── AI 副船任务（每条） ──
  for (const [shipId, assignment] of Object.entries(state.aiAssignments)) {
    const shipName = shipDisplayName(state, ctx, shipId)
    const task = assignment.task
    if (task.kind === 'mining') {
      const beltName = ctx.belts.get(task.beltId)?.name ?? task.beltId
      const phase = task.phase === 'returning' ? '返航卸货' : task.phase === 'outbound' ? '前往矿带' : '采掘中'
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        label: `${shipName} · 采矿`,
        sub: `${beltName}（${phase}）`,
        percent: null,
        remainingMs: null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else if (task.kind === 'expedition') {
      const aName = ctx.anomalies.get(task.anomalyId)?.name ?? task.anomalyId
      const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
      const phase = task.phase === 'out' ? '去程' : task.phase === 'battle' ? '交火' : '返航'
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        label: `${shipName} · 远征`,
        sub: `${aName}（${phase}）`,
        percent: null,
        remainingMs: task.phase === 'battle' ? null : remain,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else if (task.kind === 'salvage') {
      // B3 AI 打捞任务
      const gName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
      const phase = task.phase === 'returning' ? '返航卸货' : task.phase === 'outbound' ? '出航' : '打捞中'
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        label: `${shipName} · 打捞`,
        sub: `${gName}（${phase}）`,
        percent: null,
        remainingMs: null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    } else {
      // B1.5 AI 掩护巡逻（out 去程给倒计时；stand 驻留中）
      const gName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
      const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        label: `${shipName} · 掩护巡逻`,
        sub: task.phase === 'out' ? `前往 ${gName}（去程 · 剩约 ${Math.max(1, Math.round(remain / 1000))} 秒）` : `留守「${gName}」`,
        percent: null,
        remainingMs: task.phase === 'out' ? remain : null,
        stopable: true,
        stop: 'cancel-ai',
        stopParam: shipId,
      })
    }
  }

  // ── T4 换船善后：自动返航卸货中的旧船（独立倒计时，不可终止）──
  for (const [shipId, ret] of Object.entries(state.shipReturns)) {
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

  // ── T8 显式返航行程（野外 → 空间站，不可终止）／建站交付航线（2026-09-08：真实航程，可随时取消） ──
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

  // ── B1.5 主控"前往星系掩护巡逻"（旧"待命"；新指令即时就位，仅旧档去程会显示） ──
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

  // ── 快递投送（v24 时效任务真实航行；一次一笔，到站自动结算，不可中途取消） ──
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

  return out
}

/**
 * T3：某艘船此刻是否在"出勤"（返回简洁中文忙态；null = 空闲）。
 * 判定源单一：驾驶船看主控作业（采矿/扫描/远征），副船看 AI 任务；
 * 制造与技能训练不绑船，不算忙。UI 的货仓页船徽标与以后复用都走这里。
 */
export function shipBusyLabel(state: GameState, ctx: SimContext, shipId: string): string | null {
  if (shipId === state.shipId) {
    const mv = miningStatus(state, ctx)
    if (mv.active) {
      if (state.mining.phase === 'mining') return '采矿中'
      return state.mining.phase === 'outbound' ? '采矿·出航中' : '采矿·返航中'
    }
    if (state.sideTasks.deliver !== null) return '快递投送中'
    const sb = standbyStatus(state, ctx)
    if (sb.active) return `掩护巡逻·前往${sb.targetName}中`
    const sv = scanStatus(state)
    if (sv.active) return '扫描探索中'
    const ev = expeditionStatus(state, ctx)
    if (ev.active) {
      if (ev.phase === 'out') return '远征·出航中'
      if (ev.phase === 'combat') return '远征·交火中'
      return '远征·返航中'
    }
    return null
  }
  // T4 换船善后：自动返航中的船（优先于 AI 判定；两者互斥，仅顺序防御）
  if (shipInReturn(state, shipId)) return '返航卸货中'
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return null
  const task = assignment.task
  if (task.kind === 'mining') {
    if (task.phase === 'mining') return 'AI 采矿中'
    return task.phase === 'outbound' ? 'AI 采矿·出航中' : 'AI 采矿·返航中'
  }
  if (task.kind === 'standby') return task.phase === 'out' ? 'AI 掩护巡逻·去程中' : 'AI 掩护巡逻中'
  if (task.phase === 'out') return 'AI 远征·去程中'
  if (task.phase === 'battle') return 'AI 远征·交火中'
  return 'AI 远征·返航中'
}
