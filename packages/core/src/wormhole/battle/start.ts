/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { type WormholeFoeKind, wormholeCardIdForRun } from '../../wormholeFoes'
import type { CommandResult } from '../../engine'
import { withBattleRangeCheck } from '../../battleRangeMemory'
import { gridCellAt, hasLiveFoe, isExitCell, gridContentIndex } from '../../wormholeGrid'
import { startFleetBattleFor, stampFoeArrivalFx } from '../../combat'

/**
 * **开一场洞内战斗**（船长 2026-09-13：4 艘同时参战）。
 * - `kind='node'`：打**当前所在地点**（网格层：必须站在"舰船信号"地点上；老档线性层：`pendingNode.kind === 'combat'`）；
 * - `kind='boss'`：层末守卫（网格层：必须站在"下一层入口"上；老档线性层：层内节点走完）；
 * - `kind='ruins'`：遗迹收尾战（打捞完之后按确认条开打）。
 *
 * ⚠ **`'extract'` 撤离战已于 2026-09-15 退役**（船长「虫洞的撤离战取消吧」）⇒ 本函数**不再接受**它
 * （参数类型用 `Exclude<…, 'extract'>` 卡住）；老档里**已经在打**的撤离战仍由 `settleWormholeBattle`
 * 收口（那里保留 `'extract'` 分支只为兼容旧档）。
 * 战斗宿主 = `run.battle`（**不占** `expedition.battle`，故不走远征结算）。
 */
export function wormholeStartBattle(
  state: GameState,
  ctx: SimContext,
  kind: Exclude<WormholeFoeKind, 'extract'>,
  atGameMs: number = state.gameMs,
  /**
   * **校准用覆写**（可选）：只给 `tools/wormhole-econ.ts` 的**整趟模拟**做强度扫描用
   * （与 `startFleetBattleFor` 的 `strengthMul` 同一口径；引擎/实战一律走常量）。
   * ⚠ 首版工具只在"单场阶梯"里传了它、整趟模拟没传 ⇒ 扫描结果全是同一个系数（读数为假的对比）。
   */
  opts?: { strengthMul?: number },
): CommandResult {
  return withBattleRangeCheck(state, { kind: 'wormhole-fight', battleKind: kind, atGameMs, strengthMul: opts?.strengthMul }, staged => wormholeStartBattleMutable(staged, ctx, kind, atGameMs, opts))
}

