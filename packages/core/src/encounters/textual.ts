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
import { finishFleetHaulingAbortAfterEncounter } from '../hauling/fleet'

export function resolveTextual(state: GameState, ctx: SimContext, viaFlee: boolean): void {
  const enc = state.encounter
  const bal = ctx.balance.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const power = Math.max(1, calcPower(state, ctx, shipId))
  const threat = Math.max(1, enc.threat)
  const ratio = power / (power + threat)
  const wWin = 0.2 + 0.6 * ratio
  const wLose = 0.45 - 0.3 * ratio
  const r = nextRandom(state.rng)
  const suffix = viaFlee ? '（快速脱离）' : '（无人应答，自动处置）'
  const fleetShip = state.fleet[shipId]
  const seizeF = 1 + 0.1 * Math.min(5, state.skills.trained['seizure-appraisal'] ?? 0)
  const survF = 1 - 0.12 * Math.min(5, state.skills.trained['lowsec-survival'] ?? 0)
  if (r < wWin) {
    const loot = lootOf(state, ctx, seizeF)
    state.wallet.isk += loot
    dropWrecks(state, ctx)
    const d = state.encounter.galaxyId ? wreckDensityOf(state, state.encounter.galaxyId, ctx) : null
    addLog(
      state,
      'combat',
      `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 成功击退来敌${suffix}——缴获 ${loot.toLocaleString('zh-CN')} 信用点${d !== null ? `，敌舰残骸沉积（密度 ${d.toFixed(1)}）` : ''}。`,
    )
    weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, true, Date.now(), null, {
      kind: weekendKindOfEncounter(state, enc),
      galaxyId: enc.galaxyId ?? '',
      source: 'text',
    })
  } else if (r < wWin + wLose) {
    const hit = applyArmorFirstDamage(state, ctx, shipId, ambushHitHp(ctx, enc.threat))
    if (hit && hit.floored) {
      addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。', 'core.encounters.002')
    }
    if (hit) addLog(state, 'warn', hitLogText(shipName, galaxyName, enc.name, suffix, hit))
  } else {
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
  settleEncounterTail(state, ctx, shipId)
  finishFleetHaulingAbortAfterEncounter(state, ctx)
}

export function fleeEncounter(state: GameState, ctx: SimContext): CommandResult {
  if (state.encounter.pirate && state.encounter.battle) return { ok: false, error: 'encounter-in-battle', errorId: 'core.encounters.003' }
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可脱离的遭遇。', errorId: 'core.encounters.007' }
  resolveTextual(state, ctx, true)
  return { ok: true }
}
