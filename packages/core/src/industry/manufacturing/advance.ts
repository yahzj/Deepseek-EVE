import { addLog } from '../../state'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { addWare } from '../../inventory'
import { bumpFirst } from '../../firstTasks'
import { addModule } from '../../equipment'
import { shipStoredCount } from '../../fleetBook'
import { aiEfficiency, releaseAiCore } from '../../ai'
import { addAiIncome, addAiMakeDone, addAiShipDone, type SettleStats } from '../../settleStats'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeManufacturingUnlocked } from '../../probeManufacturing'
import { loopRefOf } from './loop'
import { findBuildable, productNameOf } from './blueprints'
import { missingMaterials, spendMaterialsFor } from './materials'
import { calcBuildDurationMs } from './duration'

/** 市场基准价（离线结算预估收入用：装备/舰船粗估；找不到返回 0） */
function marketBasePrice(ctx: SimContext, kind: 'module' | 'ship', refId: string): number {
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === kind && g.refId === refId) return g.basePrice ?? 0
  }
  return 0
}

/** 引擎内部调用：推进全部制造线（每次时间推进后调用；v21 多工位逐线检查到点；
 * AI 核心驱动的线到点完成即归还核心。stats = 离线结算统计器（可选，见 settleStats.ts）
 * 循环制造（2026-09-10 上移到卡片级）：开关与目标批数按蓝图读 state.manufacturingLoops，
 * 该卡全部线共用——完成一件后自动续做同一蓝图（劳动者保持占用、相位推进 finishAt 可跨大 delta
 * 连续结算多件），本轮合计 produced **逐批累加**；停止条件 = 合计达目标批数 / 材料不足 / 记录缺失 /
 * 开关已关（完成最后一件即止）。自动停线时把 `on` 置假并记 `stopWhy`（每卡一条汇总日志），
 * 该卡其它线跑完当前件即止、核心归还。 */
