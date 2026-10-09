import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS, L10N, l10nEntryText } from '@whale/data'
import { applyFoeOverride, createPlayerSpec, wormholeDerivedAnomaly } from '../src/combat'
import { createBattleState, createFoeSpecs, initFoeDronePools } from '../src/foeSpecs'
import { foeFamilyHpMulOf } from '../src/foePower'
import { advanceFoeHatcheries } from '../src/alienCombat'
import { cleanBattle } from '../src/saveBattleClean'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import { wormholeExpeditionCard } from '../src/wormholeExpeditionFoes'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const shell = ctx.anomalies.get('alien-vanguard')!
const expected = [
  ['foe-alien-acid-burster', 0.55], ['foe-alien-rift-larva', 0.22],
  ['foe-alien-starcore-larva', 0.22], ['foe-alien-starcore-adult', 0.18],
  ['foe-alien-brood-worker', 0.18], ['foe-alien-spore-hive', 0.18],
  ['foe-alien-maw', 0.12], ['foe-alien-hiveback', 0.12], ['foe-alien-broodmother', 0.1],
] as const
const hpOf = (spec: { hp: { s: number; a: number; h: number } }) => spec.hp.s + spec.hp.a + spec.hp.h
const cardOf = (ship: FoeShipDef): AnomalyDef => ({ ...shell, waves: undefined, ships: [{ ship, hpMul: 2.5 }] })

