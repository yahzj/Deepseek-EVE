/**
 * 离线结算工具。
 *
 * 离线规则（M1/M2）：关掉游戏再打开时，按"真实离开时长"补进度，但最多只结算 8 小时：
 * - 技能队列照常推进（升级事件会出现在日志里）；
 * - 采矿作业若在挖，会按循环批量结算产出（货舱满了会停在离线期间——日志会记满舱）；
 * - 制造作业到点自动完成出装备；
 * - 重复清剿（重复清剿）开着时：按 30s 分片推进并在片边界以在线同款条件自动再出发——
 *   离线期间持续讨伐并有战果（2026-09-08 玩家反馈修复；关闭 freezeBattle 的调试快进不触发）；
 *   **每片按它自己走到的那一刻传墙钟**（2026-09-22 船长选「甲」）⇒ 跨 0 点时，0 点前那段仍按
 *   离线前那版「敌对派系活跃」判、0 点后才换到上线日那版（详见函数内长注释）；
 * - 结算完成后写摘要：离线多久、采集到哪些矿石、超出上限多少未结算。
 */

import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceGame } from './engine'
import { countItem } from './inventory'
import { formatDurationMs } from './time'
import type { SettleStats } from './settleStats'
import { advanceAutoLoopBounty } from './expedition'
import { ironmanOfflineCapBonusMs } from './ironman'

// 兼容历史引用：formatDurationMs 现定义在 time.ts（避免模块循环依赖）
export { formatDurationMs } from './time'

/** 默认离线结算上限：8 小时（毫秒） */
export const DEFAULT_OFFLINE_CAP_MS = 8 * 60 * 60 * 1000

/**
 * 离线分片步长（毫秒）——仅「重复清剿（重复清剿）」开着时启用：
 * 在线时自动再出发由心跳驱动，离线大推进不会触发；分片推进并在每片边界按在线同款条件尝试再出发
 * （2026-09-08 玩家反馈：讨伐期间离线无战斗无收益）。
 */
export const OFFLINE_LOOP_CHUNK_MS = 30_000

/** 把一段真实离开时长切成"可结算部分 + 超出上限被放弃的部分" */
export function offlineSplit(
  rawGapMs: number,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
): { deltaMs: number; overflowMs: number } {
  const raw = Math.max(0, Math.floor(rawGapMs))
  const cap = Math.max(0, Math.floor(capMs))
  return { deltaMs: Math.min(raw, cap), overflowMs: Math.max(0, raw - cap) }
}

/**
 * 读档后的离线结算入口：
 * 1. 真实时钟没往前走（含回拨）→ 不做任何事；
 * 2. 推进游戏（技能升级/采矿产出/满舱事件的日志自然出现）；
 * 3. 前后对比物品栏，把离线期间采到的矿石写进摘要日志。
 */
