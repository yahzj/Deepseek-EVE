/**
 * 星图探索（V13，设计已确认）：
 *
 * 规则（中文说明）：
 * - 迷雾 = 只显示"已探索"星系（exploredGalaxies，初始只有母港）+ 其一跳邻居（frontier 剪影）；
 *   再往后的星系完全不渲染；frontier 连向更远处的通道只画半段虚化（UI 层处理）。
 * - 点亮途径一：**到达点亮**——任何船实际抵达目标星系（远征到港开战 / 矿船到远处矿带开工）；
 *   在途作业（读档恢复等）由 ensureTransitExplored 运行时兜底自动点亮。
 * - 点亮途径二：**扫描探索**（startScan）——对剪影星系发起作业：
 *   前往（按跃迁实际耗时）→ 就地深空扫描 10 分钟 → 返航，作业完成回港时点亮并写日志。
 * - 行动封锁：目标星系未点亮（且非母港）时，远征出发 / 该星系矿带开采 / AI 派发均拒绝。
 * - 扫描期间随机事件倒计时按 balance.events.exploreBoost 加速，且事件改从"探索发现"池抽取
 *   （见 events.ts EXPLORE_EVENTS）。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { originGalaxyOf, startTransitHome } from './location'
import { onArriveAtGalaxy } from './station'
import { shortestTravelMinutes, travelLegMs } from './travel'

/** 扫描探索的就地扫描窗口（毫秒；时间类参数若需调参可挪入 balance） */
export const SCAN_WINDOW_MS = 10 * 60_000

/** 信号分析学（−8%/级）× 信号过滤学（−6%/级）乘算：扫描窗口（总下限 40%） */
export function scanWindowMsOf(state: GameState): number {
  const aLv = Math.min(5, state.skills.trained['signal-analysis'] ?? 0)
  const bLv = Math.min(5, state.skills.trained['signal-filtering'] ?? 0)
  const factor = Math.max(0.4, (1 - 0.08 * aLv) * (1 - 0.06 * bLv))
  return Math.round(SCAN_WINDOW_MS * factor)
}

/** 某星系是否已探索（母港恒为真） */
export function isExplored(state: GameState, galaxyId: string): boolean {
  return galaxyId === HOME_GALAXY_ID || state.exploredGalaxies.includes(galaxyId)
}

/** 把星系标记为已探索；返回是否新点亮（去重） */
export function markExplored(state: GameState, galaxyId: string): boolean {
  if (isExplored(state, galaxyId)) return false
  state.exploredGalaxies.push(galaxyId)
  return true
}