describe('C族最终血量与机型独立判定', () => {
  it.each(expected)('%s三层最终增加30%，回避率读取舰级，信号半径不随加血变化', (id, evasion) => {
    const ship = ctx.foeShips!.get(id)!
    const card = cardOf(ship)
    const before = createFoeSpecs(cardOf({ ...ship, family: 'A' }), bal)[0]!
    const after = createFoeSpecs(card, bal)[0]!
    for (const layer of ['s', 'a', 'h'] as const) expect(after.hp[layer]).toBeCloseTo(before.hp[layer] * 1.3, 9)
    expect(after.evasion).toBe(evasion)
    expect(after.signatureM).toBe(before.signatureM)
    expect(after.resists).toEqual(before.resists)
    expect(after.weapons).toEqual(before.weapons)
    expect(createFoeSpecs(card, bal)[0]).toEqual(after)
    expect(ship.hp).toBe(hpOf(before) / 2.5)
  })

  it('混编按单位family加血，不给非C舰体加血；旧威胁路径C也生效', () => {
    const c = ctx.foeShips!.get('foe-alien-starcore-adult')!
    const a = ctx.foeShips!.get('foe-pirate-skiff')!
    const specs = createFoeSpecs({ ...shell, ships: [{ ship: c }, { ship: a }] }, bal)
    expect(hpOf(specs[0]!)).toBeCloseTo(c.hp * 1.3)
    expect(hpOf(specs[1]!)).toBeCloseTo(a.hp)
    const legacy: AnomalyDef = { ...shell, ships: undefined, waves: undefined }
    const base = createFoeSpecs({ ...legacy, foeFamily: 'A' }, bal)[0]!
    const alien = createFoeSpecs(legacy, bal)[0]!
    expect(hpOf(alien)).toBeCloseTo(hpOf(base) * 1.3)
    expect(alien.signatureM).toBe(base.signatureM)
  })

  it.each(['foe-alien-spore-hive', 'foe-alien-hiveback'] as const)('%s敌机按自身C族加血，孵化/保存不重复乘', id => {
    const ship = ctx.foeShips!.get(id)!
    const foes = createFoeSpecs(cardOf(ship), bal)
    const { state } = alienFixture(ctx)
    const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 10000)
    battle.distanceM = 10000
    initFoeDronePools(battle, foes)
    const pool = battle.foeDronePools![foes[0]!.tag]![0]!
    const defense = ship.drones![0]!.drone.defense
    expect(pool.s).toBeCloseTo(defense.shieldHp * 1.3)
    expect(pool.a).toBeCloseTo(defense.armorHp * 1.3)
    expect(pool.h).toBeCloseTo(defense.hullHp * 1.3)
    const full = { s: pool.s, a: pool.a, h: pool.h }
    pool.alive = false; pool.s = pool.a = pool.h = 0
    const carriers = [{ tag: foes[0]!.tag, foeHatchery: { cycleMs: 20000, stock: 32, fleet: true as const } }]
    advanceFoeHatcheries(battle, carriers, 0)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    advanceFoeHatcheries(loaded, carriers, 19999)
    expect(loaded.foeDronePools![foes[0]!.tag]![0]!.alive).toBe(false)
    advanceFoeHatcheries(loaded, carriers, 20000)
    expect(loaded.foeDronePools![foes[0]!.tag]![0]).toMatchObject({ ...full, alive: true })
    advanceFoeHatcheries(loaded, carriers, 40000)
    expect(loaded.foeHatcheries![foes[0]!.tag]!.revived).toBe(1)
    const saved = cleanBattle(JSON.parse(JSON.stringify(loaded)))!
    const states = (entry: typeof loaded) => entry.foeDronePools![foes[0]!.tag]!.map(pool => ({ ...pool, inHangar: pool.inHangar === true }))
    expect(states(saved)).toEqual(states(loaded))
  })

  it('非C载体所带C机型仍加血，C载体所带非C机型不加血', () => {
    const base = ctx.foeShips!.get('foe-alien-hiveback')!
    const drone = base.drones![0]!.drone
    for (const [carrier, model, multiplier] of [['A', 'C', 1.3], ['C', 'A', 1]] as const) {
      const ship = { ...base, family: carrier, drones: [{ drone: { ...drone, family: model }, count: 1 }] }
      const foes = createFoeSpecs(cardOf(ship), bal)
      const { state } = alienFixture(ctx)
      const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 10000)
      initFoeDronePools(battle, foes)
      expect(battle.foeDronePools![foes[0]!.tag]![0]!.h).toBe(drone.defense.hullHp * multiplier)
    }
  })

  it.each([
    ['foe-alien-hiveback', 12000, 20000],
    ['foe-alien-broodmother', 9000, 15000],
  ] as const)('%s旧已排定孵化保持，下次战损按新周期', (id, oldCycle, cycle) => {
    const ship = ctx.foeShips!.get(id)!
    const foes = createFoeSpecs(cardOf(ship), bal)
    const { state } = alienFixture(ctx)
    const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 10000)
    battle.distanceM = 10000
    initFoeDronePools(battle, foes)
    const pool = battle.foeDronePools![foes[0]!.tag]![0]!
    const lose = (): void => { pool.alive = false; pool.s = pool.a = pool.h = 0 }
    lose()
    advanceFoeHatcheries(battle, [{ ...foes[0]!, foeHatchery: { ...foes[0]!.foeHatchery!, cycleMs: oldCycle } }], 100)
    advanceFoeHatcheries(battle, foes, oldCycle + 99)
    expect(pool.alive).toBe(false)
    expect(battle.foeHatcheries![foes[0]!.tag]!.nextAtMs).toBe(oldCycle + 100)
    advanceFoeHatcheries(battle, foes, oldCycle + 100)
    expect(pool.alive).toBe(true)
    lose()
    advanceFoeHatcheries(battle, foes, oldCycle + 101)
    expect(battle.foeHatcheries![foes[0]!.tag]!.nextAtMs).toBe(oldCycle + 101 + cycle)
    advanceFoeHatcheries(battle, foes, oldCycle + 100 + cycle)
    expect(pool.alive).toBe(false)
    advanceFoeHatcheries(battle, foes, oldCycle + 101 + cycle)
    expect(pool.alive).toBe(true)
    expect(pool.h).toBe(ship.drones![0]!.drone.defense.hullHp * 1.3)
  })

  it.each([150000, 1000])('共享池%s不吃族格，反复覆盖和保存仍保持绝对血量', bossHp => {
    const card = ctx.anomalies.get('alien-broodmother')!
    const layers = bossHp === 150000 ? { s: 30000, a: 82500, h: 37500 } : { s: 0, a: 0, h: 1000 }
    const override = { bossShipId: 'foe-alien-broodmother', bossHp, bossHpLayers: layers, bossHpMax: 150000 }
    const once = applyFoeOverride(card, override)
    const twice = applyFoeOverride(once, override)
    const foes = createFoeSpecs(twice, bal, { tagPrefix: 'w3-' })
    const mother = foes.find(unit => unit.foeShipId === override.bossShipId)!
    expect(hpOf(mother)).toBeCloseTo(bossHp, 8)
    for (const layer of ['s', 'a', 'h'] as const) expect(mother.hp[layer]).toBeCloseTo(layers[layer], 8)
    const escort = foes.find(unit => unit.foeShipId === 'foe-alien-hiveback')!
    expect(hpOf(escort)).toBeCloseTo(2080 * 1.739 * 1.3, 8)
    const { state } = alienFixture(ctx)
    const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 10000)
    battle.distanceM = 10000
    battle.foeOverride = override
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.units[mother.tag]!.hp).toEqual(battle.units[mother.tag]!.hp)
    const rebuilt = createFoeSpecs(applyFoeOverride(card, loaded.foeOverride), bal, { tagPrefix: 'w3-' })
    expect(rebuilt.find(unit => unit.foeShipId === override.bossShipId)!.hp).toEqual(mother.hp)
  })

  it('无三层覆盖的旧共享池也保持总量，其他族绝对覆写不变', () => {
    for (const id of ['alien-broodmother', 'ink-flagship', 'corona-nexus']) {
      const card = ctx.anomalies.get(id)!
      const ship = card.ships!.find(slot => slot.ship.hullClassTier === 5)!.ship
      const specs = createFoeSpecs(applyFoeOverride(card, { bossHp: 1234, bossShipId: ship.id }), bal, { tagPrefix: 'w3-' })
      expect(hpOf(specs.find(unit => unit.foeShipId === ship.id)!)).toBeCloseTo(1234)
    }
  })
})

