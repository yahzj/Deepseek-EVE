/**
 * 离线结算工具。
 *
 * 离线规则（M1/M2）：关掉游戏再打开时，按"真实离开时长"补进度，但最多只结算 8 小时：
 * - 技能队列照常推进（升级事件会出现在日志里）；
 * - 采矿作业若在挖，会按循环批量结算产出（货舱满了会停在离线期间——日志会记满舱）；
 * - 制造作业到点自动完成出装备；
 * - 重复清剿（重复清剿）开着时：按 30s 分片推进并在片边界以在线同款条件自动再出发——
 *   离线期间持续讨伐并有战果（2026-09-08 玩家反馈修复；关闭 freezeBattle 的调试快进不触发）；
 *   **每片按它自己走到的那一刻传墙钟**（2026-09-22 船长选「甲」）⇒ 跨界时，界前那段仍按
 *   离线前那版「敌对派系活跃」判、界后才换到上线时那版（详见函数内长注释）；
 *   ⚠ **2026-09-29 船长令**：活跃那条界由"本地 0 点"改为**本地 12:00**（赏金板仍 0 点）⇒
 *   下面凡讲"活跃按哪一版算"的地方，界都指**正午**；
 * - 结算完成后写摘要：离线多久、采集到哪些矿石、超出上限多少未结算。
 */

import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceGame } from './engine'
import { formatDurationMs } from './time'
import type { SettleStats } from './settleStats'
import { advanceAutoLoopBounty, advanceAutoLoopInvasion, autoLoopInvasionGalaxy } from './expedition'
import { ironmanOfflineCapBonusMs } from './ironman'
/* 技能加速「自动续用」（2026-10-01 船长令）：离线期间逐枚不写日志，只记账 ⇒ 结算那句汇总交代 */
import { offlineBoostRenewCount, setOfflineBoostTally } from './consumables'

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
 * **当前存档的离线结算上限**（含技能加成）——**结算与"超出上限"读数共用这一处**。
 *
 * 口径（加算叠加）：
 * - 离线作业管理学 `offline-ops`（2026-09-08 船长定：+8% → **+20%/级**）：每级 +0.2（基础 8 小时，满级 16 小时）；
 * - 无人值守调度学 `unattended-dispatch`（2026-09-20 船长定：上位技能 **+40%/级** · rank4）：每级 +0.4（满级 24 小时）；
 *   两技能并存叠加：双满级 = 8h × (1 + 1.0 + 2.0) = **32 小时**。
 *
 * ⚠ **为什么要单点**（2026-09-22 船长报障「技能的离线时间上限不生效」）：原先只有 `simulateOffline`
 * 内部算加成，而**引擎侧四处**（启动离线 / 读档 / 导入档 / 调试快进）各自用 `offlineSplit(…, 默认 8h)`
 * 算"超出上限的未结算时长" ⇒ **结算按 16~32h 走、报告却按 8h 报**，玩家看到的是"技能没用"。
 * 现在两处都读本函数，读数与结算必然一致。
 */
