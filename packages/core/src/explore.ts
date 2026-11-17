import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'

export const SCAN_WINDOW_MS = 10 * 60_000
export const HOME_SCAN_WINDOW_MS = 10_000
export const SCAN_CURVE_EXP = Math.log(72) / Math.log(2.5)
export const SEC_FLOOR = -1

export function maxScanWindowMs(): number {
  return Math.round(SCAN_WINDOW_MS * Math.pow(1 + (0.5 - SEC_FLOOR), SCAN_CURVE_EXP))
}

export function scanSkillFactor(state: GameState): number {
  const aLv = Math.min(5, state.skills.trained['signal-analysis'] ?? 0)
  const bLv = Math.min(5, state.skills.trained['signal-filtering'] ?? 0)
  const cLv = Math.min(5, state.skills.trained['cartography'] ?? 0)
  return Math.max(0, (1 - 0.08 * aLv) * (1 - 0.06 * bLv) * (1 - 0.06 * cLv))
}

export function scanWindowMsOf(state: GameState): number {
  return Math.round(SCAN_WINDOW_MS * scanSkillFactor(state))
}

export function scanWindowMsFor(state: GameState, ctx: SimContext, galaxyId: string): number {
  if (galaxyId === HOME_GALAXY_ID) return HOME_SCAN_WINDOW_MS
  const galaxy = ctx.galaxies.get(galaxyId)
  const sec = galaxy?.security ?? 1
  const u = 0.5 - sec
  const shape = u > 0 ? Math.pow(1 + u, SCAN_CURVE_EXP) : 1
  return Math.round(SCAN_WINDOW_MS * scanSkillFactor(state) * shape)
}

export function isExplored(state: GameState, galaxyId: string): boolean {
  return state.exploredGalaxies.includes(galaxyId)
}

export function markExplored(state: GameState, galaxyId: string): boolean {
  if (isExplored(state, galaxyId)) return false
  state.exploredGalaxies.push(galaxyId)
  return true
}

export function frontierGalaxyIds(state: GameState, ctx: SimContext): string[] {
  const seen = new Set<string>(state.exploredGalaxies)
  const out: string[] = []
  if (!seen.has(HOME_GALAXY_ID) && ctx.galaxies.has(HOME_GALAXY_ID)) out.push(HOME_GALAXY_ID)
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

export function actionBlockReason(state: GameState, galaxyId: string | null | undefined): string | null {
  if (!galaxyId) return null
  if (isExplored(state, galaxyId)) return null
  return '该星系尚未探索——先对星图上的「未知信号」执行扫描探索。'
}

export function ensureTransitExplored(state: GameState, ctx: SimContext): void {
  if (state.mining.active && state.departure?.kind !== 'mining') {
    const belt = state.mining.beltId ? ctx.belts.get(state.mining.beltId) : undefined
    if (belt?.galaxyId) markExplored(state, belt.galaxyId)
  }
  if (state.salvaging.active && state.salvaging.galaxyId && state.departure?.kind !== 'salvaging') {
    markExplored(state, state.salvaging.galaxyId)
  }
  if (state.expedition.active && state.expedition.anomalyId && state.departure?.kind !== 'expedition') {
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

export function startScan(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) {
    return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.state.024', errorParams: { p1: galaxyId } }
  }
  if (isExplored(state, galaxyId)) {
    return {
      ok: false,
      error: `「${galaxy.name}」已在星图中点亮，无需扫描。`,
      errorId: 'core.explore.001',
      errorParams: { p1: galaxy.name },
    }
  }
  if (!frontierGalaxyIds(state, ctx).includes(galaxyId)) {
    return {
      ok: false,
      error: '该星系不在已知航线边缘，无法直接扫描——先探索它相邻的星系。',
      errorId: 'core.explore.002',
    }
  }
  if (state.scanning.active) {
    return {
      ok: false,
      error: '扫描艇正在执行另一处扫描：等它扫完，或先在星图页「终止扫描」（已扫部分会保留）。',
      errorId: 'core.explore.003',
    }
  }

  if (state.debugQuick) {
    const sq = state.scanning
    sq.active = true
    sq.galaxyId = galaxyId
    sq.startedAtGameMs = state.gameMs
    sq.finishAtGameMs = state.gameMs + 1000
    sq.originGalaxy = null
    sq.returning = false
    addLog(state, 'fleet', '已派出深空扫描艇：1 秒后录入情报。', 'core.explore.004')
    return { ok: true }
  }
  const effWin = scanWindowMsFor(state, ctx, galaxyId)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[galaxyId] ?? 0)))
  const remainWindowMs = effWin - doneMs
  const totalMs = remainWindowMs
  const s = state.scanning
  s.active = true
  s.galaxyId = galaxyId
  s.startedAtGameMs = state.gameMs
  s.finishAtGameMs = state.gameMs + totalMs
  s.originGalaxy = null
  s.returning = false
  const secOfTarget = galaxy?.security ?? 1
  const riskNote =
    secOfTarget < 0.5 ? '该星系信号嘈杂、扫描偏慢。' : '扫描期间更容易碰到有趣的东西。'
  addLog(
    state,
    'fleet',
    doneMs > 0
      ? `已派扫描艇续扫「${galaxy.name}」（就地扫描已完成 ${Math.round((doneMs / effWin) * 100)}%）：本次只需补扫剩余 ${Math.round(remainWindowMs / 60_000)} 分钟窗口。${riskNote}扫描不占主控——期间照常安排别的活动。`
      : `已派出深空扫描艇扫描「${galaxy.name}」：预计 ${Math.round(totalMs / 60_000)} 分钟后录入情报并点亮星图。${riskNote}扫描不占主控——期间照常安排别的活动。`,
  )
  return { ok: true }
}

