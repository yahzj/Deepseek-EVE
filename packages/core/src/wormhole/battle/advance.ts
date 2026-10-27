/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { gridCellAt, hasLiveFoe } from '../../wormholeGrid'
import { wormholeStartBattle } from './start'
import { advanceBattleFor, battleShowWindowMs, battleClockNowMs } from '../../combat'
import { settleWormholeBattle } from './outcome'
import { wormholeHoldUsage } from '../../wormholeSalvage'
import { bagValueIsk, deliverExtraction } from './extraction'
import { repairCivilianFittings } from '../../equipment'
import type { WormholeRunState } from '../../wormhole'
import { uidDefId } from '../../labels'

export function advanceWormhole(
  state: GameState,
  ctx: SimContext,
  freezeBattle = false,
  battleSpeedX = 1,
): void {
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return
  if (!run) return
  reconcileWormholeFleet(state, ctx, run)
  // **临时离开 = 活动停止 ⇒ 洞内一切冻结**（船长 2026-09-13 批准 · 议案 A 第 4 条）：战斗不推进
  // （不掉血）、撤离不落地、收口不落地——回来接着打，进度原样在。
  if (run.attending !== true) return
  /**
   * **围剿者直接攻击**（**2026-09-23 船长公告定稿**：「围剿者正好落在玩家所在格时，**会直接攻击玩家的舰队**」）：
   * 站在压着围剿者的格上、又没有在途战斗 ⇒ 本拍**自动开一场 `'spawn'` 战**（不弹确认条、不等玩家点）。
   * 与"伏击/未扫描踩怪"那条确认链（`pendingNodeBattle`）有意分开：那两处仍按船长 2026-09-16 的口径先提示。
   */
  if (!run.battle && run.grid && run.pendingRuinsBattle !== true && !(run.supplyVersion === 1 && run.phase === 'extracting')) {
    const hereSpawn = gridCellAt(run.grid, run.grid.pos)
    if (hereSpawn !== undefined && hasLiveFoe(hereSpawn)) wormholeStartBattle(state, ctx, 'spawn')
  }
  if (run.battle) {
    /**
     * **冻结窗口（`freezeBattle`）⇒ 把战斗时钟整体前移，不是"留着以后补算"**
     * （**2026-09-21 修船长报障「进入虫洞的战斗后，双方舰船不开火，也不会移动改变距离」**）。
     *
     * 与 `expedition.ts` 里主控远征战斗的 `freezeBattle` 分支**逐字同款**（那边的原注释：
     * 「调试快进冻结主控战斗……快进期间不推进/瞬结主控远征战斗」）：直接把 `lastTickGameMs` 拉到
     * 全局时钟、并把 `startedAtGameMs` 前移同样的量。
     *
     * ⚠⚠ **为什么洞内这条是必须的（我第一版就是漏了它）**：`simulateOffline` 是**带
     * `freezeBattle: true`** 跑的（`apps/desktop` 的 `engine.ts`），而它同时把 `state.gameMs`
     * **一次性推进整段离线时长**。原实现这里直接 `return` ⇒ **战斗时钟被落在原地**，
     * 于是读档后 `state.gameMs − battle.lastTickGameMs` = 整段离线时长（真档实测：**8 小时 = 28,800 秒**），
     * 而 `advanceBattleFor` 的补帧循环每拍**最多走 `BATTLE_MAX_STEPS × 100ms = 4,000 秒`**
     * ⇒ 玩家看到的是**极端慢镜 / 卡住的战场**：双方几乎不动、血条几乎不掉，要很久才追平
     * （8 小时 ≈ 7 拍满负荷补算）。同一处还会污染**交火时长**（战报/秒数会把离线那 8 小时算成战斗时间）。
     *
     * 前移之后语义与「临时离开」（`wormholeLeave` + `wormholeResume` 的 `shiftBattleClock`）**完全一致**：
     * **离开期间的时间不作战时间**，回来从原处续打、不补算、不白掉血。逐拍调用它是幂等的
     * （同一拍内 `owed` 当场归零，下一拍不动）。
     */
    if (freezeBattle) {
      const owed = Math.max(0, state.gameMs - run.battle.lastTickGameMs)
      if (owed > 0) {
        run.battle.lastTickGameMs = state.gameMs
        run.battle.startedAtGameMs += owed
      }
      return
    }
    advanceBattleFor(state, ctx, run.battle, run.fleet[0] ?? state.shipId, run.battle.wormhole?.cardId ?? null, null, undefined, undefined, { battleSpeedX })
    if (run.battle.ended) {
      // **击杀慢镜**（与远征 `expedition.ts` 同源 · `bal.killcamMs`）：分出胜负后**延迟结算**，
      // 让最后一击动画/爆炸演出播完；否则战斗界面会在结束那一瞬间直接卸载（首版实测踩到）。
      // ⚠ 倍速批（2026-09-19）：判据必须走**战斗时钟**并把窗口按倍速放大——否则倍速下战斗时钟领先
      //   全局时钟，`state.gameMs − lastTick` 为负 ⇒ 慢镜会被拖长（倍速只压进度、不压演出）。
      const waitMs = battleShowWindowMs(run.battle, ctx.balance.battle.killcamMs)
      if (battleClockNowMs(state, run.battle) - run.battle.lastTickGameMs < waitMs) return
      settleWormholeBattle(state, ctx, run)
    }
    return
  }
  // 撤离相位：**直接结算入港**（2026-09-15 船长「虫洞的撤离战取消吧」⇒ 零战斗零风险，不再有拦截舰队）
  if (run.phase === 'extracting' && !freezeBattle) {
    if (run.supplyVersion === 1 && wormholeHoldUsage(state, ctx).overload) {
      run.phase = 'inside'
      return
    }
    /**
     * 现行口径（2026-09-15 · 船长「**虫洞的撤离战取消吧**」）：**撤离一律不触发战斗** ——
     * 任意层、任意时候点「撤离」，下一拍直接把货仓与货柜入港。
     *
     * 旧口径（**已作废**）：第 1 层免战（`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`）、第 2 层起开一场
     * 撤离战（威胁 = 当层 ×0.8，线性曲线：层 2 = 42、每层 +7），**打赢才把货带回去、打输 = 全损**。
     *
     * ⚠ 老档兼容（"照打完"）：存档里**已经在打的撤离战**走上面的 `run.battle` 分支 —— 照打完，
     * 打完由 `settleWormholeBattle` 按新口径收口（赢 = `deliverExtraction`、输 = 全损），此后不再有下一场。
     *
     * ⚠ **空编队不许"顺利入港"**（2026-09-15 补 · 与旧口径一致）：编队账为空（全灭/老档或调试档
     * 的两本账不同步）时，把货判成"撤离成功"就是**白拿一趟**——这里按**全损**收口
     * （旧代码在同一档是"开不出撤离战 ⇒ 按全损处理"，那条兜底随撤离战取消一并搬到本分支）。
     */
    if (run.fleet.length === 0) {
      addLog(
        state,
        'combat',
        `🕳 撤离失败：编队已经没了（全灭或档案异常）——本趟按全损处理。`,
        'core.wormholeBattle.023',
      )
      state.wormhole.lastSettle = {
        kind: 'lost',
        depth: run.depth,
        oreUnits: 0,
        oreIsk: 0,
        wreckIsk: 0,
        boxes: [],
        relics: [],
        shipsLost: [],
        lostIsk: bagValueIsk(ctx, run),
      }
      state.wormhole.run = null
      repairCivilianFittings(state, ctx)
      return
    }
    deliverExtraction(state, ctx, run)
    state.wormhole.run = null
    repairCivilianFittings(state, ctx)
    return
  }
}

