/**
 * **虫洞扫描（发现线）**（船长 2026-09-14 定案）：
 * 「新增主控活动：'扫描虫洞'。玩家需要在扫描虫洞界面内开始。在扫描的过程中，玩家遭遇随机事件的期望和星图中的
 * 扫描一致。并且会上涨一个进度条，进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」
 *
 * 口径（design §三 / §五，全部船长确认）：
 * - **扫描窗口 = 220 分钟 × 三技能乘算**（信号分析学 −8%/级 · 星图测绘学 −6%/级 · 信号过滤学 −6%/级，
 *   直接复用 `explore.scanSkillFactor` —— 与星图扫描**同一把尺**）；**不吃舰船属性**（船长：「无关」）。
 * - **随机事件期望与星图扫描同源**：暴露口径交给 `encounters`（本活动在暴露清单里与 `state.scanning` 并列）。
 * - **遇袭不中断**：被打不影响进度（进度按游戏时刻推进，不在遇袭时清零）。
 * - 进度满 ⇒ **发现 1 个虫洞**（随机种子 + 起始层）进库存，随后**自动续扫**。
 * - **库存上限 5**；满则**扫描停机**并提示（船长：「扫描停机并提示」）。
 * - 施工期铁律：本模块不产生玩家可见文案里的"虫洞"以外新术语；入口只在调试模式下出现。
 */
import type { GameState, WormholeScanState, WormholeStockItem } from './state'
import { addLog } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { scanSkillFactor } from './explore'
import { WORMHOLE_MAX_SHIPS } from './wormhole'

/** **扫描一个虫洞的基准时长**（船长 2026-09-14：「扫描基准设定为220分钟」） */
export const WORMHOLE_SCAN_BASE_MS = 220 * 60_000

/** **未探索虫洞的库存上限**（船长：「玩家最多可以囤积5个未开始探索的虫洞」） */
export const WORMHOLE_STOCK_MAX = 5

/** 起始层档位（发现时随机；越深越险、产出越高 —— 沿用既有层曲线，不新增机制） */
export const WORMHOLE_STOCK_DEPTHS: readonly number[] = [1, 2, 3]

/**
 * **本趟扫描窗口**（毫秒）= 基准 220 分钟 × 三技能乘算。
 * ⚠ 与星图扫描的区别只有"基准值"和"没有低安惩罚"（扫描虫洞不吃目标星系安全等级 —— 它扫的是深空；
 * 船长只要求"遇袭期望一致"，没要求时长也吃低安系数）。
 */
export function wormholeScanWindowMs(state: GameState): number {
  return Math.max(1000, Math.round(WORMHOLE_SCAN_BASE_MS * scanSkillFactor(state)))
}

/** 当前库存（发现即入列；上限 `WORMHOLE_STOCK_MAX`） */
export function wormholeStockOf(state: GameState): WormholeStockItem[] {
  return state.wormholeStock ?? []
}

/** 库存是否已满（满 ⇒ 扫描停机） */
export function wormholeStockFull(state: GameState): boolean {
  return wormholeStockOf(state).length >= WORMHOLE_STOCK_MAX
}

/** 能不能开扫（主控活动互斥：与采矿/打捞/扫描/远征/待命/过境/虫洞探索同一把尺） */
export function wormholeScanBlockReason(state: GameState): string | null {
  if (state.wormhole.run) return '已经在虫洞里了：先完成或撤离这一趟。'
  if (state.encounter.active) return '遭遇战未决：先处理完当前遭遇。'
  if (state.mining.active) return '主控正在采矿：一台主控同时只能干一件事。'
  if (state.salvaging.active) return '主控正在打捞：一台主控同时只能干一件事。'
  if (state.scanning.active) return '主控正在扫描星系：一台主控同时只能干一件事。'
  if (state.expedition.active) return '主控正在远征：一台主控同时只能干一件事。'
  if (state.transit.active) return '主控正在航行：到港后再开始扫描。'
  if (state.standby.active) return '主控正在待命：先取消待命。'
  if (wormholeStockFull(state)) {
    return `已囤积 ${WORMHOLE_STOCK_MAX} 处未探索的虫洞：先去探索掉一处再扫。`
  }
  return null
}

