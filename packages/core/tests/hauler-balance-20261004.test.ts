import { describe, expect, it } from 'vitest'
import { ANNOUNCEMENTS, buildSimContext, EN_SHIPS, EN_SHIP_BLUEPRINTS, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { adjustDroneLoad, cpuBudgetOf, droneBayTotalM3, fitModule, repairDeprecatedModules, swapModuleAt } from '../src/equipment'
import { moduleAllowedOnShip } from '../src/shipFitting'
import { fleetDefOf } from '../src/instances'
import { createPlayerSpec } from '../src/combat'
import { meFoeRangeDebuffOf } from '../src/foeRange'
import { shieldFieldStreamsOf } from '../src/combatRepair'
import { cargoCapacityM3Of } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter, wormholeExtract } from '../src/wormhole'
import { advanceWormhole } from '../src/wormholeBattle'
import { shipSlotsWithPlugsOf, installPlug } from '../src/plugs'
import { applyFitPreset } from '../src/fitPresets'
import { advanceWormholeAuto, wormholeAutoStop } from '../src/wormholeAuto'
import { droneReviveCyclesOf } from '../src/droneRevive'
import { advanceManufacturing, cancelManufacturing, startManufacturing } from '../src/manufacturing'

const ctx = buildSimContext()
const ids = ['sh-flyingfish', 'sh-sailfish', 'sh-manatee', 'sh-swordfish', 'sh-bowhead']

function world(defId = 'sh-sailfish') {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(s, defId)
  s.shipId = uid
  repairDeprecatedModules(s, ctx)
  return { s, uid }
}

