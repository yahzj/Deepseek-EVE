import { describe, expect, it } from 'vitest'
import { buildSimContext, SKILLS } from '@whale/data'
import { createInitialState, type GameState, type ShipWreckRecord } from '../src/state'
import { addShipToFleet, restoreShipFromWreck } from '../src/fleetBook'
import { loseShip, repairShip, shipStorable } from '../src/shipyard'
import { hullRecoveryChanceOf, noteShipWreck, trySalvagePlayerWreckOf, wreckEquipmentRecoveryChanceOf, WRECK_RECOVERY_SKILL } from '../src/shipWrecks'
import { cleanShipDamage, rollShipDamage, shipDamageEffects, SHIP_DAMAGE_DEFS } from '../src/shipDamage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { pullOneWreck } from '../src/salvaging'
import { createPlayerSpec } from '../src/playerSpec'
import { cargoCapacityM3Of } from '../src/inventory'
import { cpuBudgetOf, fittedCpuUsed } from '../src/equipment'
import { applyFitPreset, saveFitPreset } from '../src/fitPresets'
import { nextRandom } from '../src/rng'
import { buySkillLicense, skillLicensePriceOf } from '../src/skillLicense'
import { enqueueSkill } from '../src/skillQueue'
import { applyMeJammerDebuff } from '../src/foeRange'
import { shipSellable } from '../src/market'
import { scrapShip } from '../src/scrap'
import { assignAiSalvage, advanceAi } from '../src/ai'
import { advanceGame } from '../src/engine'
import { injectShipRecoveryTestState } from '../../../tools/ship-recovery-test-fixture'

const ctx = buildSimContext()
const gun = 'mod-turret-kin-1'
const shield = 'mod-shield-kin-1'
const gal = 'galaxy-hub'
function world(seed = 7): GameState { return createInitialState({ nowWallMs: 0, seed, prologue: true }) }
function wreck(state: GameState, overrides: Partial<ShipWreckRecord> = {}) {
  const rec = noteShipWreck(state, { galaxyId: gal, shipId: 'lost', shipName: '老伙计', defId: 'sh-hammerhead',
    fitted: { high: [gun, null, gun], mid: [shield], low: [] }, customName: '老伙计', plugs: ['plug-cpu-core', 'plug-cpu-core'],
    droneLoad: { 'drone-scout': 3 } })
  Object.assign(rec, overrides)
  return rec
}
function recoverySample(seed: number, level: number) {
  const state = world(seed)
  state.skills.trained[WRECK_RECOVERY_SKILL.equipmentSkillId] = level
  wreck(state, { reinforceChance: 1 })
  return { state, result: trySalvagePlayerWreckOf(state, ctx, gal) }
}