export function offlineCapMsOf(state: GameState, baseMs: number = DEFAULT_OFFLINE_CAP_MS): number {
  const opsLv = Math.min(5, state.skills.trained['offline-ops'] ?? 0)
  const dispatchLv = Math.min(5, state.skills.trained['unattended-dispatch'] ?? 0)
  /**
   * **铁人福利 A**（2026-09-23 船长令）：离线结算上限 **+8 小时**——加在**基准额度**上
   * （不是加在最终值上）⇒ 未点技能 8h → **16h**；双满级技能 32h → **64h**（乘区不变：
   * `(8h + 8h) × (1 + 1.0 + 2.0)`）。非铁人档加 0 ⇒ 既有读数逐字不变。
   */
  return Math.round((baseMs + ironmanOfflineCapBonusMs(state)) * (1 + 0.2 * opsLv + 0.4 * dispatchLv))
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
  // 离线结算上限（双技能加算）——与"超出上限"读数同源，见 `offlineCapMsOf`
  const capEff = offlineCapMsOf(state, capMs)
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
    'system',
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
  /**
   * **重复出击/重复清剿开着时：离线改分片推进**，每片边界按在线同款条件尝试再出发
   * （最后一片结束后不触发，避免开出不完整单）。
   *
   * ⚠ **2026-09-26 修玩家报障「自动清缴入侵悬赏，离线后进度不涨」**：原先这条判据只看
   * `state.autoLoopAnomalyId`（常驻悬赏那条循环），每片也只调 `advanceAutoLoopBounty`
   * ⇒ **入侵的「重复出击」在离线路径里没有任何调用点**（在线由心跳调 `advanceAutoLoopInvasion`）：
   * 离线期间不再出发 ⇒ 一整段离线只结算"关游戏前那一场"甚至一场都没有 ⇒ 夺回进度不涨。
   * 现两条循环一起驱动（两者互斥：开一条会清掉另一条，不活跃的那条立即返回 `null`）。
   */
  const driveLoop =
    !opts?.freezeBattle &&
    (state.autoLoopAnomalyId !== null || autoLoopInvasionGalaxy(state) !== null)
  let boostN = 0
  setOfflineBoostTally(true)
  try {
    if (driveLoop) {
      let remaining = deltaMs
      let guard = 0
    /**
     * **墙钟跟着片走（2026-09-22 船长选「甲」）**——分片这一路上会**在离线期间不停地再出发**
     * （`advanceAutoLoopBounty`），而"这一场吃不吃敌对派系活跃加成"是在**出发那一刻**按当时那一版活跃
     * 判的（`isFactionBounty` → `exp.factionActive`）。
     *
     * 原先整段离线共用"离线末刻"这一把墙钟 ⇒ 活跃在**第一片**就换成了**上线时**那版 ⇒ 界之前那几个
     * 小时打的场次全按"上线时抽中的星系"判（实测：跨界时该星系稀有残骸存量为 0）。现在**每片传它自己
     * 走到的那一刻** ⇒ 界前那些片仍按离线前那版判（原活跃星系照吃 ×1.1 与稀有残骸掷骰），
     * 界后的片才换到上线时那版；跨多界时每道界各换一次。
     *
     * ⚠ **2026-09-29 船长令**：活跃那条界由"本地 0 点"改为**本地 12:00**（赏金板仍 0 点）
     * ⇒ 上面说的"界"对**活跃**而言是**正午**（赏金日板那条仍是 0 点，两条各按各的）。
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
        if (remaining > 0) {
          // 两条循环各试一次（互斥 ⇒ 只有一个会真的再出发）；停环原因写进各自的通知字段
          advanceAutoLoopBounty(state, ctx)
          advanceAutoLoopInvasion(state, ctx, wallMs)
        }
      }
    } else {
      advanceGame(state, deltaMs, ctx, advOpts)
    }
    boostN = offlineBoostRenewCount()
  } finally {
    setOfflineBoostTally(false)
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
  /**
   * **技能加速自动续用的汇总**（**2026-10-01 船长令** 裁定④「在线逐枚写，离线只在汇总里写一句」）：
   * 整段离线里补了几枚就在这句里交代几枚 —— 玩家上线时既知道"训练一直在加速"、也知道"料少了多少"。
   */
  const boostText = boostN > 0 ? `；自动续用突触加速剂 ×${boostN}` : ''
  const overflowTxt = formatDurationMs(overflowMs)
  const tail = overflowMs > 0 ? `；超出上限的 ${overflowTxt} 未结算` : ''
  addLog(
    state,
    'system',
    `离线结算完成：推进 ${formatDurationMs(deltaMs)}${tail}${boostText}${minedText}，期间发生 ${eventCount} 条事件。`,
    'core.simulation.002',
    {
      p1: formatDurationMs(deltaMs),
      p2: tail,
      p3: minedText,
      p4: eventCount,
      p5: boostText,
      ...(boostN > 0 ? { p5Id: 'core.simulation.003', p5p1: boostN } : {}),
      /**
       * ⚠ **槽译文必须连"槽内参数"一起喂**（`p{n}p{k}`；**2026-09-29 实障修正**）：
       * 槽模板 `core.state.023`（「；超出上限的 {p1} 未结算」）自己带一个 `{p1}`，
       * 渲染层按 `p2p1` 取它 —— 只给 `p2Id` 的话那一槽的 `{p1}` **无人供给、原样漏出**
       * （实测日志里就是「超出上限的 {p1} 未结算」）。同款范式见 `events.ts` 的 `p2p1`、
       * `hauling.ts` 的 `p8p1`；漏喂已由 `npm run l10n:params` 的"槽内参数"检查兜住。
       */
      ...(overflowMs > 0 ? { p2Id: 'core.state.023', p2p1: overflowTxt } : {}),
    },
  )
}