describe('纯货舰修订', () => {
  it('验收后的货舰公告中英逐条接线，历史公告不改正文', () => {
    const announcement = ANNOUNCEMENTS.find(a => a.id === 'ann-hauler-refit-20261004')!
    expect(announcement.id).toBe('ann-hauler-refit-20261004')
    expect(announcement.bulletIds).toHaveLength(4)
    expect(announcement.title).toBe(L10N[announcement.titleId!]!.zh)
    expect(announcement.tag).toBe(L10N[announcement.tagId!]!.zh)
    for (const [index, id] of announcement.bulletIds!.entries()) {
      expect(announcement.bullets[index]).toBe(L10N[id]!.zh)
      expect(L10N[id]!.en).toBeTruthy()
    }
    const historical = ANNOUNCEMENTS.find((a) => a.id === 'ann-weekend-compensation-20261002')!
    expect(historical.bulletIds).toBeUndefined()
    expect(historical.bullets).toHaveLength(3)
  })
  it.each([
    ['sh-flyingfish', 150, [1, 3, 4], [77, 107, 123], [430, 7.4, 0.62, 0.3]],
    ['sh-sailfish', 240, [1, 4, 5], [135, 189, 216], [415, 6.3, 0.56, 0.3]],
    ['sh-manatee', 250, [2, 3, 5], [108, 216, 216], [210, 3.8, 0.36, 0]],
    ['sh-swordfish', 320, [2, 5, 6], [254, 356, 408], [400, 6.2, 0.5, 0.28]],
    ['sh-bowhead', 350, [3, 4, 6], [204, 407, 407], [180, 3.5, 0.28, 0]],
  ])('%s 配装/血量按确认值，快运机动不降', (id, cpu, slots, hp, motion) => {
    const ship = ctx.ships.get(id as string)!
    expect(ship.cpu).toBe(cpu)
    expect(Object.values(ship.slots!)).toEqual(slots)
    expect([ship.shieldHp, ship.armorHp, ship.hullHp]).toEqual(hp)
    expect([ship.maxSpeedMps, ship.warpSpeedAus, ship.agility, ship.evasion]).toEqual(motion)
    expect(ship.droneBayM3).toBe(0)
    expect(ship.civilianFittingOnly).toBe(true)
  })

  it('武装货舰、鹦鹉螺与T5保持原能力', () => {
    for (const id of ['sh-tortoise', 'sh-hawksbill', 'sh-xuanwu', 'sh-nautilus', 'sh-colossal']) {
      expect(ctx.ships.get(id)?.civilianFittingOnly, id).not.toBe(true)
      expect(moduleAllowedOnShip(ctx.ships.get(id), ctx.modules.get('mod-turret-kin-2')!)).toBe(true)
    }
    expect(ctx.ships.get('sh-hawksbill')?.cargoM3).toBe(9600)
    expect(ctx.ships.get('sh-nautilus')?.droneBayM3).toBe(160)
  })

  it('真目录武器/机群/全队护盾不兼容，自身防御与作业允许', () => {
    for (const id of ids) {
      const ship = ctx.ships.get(id)!
      for (const mod of ctx.modules.values()) {
        if (mod.reloadMs !== undefined || mod.droneBayBonusM3 !== undefined || mod.shieldFieldPct !== undefined || mod.captureWebCycleMs !== undefined) {
          expect(moduleAllowedOnShip(ship, mod), `${id}/${mod.id}`).toBe(false)
        }
        if (mod.slot === 'miner' || mod.slot === 'salvager' || mod.slot === 'cargo' || mod.slot === 'cpu') {
          expect(moduleAllowedOnShip(ship, mod), `${id}/${mod.id}`).toBe(true)
        }
      }
    }
    const mix = { ...ctx.modules.get('mod-cargo-2')!, captureWebCycleMs: 1000 }
    expect(moduleAllowedOnShip(ctx.ships.get('sh-manatee'), mix)).toBe(false)
  })

  it('安装/换装/预设与扩槽后的安装一致拒绝，拒绝不扣库存', () => {
    const { s, uid } = world()
    s.moduleBay['mod-turret-kin-2'] = 2
    expect(fitModule(s, 'mod-turret-kin-2', ctx, { shipId: uid }).ok).toBe(false)
    expect(swapModuleAt(s, 'mod-turret-kin-2', ctx, { shipId: uid, rack: 'high', index: 0 }).ok).toBe(false)
    expect(s.moduleBay['mod-turret-kin-2']).toBe(2)
    const plug = [...ctx.modules.values()].find((m) => (m.lowSlotsAdd ?? 0) > 0)!
    s.moduleBay[plug.id] = 1
    expect(installPlug(s, ctx, plug.id, uid).ok).toBe(true)
    const deck = [...ctx.modules.values()].find((m) => m.slot === 'drone-rack')!
    s.moduleBay[deck.id] = 1
    expect(fitModule(s, deck.id, ctx, { shipId: uid, rack: 'low', index: 5 }).ok).toBe(false)
    s.fitPresets = { 'sh-sailfish': [{ name: '旧战斗方案', fitted: { high: ['mod-turret-kin-2'], mid: [], low: [deck.id] } }] }
    expect(applyFitPreset(s, ctx, uid, 0).ok).toBe(true)
    expect(s.fleet[uid]!.fitted.high[0]).toBeNull()
    expect(s.moduleBay['mod-turret-kin-2']).toBe(2)
    expect(s.moduleBay[deck.id]).toBe(1)
  })

  it('直接建档也不能恢复武器、控制、力场和机群', () => {
    const { s, uid } = world()
    const deck = [...ctx.modules.values()].find((m) => m.slot === 'drone-rack')!
    const field = [...ctx.modules.values()].find((m) => m.shieldFieldPct !== undefined)!
    const web = [...ctx.modules.values()].find((m) => m.captureWebCycleMs !== undefined)!
    s.fleet[uid]!.fitted = { high: ['mod-turret-kin-2', field.id], mid: [web.id], low: [deck.id] }
    s.fleet[uid]!.droneLoad = { 'drone-scout': 3 }
    const spec = createPlayerSpec(s, ctx, uid)!
    expect(spec.weapons).toHaveLength(1)
    expect(spec.weapons[0]!.src).toBe('base')
    expect(spec.myCaptureWeb).toBeUndefined()
    expect(shieldFieldStreamsOf(s, ctx, uid)).toEqual([])
    const ecm = [...ctx.modules.values()].find((m) => m.foeRangeDebuffPct !== undefined)!
    s.fleet[uid]!.fitted.low.push(ecm.id)
    expect(meFoeRangeDebuffOf(s, ctx, [uid])).toBe(0)
    const reserve = [...ctx.modules.values()].find((m) => m.droneReviveCycleMs !== undefined)!
    s.fleet[uid]!.fitted.high.push(reserve.id)
    expect(droneReviveCyclesOf(s, ctx, uid)).toEqual([])
    expect(droneBayTotalM3(ctx.ships.get('sh-sailfish'), s.fleet[uid]!.fitted, ctx)).toBe(0)
    s.warehouse.items['drone-scout'] = 20
    expect(adjustDroneLoad(s, ctx, 'drone-scout', 1, uid).ok).toBe(false)
    expect(s.warehouse.items['drone-scout']).toBe(20)
  })

  it('旧配装/机群无损退库、比例和货物不变；刷新不重复发放', () => {
    const { s, uid } = world()
    const entry = s.fleet[uid]!
    entry.durability = 0.45
    entry.armorPct = 0.6
    entry.cargo = { 'drone-scout': 7 }
    entry.fitted.high[0] = 'mod-turret-kin-2'
    entry.droneLoad = { 'drone-scout': 3 }
    s.moduleBay['mod-turret-kin-2'] = 2
    s.warehouse.items['drone-scout'] = 11
    repairDeprecatedModules(s, ctx)
    expect(s.moduleBay['mod-turret-kin-2']).toBe(3)
    expect(s.warehouse.items['drone-scout']).toBe(14)
    expect(entry.cargo['drone-scout']).toBe(7)
    expect(entry.durability).toBe(0.45)
    expect(entry.armorPct).toBe(0.6)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    repairDeprecatedModules(back, ctx)
    expect(back.moduleBay['mod-turret-kin-2']).toBe(3)
    expect(back.warehouse.items['drone-scout']).toBe(14)
  })

  it('旧虫洞趟保留旧规格到撤离，出洞即整理，兼容标记往返保留', () => {
    const { s, uid } = world()
    expect(wormholeEnter(s, ctx, [uid], 9).ok).toBe(true)
    expect(s.wormhole.run?.haulerFittingVersion).toBe(1)
    const fresh = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(fresh.wormhole.run?.haulerFittingVersion).toBe(1)
    delete s.wormhole.run!.haulerFittingVersion
    s.fleet[uid]!.fitted = { high: ['mod-turret-kin-2'], mid: [null, null, null], low: [null, null, null] }
    s.fleet[uid]!.droneLoad = { 'drone-scout': 3 }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    repairDeprecatedModules(back, ctx)
    expect(fleetDefOf(back, ctx, uid)!.cpu).toBe(135)
    expect(cpuBudgetOf(back, ctx, uid)).toBe(135)
    expect(shipSlotsWithPlugsOf(back, ctx, uid)).toEqual({ high: 1, mid: 3, low: 3 })
    expect(fleetDefOf(back, ctx, uid)!.droneBayM3).toBe(50)
    expect(back.fleet[uid]!.fitted.high[0]).toBe('mod-turret-kin-2')
    expect(createPlayerSpec(back, ctx, uid)!.weapons.length).toBeGreaterThan(1)
    expect(wormholeExtract(back.wormhole.run!).ok).toBe(true)
    advanceWormhole(back, ctx)
    expect(back.wormhole.run).toBeNull()
    expect(back.fleet[uid]!.fitted.high[0]).toBeNull()
    expect(back.moduleBay['mod-turret-kin-2']).toBe(1)
    expect(back.warehouse.items['drone-scout']).toBe(3)
  })

  it('不兼容旧甲板直接退库，不挤走低槽合法装备；下架炮只退迁移款一次', () => {
    const { s, uid } = world()
    const deck = [...ctx.modules.values()].find((m) => m.slot === 'drone-rack')!
    const before = s.moduleBay['mod-turret-kin-1'] ?? 0
    s.fleet[uid]!.fitted = { high: [deck.id, 'mod-turret-1'], mid: [], low: Array(5).fill('mod-cargo-2') }
    repairDeprecatedModules(s, ctx)
    expect(s.fleet[uid]!.fitted.low).toEqual(Array(5).fill('mod-cargo-2'))
    expect(s.moduleBay[deck.id]).toBe(1)
    expect(s.moduleBay['mod-turret-kin-1']).toBe(before + 1)
    expect(s.moduleBay['mod-turret-1']).toBeUndefined()
    repairDeprecatedModules(s, ctx)
    expect(s.moduleBay[deck.id]).toBe(1)
    expect(s.moduleBay['mod-turret-kin-1']).toBe(before + 1)
  })

  it('海牛基础与专精空间、蓝图孪生、售价与中英接线齐备', () => {
    const { s, uid } = world('sh-manatee')
    expect(cargoCapacityM3Of(s, ctx, uid)).toBe(16_000)
    s.skills.trained['hauler-ops'] = 5
    expect(cargoCapacityM3Of(s, ctx, uid)).toBe(20_000)
    const bp = ctx.shipBlueprints.get('sbp-manatee')!
    const once = ctx.shipBlueprints.get('sbp-once-manatee')!
    expect(bp.materials).toEqual(once.materials)
    expect(bp.buildSeconds).toBe(once.buildSeconds)
    expect(once.singleUse).toBe(true)
    const value = bp.materials.reduce((sum, m) => sum + m.count * ctx.items.get(m.itemId)!.baseSellPriceIsk, 0)
    expect(value).toBe(6_750_000 * 0.45)
    expect(bp.priceIsk).toBe(27_000_000)
    expect(once.priceIsk).toBe(675_000)
    expect(EN_SHIPS['sh-manatee']!.name).toBe('Manatee-class Freighter')
    expect(EN_SHIP_BLUEPRINTS['sbp-manatee']!.description).toBeTruthy()
    expect(EN_SHIP_BLUEPRINTS['sbp-once-manatee']!.description).toBe(EN_SHIP_BLUEPRINTS['sbp-manatee']!.description)
  })

  it('自动探索旧趟保持配装到返航，新趟标记往返不丢', () => {
    const { s, uid } = world()
    s.shipId = 'sandcat'
    s.fleet[uid]!.fitted.high[0] = 'mod-turret-kin-2'
    s.fleet[uid]!.droneLoad = { 'drone-scout': 2 }
    s.wormholeAuto = [{ id: 'old-auto', stockId: 'stock-a', seed: 7, depth: 1, shipIds: [uid], startedAtGameMs: 0, finishAtGameMs: 300_000 }]
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    repairDeprecatedModules(back, ctx)
    expect(fleetDefOf(back, ctx, uid)!.cpu).toBe(135)
    expect(back.fleet[uid]!.fitted.high[0]).toBe('mod-turret-kin-2')
    expect(back.fleet[uid]!.droneLoad).toEqual({ 'drone-scout': 2 })
    back.gameMs = 300_000
    advanceWormholeAuto(back, ctx)
    expect(back.wormholeAuto).toEqual([])
    expect(back.fleet[uid]!.fitted.high[0]).toBeNull()
    expect(back.moduleBay['mod-turret-kin-2']).toBe(1)
    expect(back.warehouse.items['drone-scout']).toBe(2)
    s.wormholeAuto[0]!.haulerFittingVersion = 1
    const fresh = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(fresh.wormholeAuto?.[0]!.haulerFittingVersion).toBe(1)
    expect(fleetDefOf(fresh, ctx, uid)!.cpu).toBe(240)
    const recall = loadSaveFile(serializeSaveFile(s, 0)).state
    delete recall.wormholeAuto![0]!.haulerFittingVersion
    expect(wormholeAutoStop(recall, 'old-auto', ctx).ok).toBe(true)
    expect(recall.fleet[uid]!.fitted.high[0]).toBeNull()
    expect(recall.warehouse.items['drone-scout']).toBe(2)
  })

  it('海牛制造沿用既有入口：开工扣料、取消退料、交付与一次性退书守恒', () => {
    const { s } = world('sh-manatee')
    const bp = ctx.shipBlueprints.get('sbp-manatee')!
    s.learnedRecipes.push(bp.id)
    s.wallet.isk = 100_000_000
    for (const m of bp.materials) s.warehouse.items[m.itemId] = m.count * 2
    expect(startManufacturing(s, bp.id, 'pilot', ctx).ok).toBe(true)
    for (const m of bp.materials) expect(s.warehouse.items[m.itemId]).toBe(m.count)
    expect(cancelManufacturing(s, ctx, s.manufacturingRuns[0]!.id).ok).toBe(true)
    for (const m of bp.materials) expect(s.warehouse.items[m.itemId]).toBe(m.count * 2)
    expect(startManufacturing(s, bp.id, 'pilot', ctx).ok).toBe(true)
    const before = s.shipStore?.['sh-manatee'] ?? 0
    s.gameMs = s.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(s, ctx)
    expect(s.shipStore?.['sh-manatee']).toBe(before + 1)
    s.blueprintStock['sbp-once-manatee'] = 1
    expect(startManufacturing(s, 'sbp-once-manatee', 'pilot', ctx).ok).toBe(true)
    expect(s.blueprintStock['sbp-once-manatee'] ?? 0).toBe(0)
    const runId = s.manufacturingRuns[0]!.id
    expect(cancelManufacturing(s, ctx, runId).ok).toBe(true)
    expect(s.blueprintStock['sbp-once-manatee']).toBe(1)
    expect(cancelManufacturing(s, ctx, runId).ok).toBe(false)
    expect(s.blueprintStock['sbp-once-manatee']).toBe(1)
  })
})
