/** 全船CPU只读审查：npx tsx tools/ship-cpu-audit.ts [--json]。
 * 读取当前目录与真实预算/装配入口，生成合成空船，不访问个人档，不写正式数值。
 * 主炮高槽填满；无人机/生产/物流按独立定位取样，辅助最多中三低二，不强求所有槽满配。
 * 两种样本不是最优配装或平衡契约，负余量只表示该样本需降档/扩容，不自动判定船体有错。
 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { cpuBudgetOf, fittedCpuUsed, droneCpuUsed, droneBayTotalM3, fitModule, adjustDroneLoad } from '../packages/core/src/equipment'
import { moduleAllowedOnShip } from '../packages/core/src/shipFitting'
import type { FittedModules } from '../packages/core/src/state'

const ctx = buildSimContext()
const droneShips = new Set(['sh-swarm', 'sh-sentinel', 'sh-wh-e-destroyer', 'sh-wh-e-carrier'])
const rows = []
for (const ship of ctx.ships.values()) {
  const mk = Math.min(3, ship.tier ?? 1)
  for (const economy of [true, false]) {
    const aux = economy ? Math.min(mk, 2) : mk
    const fitted: FittedModules = { high: [], mid: [], low: [] }
    const civilian = ship.civilianFittingOnly === true
    let profile = '主炮'
    if (ship.role === 'industrial') {
      profile = '采矿'
      fitted.high = Array(ship.slots.high).fill(`mod-miner-${mk}`)
      fitted.mid = [`mod-shield-kin-${aux}`, `mod-prop-${aux}`].slice(0, ship.slots.mid)
      fitted.low = Array(Math.min(2, ship.slots.low)).fill(`mod-cargo-${aux}`)
    } else if (ship.role === 'hauler') {
      profile = '物流'
      fitted.high = Array(ship.slots.high).fill(`mod-salvager-${mk}`)
      fitted.mid = [`mod-prop-${aux}`, `mod-shield-kin-${aux}`].slice(0, ship.slots.mid)
      fitted.low = Array(ship.slots.low).fill(`mod-cargo-${aux}`)
    } else if (droneShips.has(ship.id)) {
      profile = '机群'
      fitted.high = [`mod-drone-tac-${mk}`, `mod-drone-tac-${mk}`, `mod-pd-e-${mk}`].slice(0, ship.slots.high)
      fitted.mid = [`mod-prop-${aux}`, `mod-shield-kin-${aux}`, `mod-track-${aux}`].slice(0, ship.slots.mid)
      fitted.low = [`mod-armor-plate-${aux}`, `mod-armor-kin-${aux}`].slice(0, ship.slots.low)
    } else {
      fitted.high = Array(ship.slots.high).fill(`mod-turret-kin-${mk}`)
      fitted.mid = [`mod-prop-${aux}`, `mod-shield-kin-${aux}`, `mod-track-${aux}`].slice(0, ship.slots.mid)
      fitted.low = [`mod-armor-plate-${aux}`, `mod-armor-kin-${aux}`].slice(0, ship.slots.low)
    }
    const droneId = mk === 1 ? 'drone-scout' : mk === 2 ? 'drone-assault' : 'drone-heavy'
    const drone = ctx.items.get(droneId)!
    const volume = droneBayTotalM3(ship, fitted, ctx)
    const count = civilian ? 0 : droneShips.has(ship.id) ? Math.floor(volume / drone.unitM3) : Math.min(2, Math.floor(volume / drone.unitM3))
    const droneLoad = count > 0 ? { [droneId]: count } : {}
    for (const rack of ['high', 'mid', 'low'] as const) {
      assert(fitted[rack].length <= ship.slots[rack], `${ship.id}/${rack}槽位不合法`)
      for (const id of fitted[rack]) {
        const mod = ctx.modules.get(id!)
        assert(mod && mod.rack === rack && moduleAllowedOnShip(ship, mod), `${ship.id}/${id}装备不合法`)
      }
    }
    const usedModules = fittedCpuUsed(fitted, ctx, ship)
    const usedDrones = droneCpuUsed(droneLoad, ctx)
    const need = usedModules + usedDrones
    const budgets = [0, 5].map(level => {
      const state = createInitialState({ seed: 7, nowWallMs: 0 })
      const id = addShipToFleet(state, ship.id)
      state.skills.trained[ctx.balance.battle.cpuSkillId] = level
      const budget = cpuBudgetOf(state, ctx, id)
      let result = { ok: true } as { ok: boolean; errorId?: string }
      for (const rack of ['high', 'mid', 'low'] as const) {
        for (const mod of fitted[rack]) {
          if (!result.ok) break
          state.moduleBay[mod!] = (state.moduleBay[mod!] ?? 0) + 1
          result = fitModule(state, mod!, ctx, { shipId: id })
        }
        if (!result.ok) break
      }
      if (result.ok && count > 0) {
        state.warehouse.items[droneId] = count
        result = adjustDroneLoad(state, ctx, droneId, count, id)
      }
      assert.equal(result.ok, need <= budget, `${ship.id}算账与真实装配入口不一致：${result.errorId}`)
      if (need <= budget) assert.equal(fittedCpuUsed(state.fleet[id]!.fitted, ctx, ship) + droneCpuUsed(state.fleet[id]!.droneLoad, ctx), need)
      return { level, budget, spare: budget - need, ok: result.ok, errorId: result.errorId }
    })
    rows.push({ id: ship.id, name: ship.name, role: ship.role, tier: ship.tier, profile,
      auxiliary: economy ? '经济辅助' : '同档辅助', slots: `${ship.slots.high}/${ship.slots.mid}/${ship.slots.low}`,
      cpu: ship.cpu, modules: usedModules, drones: usedDrones, count, need,
      budget0: budgets[0]!.budget, spare0: budgets[0]!.spare,
      budget5: budgets[1]!.budget, spare5: budgets[1]!.spare, fitted, droneLoad })
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ cpuSkill: ctx.balance.battle.cpuSkillId, cpuPerLevel: ctx.balance.battle.cpuPerLevel, rows }, null, 2))
else {
  for (const sample of ['经济辅助', '同档辅助']) {
    console.log(`\n${sample}，无CPU扩容/插件，按主炮/机群/采矿/物流定位取样：`)
    console.table(rows.filter(row => row.auxiliary === sample).map(({ name, tier, profile, slots, cpu, modules, drones, need, budget5, spare5 }) => ({ name, tier, profile, slots, cpu, modules, drones, need, budget5, spare5 })))
  }
  console.log(`\n已核对${ctx.ships.size}艘×2配装×2技能档的真实装配入口；未改游戏数值或个人档。`)
}