describe('新残骸：技能加算与首次判定', () => {
  it('基础25%、下级满50%、上下级满70%、插件同池加算且总上限90%', () => {
    const state = world(), rec = wreck(state)
    expect(hullRecoveryChanceOf(rec, state)).toBe(0.25)
    state.skills.trained[WRECK_RECOVERY_SKILL.hullSkillId] = 5
    expect(hullRecoveryChanceOf(rec, state)).toBe(0.5)
    state.skills.trained[WRECK_RECOVERY_SKILL.advancedHullSkillId] = 5
    expect(hullRecoveryChanceOf(rec, state)).toBe(0.7)
    rec.reinforceChance = 0.5
    expect(hullRecoveryChanceOf(rec, state)).toBe(0.9)
    for (let level = 0; level <= 5; level++) {
      state.skills.trained[WRECK_RECOVERY_SKILL.equipmentSkillId] = level
      expect(wreckEquipmentRecoveryChanceOf(state)).toBeCloseTo(0.8 + level * 0.04)
    }
    state.skills.trained[WRECK_RECOVERY_SKILL.equipmentSkillId] = -3
    expect(wreckEquipmentRecoveryChanceOf(state)).toBe(0.8)
  })
  it('三个工程技能、上下级/分支/训练许可与说明真实接线', () => {
    const lower = SKILLS.find(s => s.id === WRECK_RECOVERY_SKILL.hullSkillId)!
    const upper = SKILLS.find(s => s.id === WRECK_RECOVERY_SKILL.advancedHullSkillId)!
    const equipment = SKILLS.find(s => s.id === WRECK_RECOVERY_SKILL.equipmentSkillId)!
    expect([lower.rank, upper.rank, equipment.rank]).toEqual([4, 5, 5])
    for (const s of [lower, upper, equipment]) { expect(s.group).toBe('工程'); expect(s.branch).toBe('b-ship-recovery') }
    expect(upper.prereq).toEqual([lower.id]); expect(equipment.prereq).toEqual([lower.id])
    expect([lower, upper, equipment].map(skillLicensePriceOf)).toEqual([500000, 2000000, 2000000])
    const state = world()
    state.wallet.isk = 10000000
    expect(enqueueSkill(state, lower.id, 1, ctx.skills).ok).toBe(false)
    expect(buySkillLicense(state, ctx.skills, lower.id).ok).toBe(true)
    expect(buySkillLicense(state, ctx.skills, upper.id).ok).toBe(true)
    expect(buySkillLicense(state, ctx.skills, equipment.id).ok).toBe(true)
    expect(enqueueSkill(state, upper.id, 1, ctx.skills).errorId).toBe('core.engine.019')
    expect(enqueueSkill(state, equipment.id, 1, ctx.skills).errorId).toBe('core.engine.019')
    expect(enqueueSkill(state, lower.id, 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, upper.id, 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, equipment.id, 1, ctx.skills).ok).toBe(true)
  })
  it.each([[0, 0, 0.25], [5, 0, 0.5], [5, 5, 0.7]])('实际首轮抽样：下级%s/上级%s时整船回收率接近%s', (lower, upper, expected) => {
    let count = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const state = world(seed)
      state.skills.trained[WRECK_RECOVERY_SKILL.hullSkillId] = lower
      state.skills.trained[WRECK_RECOVERY_SKILL.advancedHullSkillId] = upper
      wreck(state, { fitted: undefined, droneLoad: undefined, plugs: [] })
      if (trySalvagePlayerWreckOf(state, ctx, gal).kind === 'ship') count++
    }
    expect(Math.abs(count / 2000 - expected)).toBeLessThan(0.035)
  })
  it('舰体失败不再掷，拆捞装备只判一次、刷新后不能反复补回损失件', () => {
    let found: GameState | undefined
    for (let seed = 1; seed < 1000 && !found; seed++) {
      const state = world(seed)
      wreck(state, { plugs: [], droneLoad: undefined })
      const result = trySalvagePlayerWreckOf(state, ctx, gal)
      const left = state.shipWrecks?.lost
      if (result.kind === 'item' && left && left.equipmentRolled && [...left.fitted!.high, ...left.fitted!.mid].filter(Boolean).length === 1) found = state
    }
    expect(found).toBeDefined()
    const saved = serializeSaveFile(found!), back = loadSaveFile(saved).state
    expect(back.shipWrecks!.lost!.hullRolled).toBe(true)
    expect(back.shipWrecks!.lost!.equipmentRolled).toBe(true)
    const before = back.rng.count
    expect(trySalvagePlayerWreckOf(back, ctx, gal).kind).toBe('item')
    expect(back.rng.count).toBe(before)
    expect(back.shipWrecks?.lost).toBeUndefined()
    expect(trySalvagePlayerWreckOf(back, ctx, gal).kind).toBe('none')
  })
  it('旧残骸没有基础概率，沿用60%插件上限和重复尝试；判定标记不会补掷', () => {
    const state = world(), rec = wreck(state, { plugs: [], reinforceChance: 1 })
    delete rec.recoveryRules
    expect(hullRecoveryChanceOf(rec, state)).toBe(0.6)
    delete rec.reinforceChance
    expect(hullRecoveryChanceOf(rec, state)).toBe(0)
    rec.hullRolled = true
    for (let n = 0; n < 50 && state.shipWrecks?.lost; n++) expect(trySalvagePlayerWreckOf(state, ctx, gal).kind).not.toBe('ship')
    expect(state.shipWrecks?.lost).toBeUndefined()
  })
  it('无装备的裸船仍可首次回收，缺失船型不制造幽灵舰船', () => {
    const state = world(13), rec = wreck(state, { fitted: undefined, droneLoad: undefined, plugs: [], reinforceChance: 1 })
    expect(trySalvagePlayerWreckOf(state, ctx, gal).kind).toBe('ship')
    wreck(state, { defId: 'missing', fitted: undefined, droneLoad: undefined, plugs: [], reinforceChance: 1 })
    expect(trySalvagePlayerWreckOf(state, ctx, gal).kind).not.toBe('ship')
    expect(rec.recoveryRules).toBe(2)
  })
})

