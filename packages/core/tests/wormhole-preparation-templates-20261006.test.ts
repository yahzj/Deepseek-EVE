import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { cleanWormholePreparationTemplates, wormholeSavePreparationTemplate, wormholeRenamePreparationTemplate, wormholeDeletePreparationTemplate, wormholeTemplateFillPlan } from '../src/wormholePreparationTemplates'
import { wormholeEnterPrepared } from '../src/wormholePreparation'

const ctx = buildSimContext()
function fixture() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const ship = addShipToFleet(state, 'sh-thresher')
  state.shipId = ship
  state.fleet[ship]!.fitted.high = ['mod-turret-kin-1']
  state.fleet[ship]!.droneLoad = { 'drone-scout': 4 }
  state.warehouse.items = { 'ammo-kinetic-l': 1000, 'drone-scout': 100, 'repairkit-mil': 3000 }
  return { state, ship }
}

describe('虫洞整备多模板 · 随档及明确取舍', () => {
  it('新增、改名、覆盖、删除仅改模板，十套上限与同名不覆盖', () => {
    const { state } = fixture()
    const before = structuredClone(state)
    for (let n = 1; n <= 10; n++) expect(wormholeSavePreparationTemplate(state, `方案${n}`, { 'ammo-kinetic-l': n, 'drone-scout': 0 }).ok).toBe(true)
    expect(wormholeSavePreparationTemplate(state, '第十一套', { 'ammo-kinetic-l': 0 })).toEqual({ ok: false, code: 'template-limit' })
    expect(wormholeSavePreparationTemplate(state, '方案1', { 'ammo-kinetic-l': 55 })).toEqual({ ok: false, code: 'name-duplicate' })
    expect(wormholeRenamePreparationTemplate(state, 'manifest-1', ' 新名称 ').ok).toBe(true)
    expect(wormholeSavePreparationTemplate(state, '新名称', { 'ammo-kinetic-l': 99 }, 'manifest-1').ok).toBe(true)
    expect(state.wormholePreparationTemplates![0]).toEqual({ id: 'manifest-1', name: '新名称', targets: { 'ammo-kinetic-l': 99 } })
    expect(state.warehouse).toEqual(before.warehouse)
    expect(state.fleet).toEqual(before.fleet)
    for (const t of [...state.wormholePreparationTemplates!]) expect(wormholeDeletePreparationTemplate(state, t.id).ok).toBe(true)
    expect(state.wormholePreparationTemplates).toBeUndefined()
    expect(wormholeRenamePreparationTemplate(state, 'missing', 'x')).toEqual({ ok: false, code: 'template-missing' })
  })

  it('新字段双轮往返保留两套及明确0；老档不补空字段', () => {
    const { state } = fixture()
    expect(wormholeSavePreparationTemplate(state, '炮舰', { 'ammo-kinetic-l': 80, 'drone-scout': 0 }).ok).toBe(true)
    expect(wormholeSavePreparationTemplate(state, '无人机', { 'ammo-kinetic-l': 0, 'drone-scout': 32 }).ok).toBe(true)
    const first = loadSaveFile(serializeSaveFile(state, 0)).state
    const second = loadSaveFile(serializeSaveFile(first, 0)).state
    expect(second.wormholePreparationTemplates).toEqual(state.wormholePreparationTemplates)
    expect(first.warehouse).toEqual(state.warehouse)
    const initial = createInitialState({ nowWallMs: 0 })
    expect(loadSaveFile(serializeSaveFile(initial, 0)).state).not.toHaveProperty('wormholePreparationTemplates')
  })

  it('坏数量、重复键和超过十套清洗，不把目标不足接成仓库供货', () => {
    const raw = Array.from({ length: 12 }, (_, n) => ({ id: `t${n}`, name: `模板${n}`, targets: { 'drone-scout': 0, a: -1, b: Infinity, c: 0.1, d: '3' } }))
    const clean = cleanWormholePreparationTemplates([null, {}, { id: 'bad', name: '', targets: {} }, raw[0], raw[0], ...raw.slice(1)])
    expect(clean).toHaveLength(10)
    expect(clean.every(t => Object.keys(t.targets).length === 1 && t.targets['drone-scout'] === 0)).toBe(true)
    const { state } = fixture()
    const before = structuredClone(state)
    expect(wormholeSavePreparationTemplate(state, '非法', { a: -1 }).ok).toBe(false)
    expect(wormholeSavePreparationTemplate(state, '非法', { a: 1, b: NaN }).ok).toBe(false)
    expect(wormholeSavePreparationTemplate(state, ' ', { a: 1 }).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('按模板填写弹药/备用/组件，不推算一套、不改部署或偏好；确认前只读', () => {
    const { state, ship } = fixture()
    const before = structuredClone(state)
    const template = { id: 'test', name: '自定', targets: { 'ammo-kinetic-l': 100, 'drone-scout': 0, 'repairkit-mil': 20 } }
    const plan = wormholeTemplateFillPlan(state, ctx, [ship], { targets: { 'drone-scout': 99 }, unload: [] }, template)
    expect(plan.request.targets).toEqual(template.targets)
    expect(plan.deployedDrones).toEqual({ 'drone-scout': 4 })
    expect(plan.items['drone-scout']).toBeUndefined()
    expect(state).toEqual(before)
    expect(wormholeEnterPrepared(state, ctx, [ship], 19, plan).ok).toBe(true)
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(900)
    expect(state.wormhole.run!.supplies!.items).toEqual({ 'ammo-kinetic-l': 100, 'repairkit-mil': 20 })
    expect(state.fleet[ship]!.droneLoad).toEqual(before.fleet[ship]!.droneLoad)
  })

  it('已有货超目标保留并报超额，已有卸港不取消，无暗卸或暗删', () => {
    const { state, ship } = fixture()
    state.fleet[ship]!.cargo = { 'ammo-kinetic-l': 150, 'drone-scout': 10, 'repairkit-mil': 12 }
    const before = structuredClone(state)
    const plan = wormholeTemplateFillPlan(state, ctx, [ship], { targets: {}, unload: ['repairkit-mil'] }, { id: 'a', name: 'x', targets: { 'ammo-kinetic-l': 100, 'repairkit-mil': 20, 'drone-scout': 0 } })
    expect(plan.request).toEqual({ targets: { 'ammo-kinetic-l': 150, 'repairkit-mil': 0, 'drone-scout': 10 }, unload: ['repairkit-mil'] })
    expect(plan.excess).toEqual({ 'ammo-kinetic-l': 50, 'drone-scout': 10 })
    expect(plan.fromWarehouse).toEqual({})
    expect(state).toEqual(before)
    expect(wormholeEnterPrepared(state, ctx, [ship], 19, plan).ok).toBe(true)
    expect(state.warehouse.items['repairkit-mil']).toBe(3012)
    expect(state.wormhole.run!.supplies!.items).toEqual({ 'ammo-kinetic-l': 150, 'drone-scout': 10 })
  })

  it('缺货和超容不减目标，入场拒绝原子；未知/非法物品套用不可入场', () => {
    const { state, ship } = fixture()
    const before = structuredClone(state)
    const plan = wormholeTemplateFillPlan(state, ctx, [ship], { targets: {}, unload: [] }, { id: 'a', name: 'x', targets: { 'ammo-kinetic-l': 10000, 'repairkit-mil': 3000, 'drone-scout': 32 } })
    expect(plan.request.targets['ammo-kinetic-l']).toBe(10000)
    expect(plan.shortage['ammo-kinetic-l']).toBe(9000)
    expect(plan.cells).toBeGreaterThan(plan.capacity)
    expect(wormholeEnterPrepared(state, ctx, [ship], 19, plan).ok).toBe(false)
    const bad = wormholeTemplateFillPlan(state, ctx, [ship], { targets: {}, unload: [] }, { id: 'a', name: 'x', targets: { 'no-such-item': 1 } })
    expect(bad.invalid).toContain('no-such-item')
    expect(state).toEqual(before)
  })
})
