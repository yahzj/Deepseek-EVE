import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import ships from '../../data/src/static/ships.json'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { adjustDroneLoad, cpuBudgetOf, fittedCpuUsed, droneCpuUsed, fitModule } from '../src/equipment'

const ctx = buildSimContext()
const root = new URL('../../../', import.meta.url)
// 船长2026-10-09确认：仅四船CPU变化，以批准前主树锁定其他字段和条目。
const baseline = '51f658b1'
const changes = [
  { id: 'sh-wh-c-cruiser', old: 280, next: 360, budget5: 450, need: 414, kind: 'battle' },
  { id: 'sh-wh-d-cruiser', old: 300, next: 350, budget5: 438, need: 414, kind: 'battle' },
  { id: 'pioneer', old: 175, next: 240, budget5: 300, need: 280, kind: 'mining' },
  { id: 'sh-humpback', old: 175, next: 260, budget5: 325, need: 280, kind: 'mining' },
] as const

function sample(row: (typeof changes)[number], old = false, level = 5) {
  const def = ctx.ships.get(row.id)!
  const local = old ? { ...ctx, ships: new Map([...ctx.ships, [row.id, { ...def, cpu: row.old }]]) } : ctx
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const shipId = addShipToFleet(state, row.id)
  state.skills.trained[ctx.balance.battle.cpuSkillId] = level
  const fitted = row.kind === 'battle'
    ? { high: Array(4).fill('mod-turret-kin-3') as string[], mid: ['mod-prop-3', 'mod-shield-kin-3', 'mod-track-3'], low: ['mod-armor-plate-3', 'mod-armor-kin-3'] }
    : { high: Array(3).fill('mod-miner-3') as string[], mid: ['mod-prop-3', 'mod-shield-kin-3'], low: ['mod-cargo-3', 'mod-cargo-3'] }
  for (const rack of ['high', 'mid', 'low'] as const) {
    for (const mod of fitted[rack]) state.moduleBay[mod] = (state.moduleBay[mod] ?? 0) + 1
  }
  state.warehouse.items['drone-heavy'] = 2
  const install = () => {
    for (const rack of ['high', 'mid', 'low'] as const) {
      for (const mod of fitted[rack]) {
        const result = fitModule(state, mod, local, { shipId })
        if (!result.ok) return result
      }
    }
    return row.kind === 'battle' ? adjustDroneLoad(state, local, 'drone-heavy', 2, shipId) : { ok: true }
  }
  return { state, local, shipId, def, install }
}

describe('获批四舰CPU调整', () => {
  it('静态JSON仅四个cpu值变化，其他42舰与四舰其他属性和顺序全部保持', () => {
    const old = JSON.parse(execFileSync('git', ['show', `${baseline}:packages/data/src/static/ships.json`], { cwd: root, encoding: 'utf8', windowsHide: true })) as typeof ships
    const expected = structuredClone(old)
    const rows = Object.values(expected.groups).flat()
    for (const change of changes) {
      const row = rows.find(row => row.id === change.id)!
      expect(row.cpu).toBe(change.old)
      row.cpu = change.next
    }
    expect(ships).toEqual(expected)
    expect([...ctx.ships]).toHaveLength(46)
  })

  it.each(changes)('$id中文和英文目录、零级和满级预算都读取新CPU', row => {
    for (const locale of ['zh', 'en'] as const) expect(buildSimContext(locale).ships.get(row.id)!.cpu).toBe(row.next)
    const zero = sample(row, false, 0)
    const max = sample(row)
    expect(cpuBudgetOf(zero.state, ctx, zero.shipId)).toBe(row.next)
    expect(cpuBudgetOf(max.state, ctx, max.shipId)).toBe(row.budget5)
    expect(max.state.fleet[max.shipId]!.plugs ?? []).toEqual([])
  })

  it.each(changes)('$id原预算拒绝的代表组合，在新满技能预算下无需扩容即可真实装配', row => {
    const old = sample(row, true)
    expect(old.install().ok).toBe(false)
    const next = sample(row)
    expect(next.install()).toMatchObject({ ok: true })
    const fleet = next.state.fleet[next.shipId]!
    expect(fittedCpuUsed(fleet.fitted, ctx, next.def) + droneCpuUsed(fleet.droneLoad, ctx)).toBe(row.need)
    expect(cpuBudgetOf(next.state, ctx, next.shipId) - row.need).toBe(row.budget5 - row.need)
  })

  it('巢群多装一件MK3甲量仍合法，再装一件超载被拒；不放宽CPU门禁', () => {
    const world = sample(changes[0])
    expect(world.install().ok).toBe(true)
    world.state.moduleBay['mod-armor-plate-3'] = 2
    expect(fitModule(world.state, 'mod-armor-plate-3', ctx, { shipId: world.shipId }).ok).toBe(true)
    const before = structuredClone(world.state.fleet[world.shipId]!)
    expect(fitModule(world.state, 'mod-armor-plate-3', ctx, { shipId: world.shipId })).toMatchObject({ ok: false, errorId: 'core.equipment.009' })
    expect(world.state.fleet[world.shipId]!.fitted).toEqual(before.fitted)
    expect(world.state.moduleBay['mod-armor-plate-3']).toBe(1)
  })

  it('座头鲸可追加第三件MK3扩仓，第四件仍超载；独角鲸低槽数量不变', () => {
    const world = sample(changes[3])
    expect(world.install().ok).toBe(true)
    world.state.moduleBay['mod-cargo-3'] = 2
    expect(fitModule(world.state, 'mod-cargo-3', ctx, { shipId: world.shipId }).ok).toBe(true)
    expect(fitModule(world.state, 'mod-cargo-3', ctx, { shipId: world.shipId })).toMatchObject({ ok: false, errorId: 'core.equipment.009' })
    expect(ctx.ships.get('pioneer')!.slots!.low).toBe(2)
  })
})