describe('回收入队：装备、正常插件及资源守恒', () => {
  it('真实主控与AI打捞同源回收；合成档重载、原舰体只入队一次，AI核心不复制', () => {
    const pilotState = world(), aiState = world()
    injectShipRecoveryTestState(pilotState)
    injectShipRecoveryTestState(aiState)
    const worker = aiState.shipId
    aiState.shipId = 'sandcat'
    aiState.skills.trained['ai-expert'] = 5
    aiState.aiCores.basic = 1
    aiState.debugQuick = true
    expect(assignAiSalvage(aiState, worker, 'basic', gal, ctx).ok).toBe(true)
    pullOneWreck(pilotState, ctx, gal, 60000)
    advanceAi(aiState, 20000, ctx)
    const recover = (state: GameState) => Object.values(state.fleet).filter(s => s.customName === '回收目标')
    expect(recover(aiState)).toHaveLength(1)
    expect(recover(aiState)[0]).toEqual(recover(pilotState)[0])
    const back = loadSaveFile(serializeSaveFile(aiState)).state
    advanceGame(back, 10000, ctx, { nowWallMs: back.savedAtWallMs })
    expect(recover(back)).toHaveLength(1)
    expect(back.aiCores.basic).toBe(0)
    expect(back.aiAssignments[worker]?.task.kind).toBe('salvage')
  })
  it('真实损失→回收→重载：名字/逐位/重复插件保留，结构装甲20%，不切主控，不退货与弹药', () => {
    const state = world(13), uid = addShipToFleet(state, 'sh-hammerhead')
    state.fleet[uid]!.customName = '老伙计'
    state.fleet[uid]!.fitted = { high: [gun, null, gun], mid: [shield], low: [] }
    state.fleet[uid]!.plugs = ['plug-cpu-core', 'plug-cpu-core']
    state.fleet[uid]!.damagePlugs = ['range']
    state.fleet[uid]!.cargo = { 'ammo-kinetic': 100, 'min-titanium': 50 }
    state.fleet[uid]!.durability = 0; state.fleet[uid]!.armorPct = 0
    state.skills.trained[WRECK_RECOVERY_SKILL.equipmentSkillId] = 5
    loseShip(state, uid, ctx, '测试损失', gal)
    state.shipWrecks![uid]!.reinforceChance = 1
    const pilot = state.shipId, inventory = structuredClone(state.warehouse), modules = structuredClone(state.moduleBay)
    pullOneWreck(state, ctx, gal, 60000)
    const [newId, restored] = Object.entries(state.fleet).find(([id, s]) => id !== uid && s.customName === '老伙计')!
    expect(newId).not.toBe(uid)
    expect(restored.fitted.high.slice(0, 3)).toEqual([gun, null, gun])
    expect(restored.fitted.high).toHaveLength(ctx.ships.get('sh-hammerhead')!.slots!.high)
    expect(restored.plugs).toEqual(['plug-cpu-core', 'plug-cpu-core'])
    expect(restored.damagePlugs).toContain('range')
    expect(restored.durability).toBe(0.2); expect(restored.armorPct).toBe(0.2)
    expect(restored.cargo).toEqual({}); expect(state.shipId).toBe(pilot)
    expect(state.warehouse).toEqual(inventory); expect(state.moduleBay).toEqual(modules)
    expect(state.shipWrecks?.[uid]).toBeUndefined(); expect(state.wreckLog![0]!.recovered).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fleet[newId]!.damagePlugs).toEqual(restored.damagePlugs)
    expect(back.wreckLog![0]!.damagePlugs).toEqual(['range'])
    expect(back.fleet[newId]!.customName).toBe('老伙计')
  })
  it('80%是真逐件概率，技能满级普通装备全保全，无人机仍独立25%按型判定', () => {
    let ships = 0, kept = 0, drones = 0, maxedKept = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const base = recoverySample(seed, 0).result, full = recoverySample(seed, 5).result
      if (base.kind === 'ship') { ships++; kept += base.keptModules!; if (base.droneLoad?.['drone-scout']) drones++ }
      if (full.kind === 'ship') { maxedKept += full.keptModules!; expect(full.keptModules).toBe(3); expect(full.lostModules).toBe(0) }
    }
    expect(kept / (ships * 3)).toBeGreaterThan(0.76); expect(kept / (ships * 3)).toBeLessThan(0.84)
    expect(drones / ships).toBeGreaterThan(0.2); expect(drones / ships).toBeLessThan(0.3)
    expect(maxedKept).toBe(ships * 3)
  })
  it('未保全协处理器导致预算降低，已保全模块退库而不静默销毁', () => {
    let checked = false
    for (let seed = 1; seed <= 500 && !checked; seed++) {
      const state = world(seed)
      const ship = { ...ctx.ships.get('sh-hammerhead')!, cpu: 10 }
      const expensive = { ...ctx.modules.get(gun)!, cpuUse: 10 }
      const lowCpuCtx = { ...ctx, ships: new Map(ctx.ships).set(ship.id, ship), modules: new Map(ctx.modules).set(gun, expensive) }
      const rec = wreck(state, { plugs: [], droneLoad: undefined, reinforceChance: 1,
        fitted: { high: Array(ship.slots!.high).fill(expensive.id), mid: [], low: ['mod-cpu-3'] } })
      const before = structuredClone(state.moduleBay)
      pullOneWreck(state, lowCpuCtx, gal, 60000)
      const restored = Object.entries(state.fleet).find(([, s]) => s.customName === '老伙计')
      if (!restored) continue
      const [uid, s] = restored
      const returned = (state.moduleBay[expensive.id] ?? 0) - (before[expensive.id] ?? 0)
      if (returned === 0) continue
      expect(fittedCpuUsed(s.fitted, lowCpuCtx, ship)).toBeLessThanOrEqual(cpuBudgetOf(state, lowCpuCtx, uid))
      expect(state.logs.find(l => l.textId === 'core.shipRecovery.001')?.textParams).toBeDefined()
      expect(rec.fitted!.high).toHaveLength(ship.slots!.high)
      checked = true
    }
    expect(checked).toBe(true)
  })
})

