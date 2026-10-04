/**
 * 纯货舰配装与经济读数：npx tsx tools/hauler-readings.ts；不读个人档，不改生产数据。
 * --legacy对照旧船体；--battle跑五族普通遭遇五种编队（各五种子），不代替整趟/精英验收。
 * 运输枚举限现有扩仓、跃迁计算机、协处理器及低槽/CPU插件；理论时薪不含税费、损失或供给约束。
 * 版本自检：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-04 · 最后跑过 2026-10-04。
 */
import { buildSimContext, SKILLS } from '@whale/data'
import { addShipToFleet, cargoCapacityM3Of, createInitialState, cpuBudgetOf, fittedCpuUsed, moduleAllowedOnShip, shipSlotsWithPlugsOf } from '@whale/core'
import { haulEffectiveMinutes, haulLegMinutesOf, haulLegReward } from '../packages/core/src/hauling'
import { shortestTravelMinutes, travelLegMs, warpSpeedAus } from '../packages/core/src/travel'
import { calcBuildDurationMs, matNeedCount } from '../packages/core/src/manufacturing'
import { advanceBattleFor, createPlayerSpec, rawDamageToKill, startFleetBattleFor } from '../packages/core/src/combat'
import { fitModule } from '../packages/core/src/equipment'
import { LEGACY_HAULER_STATS } from '../packages/core/src/shipFitting'

const ctx = buildSimContext()
if (process.argv.includes('--battle')) {
  const cards = ['wh-pirate-scout', 'wh-alien-swarm', 'wh-grave-watch', 'wh-titan-echo', 'wh-exile-blockade']
  const plans = [
    ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead'],
    ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-sailfish'],
    ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-manatee'],
    ['sh-hammerhead', 'sh-hammerhead', 'sh-nautilus', 'sh-manatee'],
    ['sh-hawksbill', 'sh-hawksbill', 'sh-hawksbill', 'sh-hawksbill'],
  ]
  for (const plan of plans) for (const card of cards) {
    let wins = 0
    let cargo = 0
    let haulerSurvives = 0
    let seconds = 0
    let ammo = 0
    let repairs = 0
    for (let seed = 1; seed <= 5; seed++) {
      const s = createInitialState({ nowWallMs: 0, seed })
      for (const sk of SKILLS) s.skills.trained[sk.id] = 3
      for (const item of ctx.items.values()) if (item.kind === 'ammo' || item.kind === 'kit') s.warehouse.items[item.id] = 100_000
      const uids = plan.map((id) => addShipToFleet(s, id))
      s.shipId = uids[0]!
      for (const uid of uids) {
        const def = ctx.ships.get(s.fleet[uid]!.defId!)!
        const haul = def.civilianFittingOnly === true
        const high = haul ? ['mod-salvager-2'] : Array(def.slots!.high).fill('mod-turret-kin-2')
        const mid = ['mod-shield-ext-2', 'mod-shield-kin-2', 'mod-shield-pla-2', 'mod-hullrep-2'].slice(0, def.slots!.mid)
        const low = ['mod-cargo-2', 'mod-dc-2'].slice(0, def.slots!.low)
        for (const id of [...high, ...mid, ...low]) {
          s.moduleBay[id] = (s.moduleBay[id] ?? 0) + 1
          const r = fitModule(s, id, ctx, { shipId: uid })
          if (!r.ok) throw new Error(`${def.id}/${id}: ${r.error}`)
        }
      }
      cargo = uids.reduce((sum, uid) => sum + cargoCapacityM3Of(s, ctx, uid), 0)
      const stockAmmo = s.warehouse.items['ammo-kinetic-l']!
      const stockKit = s.warehouse.items['repairkit-mil']!
      const b = startFleetBattleFor(s, ctx, uids, card, 0, 3000, { depth: 1, kind: 'node', waves: 1 })
      if (!b) throw new Error('战斗未建立')
      for (let i = 0; i < 900 && !b.ended; i++) {
        s.gameMs += 1000
        advanceBattleFor(s, ctx, b, s.shipId, card)
      }
      if (!b.ended) throw new Error('战斗未结算')
      wins += b.ended === 'me' ? 1 : 0
      const last = b.myFleet!.find((e) => e.shipId === uids[3])!
      haulerSurvives += b.units[last.tag]!.hp.h > 0 ? 1 : 0
      seconds += b.lastTickGameMs / 1000
      const remaining = b.ammo.kin
      ammo += stockAmmo - s.warehouse.items['ammo-kinetic-l']! - remaining
      repairs += stockKit - s.warehouse.items['repairkit-mil']!
    }
    console.log(JSON.stringify({ plan, card, seeds: 5, wins, fourthSurvives: haulerSurvives, cargo,
      seconds: seconds / 5, ammoUsed: ammo / 5, kitsUsed: repairs / 5 }))
  }
  process.exit(0)
}
if (process.argv.includes('--legacy')) {
  for (const [id, stats] of Object.entries(LEGACY_HAULER_STATS)) {
    const ship = ctx.ships.get(id)!
    ctx.ships.set(id, { ...ship, ...stats, civilianFittingOnly: false })
  }
}
const ids = ['sh-flyingfish', 'sh-sailfish', 'sh-manatee', 'sh-swordfish', 'sh-bowhead']
const route = { from: 'galaxy-hub', to: 'galaxy-cinder' }
const nominal = shortestTravelMinutes(ctx, route.from, route.to)
const effective = haulEffectiveMinutes(ctx, route.from, route.to)
if (!Number.isFinite(nominal) || nominal <= 0 || effective <= 0) throw new Error('测试航线不可达')
const lowChoices = [...ctx.modules.values()].filter((m) =>
  m.slot === 'cargo' || (m.warpSpeedBonusPct ?? 0) > 0 || (m.slot === 'cpu' && m.cpuBonus === 45))
