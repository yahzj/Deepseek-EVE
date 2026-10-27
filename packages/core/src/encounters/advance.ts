/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { maintainPresence, foeKeyOf } from './presence'
import { settleEncounterBattle, settleEscape } from './outcome'
import { advanceBattleFor } from '../combat'
import { weekendFlagshipEncounterOf, weekendNoteFlagshipPlayerKill, weekendApplyBattleOutcome } from '../weekendBattle'
import { weekendKindOfEncounter } from './return'
import { resolveTextual } from './textual'

/**
 * 引擎内部：每推进后调用——推进进行中的遭遇（待决超时 / 战斗），空闲时按暴露窗口掷骰。
 */
/**
 * 引擎内部（每推进后调用）：
 * ① 维护"低安在场记录"（galaxyId → 连续在场起始时刻，用于 5 分钟入场缓冲与首提提示）；
 * ② 推进进行中的遭遇（待决超时自动文字结算 / 应战战斗推演）。
 * 触发判定不在此处——由随机事件线到点时调用 rollLowSecAmbush（遭遇占用事件机会，船长 2026-09-04 定）。
 */
export function advanceEncounterWatch(state: GameState, ctx: SimContext, _deltaMs: number, freezeBattle = false): void {
  maintainPresence(state, ctx)
  const enc = state.encounter
  if (enc.active) {
    if (enc.battle) {
      if (enc.battle.ended) {
        /** ⚠ 与下面那支**同源**（见 `settleEncounterBattle` 的头注：漏结算 = 旗舰白打） */
        settleEncounterBattle(state, ctx, enc)
        return
      }
      // 调试快进冻结（船长 2026-09-05：取消"瞬间结束交战"）——不在快进期间推进/结算进行中的遭遇战，
      // 把战斗时钟同步到"现在"（并同步平移 startedAtGameMs 以免 maxBattleMs 误判超时），战术状态保持冻结，
      // 快进结束后战斗从冻结点继续按真实时长逐拍打完，不随快进时间跳变而瞬结。
      if (freezeBattle) {
        const now = state.gameMs
        const owed = Math.max(0, now - (enc.battle.lastTickGameMs ?? now))
        if (owed > 0) {
          enc.battle.lastTickGameMs = now
          enc.battle.startedAtGameMs += owed
        }
        return
      }
      advanceBattleFor(state, ctx, enc.battle, enc.shipId ?? state.shipId, foeKeyOf(enc), null)
      /**
       * **旗舰战：母舰被打沉 ⇒ 当场留档**（**2026-09-27 船长令**：「开关不能挂旗舰身上吗？旗舰爆炸开启。」
       * ＋「和入侵结束的报告一样，留档玩家的旗舰战记录。直到下一次入侵开始时覆盖清空。」）。
       *
       * **触发制**：事实由 `combat.applyFoeUnitDamage`（敌舰伤害唯一收口）在母舰三层血清零那一发落在
       * `enc.battle.bossDownAtMs`（**随档**）上；这里只把它抄进场次记录 —— **读一个标记，不扫血、不判账**。
       * 位置在两条收尾分支**之前** ⇒ 即便这一场的结算随后被丢（活动已结束等），"玩家亲手打沉"也已入档。
       * 幂等（同场只写一次）在 core 侧保证；非旗舰遭遇 ⇒ 一次 `false` 判据即返回。
       */
      if (weekendFlagshipEncounterOf(state, enc)) {
        weekendNoteFlagshipPlayerKill(state, enc.battle, Date.now())
      }
      // 自动脱离（2026-09-11 船长定：遭遇战挂同一个 50% 保险）→ 轻损脱离结算，随后撤退返港待命
      if (enc.battle.autoEscaped) {
        /**
         * **入侵结算也要走一遍**（2026-09-25 补 · 由船长「撤退会重抽吗」一问查出）：
         * 母舰伤害是在**战斗收尾**那一步量进血池的（`weekendApplyBattleOutcome` → `flagshipBattleLedger`），
         * 而**自动脱离 / 快速脱离走的是另一条收尾路径**（`settleEscape`）⇒ 原先**这一场对母舰打出的伤害
         * 白打**；设计稿写的是「按对母舰造成的伤害决定」（撤退 / 战败的伤害照记）。
         * 这里按"没打赢"结算：**只记伤害 · 不给进度 · 不判击沉**（`victory: false`）。
         */
        weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, false, Date.now(), enc.battle, {
          kind: weekendKindOfEncounter(state, enc),
          galaxyId: enc.galaxyId ?? '',
          source: 'battle',
        })
        settleEscape(state, ctx)
        return
      }
      if (enc.battle.ended) {
        /**
         * **周末入侵**：占领区的伏击战 / 旗舰挑战打完 ⇒ 走入侵结算
         * （遇袭击退 **+3%**、战败只受损不动进度、旗舰按对母舰的伤害记池子）。
         * 2026-09-25 修过"归属要靠显式提示传进去"（`settleFight` 会把遭遇槽清空）；2026-09-26 再把
         * 收口合并到 `settleEncounterBattle`（与上面那支同源，见它的头注）。
         */
        settleEncounterBattle(state, ctx, enc)
      }
      return
    }
    // 待决邀约：超时自动按文字结算（离线大步长会立刻超时 → 与"离线只文字"一致）
    if (state.pendingBattleRange?.intent.kind === 'encounter' && state.pendingBattleRange.intent.invitedAtGameMs === enc.invitedAtGameMs) return
    if (state.gameMs >= enc.deadlineGameMs) {
      resolveTextual(state, ctx, false)
    }
    return
  }
}