export function wormholeStartBattleMutable(state: GameState, ctx: SimContext, kind: Exclude<WormholeFoeKind, 'extract'>,
  atGameMs: number, opts?: { strengthMul?: number }): CommandResult {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormholeBattle.001' }
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  if (run.expeditionRules === 2 && run.supplyVersion !== 1) return { ok: false, code: 'unsupported-rules' }
  if (run.battle) return { ok: false, error: '战斗还没结束。', errorId: 'core.wormholeBattle.002' }
  const grid = run.grid
  const here = grid ? gridCellAt(grid, grid.pos) : undefined
  /**
   * **这一格压着围剿者吗**（2026-09-23 新机制）：压着 ⇒ 本场按 `'spawn'` 用途打
   * （强度 = 该层普通节点、战果走折减形状、打赢后解除覆盖）。界面照旧调 `'node'`（袭击确认链同一条）。
   */
  const spawnHere = grid !== undefined && here !== undefined && hasLiveFoe(here)
  const eventHere = run.expeditionRules === 2 && here?.event?.battle === 'pending'
  if (run.expeditionRules === 2 && kind === 'node' && !spawnHere && !eventHere && here?.combatCleared) return { ok: false, errorId: 'core.wormholeBattle.008' }
  if (kind === 'node') {
    if (grid) {
      // 网格层：战斗由**地点**触发（舰船信号 / 遗迹收尾，后者 F3b 接）；围剿者盖在任何格上都算
      if (here?.place !== 'ship' && !spawnHere && !eventHere) {
        return { ok: false, error: '这里没有可交火的信号。', errorId: 'core.wormholeBattle.003' }
      }
    } else {
      if (!run.pendingNode) {
        return { ok: false, error: '本层已清空：该打层末守卫了。', errorId: 'core.wormholeBattle.004' }
      }
      if (run.pendingNode.kind !== 'combat') {
        return { ok: false, error: '这个节点不是战斗节点。', errorId: 'core.wormholeBattle.005' }
      }
    }
  } else if (kind === 'boss') {
    // 网格层：层末守卫守在"下一层入口"那一格上——站上去激活它才开打
    if (grid) {
      if (!here || !isExitCell(grid, grid.pos)) {
        return {
          ok: false,
          error: '层末守卫守在下一层入口：先找到并抵达入口。',
          errorId: 'core.wormholeBattle.006',
        }
      }
    } else if (run.pendingNode) {
      return { ok: false, error: '本层还没走完：先处理完层内节点。', errorId: 'core.wormholeBattle.007' }
    }
    if ((run.bossCleared ?? 0) >= run.depth) {
      return { ok: false, error: '本层守卫已经清掉了。', errorId: 'core.wormholeBattle.008' }
    }
  } else if (kind === 'ruins') {
    // **遗迹收尾战**（F3b）：网格层必须站在遗迹格上；**不再要求"那格已捞空"**（见下）
    if (!grid) return { ok: false, error: '遗迹收尾战只在网格层成立。', errorId: 'core.wormholeBattle.009' }
    if (here?.place !== 'ruins') return { ok: false, error: '这里不是遗迹。', errorId: 'core.wormholeBattle.010' }
    /**
     * ⚠ **2026-09-20 玩家报障修复**：「虫洞打捞有 BUG，我带一个打捞器摸 2、3 残骸的遗迹。**惊动敌人后
     * 有时候需要继续打捞，把残骸清空才能对敌。**」
     *
     * 根因：惊扰守卫的判定自 **2026-09-16 起提前到"遗迹第一次打捞"**（见 `wormholeSalvage.ts`
     * 的"遗迹首捞结算"）⇒ 掷中那一刻格上通常还剩 2~3 堆；而这里旧闸门还写着
     * 「**遗迹还没打捞完：先捞空再打。**」（那是"收尾战挂在捞空那一拍"时代的残留）⇒ 玩家点「迎战」
     * 只会收到这句拒因，**别的动作又都被 `gridActionBlocked` 拦着** ⇒ 只能一直捞到清空才打得成
     * （1 台打捞器时尤其明显）。
     *
     * 现行判据 = **`run.pendingRuinsBattle`**（"这一场欠着"的凭据，由首捞掷中时置位）：
     * 既不会漏掉该打的仗，也不会让人凭空开一场"没被惊动"的遗迹战。
     */
    if (run.pendingRuinsBattle !== true) {
      return { ok: false, error: '遗迹深处的守备还没被惊动：先在遗迹格上打捞一次。', errorId: 'core.wormholeBattle.011' }
    }
  } else if (kind === 'spawn') {
    /**
     * **围剿战**（2026-09-23 新机制）：只在网格层成立，且**当前格必须压着围剿者**。
     * 界面一般不必显式传它——袭击确认链照旧调 `'node'`，本函数按 `spawnHere` 自动改道；
     * 这条留给工具/用例（要一场"就是围剿者"的战斗时点名）。
     */
    if (!grid) return { ok: false, error: '围剿战只在网格层成立。', errorId: 'core.wormholeBattle.032' }
    if (!spawnHere) return { ok: false, error: '这里没有围剿者。', errorId: 'core.wormholeBattle.033' }
  }
  const waves = kind === 'node' && !grid ? Math.max(1, run.pendingNode?.waves ?? 1) : 1
  /**
   * 敌卡 = **本趟锁定的族**（船长 2026-09-14 定案 · 丁：一处虫洞一族、整趟同族）
   * × **该层的档位池**（船长 2026-09-15：层 1 只浅 / 层 2~3 中 2 : 浅 1 / 层 4+ 深 2 : 中 1 : 浅 1；
   * **层末守卫取该层最深已解锁档**）。
   *
   * 节点序号：网格层取**该格的内容序号**（`gridContentIndex` ⇒ 同格恒同卡、不同格有变化），
   * 线性老档取 `run.nodeIndex`；`run.family` 缺省（老档 / 调试入口）按 `run.seed` 现算 ⇒ 零迁移。
   */
  /** 本场用途：**压着围剿者 ⇒ `'spawn'`**（威胁照该层普通节点算、战果走折减形状、打赢解除覆盖） */
  const battleKind: WormholeFoeKind = spawnHere ? 'spawn' : kind
  const cardId =
    battleKind === 'spawn' && here?.foe
      ? here.foe.card // 刷出那一刻抽定的卡（随档）⇒ 读档后再打仍是同一张
      : wormholeCardIdForRun({
          family: run.family,
          seed: run.seed,
          depth: run.expeditionRules === 2 ? 1 : run.depth,
          kind: battleKind,
          nodeIndex: grid ? gridContentIndex(grid, grid.pos) : run.nodeIndex,
        })
  // 手动按真实卡记忆；自动探索每场由引擎计算，不读取玩家记录。
  const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, atGameMs, run.automaticBattleRanges ? null : undefined, {
    depth: run.depth,
    kind: battleKind,
    waves,
    ...(run.expeditionRules === 2 ? {
      expeditionRules: 2,
      expeditionRole: battleKind === 'spawn' ? 'patrol' as const : eventHere ? 'event' as const : battleKind === 'boss' ? 'guard' as const : here?.elite ? 'elite' as const : 'ordinary' as const,
      ...(battleKind === 'boss' && run.guardSupportDisabled ? { guardSupportDisabled: true } : {}),
      ...(run.nextBattleRangeMul ? { desireRangeMul: run.nextBattleRangeMul } : {}),
    } : {}),
    ...(opts?.strengthMul !== undefined ? { strengthMul: opts.strengthMul } : {}),
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。', errorId: 'core.wormholeBattle.012' }
  // **洞内开战 = 敌方跃迁入场**（船长 2026-09-13「虫洞内为敌方」）：给首波敌舰盖入场时刻
  // ⇒ 入场窗口内我方打不到它们（船长 2026-09-14「动画没结束不开火」）。
  // 洞外那一场是我方飞入、敌方没有入场动画 ⇒ **不盖**（有动画才有窗口）。
  stampFoeArrivalFx(battle)
  run.battle = battle
  if (run.expeditionRules === 2) delete run.nextBattleRangeMul
  // 开战成功 ⇒ 清「待迎战」标记（遗迹收尾战那条确认链到此闭合）
  if (run.pendingRuinsBattle === true) run.pendingRuinsBattle = false
  // **踩中埋伏**那条确认链同样到此闭合（船长 2026-09-16）
  if (run.pendingNodeBattle === true) run.pendingNodeBattle = false
  return { ok: true }
}
