/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { shipDisplayName } from '../instances'
import { calcPower } from '../expedition'
import { nextRandom } from '../rng'
import { lootOf, dropWrecks, ambushHitHp, hitLogText } from './loot'
import { wreckDensityOf } from '../salvage'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { weekendKindOfEncounter, clearEncounter, settleEncounterTail } from './return'
import { applyArmorFirstDamage } from '../hullDamage'
import { ceilFinalQuantity } from '../quantity'
import type { CommandResult } from '../engine'

/**
 * 文字三档结算（Q2 甲）：击退（缴获 ISK）/ 受损（耐久 −5%~15%，clamp 5%）/ 被抢（至多 30% 货）。
 * ratio = 我方火力 / (我方火力 + 遭遇强度)；mode 仅影响日志措辞。
 * ⚠ **被抢档只抢货**（2026-09-28 船长令取消"无货则抢信用点"那条兜底，见该分支注）。
 */
export function resolveTextual(state: GameState, ctx: SimContext, viaFlee: boolean): void {
  const enc = state.encounter
  const bal = ctx.balance.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const power = Math.max(1, calcPower(state, ctx, shipId))
  const threat = Math.max(1, enc.threat)
  const ratio = power / (power + threat)
  // 三档权重随战力比：击退 20%~80%、受损 45%~15%、被抢 35%~5%
  const wWin = 0.2 + 0.6 * ratio
  const wLose = 0.45 - 0.3 * ratio
  const r = nextRandom(state.rng)
  const suffix = viaFlee ? '（快速脱离）' : '（无人应答，自动处置）'
  const fleetShip = state.fleet[shipId]
  // 缴获评估学 ×1.1/级；低安生存学：被抢上限 −12%/级（货与现金同享）
  const seizeF = 1 + 0.1 * Math.min(5, state.skills.trained['seizure-appraisal'] ?? 0)
  const survF = 1 - 0.12 * Math.min(5, state.skills.trained['lowsec-survival'] ?? 0)
  if (r < wWin) {
    // 2026-09-09：缴获 = 伏击敌群赏金 ×50%（缴获评估学照旧）；击退同样留下敌舰残骸
    const loot = lootOf(state, ctx, seizeF)
    state.wallet.isk += loot
    dropWrecks(state, ctx)
    const d = state.encounter.galaxyId ? wreckDensityOf(state, state.encounter.galaxyId, ctx) : null
    addLog(
      state,
      'combat',
      `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 成功击退来敌${suffix}——缴获 ${loot.toLocaleString('zh-CN')} 信用点${d !== null ? `，敌舰残骸沉积（密度 ${d.toFixed(1)}）` : ''}。`,
    )
    /**
     * **周末入侵**：文字结算里的"击退"也算一次**击退遇袭**（设计稿：**离线自动结算击退 +1%**）。
     * 走 `source: 'text'` —— 与"迎战打赢"的 +3% 分档；`victory: true` 在这里的含义 = "这一档判成了击退"。
     * ⚠ 必须**赶在 `clearEncounter` 之前**：本函数末尾会把遭遇槽清空，而归属判定要读它。
     */
    weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, true, Date.now(), null, {
      kind: weekendKindOfEncounter(state, enc),
      galaxyId: enc.galaxyId ?? '',
      source: 'text',
    })
  } else if (r < wWin + wLose) {
    // 受损：一口 = 敌群火力 × hitFirepowerSec，**先扣装甲、吸完再进结构**（2026-09-11 船长定；
    // 2026-09-14 改判：5 秒 —— 见 `balance.encounter.hitFirepowerSec` 与文件头）
    const hit = applyArmorFirstDamage(state, ctx, shipId, ambushHitHp(ctx, enc.threat))
    if (hit && hit.floored) {
      addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。', 'core.encounters.002')
    }
    if (hit) addLog(state, 'warn', hitLogText(shipName, galaxyName, enc.name, suffix, hit))
  } else {
    /**
     * **被抢：只抢船上的货，至多 30%**（**2026-09-28 船长令**：「**取消遇袭事件中的抢劫信用点。**」）。
     *
     * 沿革：原先"无货可抢就改抢钱包"（至多 5% 信用点，旋钮 `balance.encounter.iskTakenMaxPct`）——
     * 那条路连同旋钮、类型字段与"抢走 X 信用点"那句文案**一并删除**：空货仓遇袭 ⇒ 一无所获。
     */
    let takenUnits = 0
    if (fleetShip) {
      const total = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
      const take = Math.min(total, ceilFinalQuantity(total * bal.lootTakenMaxPct * survF * nextRandom(state.rng)))
      let rest = take
      for (const key of Object.keys(fleetShip.cargo)) {
        if (rest <= 0) break
        const unit = fleetShip.cargo[key]!
        const grab = Math.min(unit, rest)
        fleetShip.cargo[key] = unit - grab
        rest -= grab
        if (fleetShip.cargo[key] <= 0) delete fleetShip.cargo[key]
      }
      takenUnits = take - rest
    }
    addLog(
      state,
      'combat',
      takenUnits > 0
        ? `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 被劫${suffix}——货仓损失 ${takenUnits.toLocaleString('zh-CN')} 单位货物，破财消灾。`
        : `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 被洗劫${suffix}——一无所获的劫匪悻悻离去。`,
    )
  }
  clearEncounter(state)
  // 收场尾巴（2026-09-12 船长定：先修后判）——胜、败、被抢三路共用
  settleEncounterTail(state, ctx, shipId)
}

/** 玩家指令：快速脱离（立即按文字三档结算） */
export function fleeEncounter(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可脱离的遭遇。', errorId: 'core.encounters.007' }
  resolveTextual(state, ctx, true)
  return { ok: true }
}