/**
 * **编队账对账**（2026-09-15 补）：把 `run.fleet` 里**已经不在 `state.fleet`** 的成员摘掉。
 *
 * 为什么需要：两本账（洞内编队 / 舰队）本该同步，但**老档、调试档、异常态**下可能残留"幽灵成员"
 * （船已被别处判损，编队账还记着它）。实测后果不算严重——开战时会被自动过滤、不参战、不崩——
 * 但**结算单与读数会把它算进去**，也让"编队为空"这类判据看不准。
 *
 * 口径：只摘"已不在舰队"的；摘了写一条日志（幂等：没事发生时零开销、零日志）。
 */
export function reconcileWormholeFleet(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  if (run.fleet.every((uid) => state.fleet[uid] !== undefined)) return
  const ghosts = run.fleet.filter((uid) => state.fleet[uid] === undefined)
  run.fleet = run.fleet.filter((uid) => state.fleet[uid] !== undefined)
  const names = ghosts.map((uid) => ctx.ships.get(uidDefId(uid))?.name ?? uid)
  addLog(
    state,
    'warn',
    `🕳 编队核对：${names.join('、')} 已不在舰队（${ghosts.length} 艘）——已从本趟编队里摘掉，剩余 ${run.fleet.length} 艘。`,
  )
}