describe('战损插件', () => {
  it.each(SHIP_DAMAGE_DEFS.map(d => d.id))('%s只降低对应最终属性15%，已装加成仍参与计算', kind => {
    const state = world(), uid = addShipToFleet(state, 'sh-hammerhead')
    state.fleet[uid]!.fitted = { high: [gun], mid: [shield], low: [] }
    state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
    state.fleet[uid]!.plugs = ['plug-shield-plate', 'plug-rangefinder']
    const base = createPlayerSpec(state, ctx, uid)!, cargo = cargoCapacityM3Of(state, ctx, uid)
    state.fleet[uid]!.damagePlugs = [kind]
    const next = createPlayerSpec(state, ctx, uid)!
    expect(next.hp.s).toBeCloseTo(base.hp.s * (kind === 'shield' ? 0.85 : 1))
    expect(next.hp.a).toBeCloseTo(base.hp.a * (kind === 'armor' ? 0.85 : 1))
    expect(next.hp.h).toBeCloseTo(base.hp.h * (kind === 'hull' ? 0.85 : 1))
    expect(next.speedMps).toBeCloseTo(base.speedMps! * (kind === 'speed' ? 0.85 : 1))
    expect(cargoCapacityM3Of(state, ctx, uid)).toBe(kind === 'cargo' ? Math.round(cargo * 0.85) : cargo)
    next.weapons.forEach((w, i) => expect(w.maxRangeM).toBe(kind === 'range' ? Math.round(base.weapons[i]!.maxRangeM * 0.85) : base.weapons[i]!.maxRangeM))
    expect(state.fleet[uid]!.plugs).toHaveLength(2)
  })
  it('50%新增、去重上限3、不占插件槽、已满不掷；清洗拒绝未知项', () => {
    let added = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const state = world(seed)
      const damage = rollShipDamage(state, ['shield', 'armor'])
      if (damage.length === 3) added++
      expect(new Set(damage).size).toBe(damage.length)
      const before = state.rng.count
      if (damage.length === 3) { expect(rollShipDamage(state, damage)).toEqual(damage); expect(state.rng.count).toBe(before) }
    }
    expect(added / 2000).toBeGreaterThan(0.45); expect(added / 2000).toBeLessThan(0.55)
    expect(cleanShipDamage(['shield','shield','ghost','range','cargo','speed'])).toEqual(['shield','range','cargo'])
    expect(shipDamageEffects(['shield', 'shield'])).toMatchObject({ shield: 0.85, armor: 1 })
  })
  it('射程战损与干扰相乘，带射程加成的舰炮和无人机共用各自基准账', () => {
    const state = world(), uid = addShipToFleet(state, 'sh-hammerhead')
    state.fleet[uid]!.fitted = { high: [gun, 'mod-drone-relay-1'], mid: [], low: [] }
    state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
    state.fleet[uid]!.plugs = ['plug-rangefinder']
    const beforeRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    const before = createPlayerSpec(state, ctx, uid, undefined, beforeRefs)!
    state.fleet[uid]!.damagePlugs = ['range']
    const afterRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    const after = createPlayerSpec(state, ctx, uid, undefined, afterRefs)!
    expect(afterRefs.weaponRanges).toHaveLength(after.weapons.length)
    afterRefs.weaponRanges.forEach((r, i) => {
      expect(r.baseM).toBeCloseTo(beforeRefs.weaponRanges[i]!.baseM * 0.85)
      expect(r.bonusMul).toBe(beforeRefs.weaponRanges[i]!.bonusMul)
    })
    applyMeJammerDebuff(before, 0.35, beforeRefs.weaponRanges)
    applyMeJammerDebuff(after, 0.35, afterRefs.weaponRanges)
    after.weapons.forEach((w, i) => expect(Math.abs(w.maxRangeM - Math.round(before.weapons[i]!.maxRangeM * 0.85))).toBeLessThanOrEqual(1))
  })
  it('修理/换装不清除、不入方案/黑匣/库存，入仓和出售阻止洗白', () => {
    const state = world(), uid = restoreShipFromWreck(state, { defId: 'sh-hammerhead', recoveryRules: 2, damagePlugs: ['cargo'],
      fitted: { high: [gun], mid: [], low: [] } })
    state.wallet.isk = 100000000
    expect(repairShip(state, uid, ctx).ok).toBe(true)
    expect(state.fleet[uid]!.damagePlugs).toEqual(['cargo'])
    expect(shipStorable(state, uid).ok).toBe(false)
    expect(shipSellable(state, uid).ok).toBe(false)
    expect(saveFitPreset(state, ctx, uid, '测试').ok).toBe(true)
    expect(state.fitPresets!['sh-hammerhead']![0]).not.toHaveProperty('damagePlugs')
    expect(applyFitPreset(state, ctx, uid, 0).ok).toBe(true)
    expect(state.fleet[uid]!.damagePlugs).toEqual(['cargo'])
    const isolated = structuredClone(state)
    isolated.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
    isolated.fleet[uid]!.customName = null
    expect(shipStorable(isolated, uid).reasonId).toBe('core.shipRecovery.003')
    expect(shipSellable(isolated, uid).reason).toContain('战损插件')
    const before = structuredClone(state.moduleBay)
    expect(scrapShip(state, ctx, uid).ok).toBe(true)
    expect(state.moduleBay.cargo).toBeUndefined()
    expect((state.moduleBay[gun] ?? 0) - (before[gun] ?? 0)).toBe(1)
  })
  it('未捞的残骸和一次性标记往返后仍保持相同下一轮结果和随机数', () => {
    const state = world(), rec = wreck(state, { damagePlugs: ['speed', 'hull'] })
    const copy = loadSaveFile(serializeSaveFile(state)).state
    expect(copy.shipWrecks!.lost).toMatchObject({ recoveryRules: 2, customName: '老伙计', damagePlugs: ['speed', 'hull'] })
    expect(trySalvagePlayerWreckOf(copy, ctx, gal)).toEqual(trySalvagePlayerWreckOf(state, ctx, gal))
    expect(copy.rng).toEqual(state.rng)
    expect(nextRandom(copy.rng)).toBe(nextRandom(state.rng))
    expect(rec.fitted!.high).toEqual([gun, null, gun])
  })
  it('同型新造舰不会覆盖尚未回收的旧残骸或误标另一条沉船记录', () => {
    const state = world()
    const first = addShipToFleet(state, 'sh-hammerhead')
    loseShip(state, first, ctx, '第一次', gal)
    const second = addShipToFleet(state, 'sh-hammerhead')
    expect(second).not.toBe(first)
    loseShip(state, second, ctx, '第二次', gal)
    expect(Object.keys(state.shipWrecks!)).toEqual([first, second])
    state.shipWrecks![second]!.hullRolled = true
    state.shipWrecks![second]!.fitted = { high: [gun], mid: [], low: [] }
    trySalvagePlayerWreckOf(state, ctx, gal)
    expect(state.wreckLog!.find(r => r.shipId === second)!.recovered).toBe(true)
    expect(state.wreckLog!.find(r => r.shipId === first)!.recovered).toBeUndefined()
  })
})