/** 开始扫描（**只能在扫描界面里点**；船长：「玩家需要在扫描虫洞界面内开始」） */
export function wormholeScanStart(state: GameState, _ctx: SimContext): CommandResult {
  const blocked = wormholeScanBlockReason(state)
  if (blocked) return { ok: false, error: blocked }
  if ((state.wormholeScan ?? { active: false, progressMs: 0 }).active) return { ok: false, error: '扫描已经在跑。' }
  /**
   * ⚠ **续扫不清零**（船长：「停扫保留进度」）：只置回 active，`progressMs` 原样接着累计。
   */
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  scan.active = true
  addLog(state, 'info', `🛰 开始扫描虫洞：主控就地展开扫描阵列${scan.progressMs > 0 ? `（续扫：已扫 ${Math.floor(scan.progressMs / 60_000)} 分钟）` : ''}。`)
  return { ok: true }
}

/** 手动停扫（进度保留：下次接着扫） */
export function wormholeScanStop(state: GameState): CommandResult {
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  if (!scan.active) return { ok: false, error: '扫描没在跑。' }
  scan.active = false
  const mins = Math.floor(scan.progressMs / 60_000)
  addLog(state, 'info', `🛰 停止扫描虫洞（进度保留：已扫 ${mins} 分钟）。`)
  return { ok: true }
}

let stockSeq = 0
/** 造一处"已发现"的虫洞（种子 + 起始层；界面按种子显示、进洞时用它建副本） */
function rollStockItem(state: GameState, ctx: SimContext): WormholeStockItem {
  const rng = (): number => {
    // 用引擎的随机流（同档可复现；不额外引入随机源）
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
  return {
    id: `wh-${Date.now().toString(36)}-${stockSeq.toString(36)}`,
    seed: Math.floor(rng() * 2_000_000_000) + 1,
    depth,
    foundAtGameMs: state.gameMs,
  }
}

/** 把一处新发现的虫洞放进库存（满了 ⇒ 不放进，返回 null） */
export function wormholeStockPush(state: GameState, ctx: SimContext): WormholeStockItem | null {
  if (wormholeStockFull(state)) return null
  const item = rollStockItem(state, ctx)
  state.wormholeStock = [...wormholeStockOf(state), item]
  addLog(
    state,
    'info',
    `🛰 发现虫洞：起始层 ${item.depth}（已囤积 ${state.wormholeStock.length}/${WORMHOLE_STOCK_MAX} 处）——到「扫描虫洞」页决定何时探索。`,
  )
  return item
}

/** 取走一处（进洞时消耗） */
export function wormholeStockTake(state: GameState, id: string): WormholeStockItem | undefined {
  const list = wormholeStockOf(state)
  const hit = list.find((x) => x.id === id)
  if (!hit) return undefined
  state.wormholeStock = list.filter((x) => x.id !== id)
  return hit
}

/**
 * **扫描推进**（`advanceGame` 每拍调用；进度按毫秒累计，满一个产出一个）。
 * - 遇袭**不清零**（船长：「遇袭不中断扫描」）——本函数不看战斗、不看遭遇；
 * - 库存满 ⇒ **停机并提示**（船长：「扫描停机并提示」）：活动停、进度停在满值，日志说清去哪处理。
 * - 离线大步长会一次跨过多个窗口 ⇒ **循环产出**（每满一个产一个，直到库存满或进度用尽）。
 */
export function advanceWormholeScan(state: GameState, ctx: SimContext, deltaMs: number): void {
  const scan = state.wormholeScan
  if (!scan?.active || deltaMs <= 0) return
  const windowMs = wormholeScanWindowMs(state)
  scan.progressMs += deltaMs
  while (scan.progressMs >= windowMs) {
    if (wormholeStockFull(state)) {
      scan.active = false
      scan.progressMs = windowMs
      addLog(
        state,
        'warn',
        `🛰 扫描停机：已囤积 ${WORMHOLE_STOCK_MAX} 处未探索的虫洞（上限）——先去探索掉一处，再回来开扫。`,
      )
      return
    }
    scan.progressMs -= windowMs
    wormholeStockPush(state, ctx)
  }
}