describe('C族最终加血不被探索预算抵消', () => {
  it.each([1, 5, 10])('信号空间第%s层保留30%加血，输出与信号半径不变', depth => {
    const card = ctx.anomalies.get('wh-alien-swarm') ?? ctx.anomalies.get('wh-alien-spore')!
    expect(card).toBeDefined()
    const plain = { ...card, id: `${card.id}-without-hp-trait`, ships: card.ships!.map(slot => ({ ...slot, ship: { ...slot.ship, family: 'A' as const } })) }
    const before = createFoeSpecs(wormholeDerivedAnomaly(ctx, plain, { depth, kind: 'node', waves: 1 }), bal)
    const after = createFoeSpecs(wormholeDerivedAnomaly(ctx, card, { depth, kind: 'node', waves: 1 }), bal)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < after.length; i++) {
      expect(hpOf(after[i]!)).toBeCloseTo(hpOf(before[i]!) * 1.3, 7)
      expect(after[i]!.weapons).toEqual(before[i]!.weapons)
      expect(after[i]!.signatureM).toBe(before[i]!.signatureM)
    }
  })

  it('新虫洞分配使用族格前比例，最终血量30%且没有额外输出加成', () => {
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies].map(([id, card]) => [id, {
      ...card, ships: card.ships?.map(slot => ({ ...slot, ship: { ...slot.ship, family: slot.ship.family === 'C' ? 'A' as const : slot.ship.family } })),
    }])), foeShips: new Map(ctx.foeShips) }
    for (const depth of [1, 10]) {
      const before = wormholeExpeditionCard(local, 'C', depth, 'ordinary')
      const after = wormholeExpeditionCard(ctx, 'C', depth, 'ordinary')
      expect(after.expeditionFoe.strength.hp).toBeCloseTo(before.expeditionFoe.strength.hp * 1.3, 7)
      expect(after.expeditionFoe.strength.dps).toBe(before.expeditionFoe.strength.dps)
      expect(after.expeditionFoe.budget.hp).toBeCloseTo(before.expeditionFoe.strength.hp * 1.3, 7)
    }
  })
})

function handbookRenderer(locale: 'zh' | 'en') {
  type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] }
  const scope: Record<string, any> = {
    exports: {}, L10N, l10nEntryText, FOE_MOUNTS, FOE_SHIPS, foeFamilyHpMulOf,
    WEB_BREAK_DIST_M: 4500, signalSpaceTextId: (id: string) => id,
    localStorage: { getItem: () => locale }, navigator: { language: locale }, createContext: () => ({}),
    React: { Fragment: 'fragment', createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) },
    ShipSprite: 'ship', DmgChip: 'damage',
  }
  const execute = (path: string, pick?: string): void => {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const code = pick ? ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === pick)!.getText(ast)
      : ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
    runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  }
  execute('apps/desktop/src/renderer/src/i18n/locale.tsx')
  Object.assign(scope, { tr: scope.exports.tr, isEn: scope.exports.isEn })
  execute('apps/desktop/src/renderer/src/ui/foeBrief.ts')
  Object.assign(scope, { foeBriefLinesOfShip: scope.exports.foeBriefLinesOfShip, mountLabelText: scope.exports.mountLabelText })
  execute('apps/desktop/src/renderer/src/panels/handbookDetail.tsx', 'FoeBody')
  return scope.exports
}

describe('真实手册回避率和说明同源', () => {
  const ui = handbookRenderer('zh')
  it.each(expected)('%s手册详情显示%s回避，与实际建档一致', (id, rate) => {
    const ship = ctx.foeShips!.get(id)!
    const tree = ui.FoeBody({ cell: { raw: ship }, engine: { ctx } })
    const rows = tree.children.filter((node: any) => node?.props?.className === 'app-detail-row')
    const row = rows.find((node: any) => node.children[0].children[0] === L10N['ui.FitPage.007']!.zh)
    expect(row.children[1].children[0]).toBe(`${Math.round(rate * 100)}%`)
    expect(createFoeSpecs(cardOf(ship), bal)[0]!.evasion).toBe(rate)
  })

  it('新中文说明不含炮伤惩罚、无英文草稿，英文显示只回退中文', () => {
    const en = handbookRenderer('en')
    const text = ui.mountEffectText(FOE_MOUNT_IDS.broodControl)
    expect(text).toBe('本舰无人机伤害增加50%，射程增加50%。')
    expect(en.mountEffectText(FOE_MOUNT_IDS.broodControl)).toBe(text)
    expect(ui.mountEffectText(FOE_MOUNT_IDS.hivebackHatchery)).toContain('20秒')
    expect(ui.mountEffectText(FOE_MOUNT_IDS.broodmotherHatchery)).toContain('15秒')
    for (const id of ['ui.alien.008', 'ui.alien.009']) expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
    expect(L10N['ui.alien.002']!.en).toContain('gun damage')
  })
})
