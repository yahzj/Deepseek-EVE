import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_DRONE_C_JAWCLAW, L10N, l10nEntryText, DRONE_ROLE_SPECS } from '@whale/data'
import itemData from '../../data/src/static/items.json'
import foeData from '../../data/src/static/foeDrones.json'
import marketData from '../../data/src/static/market.json'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { adjustDroneLoad, cpuBudgetOf, droneCpuUsed, droneLoadM3, fittedCpuUsed } from '../src/equipment'
import { createPlayerSpec, startBattleFor } from '../src/combat'
import { createBattleState, createFoeSpecs, initFoeDronePools } from '../src/foeSpecs'
import { advanceFoeHatcheries } from '../src/alienCombat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { cleanBattle } from '../src/saveBattleClean'
import { foeDroneRangeOf } from '../src/foeRange'

const ctx = buildSimContext(), root = new URL('../../../', import.meta.url)
const id = 'drone-jawclaw'
const oldDrone = { ...FOE_DRONE_C_JAWCLAW, role: 'scout' as const, dmg: 6, hitRate: .89, maxRangeM: 6000,
  defense: { shieldHp: 6, armorHp: 12, hullHp: 20, evasion: .45 } }
const baseline = (path: string) => JSON.parse(execFileSync('git', ['show', `694fe079:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true }))
function world(ship = 'sh-wh-c-cruiser', count = 10) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261009 })
  const uid = addShipToFleet(state, ship)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  state.fleet[uid]!.droneLoad = { [id]: count }
  return { state, uid }
}

describe('颚钳战斗机确认值与范围守恒', () => {
  it.each(['zh', 'en'] as const)('%s敌我基础属性对齐，战斗机定位与延期说明', locale => {
    const local = buildSimContext(locale), item = local.items.get(id)!
    expect(item).toMatchObject({ droneClass: 'combat', damageType: 'kinetic', dmg: 10, hitRate: .85, maxRangeM: 5000, falloff: 1, cpuUse: 8, unitM3: 10,
      defense: { shieldHp: 12, armorHp: 30, hullHp: 48, evasion: .25 } })
    expect(FOE_DRONE_C_JAWCLAW).toMatchObject({ role: 'combat', damageType: item.damageType, dmg: item.dmg, hitRate: item.hitRate, maxRangeM: item.maxRangeM, falloff: item.falloff, reloadMs: 4400, defense: item.defense })
    expect(item.defense!.shieldHp + item.defense!.armorHp + item.defense!.hullHp).toBe(90)
    expect(item.maxRangeM).toBeGreaterThanOrEqual(DRONE_ROLE_SPECS.combat.rangeM[0])
    expect(item.maxRangeM).toBeLessThanOrEqual(DRONE_ROLE_SPECS.combat.rangeM[1])
    expect(item.description).toBe(l10nEntryText(L10N['item.jawclaw.002']!, locale))
    expect(item.description).toContain('动能战斗无人机')
  })

  it('静态源仅两行确认字段变化，市场/其他机型/图纸价格与料单不变', () => {
    const items = baseline('packages/data/src/static/items.json')
    Object.assign(items.groups.DRONES_0.find((row: { id: string }) => row.id === id), {
      droneClass: 'combat', unitM3: 10, cpuUse: 8, dmg: 10, hitRate: .85, maxRangeM: 5000,
      defense: { shieldHp: 12, armorHp: 30, hullHp: 48, evasion: .25 },
    })
    expect(itemData).toEqual(items)
    const foes = baseline('packages/data/src/static/foeDrones.json')
    Object.assign(foes.groups.parameters.find((row: { id: string }) => row.id === 'foe-drone-c-jawclaw'), {
      defense_shieldHp: 12, defense_armorHp: 30, defense_hullHp: 48, defense_evasion: .25, dmg: 10, hitRate: .85, maxRangeM: 5000,
    })
    expect(foeData).toEqual(foes)
    expect(marketData).toEqual(baseline('packages/data/src/static/market.json'))
    expect(ctx.marketGoods.get(id)!.basePrice).toBe(24000)
    expect(ctx.marketGoods.get('bp-faction-drone-jawclaw')!.basePrice).toBe(2400000)
    const book = ctx.blueprints.get('bp-faction-drone-jawclaw')!
    expect(book).toMatchObject({ outputUnits: 50, buildSeconds: 180 })
    expect(book.materials).toEqual(ctx.blueprints.get('bp-lair-g-drone')!.materials)
  })

  it.each(['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother'])('%s所有波次火力锚点与载体不变，仅目标机型命中射程变化', cardId => {
    const card = ctx.anomalies.get(cardId)!
    const before = { ...card, ships: card.ships!.map(slot => ({ ...slot, ship: {
      ...slot.ship, drones: slot.ship.drones?.map(ds => ds.drone.id === oldDrone.id ? { ...ds, drone: oldDrone } : ds),
    } })) }
    for (let wave = 0; wave < card.waves!.length; wave++) {
      const opts = { tagPrefix: wave === 0 ? '' : `w${wave}-` }
      const old = createFoeSpecs(before, ctx.balance.battle, opts)
      const now = createFoeSpecs(card, ctx.balance.battle, opts)
      expect(now.map(unit => ({ tag: unit.tag, hp: unit.hp, hatchery: unit.foeHatchery }))).toEqual(old.map(unit => ({ tag: unit.tag, hp: unit.hp, hatchery: unit.foeHatchery })))
      for (let i = 0; i < now.length; i++) {
        expect(now[i]!.weapons.map(w => ({ ...w, ...(w.artId === oldDrone.id ? { hitRate: .89, maxRangeM: 6000 } : {}) }))).toEqual(old[i]!.weapons)
      }
    }
  })

  it('敌方新池吃C族1.3倍血量，导控射程7500，孵化与保存恢复正确', () => {
    const { state, uid } = world('sh-wh-e-carrier', 5)
    const card = { ...ctx.anomalies.get('alien-main')!, waves: undefined, ships: [{ ship: ctx.foeShips!.get('foe-alien-hiveback')!, firepowerAnchor: 228 }] }
    const foes = createFoeSpecs(card, ctx.balance.battle)
    const carrier = foes.find(unit => unit.foeShipId === 'foe-alien-hiveback')!
    expect(carrier).toBeDefined()
    const battle = createBattleState(createPlayerSpec(state, ctx, uid)!, foes, 0, 5000)
    battle.distanceM = 5000
    initFoeDronePools(battle, foes)
    const pool = battle.foeDronePools![carrier.tag]![0]!
    expect(pool).toMatchObject({ s: 12 * 1.3, a: 30 * 1.3, h: 48 * 1.3, evasion: .25 })
    const weapon = carrier.weapons.find(w => w.artId === oldDrone.id)!
    expect(foeDroneRangeOf(battle, weapon)).toBe(7500)
    pool.alive = false; pool.s = pool.a = pool.h = 0
    advanceFoeHatcheries(battle, [carrier], 0)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    advanceFoeHatcheries(loaded, [carrier], carrier.foeHatchery!.cycleMs)
    expect(loaded.foeDronePools![carrier.tag]![0]).toMatchObject({ s: 12 * 1.3, a: 30 * 1.3, h: 48 * 1.3, alive: true })
  })

  it('旧50m³装载10架保留，仅可出击5架，超限提示依据和卸回库存守恒', () => {
    const { state, uid } = world()
    state.warehouse.items[id] = 20
    state.learnedRecipes = [...state.learnedRecipes, 'bp-faction-drone-jawclaw']
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.fleet[uid]!.droneLoad).toEqual({ [id]: 10 })
    expect(droneLoadM3(loaded.fleet[uid]!.droneLoad, ctx)).toBe(100)
    expect(droneCpuUsed(loaded.fleet[uid]!.droneLoad, ctx)).toBe(80)
    const drones = createPlayerSpec(loaded, ctx, uid)!.weapons.filter(w => w.artId === id)
    expect(drones).toHaveLength(5)
    expect(drones[0]).toMatchObject({ shotDmg: 20, hitRate: .85, maxRangeM: 5000, reloadMs: 4400 })
    expect(adjustDroneLoad(loaded, ctx, id, 1, uid).ok).toBe(false)
    expect(loaded.warehouse.items[id]).toBe(20)
    expect(adjustDroneLoad(loaded, ctx, id, -5, uid).ok).toBe(true)
    expect(loaded.fleet[uid]!.droneLoad).toEqual({ [id]: 5 })
    expect(loaded.warehouse.items[id]).toBe(25)
    expect(loaded.learnedRecipes).toContain('bp-faction-drone-jawclaw')
  })

  it('CPU受限时按新8CPU限制出击，旧存量不丢，战中旧池不强制改血', () => {
    const { state, uid } = world('sh-wh-e-carrier', 10)
    const def = ctx.ships.get('sh-wh-e-carrier')!
    const local = { ...ctx, ships: new Map([...ctx.ships, [def.id, { ...def, cpu: 64 }]]) }
    expect(cpuBudgetOf(state, local, uid) - fittedCpuUsed(state.fleet[uid]!.fitted, local, def)).toBe(64)
    expect(createPlayerSpec(state, local, uid)!.weapons.filter(w => w.artId === id)).toHaveLength(8)
    expect(state.fleet[uid]!.droneLoad).toEqual({ [id]: 10 })
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0, 5000)!
    const key = Object.keys(battle.dronePools!).find(k => battle.dronePools![k]!.artId === id)!
    Object.assign(battle.dronePools![key]!, { s: 6, a: 12, h: 20, maxS: 6, maxA: 12, maxH: 20, evasion: .45 })
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.dronePools![key]).toMatchObject({ s: 6, a: 12, h: 20, maxS: 6, maxA: 12, maxH: 20, evasion: .45 })
  })
})
