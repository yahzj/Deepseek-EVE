/**
 * **「第一次」任务的奖励发放**（2026-09-18 船长逐条裁定奖励表后，从头注释里的 `grantFirstReward` 拆出来）。
 *
 * 为什么单独一件：奖励要落进**六个不同的口袋**——蓝图书（`blueprintStock`）· 仓库物品（`warehouse.items`）·
 * 装备库（`moduleBay`）· 机库（`fleet`，需按同型自动编号）· AI 核心账本（`aiCores`）· 虫洞库存（`wormholeStock`）——
 * 而 `inventory` / `shipyard` / `wormholeScan` 三个写入方**都反向依赖 `firstTasks`**（用 `bumpFirst` 记数），
 * 所以那几处 import 只能放在这个**没人反向依赖**的模块里；`firstTasks.ts` 继续保持"零运行期 import"。
 *
 * 口径：奖励只在任务**首次完成**那一次发放（去重键 = `importantTasks[id].done`，由调用方保证）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import type { FirstReward, FirstTaskDef } from './firstTasks'
import { FIRST_TASKS, isFirstTaskCurrent, visibleFirstTasks } from './firstTasks'
import { addWare } from './inventory'
import { addShipToFleet } from './shipyard'
import { grantWormholeStock } from './wormholeScan'
import { addLog } from './state'

/** 奖励口袋的中文名解析（本模块不查内容表 ⇒ 一律走 `ctx` 的三个目录；查不到就回落 id） */
function nameOfFrom(ctx: SimContext) {
  return (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string): string =>
    kind === 'blueprint'
      ? (ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
      : kind === 'ware'
        ? (ctx.items.get(id)?.name ?? id)
        : kind === 'module'
          ? (ctx.modules.get(id)?.name ?? id)
          : (ctx.ships.get(id)?.name ?? id)
}

/** 玩家可见的发放日志（一句话；说明文案口径：不写原因解释、短句陈述） */
function grantLog(name: string): string {
  return `◆ 任务奖励已发放：${name}。`
}
/** 起手道具的发放日志（与上面分开写，玩家一眼能分清"这是开始给的"） */
function startGrantLog(name: string): string {
  return `◆ 任务起手道具已发放：${name}。`
}

/**
 * **把某个口袋逐项落袋**（`pocket`：`reward` = 完成奖励 / `startReward` = 起手道具）——
 * 两个口袋走**同一段代码**，只有日志前缀不同；`nameOf` 由调用方给（本模块不查内容表，避免再拉依赖）。
 */
export function grantFirstPocket(
  state: GameState,
  ctx: SimContext,
  def: FirstTaskDef,
  pocket: 'reward' | 'startReward',
  nameOf: (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string) => string,
): void {
  const r: FirstReward | undefined = pocket === 'reward' ? def.reward : def.startReward
  if (!r) return
  const granted: string[] = []

  for (const b of r.blueprints ?? []) {
    state.blueprintStock[b.blueprintId] = (state.blueprintStock[b.blueprintId] ?? 0) + b.units
    granted.push(`${nameOf('blueprint', b.blueprintId)} ×${b.units}`)
  }
  for (const w of r.ware ?? []) {
    addWare(state, w.itemId, w.units)
    granted.push(`${nameOf('ware', w.itemId)} ×${w.units}`)
  }
  for (const m of r.modules ?? []) {
    state.moduleBay[m.moduleId] = (state.moduleBay[m.moduleId] ?? 0) + m.units
    granted.push(`${nameOf('module', m.moduleId)} ×${m.units}`)
  }
  for (const s of r.ships ?? []) {
    for (let i = 0; i < s.units; i++) addShipToFleet(state, s.defId)
    granted.push(`${nameOf('ship', s.defId)} ×${s.units}`)
  }
  for (const c of r.aiCores ?? []) {
    // 与 `ai.gainAiCore` 同口径（**核心不进仓库**，直接进账本）；此处就地写以避开反向依赖
    state.aiCores[c.type] = (state.aiCores[c.type] ?? 0) + c.units
    granted.push(`基础 AI 核心 ×${c.units}`)
  }
  if (r.wormholeStock !== undefined && r.wormholeStock > 0) {
    const n = grantWormholeStock(state, ctx, r.wormholeStock)
    granted.push(`未探索虫洞 ×${n}`)
  }
  if (r.isk !== undefined && r.isk > 0) {
    state.wallet.isk += r.isk
    granted.push(`${r.isk.toLocaleString('zh-CN')} 信用点`)
  }

  if (granted.length > 0) {
    const names = granted.join('、')
    const textId = pocket === 'reward' ? 'core.firstRewards.001' : 'core.firstRewards.007'
    addLog(state, 'trade', (pocket === 'reward' ? grantLog : startGrantLog)(names), textId, { p1: names })
  }
}

/** 按任务定义把**完成奖励**逐项落袋（`nameOf` 由调用方给；保留旧签名给既有调用方/用例） */
export function grantFirstReward(
  state: GameState,
  ctx: SimContext,
  def: FirstTaskDef,
  nameOf: (kind: 'blueprint' | 'ware' | 'module' | 'ship', id: string) => string,
): void {
  grantFirstPocket(state, ctx, def, 'reward', nameOf)
}

/**
 * **任务起手道具**（**2026-09-21 船长令**）——把"**现在轮到的那一条**（末段并列批则那两条）"的
 * `startReward` 发下去。
 *
 * 判据 = `visibleFirstTasks(state)`（与"显示哪一条"同一把尺）；去重键 = `importantTasks[id].started`
 * （**只在发放时写** ⇒ 老档零迁移、不回收）。**它不是每拍扫描**：只在两处调用——
 * ① 玩家点「完成」时（`claimFirstTask` ⇒ 顺手把新轮到的发掉，这就是船长要的"时间点很明确"）；
 * ② 序章收尾（`onboarding.finishPrologue`，只为"第一条本身就有起手道具"这一种情况）。
 */
export function grantStartRewardsForCurrent(state: GameState, ctx: SimContext): string[] {
  const nameOf = nameOfFrom(ctx)
  const out: string[] = []
  for (const def of visibleFirstTasks(state)) {
    if (!def.startReward) continue
    if (state.importantTasks[def.id]?.started === true) continue
    grantFirstPocket(state, ctx, def, 'startReward', nameOf)
    state.importantTasks[def.id] = { ...(state.importantTasks[def.id] ?? {}), started: true }
    out.push(def.id)
  }
  return out
}

/** 「点完成」的结果（渲染层据此给提示；不用 `CommandResult` 是为了避开 `engine` 的反向依赖） */
export interface ClaimFirstTaskResult {
  ok: boolean
  error?: string
  errorId?: string
  /** 本次新发下去的起手道具属于哪几条（读数用） */
  started?: string[]
}

/**
 * **玩家点「完成」**（**2026-09-21 船长令**：「第一次任务不要自动完成。要让玩家回到任务中心点击完成
 * 才开始下一步」）——任务链上**唯一的推进口**，校验 → 写 `done` → 发完成奖励 → 发下一条的起手道具。
 *
 * 四道校验（都给玩家看得懂的理由；界面上按钮本就会置灰，这里是 core 侧收口）：
 * ① 任务 id 存在 ② 没完成过 ③ **正轮到它** ④ 判据已满足。
 * 通讯/成就/里程碑解锁/下一阶段发布都读 `importantTasks[id].done` ⇒ 它们自然落在**这一点击之后**
 * （通讯在下一拍由 `advanceComms` 送达，与改前同一拍性）。
 */
export function claimFirstTask(state: GameState, ctx: SimContext, id: string): ClaimFirstTaskResult {
  const def = FIRST_TASKS.find((d) => d.id === id)
  if (!def) return { ok: false, error: `未知任务：${id}。`, errorId: 'core.firstRewards.002' }
  if (state.importantTasks[id]?.done === true) {
    return { ok: false, error: '这条任务已经完成过了。', errorId: 'core.firstRewards.003' }
  }
  if (!isFirstTaskCurrent(state, id)) {
    return { ok: false, error: '这条任务还没轮到：先完成当前那一条。', errorId: 'core.firstRewards.004' }
  }
  if (def.judge(state, ctx) < 1) {
    return { ok: false, error: '这条任务的条件还没达成。', errorId: 'core.firstRewards.005' }
  }
  state.importantTasks[id] = { ...(state.importantTasks[id] ?? {}), done: true }
  grantFirstPocket(state, ctx, def, 'reward', nameOfFrom(ctx))
  // 下一步的起手道具：**就在这一次点击里发**（船长 2026-09-21：「这样给予任务开始前道具的时间点就很明确」）
  const started = grantStartRewardsForCurrent(state, ctx)
  addLog(state, 'info', `◆ 任务完成：「${def.title}」。`, 'core.firstRewards.006', { p1: def.title })
  return { ok: true, started }
}
