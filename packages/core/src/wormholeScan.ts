import { ceilFinalQuantity } from './quantity'
import { promoScanMul, tuningMul } from './tuning'
import type { GameState, WormholeArchetype, WormholeFamily,  WormholeStockItem } from './state'
import { matterTechScanCut } from './matterTech'
import { addLog, wormholeScanHalt } from './state'
import { applyActivityGate } from './activityGate'
import type { SimContext } from './types'
import type { CommandResult, CoreBlockReason } from './engine'
import { scanSkillFactor } from './explore'
import { DSI_FACTION_ID, standingOf } from './expedition'
import { WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeFamilyOfSeed } from './wormholeFoes'

export const WORMHOLE_SCAN_BASE_MS = 12 * 60 * 60_000

export const WORMHOLE_STOCK_MAX = 5

export const WORMHOLE_STOCK_BONUS_PER_LEVEL = 2

export const WORMHOLE_STOCK_BONUS = 10

export const WORMHOLE_STOCK_MAX_HARD = WORMHOLE_STOCK_MAX + WORMHOLE_STOCK_BONUS

export function wormholeStockMaxOf(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['chart-archive'] ?? 0)
  return WORMHOLE_STOCK_MAX + WORMHOLE_STOCK_BONUS_PER_LEVEL * lv
}

export const WORMHOLE_STOCK_DEPTHS: readonly number[] = [1]

export const WORMHOLE_SCAN_UNLOCK_STANDING = 40

export function wormholeScanStanding(state: GameState): number {
  return standingOf(state, DSI_FACTION_ID)
}

export function wormholeScanUnlocked(state: GameState): boolean {
  return wormholeScanStanding(state) >= WORMHOLE_SCAN_UNLOCK_STANDING
}

export function happeningsScanFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  return Math.max(0, 1 - 0.04 * lv)
}

export function wormholeScanWindowMs(
  state: GameState,
  techCut = 0,
): number {
  if (state.debugQuick) return 1000
  return Math.max(
    1000,
    Math.round(
      WORMHOLE_SCAN_BASE_MS *
        scanSkillFactor(state) *
        happeningsScanFactor(state) *
        tuningMul(state, 'wormholeScanMs') *
        promoScanMul(state) *
        (1 - Math.min(0.9, Math.max(0, techCut))),
    ),
  )
}

export function wormholeStockOf(state: GameState): WormholeStockItem[] {
  return state.wormholeStock ?? []
}

export function wormholeStockFull(state: GameState): boolean {
  return wormholeStockOf(state).length >= wormholeStockMaxOf(state)
}

export function wormholeScanBlockReason(state: GameState): CoreBlockReason | null {
  if (!wormholeScanUnlocked(state)) {
    return {
      error: `扫描虫洞尚未解锁：需要「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（累计 ${wormholeScanStanding(state)}）——先去做协会的委托攒声望。`,
      errorId: 'core.wormholeScan.011',
      errorParams: { p1: WORMHOLE_SCAN_UNLOCK_STANDING, p2: wormholeScanStanding(state) },
    }
  }
  if (state.wormhole.run) {
    return { error: '已经在虫洞里了：先完成或撤离这一趟。', errorId: 'core.wormholeScan.012' }
  }
  if (state.encounter.active) {
    return { error: '遭遇战未决：先处理完当前遭遇。', errorId: 'core.wormholeScan.013' }
  }
  if (wormholeStockFull(state)) {
    return {
      error: `已囤积 ${wormholeStockMaxOf(state)} 处未探索的虫洞：先去探索掉一处再扫。`,
      errorId: 'core.wormholeScan.014',
      errorParams: { p1: wormholeStockMaxOf(state) },
    }
  }
  return null
}

export function wormholeScanStart(state: GameState, ctx: SimContext): CommandResult {
  const blocked = wormholeScanBlockReason(state)
  if (blocked) return { ok: false, error: blocked.error, errorId: blocked.errorId, errorParams: blocked.errorParams }
  if ((state.wormholeScan ?? { active: false, progressMs: 0 }).active) {
    return { ok: false, error: '扫描已经在跑。', errorId: 'core.wormholeScan.001' }
  }
  const gateSkip = applyActivityGate(state, 'wormholeScan', ctx)
  if (gateSkip) return gateSkip
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  scan.active = true
  const resumed = scan.progressMs > 0
  const scanMin = Math.floor(scan.progressMs / 60_000)
  addLog(
    state,
    'fleet',
    `🛰 开始扫描虫洞：主控就地展开扫描阵列${resumed ? `（续扫：已扫 ${scanMin} 分钟）` : ''}。`,
    resumed ? 'core.wormholeScan.003' : 'core.wormholeScan.002',
    resumed ? { p1: scanMin } : undefined,
  )
  return { ok: true }
}

export function wormholeScanStop(state: GameState): CommandResult {
  const mins = wormholeScanHalt(state)
  if (mins === null) return { ok: false, error: '扫描没在跑。', errorId: 'core.wormholeScan.004' }
  addLog(state, 'fleet', `🛰 停止扫描虫洞（进度保留：已扫 ${mins} 分钟）。`, 'core.wormholeScan.005', { p1: mins })
  return { ok: true }
}