export function advanceManufacturing(state: GameState, ctx: SimContext, stats?: SettleStats): void {
  for (let i = state.manufacturingRuns.length - 1; i >= 0; i--) {
    const mf = state.manufacturingRuns[i]!
    if (!mf.active || state.gameMs < mf.finishAtGameMs) continue

    const blueprintId = mf.blueprintId
    const worker = mf.worker
    const byCore = worker !== undefined && worker !== 'pilot'
    // 卡片级循环（2026-09-10 船长定）：同一张卡的线共用开关/目标/合计，实时读、不往线上写副本
    const loop = loopRefOf(state, blueprintId)
    const auto = loop?.on === true
    let guard = 0
    let stopWhy = '' // 收尾原因（非循环线恒为空；空 = 正常完成停止/开关已关）


    /** 结算当前这一件（产出入账 + 完成日志 + 离线统计）；记录缺失抛错由调用处 catch 语义处理 */
    const settlePiece = (buildable: NonNullable<ReturnType<typeof findBuildable>>): boolean => {
      const coreType = byCore ? (worker as AiCoreType) : undefined
      if (buildable.kind === 'module') {
        const moduleDef = buildable.moduleId ? ctx.modules.get(buildable.moduleId) : undefined
        if (!moduleDef) return false
        addModule(state, moduleDef.id)
        addLog(
          state,
          'industry',
          `制造完成：${moduleDef.name} 已放入装备库，可以到装配台安装了。`,
          'core.manufacturing.014',
          { p1: moduleDef.name },
        )
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'module', moduleDef.id))
        }
      } else if (buildable.kind === 'ship') {
        const shipDef = buildable.shipId ? ctx.ships.get(buildable.shipId) : undefined
        if (!shipDef) return false
        // 2026-09-14 船长：「所有组装机生产的舰船都放进舰船仓库内，并允许堆叠数量」
        // ⇒ 不再直接进机库；要驾驶/指派先到舰船页把船转入舰队（`shipyard.unstoreShip`）
        state.shipStore = state.shipStore ?? {}
        state.shipStore[shipDef.id] = shipStoredCount(state, shipDef.id) + 1
        // 2026-09-15 船长（首艘自造船通讯 `msg-first-ship`）：**置位点唯一就在这里**——主控亲手开线的产出
        // 与 AI 核心代造（含离线期间造的）都从这一处出水 ⇒ 通讯说的"造好第一条船"与产出入仓是**同一个事实**，
        // 不会各说各的；只置一次（已经是 true 就不再写，避免无谓的存档变动）。
        if (state.firstShipBuilt !== true) state.firstShipBuilt = true
        // 「第一条船」与「造船厂主」链的计数落点（2026-09-18 修）：**造船交付这一处**才是
        // "造出自造船"的事实。⚠ 原先这一行被落在 `shipyard.unstoreShip`（从舰船仓库**转入舰队**）里
        // ⇒ 玩家按正常路径造船时 `ships` 永不增加、「第一条船」判不过（探针实测 90 分钟游戏时间也完不成）。
        bumpFirst(state, 'ships')
        addLog(
          state,
          'industry',
          `造船完成：${shipDef.name} 已入舰船仓库（现有 ${state.shipStore[shipDef.id]} 艘）——到舰船页「舰船仓库」可转入舰队。`,
        )
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          // 2026-09-14 船长「补」：舰船产出入的是舰船仓库 ⇒ 离线简报里单列「造船 ×N」
          addAiShipDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'ship', shipDef.id))
        }
      } else {
        // 2026-09-05 弹药蓝图：物品类产物按 outputUnits 批量入物品仓库
        const itemDef = buildable.itemId ? ctx.items.get(buildable.itemId) : undefined
        if (!itemDef) return false
        const n = Math.max(1, buildable.outputUnits ?? 1)
        addWare(state, itemDef.id, n)
      bumpFirst(state, 'produceUnits', n) // 第一次任务/链：组装机产出件数
        // 2026-09-20 零件体系：零件制造完成**不写事件日志**（船长定）——其余物品照旧
        if (itemDef.kind !== 'part') {
          addLog(state, 'industry', `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`)
        }
        // 2026-09-20 零件体系：零件制造完成**不写事件日志**（船长定）——其余物品照旧
        if (itemDef.kind !== 'part') {
          addLog(
            state,
            'industry',
            `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`,
            'core.manufacturing.015',
            { p1: itemDef.name, p2: n.toLocaleString('zh-CN') },
          )
        }
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, n * (itemDef.baseSellPriceIsk ?? 0))
        }
      }
      return true
    }

    while (state.gameMs >= mf.finishAtGameMs) {
      if (++guard > 100_000) {
        stopWhy = '连续推进超过保护上限，循环已中断'
        break
      }
      const buildable = blueprintId ? findBuildable(ctx, blueprintId) : null
      if (!buildable) {
        addLog(state, 'industry', '制造作业引用的蓝图记录缺失，产出已丢弃（异常）。', 'core.manufacturing.012')
        stopWhy = '蓝图记录缺失'
        break
      }
      // 本轮全卡合计（2026-09-10：卡片级计数，**开关打开期间逐批累加**——含首件；
      // 达成目标时停在"正好等于目标"的**批数**上，随后收尾的在跑件不再计入，故合计即停线依据）
      if (loop && loop.on === true) loop.produced = (loop.produced ?? 0) + 1
      if (!settlePiece(buildable)) {
        addLog(state, 'industry', '制造作业引用的产物记录缺失，产出已丢弃（异常）。', 'core.manufacturing.013')
        stopWhy = '产物记录缺失'
        break
      }
      /**
       * **交付了这一件 ⇒ 它那笔退料账结清**（**2026-10-01 收口**）：账只记"在跑那一件已扣的料"，
       * 于是取消/停机时退的是**当前在跑那件**（原先只在开工记一笔 ⇒ 循环里越跑越对不上）。
       */
      mf.spentMaterials = []
      if (!auto) break
      const goal = loop && loop.goal && loop.goal > 0 ? loop.goal : null
      if (goal !== null && (loop?.produced ?? 0) >= goal) {
        stopWhy = `已达成目标 ${goal} 批`
        break
      }
      if (blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID && !probeManufacturingUnlocked(state)) {
        stopWhy = '星系搜索尚未解锁'
        break
      }
      const missing = missingMaterials(state, ctx, buildable.spec, blueprintId ?? undefined)
      if (missing.length > 0) {
        stopWhy = `材料不足（缺 ${missing.join('、')}）`
        break
      }
      // 续做下一件：即时扣料、按当前技能重算耗时并相位推进（劳动者/核心保持占用）
      let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
      if (worker !== undefined && worker !== 'pilot') {
        const eff = aiEfficiency(state, ctx, worker)
        durationMs = Math.max(1, Math.round(durationMs / eff))
      }
      const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
      if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0, 1 - 0.05 * autoLv)))
      /**
       * ⚠ **与开工同一把尺**（**2026-10-01 收口**）：等价组按组序取够 ＋ 逐笔记进退料账 ＋ **扣不动就停线**。
       * 原先这里自己写了一句 `removeWare(need.itemId, …)`（不走等价组、不记账、不看返回值）
       * ⇒ 玩家手上只有通用黑匣时**续做的那几件白造**。
       */
      const spent: { itemId: string; count: number }[] = []
      if (!spendMaterialsFor(state, buildable.spec.materials, spent, blueprintId!)) {
        stopWhy = `材料不足（缺 ${missing.join('、')}）`
        break
      }
      mf.spentMaterials = spent
      mf.finishAtGameMs += durationMs
      mf.durationMs = durationMs
    }

    // 收尾判定：单件线 / 开关已关 / 带停因（达目标/缺料/记录缺失）→ 移除线并归还核心；
    // 循环正常续产中（已重排下一件到点）→ 线保留到下一 tick
    const lineEnds = !auto || stopWhy !== ''
    if (!lineEnds) continue
    state.manufacturingRuns.splice(i, 1)
    if (byCore) releaseAiCore(state, worker)
    if (auto && stopWhy) {
      // 卡片级自动停线（2026-09-10 船长定：达成目标/材料不足 → 自动关开关 + 卡片上标停因）。
      // 同一 tick 内同卡多条线一起到点时**只结一次账**（后面的线读到 on=false 即自然收尾、不重复记日志）
      const rest = blueprintId
        ? state.manufacturingRuns.filter((r) => r.active && r.blueprintId === blueprintId).length
        : 0
      const b = blueprintId ? findBuildable(ctx, blueprintId) : null
      const nm = b ? productNameOf(ctx, b, blueprintId ?? '') : (blueprintId ?? '')
      if (loop && loop.on === true) {
        loop.on = false
        loop.stopWhy = stopWhy
        addLog(
          state,
          'industry',
          `循环制造停止：${nm}（本卡合计 ${loop.produced ?? 0} 批）——${stopWhy}${
            rest > 0 ? `；本卡其余 ${rest} 条线跑完当前件即停` : ''
          }${byCore ? '；AI 核心已归还核心库' : ''}`,
        )
      }
    }
  }
}