export function simulateOffline(
  state: GameState,
  lastSavedWallMs: number,
  nowWallMs: number,
  ctx: SimContext,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
  opts?: { freezeBattle?: boolean; stats?: SettleStats },
): void {
  const rawGap = nowWallMs - lastSavedWallMs
  if (rawGap <= 0) return
  // 离线结算上限双技能（加算叠加）：
  // - 离线作业管理学 offline-ops（2026-09-08 船长定：+8% → +20%/级）：每级 +0.2（基础 8 小时，满级 16 小时）；
  // - 无人值守调度学 unattended-dispatch（2026-09-20 船长定：上位技能 +40%/级 · rank4）：每级 +0.4（满级 24 小时）；
  //   两技能并存叠加：双满级 = 8h × (1 + 1.0 + 2.0) = 32 小时。
  const opsLv = Math.min(5, state.skills.trained['offline-ops'] ?? 0)
  const dispatchLv = Math.min(5, state.skills.trained['unattended-dispatch'] ?? 0)
  /**
   * **铁人福利 A**（2026-09-23 船长令）：「**离线结算上限 +8 小时**」——加在**基准额度**上
   * （不是加在最终值上）⇒ 未点技能 8h → **16h**；双满级技能 32h → **64h**（乘区不变：
   * `(8h + 8h) × (1 + 1.0 + 2.0)`）。非铁人档加 0 ⇒ 既有读数逐字不变。
   */
  const capEff = Math.round((capMs + ironmanOfflineCapBonusMs(state)) * (1 + 0.2 * opsLv + 0.4 * dispatchLv))
  const { deltaMs, overflowMs } = offlineSplit(rawGap, capEff)
  if (deltaMs <= 0) return

  // 记录结算前的数量（当前船货仓 + 物品仓库），用于结算后对比出"离线得了什么"
  const beforeCounts = new Map<string, number>()
  const snapshot = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) beforeCounts.set(id, (beforeCounts.get(id) ?? 0) + units)
    }
  }
  snapshot(state.fleet[state.shipId]?.cargo ?? {})
  snapshot(state.warehouse.items)

  // 记录结算前的日志条数（必须在写"离线归来"之前取，否则把这条也算进去）
  const before = state.logs.length
  addLog(
    state,
    'info',
    `离线归来：已离开 ${formatDurationMs(rawGap)}，开始结算……`,
    'core.simulation.001',
    { p1: formatDurationMs(rawGap) },
  )
  // nowWallMs = 离线末刻：赏金日板按**现实墙钟**对齐"每天本地 0 点"——离线跨过 0 点即整板换新
  // （跨多日只补最后一道界：中间那些天的板早已作废）。
  // ⚠ 这一把墙钟只给**大推进那条路**用；分片那条路（重复清剿开着）改成"墙钟跟着片走"，见下面的长注释。
  const advOpts = {
    freezeBattle: opts?.freezeBattle,
    settleStats: opts?.stats,
    nowWallMs: lastSavedWallMs + deltaMs,
    /**
     * **离线静默模式**（船长 2026-09-21 裁定「乙案」）：
     * 离线是**一次性大推进**，随机事件循环会把整段离线里到点的全部补发
     * ⇒ 上线瞬间日志刷屏 + 一批订单同生同灭 + 行情池被线性叠加。
     * 传 `true` ⇒ 事件只推进到点节奏、不产生任何副作用；上线只留下面那条汇总。
     */
    offline: true,
  }
  // 重复清剿（重复清剿）开着时：在线由心跳驱动自动再出发，离线大推进不会触发——
  // 改分片推进，每片边界按在线同款条件尝试再出发（最后一片结束后不触发，避免开出不完整单）。
  const driveLoop = !opts?.freezeBattle && state.autoLoopAnomalyId !== null
  if (driveLoop) {
    let remaining = deltaMs
    let guard = 0
    /**
     * **墙钟跟着片走（2026-09-22 船长选「甲」）**——分片这一路上会**在离线期间不停地再出发**
     * （`advanceAutoLoopBounty`），而"这一场吃不吃敌对派系活跃加成"是在**出发那一刻**按当时那张日板
     * 判的（`isFactionBounty` → `exp.factionActive`）。
     *
     * 原先整段离线共用"离线末刻"这一把墙钟 ⇒ 日板在**第一片**就换成了**上线日**那版 ⇒ 0 点之前那几个
     * 小时打的场次全按"上线日抽中的星系"判（实测：跨天时该星系稀有残骸存量为 0）。现在**每片传它自己
     * 走到的那一刻** ⇒ 0 点前那些片仍按离线前那版日板判（昨天的活跃星系照吃 ×1.1 与稀有残骸掷骰），
     * 0 点后的片才换到上线日那版；跨多日时每道日界各换一次。
     *
     * ⚠ **只改"传进去的墙钟"，不动分片本身**：片长/片数/每片一次 `advanceGame` 全都不变，末片的墙钟
     * 仍等于"离线末刻"（`state.wallMs` 落值与改前一致）⇒ 除日板相位外零副作用。
     * ⚠ **大推进那条路（没开重复清剿）故意不切**：那条路上离线期间不会再出发（`advanceAutoLoopBounty`
     * 只有在线心跳与这里两个调用点），战果早在出发那一刻锁定 ⇒ 切段没有收益，反而会让"20 分钟
     * 资源/快递板只按末窗刷一次"（船长 2026-09-05 定）从 1 次变成 2~3 次。
     * 将来若那条路也能在离线中再出发，这里要一起改。
     */
    let wallMs = lastSavedWallMs
    while (remaining > 0) {
      if (++guard > 200_000) break // 防失控（30s 片 × 8h ≈ 960 片，余量充足）
      const step = Math.min(remaining, OFFLINE_LOOP_CHUNK_MS)
      wallMs += step
      advanceGame(state, step, ctx, { ...advOpts, nowWallMs: wallMs })
      remaining -= step
      if (remaining > 0) advanceAutoLoopBounty(state, ctx)
    }
  } else {
    advanceGame(state, deltaMs, ctx, advOpts)
  }
  // 事件数 = 总新增 - 1（减去"离线归来"本身）
  const eventCount = state.logs.length - before - 1

  // 离线期间物品只增不减（采矿自动入仓/卸货），正差即产出
  const gained: string[] = []
  const after = new Map<string, number>()
  const snapshotAfter = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) after.set(id, (after.get(id) ?? 0) + units)
    }
  }
  snapshotAfter(state.fleet[state.shipId]?.cargo ?? {})
  snapshotAfter(state.warehouse.items)
  for (const [id, unitsNow] of after) {
    const unitsBefore = beforeCounts.get(id) ?? 0
    if (unitsNow > unitsBefore) gained.push(`${ctx.items.get(id)?.name ?? id}×${unitsNow - unitsBefore}`)
  }
  const minedText = gained.length > 0 ? `；离线采集 ${gained.join('、')}` : ''
  const tail = overflowMs > 0 ? `；超出上限的 ${formatDurationMs(overflowMs)} 未结算` : ''
  addLog(
    state,
    'info',
    `离线结算完成：推进 ${formatDurationMs(deltaMs)}${tail}${minedText}，期间发生 ${eventCount} 条事件。`,
    'core.simulation.002',
    {
      p1: formatDurationMs(deltaMs),
      p2: tail,
      p3: minedText,
      p4: eventCount,
      ...(overflowMs > 0 ? { p2Id: 'core.state.023' } : {}),
    },
  )
}