export function reconcileWormholeScanWelcome(state: GameState): boolean {
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  if (scan.welcomed === true) return false
  if (!wormholeScanUnlocked(state)) return false
  scan.welcomed = true
  scan.progressMs = wormholeScanWindowMs(state)
  addLog(state, 'fleet', '🛰 虫洞扫描阵列已就绪：主控可就地展开扫描（进洞前记得带采集器与打捞器）。', 'core.wormholeScan.006')
  return true
}

let stockSeq = 0
function rollStockItem(state: GameState, ctx: SimContext): WormholeStockItem {
  const rng = (): number => {
    state.rng.count += 1
    let x = (state.rng.seed + state.rng.count * 2654435761) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
  void ctx
  stockSeq += 1
  const depth = WORMHOLE_STOCK_DEPTHS[Math.min(WORMHOLE_STOCK_DEPTHS.length - 1, Math.floor(rng() * WORMHOLE_STOCK_DEPTHS.length))]!
  const seed = Math.floor(rng() * 2_000_000_000) + 1
  return {
    id: `wh-${Date.now().toString(36)}-${stockSeq.toString(36)}`,
    seed,
    depth,
    archetype: wormholeArchetypeOf(seed),
    family: wormholeFamilyOfSeed(seed),
    foundAtGameMs: state.gameMs,
  }
}

export function wormholeStockDiscard(state: GameState, id: string): CommandResult {
  const list = wormholeStockOf(state)
  const hit = list.find((x) => x.id === id)
  if (!hit) return { ok: false, error: '这处虫洞不在了（可能已经探索过）。', errorId: 'core.wormholeScan.007' }
  const running = (state.wormholeAuto ?? []).find((r) => r.stockId === id)
  if (running) {
    return { ok: false, error: '这一处正在自动探索中：先召回那一趟，再放弃。', errorId: 'core.wormholeScan.008' }
  }
  state.wormholeStock = list.filter((x) => x.id !== id)
  const meta = wormholeStockMeta(hit)
  addLog(
    state,
    'fleet',
    `🛰 已放弃一处虫洞：${WORMHOLE_ARCHETYPE_LABELS[meta.archetype]}（那处通道就此关闭）。`,
    'core.wormholeScan.009',
    { p1: WORMHOLE_ARCHETYPE_LABELS[meta.archetype] },
  )
  return { ok: true }
}

export function wormholeStockMeta(item: WormholeStockItem): {
  archetype: WormholeArchetype
  family: WormholeFamily
} {
  return {
    archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
    family: item.family ?? wormholeFamilyOfSeed(item.seed),
  }
}

function stockPushUncapped(state: GameState, ctx: SimContext): WormholeStockItem {
  const item = rollStockItem(state, ctx)
  state.wormholeStock = [...wormholeStockOf(state), item]
  return item
}

export function wormholeStockPush(state: GameState, ctx: SimContext): WormholeStockItem | null {
  if (wormholeStockFull(state)) return null
  const item = stockPushUncapped(state, ctx)
  addLog(
    state,
    'fleet',
    `发现一处信号空间：${WORMHOLE_ARCHETYPE_LABELS[item.archetype ?? wormholeArchetypeOf(item.seed)]}，已记录${wormholeStockOf(state).length}/${wormholeStockMaxOf(state)}处。`,
    'core.explorationStatus.001',
    { p1: WORMHOLE_ARCHETYPE_LABELS[item.archetype ?? wormholeArchetypeOf(item.seed)], p1Id: ({ balanced: 'core.wormholeArch.001', wreck: 'core.wormholeArch.002', ruins: 'core.wormholeArch.003', vein: 'core.wormholeArch.004', combat: 'core.wormholeArch.005' } as Record<string, string>)[item.archetype ?? wormholeArchetypeOf(item.seed)]!, p2: wormholeStockOf(state).length, p3: wormholeStockMaxOf(state) },
  )
  return item
}

export function grantWormholeStock(state: GameState, ctx: SimContext, count: number): number {
  const n = Math.max(0, ceilFinalQuantity(count))
  if (n <= 0) return 0
  for (let i = 0; i < n; i++) stockPushUncapped(state, ctx)
  addLog(
    state,
    'fleet',
    `🛰 已标记 ${n} 处虫洞坐标（未探索）——到「扫描虫洞」页决定何时探索。`,
    'core.wormholeScan.010',
    { p1: n },
  )
  return n
}

export function wormholeStockTake(state: GameState, id: string): WormholeStockItem | undefined {
  const list = wormholeStockOf(state)
  const hit = list.find((x) => x.id === id)
  if (!hit) return undefined
  state.wormholeStock = list.filter((x) => x.id !== id)
  return hit
}

export function advanceWormholeScan(state: GameState, ctx: SimContext, deltaMs: number): void {
  const scan = state.wormholeScan
  if (!scan?.active || deltaMs <= 0) return
  const windowMs = wormholeScanWindowMs(state, matterTechScanCut(state, ctx))
  scan.progressMs += deltaMs
  while (scan.progressMs >= windowMs) {
    if (wormholeStockFull(state)) {
      scan.active = false
      scan.progressMs = windowMs
      addLog(
        state,
        'warn',
        `扫描已暂停：信号空间坐标达到上限${wormholeStockMaxOf(state)}处。`,
        'core.explorationStatus.003',
        { p1: wormholeStockMaxOf(state) },
      )
      return
    }
    scan.progressMs -= windowMs
    wormholeStockPush(state, ctx)
  }
}