function finishScan(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  const galaxy = s.galaxyId !== null ? ctx.galaxies.get(s.galaxyId) : undefined
  if (s.galaxyId !== null) delete state.scanProgress[s.galaxyId]
  const targetId = s.galaxyId
  const newly = galaxy ? markExplored(state, galaxy.id) : false
  const name = galaxy?.name ?? '未知星系'
  s.active = false
  s.galaxyId = null
  s.returning = false
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null
  s.awaitingView = true
  s.lastGalaxyId = targetId
  addLog(
    state,
    'fleet',
    newly
      ? `✦ 扫描完成：「${name}」的情报已录入星图——航线、矿带与悬赏信息全部解锁（扫描艇已收回）。`
      : `✦ 扫描完成：「${name}」的补扫完成，没有发现新的信息（扫描艇已收回）。`,
    newly ? 'core.explore.008' : 'core.explore.009',
    { p1: name },
  )
}

export function stopScan(state: GameState, ctx: SimContext): CommandResult {
  const s = state.scanning
  if (!s.active) return { ok: false, error: '当前没有进行中的扫描。', errorId: 'core.explore.005' }
  const gid = s.galaxyId
  if (gid === null) {
    s.active = false
    return { ok: false, error: '扫描状态异常，已自动清理。', errorId: 'core.explore.006' }
  }
  const galaxy = ctx.galaxies.get(gid)
  const galaxyName = galaxy?.name ?? gid
  const totalMs = Math.max(1, s.finishAtGameMs - s.startedAtGameMs)
  const elapsed = Math.max(0, state.gameMs - s.startedAtGameMs)
  if (elapsed >= totalMs) {
    finishScan(state, ctx)
    return { ok: true }
  }
  const effWin = scanWindowMsFor(state, ctx, gid)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[gid] ?? 0)))
  const keep = Math.min(effWin - 1, doneMs + elapsed)
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null
  s.returning = false
  if (keep > 0) {
    state.scanProgress[gid] = keep
    addLog(
      state,
      'fleet',
      `已召回扫描艇：对「${galaxyName}」的就地扫描完成 ${Math.round((keep / effWin) * 100)}%，进度已保存——下次对该星系扫描只需补扫剩余窗口。`,
    )
  } else {
    addLog(
      state,
      'fleet',
      `已召回扫描艇：对「${galaxyName}」的扫描尚未产生进度，随时可以重发。`,
      'core.explore.007',
      { p1: galaxyName },
    )
  }
  return { ok: true }
}

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

export function scanAwaitingView(state: GameState): { galaxyId: string | null } | null {
  return state.scanning.awaitingView === true ? { galaxyId: state.scanning.lastGalaxyId ?? null } : null
}

export function acknowledgeScanView(state: GameState): boolean {
  if (state.scanning.awaitingView !== true) return false
  state.scanning.awaitingView = false
  return true
}

export function advanceScanning(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  if (!s.active || s.galaxyId === null) return
  if (state.gameMs < s.finishAtGameMs) return
  finishScan(state, ctx)
}