/** 未探索但"邻接已探索"的星系 id 列表（星图剪影 = 可扫描对象） */
export function frontierGalaxyIds(state: GameState, ctx: SimContext): string[] {
  const seen = new Set<string>(state.exploredGalaxies)
  const out: string[] = []
  for (const edge of ctx.galaxyEdges) {
    const aIn = seen.has(edge.from)
    const bIn = seen.has(edge.to)
    if (aIn !== bIn) {
      const id = aIn ? edge.to : edge.from
      if (!seen.has(id) && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/** 行动封锁检查：返回不可行动原因；null = 可行动（母港与已探索星系不受限） */
export function actionBlockReason(state: GameState, galaxyId: string | null | undefined): string | null {
  if (!galaxyId || galaxyId === HOME_GALAXY_ID) return null
  if (isExplored(state, galaxyId)) return null
  return '该星系尚未探索——先对星图上的「未知信号」执行扫描探索。'
}

/** 引擎内部：在途作业兜底点亮（读档恢复/老档迁移后，船已经在路上的星系视为已探明航路） */
export function ensureTransitExplored(state: GameState, ctx: SimContext): void {
  if (state.mining.active) {
    const belt = state.mining.beltId ? ctx.belts.get(state.mining.beltId) : undefined
    if (belt?.galaxyId) markExplored(state, belt.galaxyId)
  }
  if (state.salvaging.active && state.salvaging.galaxyId) {
    markExplored(state, state.salvaging.galaxyId)
  }
  if (state.expedition.active && state.expedition.anomalyId) {
    const anomaly = ctx.anomalies.get(state.expedition.anomalyId)
    if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
  }
  for (const assignment of Object.values(state.aiAssignments)) {
    const task = assignment.task
    if (task.kind === 'mining') {
      const belt = ctx.belts.get(task.beltId)
      if (belt?.galaxyId) markExplored(state, belt.galaxyId)
    } else if (task.kind === 'expedition') {
      const anomaly = ctx.anomalies.get(task.anomalyId)
      if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
    } else if (task.kind === 'standby') {
      markExplored(state, task.galaxyId)
    }
  }
}

/**
 * 玩家指令：对剪影星系发起扫描探索。
 * 校验：目标存在且未探索（母港无需扫）、是 frontier（信息可达）、无进行中的主控作业（采矿/远征/扫描/返航行程）。
 * T8：作业 = 去程 + 就地扫描窗口（出发时锁定）；窗口完成即"停留该星系"（不再自动返航）。
 */
export function startScan(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。` }
  if (isExplored(state, galaxyId)) return { ok: false, error: `「${galaxy.name}」已在星图中点亮，无需扫描。` }
  if (!frontierGalaxyIds(state, ctx).includes(galaxyId)) {
    return { ok: false, error: '该星系不在已知航线边缘，无法直接扫描——先探索它相邻的星系。' }
  }
  if (state.scanning.active) return { ok: false, error: '扫描探索作业进行中。' }
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：请先停止开采。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业进行中：请先停止打捞。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中：舰船不在空间站。' }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  if (state.transit.active) return { ok: false, error: '返航空间站途中：到站后再安排扫描。' }
  if (state.refineRun.active && state.refineRun.worker === 'pilot') {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出航扫描。' }
  }
  if (!state.fleet[state.shipId]) return { ok: false, error: '当前舰船数据缺失，无法出航扫描。' }

  // T8：出发地 = 当前位置（野外停留点或空间站）；作业开始时清野外标记（位置交给作业自身表达）
  const from = originGalaxyOf(state, ctx)
  const travelMin = shortestTravelMinutes(ctx, from, galaxyId)
  if (!Number.isFinite(travelMin)) return { ok: false, error: '该星系不在当前可达航线内，无法前往扫描。' }
  const fromName = ctx.galaxies.get(from)?.name ?? from
  state.awayGalaxy = null

  // 调试模式 debugQuick：扫描固定 1 秒完成
  if (state.debugQuick) {
    const sq = state.scanning
    sq.active = true
    sq.galaxyId = galaxyId
    sq.startedAtGameMs = state.gameMs
    sq.finishAtGameMs = state.gameMs + 1000
    sq.originGalaxy = from === HOME_GALAXY_ID ? null : from
    addLog(state, 'info', '开始扫描探索（调试模式）：1 秒后录入情报并停留。')
    return { ok: true }
  }
  let legMs = travelLegMs(state, ctx, travelMin)
  // 星图测绘学（cartography）：扫描去程 −6%/级
  const mapLv = Math.min(5, state.skills.trained['cartography'] ?? 0)
  if (mapLv > 0) legMs = Math.max(1, Math.round(legMs * (1 - 0.06 * mapLv)))
  // v14 续扫：终止过的星系只补扫剩余窗口（已完成部分保存在 state.scanProgress；窗口按信号分析学折算）
  const effWin = scanWindowMsOf(state)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[galaxyId] ?? 0)))
  const remainWindowMs = effWin - doneMs
  const totalMs = legMs + remainWindowMs
  const s = state.scanning
  s.active = true
  s.galaxyId = galaxyId
  s.startedAtGameMs = state.gameMs
  s.finishAtGameMs = state.gameMs + totalMs
  s.originGalaxy = from === HOME_GALAXY_ID ? null : from
  addLog(
    state,
    'info',
    doneMs > 0
      ? `开始扫描探索（续扫，从「${fromName}」出发）：就地扫描已完成 ${Math.round((doneMs / effWin) * 100)}%，本次只需补扫剩余 ${Math.round(remainWindowMs / 60_000)} 分钟窗口。`
      : `开始扫描探索：深空扫描艇从「${fromName}」出发驶向一处「未知信号」——预计 ${Math.round(totalMs / 60_000)} 分钟后录入情报并停留该星系。扫描期间更容易碰到有趣的东西。`,
  )
  return { ok: true }
}

/** 引擎内部：扫描作业完成（点亮星系、清进度、船停留该星系；advance 与"终止时窗口恰好完成"共用） */
function finishScan(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  const galaxy = s.galaxyId !== null ? ctx.galaxies.get(s.galaxyId) : undefined
  if (s.galaxyId !== null) delete state.scanProgress[s.galaxyId]
  const targetId = s.galaxyId
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null
  const newly = galaxy ? markExplored(state, galaxy.id) : false
  const name = galaxy?.name ?? '未知星系'
  // T8/T9：完成即"抵达"——建站点星系视档位停靠工地/副站；否则野外停留（不再自动返航）
  if (targetId !== null && targetId !== HOME_GALAXY_ID) {
    onArriveAtGalaxy(state, ctx, targetId)
  } else {
    state.awayGalaxy = null
  }
  addLog(
    state,
    'info',
    newly
      ? `✦ 扫描完成：「${name}」的情报已录入星图——航线、矿带与悬赏信息全部解锁；扫描艇停留该星系（可继续探索或返航空间站）。`
      : `✦ 扫描完成：「${name}」的补扫完成，没有发现新的信息；扫描艇停留该星系。`,
  )
}

/**
 * 玩家指令：终止扫描探索（v14 续扫语义 + T8 位置语义）。
 * 就地扫描窗口的已完成部分会保存进 state.scanProgress——下次对该星系扫描只补扫剩余窗口；
 * 终止后舰船自动返航空间站（去程即终止 = 从出发地折返；已在目标 = 从目标返航）。
 */
export function stopScan(state: GameState, ctx: SimContext): CommandResult {
  const s = state.scanning
  if (!s.active) return { ok: false, error: '当前没有进行中的扫描探索。' }
  const gid = s.galaxyId
  if (gid === null) {
    s.active = false
    return { ok: false, error: '扫描作业状态异常，已自动清理。' }
  }
  const galaxy = ctx.galaxies.get(gid)
  const galaxyName = galaxy?.name ?? gid
  const totalMs = Math.max(1, s.finishAtGameMs - s.startedAtGameMs)
  const effWin = scanWindowMsOf(state)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[gid] ?? 0)))
  const remainWindowMs = effWin - doneMs
  // T8 作业 = 去程 + 窗口（无返航段）：去程腿 = 总长 - 剩余窗口
  const legMs = Math.max(0, totalMs - remainWindowMs)
  const elapsed = Math.max(0, state.gameMs - s.startedAtGameMs)
  const origin = s.originGalaxy && s.originGalaxy !== HOME_GALAXY_ID ? s.originGalaxy : null

  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null

  if (elapsed < legMs) {
    // 还在去程路上：窗口进度无新增 → 折返空间站（从出发地计程；从母港出发则直接回港）
    if (doneMs > 0) {
      addLog(state, 'info', `已终止扫描探索（对「${galaxyName}」之前已保存 ${Math.round((doneMs / effWin) * 100)}% 窗口进度，下次续扫）。`)
    } else {
      addLog(state, 'info', `已终止扫描探索：对「${galaxyName}」的扫描艇尚未开始就地扫描，本次无进度可保留。`)
    }
    if (origin !== null) {
      state.awayGalaxy = origin
      startTransitHome(state, ctx)
    } else {
      addLog(state, 'info', '扫描艇已折返母港。')
    }
    return { ok: true }
  }
  if (elapsed >= totalMs) {
    // 窗口已完整走完（同帧推进边界）：直接结算点亮并停留
    finishScan(state, ctx)
    return { ok: true }
  }
  // 就地扫描进行中：保存窗口完成部分（按生效窗口上限），从目标返航空间站
  const windowDone = Math.min(remainWindowMs, Math.max(0, elapsed - legMs))
  const newDone = doneMs + windowDone
  const keep = Math.min(effWin - 1, newDone)
  if (keep > 0) state.scanProgress[gid] = keep
  addLog(
    state,
    'info',
    `已终止扫描探索：就地扫描完成 ${Math.round((keep / effWin) * 100)}%，进度已保存——下次对该星系扫描只需补扫剩余窗口。扫描艇正在返航空间站。`,
  )
  state.awayGalaxy = gid
  startTransitHome(state, ctx)
  return { ok: true }
}

/** 扫描进度查询（UI：百分比与剩余毫秒） */
export function scanStatus(state: GameState): {
  active: boolean
  galaxyId: string | null
  totalMs: number
  remainingMs: number
  percent: number
} {
  const s = state.scanning
  if (!s.active || s.galaxyId === null) {
    return { active: false, galaxyId: null, totalMs: 0, remainingMs: 0, percent: 0 }
  }
  const totalMs = Math.max(1, s.finishAtGameMs - s.startedAtGameMs)
  const remainingMs = Math.max(0, s.finishAtGameMs - state.gameMs)
  return {
    active: true,
    galaxyId: s.galaxyId,
    totalMs,
    remainingMs,
    percent: Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100)),
  }
}

/** 引擎内部：扫描作业推进（到点完成 → 点亮星系并写日志） */
export function advanceScanning(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  if (!s.active || s.galaxyId === null) return
  if (state.gameMs < s.finishAtGameMs) return
  finishScan(state, ctx)
}