const plugChoices = [...ctx.modules.values()].filter((m) => m.slot === 'plug' && ((m.lowSlotsAdd ?? 0) > 0 || (m.cpuBonus ?? 0) > 0))

for (const level of [0, 5]) {
  console.log(`技能档 ${level}，航线 ${route.from} → ${route.to}，行情倍率1；不含风险损失/市场吸纳`)
  for (const id of ids) {
    const s = createInitialState({ nowWallMs: 0, seed: 7 })
    const uid = addShipToFleet(s, id)
    s.shipId = uid
    if (level === 5) for (const sk of SKILLS) s.skills.trained[sk.id] = 5
    const entry = s.fleet[uid]!
    const ship = ctx.ships.get(id)!
    const capBase = cargoCapacityM3Of(s, ctx, uid)
    let bestHour = { hourly: 0, cargo: 0, warp: 0, cpu: 0, fit: [] as string[], plugs: [] as string[] }
    let maxCap = 0
    for (let mask = 0; mask < 1 << plugChoices.length; mask++) {
      entry.plugs = plugChoices.filter((_, i) => (mask & 1 << i) !== 0).map((m) => m.id)
      if (entry.plugs.length > (ship.plugSlots ?? 0)) continue
      const slots = shipSlotsWithPlugsOf(s, ctx, uid)
      entry.fitted = { high: Array(slots.high).fill(null), mid: Array(slots.mid).fill(null), low: Array(slots.low).fill(null) }
      const search = (at: number, start: number): void => {
        const cpu = fittedCpuUsed(entry.fitted, ctx, ship)
        const budget = cpuBudgetOf(s, ctx, uid)
        if (cpu > budget + (slots.low - at) * 45) return
        if (cpu <= budget) {
          const cap = cargoCapacityM3Of(s, ctx, uid)
          const ms = travelLegMs(s, ctx, haulLegMinutesOf(nominal), uid)
          const hour = haulLegReward(ctx, cap, effective, 1) * 3_600_000 / ms
          maxCap = Math.max(maxCap, cap)
          if (hour > bestHour.hourly) bestHour = { hourly: hour, cargo: cap, warp: warpSpeedAus(s, ctx, uid), cpu,
            fit: entry.fitted.low.filter((v): v is string => v !== null), plugs: [...entry.plugs!] }
        }
        if (at >= slots.low) return
        for (let i = start; i < lowChoices.length; i++) {
          const m = lowChoices[i]!
          if (!moduleAllowedOnShip(ship, m)) continue
          entry.fitted.low[at] = m.id
          search(at + 1, i)
        }
        entry.fitted.low[at] = null
      }
      search(0, 0)
    }
    console.log(JSON.stringify({ id, capBase, maxCap, bestHour }))
    entry.plugs = []
    const layout = shipSlotsWithPlugsOf(s, ctx, uid)
    const salvage = [...ctx.modules.values()].find((m) => m.slot === 'salvager' && m.cpuUse === 6)!
    entry.fitted = { high: [salvage.id, ...Array(layout.high - 1).fill(null)],
      mid: ['mod-shield-ext-2', 'mod-shield-kin-2', 'mod-hullrep-2', ...Array(Math.max(0, layout.mid - 3)).fill(null)].slice(0, layout.mid),
      low: ['mod-cargo-2', 'mod-dc-2', ...Array(Math.max(0, layout.low - 2)).fill(null)] }
    const missing = [...entry.fitted.high, ...entry.fitted.mid, ...entry.fitted.low].filter((v) => v && !ctx.modules.has(v))
    if (missing.length > 0) throw new Error(`配装引用不存在 ${missing}`)
    const spec = createPlayerSpec(s, ctx, uid)!
    console.log(JSON.stringify({ id, defense: { hp: spec.hp,
      ehp: ['kinetic', 'explosive', 'plasma'].map((type) => rawDamageToKill(spec.hp, spec.resists, type as 'kinetic')),
      weapons: spec.weapons.length, cargo: cargoCapacityM3Of(s, ctx, uid),
      cpu: fittedCpuUsed(entry.fitted, ctx, ship), budget: cpuBudgetOf(s, ctx, uid) } }))
  }
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  if (level === 5) for (const sk of SKILLS) s.skills.trained[sk.id] = 5
  const bp = ctx.shipBlueprints.get('sbp-manatee')!
  const cost = bp.materials.reduce((sum, m) => sum + matNeedCount(s, m.count) * ctx.items.get(m.itemId)!.baseSellPriceIsk, 0)
  const ms = calcBuildDurationMs(s, ctx, bp)
  console.log(JSON.stringify({ manufacturing: 'sh-manatee', materials: bp.materials, cost, ms,
    cashNetWithoutBook: 6_750_000 * 0.65 - cost, cashNetWithOnceBook: 6_750_000 * 0.65 - cost - 3_375_000 }))
}
