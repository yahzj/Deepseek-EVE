/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import { maybeFireTravelEvent, returnBaseGalaxy, landAtReturnBase } from './travel'
import { beginBattleAt } from './launch'
import { advanceBattleFor, battleClockNowMs, battleShowWindowMs } from '../combat'
import { settleBattleRetreat } from './retreat'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { resolveBattleOutcome } from './outcome'
import { unloadCargoOfShipToWarehouse } from '../inventory'

/** 引擎内部：按阶段推进远征（时间已由 gameMs 表达；同帧内阶段可连续跨越，离线大推进亦然） */
export function advanceExpedition(state: GameState, ctx: SimContext, freezeBattle = false): void {
  const exp = state.expedition
  for (let guard = 0; guard < 6; guard++) {
    if (!exp.active) return
    if (exp.phase === 'out') {
      maybeFireTravelEvent(state, ctx)
      if (state.gameMs < exp.finishAtGameMs) return
      const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, exp.finishAtGameMs)
      if (!ok) {
        if (state.pendingBattleRange) return
        exp.active = false
        exp.anomalyId = null
        exp.battle = null
        exp.lairTier = undefined
    exp.factionActive = undefined
        addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
        return
      }
      continue // 同一帧继续处理交火（离线大推进直接打到结束）
    }
    if (exp.phase === 'battle') {
      if (!exp.battle) {
        // 防御：存档里 battle 丢失 → 用当前时刻开战
        const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, state.gameMs)
        if (!ok) {
          if (state.pendingBattleRange) return
          exp.active = false
          exp.anomalyId = null
          exp.lairTier = undefined
    exp.factionActive = undefined
          addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
          return
        }
        continue
      }
      // 调试快进冻结主控战斗（船长 2026-09-05：方便测试战斗系统）——快进期间不推进/瞬结主控远征战斗
      if (freezeBattle) {
        const now = state.gameMs
        const owed = Math.max(0, now - (exp.battle.lastTickGameMs ?? now))
        if (owed > 0) {
          exp.battle.lastTickGameMs = now
          exp.battle.startedAtGameMs += owed
        }
        return
      }
      advanceBattleFor(state, ctx, exp.battle, state.shipId, exp.anomalyId, null, exp.lairTier)
      // 撤离请求两个来源（都走同一轻损撤退结算，只在文案上区分）：
      // ①连续作战保险——巡回场次结构损失过半；②**战斗超时判负**（2026-09-10 船长定）。
      // 来源见 battle.escapeReason，缺省 = 'hull'（旧档/旧口径零迁移）。
      if (exp.battle.autoEscaped) {
        settleBattleRetreat(
          state,
          ctx,
          exp.battle.escapeReason === 'timeout'
            ? 'timeout'
            : exp.battle.escapeReason === 'cannot-engage'
              ? 'cannot-engage'
              : 'auto',
        )
        if (!exp.active) return
        continue // 已转 back：若返航已到点则同帧回家
      }
      if (exp.battle.ended) {
        // V12.3 击杀慢镜：分出胜负后延迟 killcamMs 再结算，让最后一击动画与爆炸演出播完；
        // 计时基准 = 战斗停表时刻（lastTickGameMs 冻结于击杀拍）。离线/大步长推进下差值立即达标，行为与旧版一致。
        // ⚠ 倍速批（2026-09-19）：判据改走**战斗时钟**并把窗口按倍速放大（洞外战斗 `speedX` 缺省 = 1 ⇒ 逐字等价）。
        const bal = ctx.balance.battle
        if (battleClockNowMs(state, exp.battle) - exp.battle.lastTickGameMs < battleShowWindowMs(exp.battle, bal.killcamMs)) return
        /** **周末入侵**：被占星系的悬赏战打完 ⇒ 走入侵结算（主动胜利 +5%（外围）/ +5%（核心）· 夺回发奖 · 旗舰击沉） */
        weekendApplyBattleOutcome(
          state,
          ctx,
          state.expedition.anomalyId ?? null,
          state.expedition.battle?.ended === 'me',
          state.wallMs ?? Date.now(),
          state.expedition.battle, // 2026-09-24：旗舰 BOSS 要按它量"这一场对母舰的伤害"
        )
        resolveBattleOutcome(state, ctx)
        continue // resolve 后转 back；若返航也已到点则同帧回家
      }
      return
    }
    // back：到港结束（2026-09-08：落点 = 返航基准星系——有已建成副站则停靠该站，否则母港；
    // 2026-09-08 船长再定：任何进港时刻自动整仓卸货入仓库）
    if (state.gameMs < exp.finishAtGameMs) return
    const wasVictoryReturn = exp.returnReason === 'victory'
    const targetGal = exp.foeGalaxyId ?? (exp.anomalyId ? ctx.anomalies.get(exp.anomalyId)?.galaxyId ?? null : null)
    const base = targetGal !== null ? returnBaseGalaxy(state, ctx, targetGal) : HOME_GALAXY_ID
    landAtReturnBase(state, ctx, base)
    const moved = unloadCargoOfShipToWarehouse(state, ctx, state.shipId) // 进港自动卸货（战利品/残货）
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    exp.returnReason = undefined
    exp.lairTier = undefined
    exp.factionActive = undefined
    const siteName = state.dockedSite !== null ? ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite : null
    const unloadedNote = moved > 0 ? `货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : ''
    addLog(
      state,
      'combat',
      wasVictoryReturn
        ? siteName
          ? `悬赏战果已携回「${siteName}」并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
          : `悬赏战果已携回母港并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
        : siteName
          ? `远征结束，舰队已停靠「${siteName}」（副空间站）。${unloadedNote}`
          : `远征结束，舰队已停靠母港。${unloadedNote}`,
      wasVictoryReturn
        ? siteName
          ? 'core.expedition.057'
          : 'core.expedition.058'
        : siteName
          ? 'core.expedition.059'
          : 'core.expedition.060',
      wasVictoryReturn
        ? siteName
          ? { p1: siteName, p2: moved.toLocaleString('zh-CN') }
          : { p1: moved.toLocaleString('zh-CN') }
        : siteName
          ? {
              p1: siteName,
              p2: unloadedNote,
              ...(unloadedNote !== ''
                ? { p2Id: 'core.expedition.061', p2p1: moved.toLocaleString('zh-CN') }
                : {}),
            }
          : {
              p1: unloadedNote,
              ...(unloadedNote !== ''
                ? { p1Id: 'core.expedition.061', p1p1: moved.toLocaleString('zh-CN') }
                : {}),
            },
    )
    return
  }
}
