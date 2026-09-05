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
import { manufacturingStatus } from './manufacturing'
import { oreAvailable } from './industry'
import { refineRunViews } from './industry'
import { expeditionStatus, bountyCooldownRemainingMs } from './expedition'
import { standbyStatus, transitStatus } from './location'
import { shipDisplayName } from './instances'

/** 活动种类（UI 据此渲染图标；新增耗时作业在此扩展） */
export type ActivityKind =
  | 'train'
  | 'mining'
  | 'scan'
  | 'manufacture'
  | 'refine'
  | 'expedition'
  | 'ai'
  | 'return'
  | 'transit'
  | 'standby'
  | 'loop'

/** 停止动作标识（UI → desktop engine 方法映射；停止参数如副船 id 放 param） */
export type ActivityStopKind =
  | 'remove-training'
  | 'stop-mining'
  | 'stop-scan'
  | 'cancel-manufacture'
  | 'stop-refine'
  | 'recall-expedition'
  | 'retreat-battle'
  | 'cancel-ai'
  | 'recall-standby'
  | 'stop-loop'

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
      // T4 显式行程：出航/返航阶段给出精确剩余；采掘阶段只给循环进度
      remainingMs: mv.phase !== 'mining' ? mv.remainingMs : null,
      stopable: true,
      stop: 'stop-mining',
    })
  }

  // ── 扫描探索 ──
  const sv = scanStatus(state)
  if (sv.active) {
    out.push({
      id: 'scan',
      kind: 'scan',
      label: '扫描探索',
      sub: '未知信号',
      percent: sv.percent,
      remainingMs: sv.remainingMs,
      stopable: true,
      stop: 'stop-scan',
    })
  }

  // ── 制造 ──
  const mfv = manufacturingStatus(state, ctx)
  if (mfv.active) {
    out.push({
      id: 'manufacture',
      kind: 'manufacture',
      label: mfv.productName,
      sub: mfv.kind === 'ship' ? '造船中' : '制造中',
      percent: mfv.percent,
      remainingMs: mfv.remainingMs,
      stopable: true,
      stop: 'cancel-manufacture',
    })
  }

  // ── 精炼炉运转（v20 多台并行：每个资源/残骸可多台、逐台一条活动；主控/AI 核心驱动） ──
  for (const rv of refineRunViews(state, ctx)) {
    const isWreck = rv.itemId ? ctx.items.get(rv.itemId)?.kind === 'wreck' : false
    const remainUnits = rv.itemId ? oreAvailable(state, rv.itemId) : 0
    out.push({
      id: `refine:${rv.id}`,
      kind: 'refine',
      label: `${isWreck ? '残骸回收' : '精炼炉'} · ${rv.itemName}`,
      sub: `${rv.workerLabel}驱动 · 已 ${rv.batchesDone} 批 / 仓库余 ×${remainUnits}（每批 ${rv.batchUnits} 单位）`,
      percent: rv.percent,
      remainingMs: rv.remainingMs,
      stopable: true,
      stop: 'stop-refine',
      stopParam: String(rv.id),
    })
  }

  // ── 远征（去程/返航/交火） ──
  const ev = expeditionStatus(state, ctx)
  if (ev.active) {
    const inBattle = ev.phase === 'combat'
    out.push({
      id: 'expedition',
      kind: 'expedition',
      label: ev.anomalyName,
      sub: inBattle ? '实时交火中' : `${ev.phaseLabel}（${ev.galaxyName}）`,
      percent: ev.percent,
      remainingMs: ev.remainingMs,
      // 交火中可"撤退"（轻损脱离并返航）；去程/返航可"召回"
      stopable: true,
      stop: inBattle ? 'retreat-battle' : 'recall-expedition',
    })
  }

  // ── 连续出击（autoLoop：打完冷却后自动再出发；悬赏冷却/等待空窗也记录为玩家活动——船长 2026-09-05） ──
  const loopId = state.autoLoopAnomalyId
  if (loopId !== null) {
    const inFlight = state.expedition.active && state.expedition.anomalyId === loopId
    if (!inFlight) {
      const aName = ctx.anomalies.get(loopId)?.name ?? loopId
      const cdMs = bountyCooldownRemainingMs(state, loopId)
      const busyOther = state.mining.active || state.scanning.active || state.transit.active || state.standby.active
      out.push({
        id: 'loop',
        kind: 'loop',
        label: '连续出击',
        sub: busyOther
          ? `目标「${aName}」——等待当前作业结束，自动再出击`
          : cdMs > 0
            ? `目标「${aName}」——正在扫描新敌人`
            : `目标「${aName}」——即将自动再出击`,
        percent: null,
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
      // B1.5 AI 驻留待命（out 去程给倒计时；stand 驻留中）
      const gName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
      const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
      out.push({
        id: `ai-${shipId}`,
        kind: 'ai',
        label: `${shipName} · 驻留待命`,
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

  // ── T8 显式返航行程（野外 → 空间站，不可终止） ──
  const tv = transitStatus(state, ctx)
  if (tv.active) {
    out.push({
      id: 'transit',
      kind: 'transit',
      label: `返航空间站（${tv.toName}）`,
      sub: tv.fromName ? `自「${tv.fromName}」启程` : '野外返航',
      percent: tv.percent,
      remainingMs: tv.remainingMs,
      stopable: false,
      stopReason: '返航行程不可取消',
      stop: null,
    })
  }

  // ── B1.5 主控"前往星系待命"去程（可取消召回） ──
  const sbv = standbyStatus(state, ctx)
  if (sbv.active) {
    out.push({
      id: 'standby',
      kind: 'standby',
      label: `前往 ${sbv.targetName} 待命`,
      sub: '去程中',
      percent: sbv.percent,
      remainingMs: sbv.remainingMs,
      stopable: true,
      stop: 'recall-standby',
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
    const sb = standbyStatus(state, ctx)
    if (sb.active) return `待命·前往${sb.targetName}中`
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
  if (task.kind === 'standby') return task.phase === 'out' ? 'AI 待命·去程中' : 'AI 待命中'
  if (task.phase === 'out') return 'AI 远征·去程中'
  if (task.phase === 'battle') return 'AI 远征·交火中'
  return 'AI 远征·返航中'
}
