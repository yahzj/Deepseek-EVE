import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildSimContext, FOE_SHIPS, L10N } from '@whale/data'
import { activeFoeSpecsOf, createBattleState, foesWithSupport, resolveFoeRevive, seedUnit } from '../src/foeSpecs'
import { advanceBattleFor, applyFoeOverride, battleArcsFor, createPlayerSpec } from '../src/combat'
import { foeShipIdOfTag, foeShipTierOf, foeUnitNameOf } from '../src/foeCard'
import { isAlive } from '../src/combatMath'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import type { BattleState } from '../src/state'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const ctx = buildSimContext()
const card = ctx.anomalies.get('alien-broodmother')!
const ADULT = 'foe-alien-starcore-adult'
function world(entry: AnomalyDef = card) {
  const { state } = alienFixture(ctx, 'heavy', 611, 4)
  const foes = activeFoeSpecsOf(entry, ctx.balance.battle, 3)
  const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 200)
  battle.distanceM = 200
  battle.waveIdx = 3
  const mother = foes.find(f => f.foeSummonEscort)!
  return { state, battle, foes, mother, entry }
}
const down = (battle: BattleState, tag: string): void => { battle.units[tag]!.hp = { s: 0, a: 0, h: 0 } }
function summon(w: ReturnType<typeof world>, clock = 30000): void {
  w.battle.foeAbilityClocks = { [w.mother.tag]: clock }
  resolveFoeRevive(w.state, w.battle, w.foes, ctx.balance.battle, 999999)
}

function renderer(locale: 'zh' | 'en') {
  const sourceOf = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
  const bodyOf = (path: string): string => {
    const ast = ts.createSourceFile(path, sourceOf(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    return ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  }
  const scope: Record<string, any> = { exports: {}, L10N, FOE_MOUNTS, FOE_SHIPS, WEB_BREAK_DIST_M: 4500,
    signalSpaceTextId: (id: string) => id, localStorage: { getItem: () => locale }, navigator: { language: locale },
    createContext: () => ({ Provider: 'Provider' }) }
  const execute = (source: string): void => { runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope) }
  execute(bodyOf('apps/desktop/src/renderer/src/i18n/locale.tsx'))
  scope.tr = scope.exports.tr; scope.isEn = scope.exports.isEn
  execute(bodyOf('apps/desktop/src/renderer/src/ui/foeBrief.ts'))
  const handbook = ts.createSourceFile('handbook.tsx', sourceOf('apps/desktop/src/renderer/src/panels/Handbook.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const collector = handbook.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'collectFoeShips')!
  execute(`${collector.getText(handbook)}\nexports.collect = collectFoeShips`)
  return scope.exports as {
    collect: (engine: { ctx: ReturnType<typeof buildSimContext> }) => Map<string, FoeShipDef>
    mountEffectText: (id: string) => string
    foeBriefLinesOfShip: (ship: FoeShipDef) => { mounts: Array<{ name: string; effect: string }> }
  }
}

describe('巢母主动召唤星髓成虫', () => {
  it('保留9秒无限补机与加速，30秒最多3架；无随机消费、不要求成虫或工虫尸体', () => {
    const w = world()
    expect(w.mother.foeReviveEscort).toBeUndefined()
    expect(w.mother.foeSummonEscort).toEqual({ everyMs: 30000, count: 3, shipId: ADULT, activeClock: true })
    expect(w.mother.foeHatchery).toEqual({ cycleMs: 9000, stock: 'unlimited', fleet: true })
    expect(w.mother.foeFleetSpeedRamp).toEqual({ rampMs: 120000, maxBonusPct: 1.8 })
    for (const f of w.foes.slice(1)) delete w.battle.units[f.tag]
    const rng = structuredClone(w.state.rng)
    summon(w, 29999)
    expect(w.battle.foeReviveCount).toBeUndefined()
    summon(w)
    expect(w.battle.foeReviveCount).toBe(3)
    expect(w.state.rng).toEqual(rng)
    const supported = foesWithSupport(w.battle, w.foes).filter(f => f.tag.startsWith('sup'))
    expect(supported.map(f => f.foeShipId)).toEqual(Array(3).fill(ADULT))
    expect(supported.every(f => w.battle.units[f.tag]!.weapons.every(ms => ms > 0))).toBe(true)
  })

  it.each([0, 1, 2, 3])('空位%s只补实际空位，活援军计入4艘上限，满编周期不积累', room => {
    const w = world()
    for (const f of w.foes.slice(1, room + 1)) down(w.battle, f.tag)
    summon(w)
    expect(w.battle.foeReviveCount ?? 0).toBe(room)
    expect(foesWithSupport(w.battle, w.foes).filter(f => isAlive(w.battle, f.tag))).toHaveLength(4)
    summon(w, 60000)
    expect(w.battle.foeReviveCount ?? 0).toBe(room)
    const target = foesWithSupport(w.battle, w.foes).find(f => f.tag !== w.mother.tag && isAlive(w.battle, f.tag))!
    down(w.battle, target.tag)
    summon(w, 60001)
    expect(w.battle.foeReviveCount ?? 0).toBe(room)
    summon(w, 90000)
    expect(w.battle.foeReviveCount).toBe(room + 1)
  })

  it.each([.75, 1, 1.4])('本场强度%s从原成虫重建；不继承巢母20倍厚血或共享血池', strength => {
    const derived = applyFoeOverride(card, { strengthMul: strength, bossShipId: 'foe-alien-broodmother', bossHp: 150000 })
    const w = world(derived)
    for (const f of w.foes.slice(1)) down(w.battle, f.tag)
    summon(w)
    const original = activeFoeSpecsOf(derived, ctx.balance.battle, 1).find(f => f.foeShipId === ADULT)!
    const fresh = foesWithSupport(w.battle, w.foes).filter(f => f.tag.startsWith('sup'))
    for (const spec of fresh) {
      expect(spec.hp).toEqual(original.hp)
      expect(spec.hp.s + spec.hp.a + spec.hp.h).toBeCloseTo(936 * strength)
      expect(spec.weapons).toEqual(original.weapons)
      expect(spec.speedMps).toBe(398)
      expect(spec.foeChargeMul).toBe(2)
      expect(spec.foeSummonEscort).toBeUndefined()
    }
    expect(w.mother.hp.s + w.mother.hp.a + w.mother.hp.h).toBe(150000)
  })

  it('成虫名称、舰级、体积档、独立规格和随档计时一致；未知召唤tag不冒认', () => {
    const w = world()
    for (const f of w.foes.slice(1)) down(w.battle, f.tag)
    summon(w)
    const fresh = foesWithSupport(w.battle, w.foes).filter(f => f.tag.startsWith('sup'))
    for (const spec of fresh) {
      expect(foeShipIdOfTag(card, spec.tag)).toBe(ADULT)
      expect(foeShipTierOf(card, spec.tag)).toBe(2)
      expect(foeUnitNameOf(card, spec.tag)).toBe('星髓成虫')
      expect(w.battle.units[spec.tag]!.foeShipId).toBe(ADULT)
    }
    const arcs = battleArcsFor(w.state, ctx, { battle: w.battle, anomaly: card, leaderShipId: w.state.shipId })!
    expect(arcs.foeBands.find(band => band.maxM === 2655)?.count).toBe(3)
    expect(arcs.foeMounts).toContain('虫群冲锋器 T2')
    fresh[0]!.weapons[0]!.maxRangeM = 1
    expect(fresh[1]!.weapons[0]!.maxRangeM).toBe(2655)
    expect(w.mother.foeSummonTemplate!.weapons[0]!.maxRangeM).toBe(2655)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle: w.battle }
    const back = loadSaveFile(serializeSaveFile(w.state)).state
    expect(back.expedition.battle!.foeReviveAtMs).toBe(60000)
    const rebuilt = activeFoeSpecsOf(card, ctx.balance.battle, 3)
    expect(foesWithSupport(back.expedition.battle!, rebuilt).filter(f => f.tag.startsWith('sup')).map(f => f.weapons)).toEqual(
      Array(3).fill(w.mother.foeSummonTemplate!.weapons))
    expect(foeShipIdOfTag(card, 'sup999-w3-summon-unknown')).toBeNull()
    expect(foeShipIdOfTag(card, `sup999-w0-summon-${ADULT}`)).toBeNull()
    const legacy = { ...w.foes[2]!, tag: `sup4-${w.foes[2]!.tag}` }
    seedUnit(w.battle, legacy)
    expect(foesWithSupport(w.battle, w.foes).find(f => f.tag === legacy.tag)!.foeShipId).toBe('foe-alien-brood-worker')
  })

  it('巢母死亡、战斗结束或总开关关闭均不召唤；未配置来源不伪造成虫倍率', () => {
    for (const kind of ['death', 'end', 'off', 'missing'] as const) {
      const w = world()
      for (const f of w.foes.slice(1)) down(w.battle, f.tag)
      if (kind === 'death') down(w.battle, w.mother.tag)
      if (kind === 'end') w.battle.ended = 'me'
      if (kind === 'missing') delete w.mother.foeSummonTemplate
      w.battle.foeAbilityClocks = { [w.mother.tag]: 30000 }
      resolveFoeRevive(w.state, w.battle, w.foes, { ...ctx.balance.battle, foeReviveEnabled: kind !== 'off' }, 30000)
      expect(w.battle.foeReviveCount).toBeUndefined()
    }
  })

  it('真引擎成虫会攻击、会受伤，巢母死后存活成虫阻止判胜，全部击毁才胜利', () => {
    const w = world()
    w.state.fleet[w.state.shipId]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    const def = ctx.ships.get('sh-megalodon')!
    const local = { ...ctx, ships: new Map(ctx.ships).set(def.id, { ...def, shieldHp: 900000, armorHp: 900000, hullHp: 900000 }) }
    for (const f of w.foes.slice(1)) down(w.battle, f.tag)
    summon(w)
    down(w.battle, w.mother.tag)
    const targets = foesWithSupport(w.battle, w.foes).filter(f => f.tag.startsWith('sup'))
    for (const target of targets) w.battle.units[target.tag]!.hp = { s: 900000, a: 900000, h: 900000 }
    w.battle.distanceM = 200
    for (let time = 100; time <= 15000; time += 100) {
      w.state.gameMs = time
      advanceBattleFor(w.state, local, w.battle, w.state.shipId, card.id)
    }
    expect(w.battle.stats.foeShots).toBeGreaterThan(0)
    expect(w.battle.stats.meHits).toBeGreaterThan(0)
    expect(w.battle.stats.meDmg).toBeGreaterThan(0)
    expect(w.battle.ended).toBeNull()
    for (const target of targets) down(w.battle, target.tag)
    w.state.gameMs += 2000
    advanceBattleFor(w.state, local, w.battle, w.state.shipId, card.id)
    expect(w.battle.ended).toBe('me')
  })
})

describe('手册挂载与中英明文同源', () => {
  it('条目空挂载覆盖舰级挂载，手册不偷偷补回默认件；多个出现配置按实际件去重', () => {
    const ship = ctx.foeShips!.get(ADULT)!
    const empty: AnomalyDef = { ...card, id: 'empty-mount-case', ships: [{ ship, count: 1, mounts: [] }] }
    const mounted: AnomalyDef = { ...card, id: 'mounted-case', ships: [{ ship, count: 1, mounts: [FOE_MOUNT_IDS.broodControl] }] }
    const ui = renderer('zh')
    const local = { ...ctx, anomalies: new Map([[empty.id, empty]]) }
    expect(ui.collect({ ctx: local }).get(ADULT)!.mounts).toEqual([])
    local.anomalies.set(mounted.id, mounted)
    expect(ui.collect({ ctx: local }).get(ADULT)!.mounts).toEqual([FOE_MOUNT_IDS.broodControl])
    expect(ship.mounts).toEqual([FOE_MOUNT_IDS.chargeSwarmT2])
  })

  it.each(['zh', 'en'] as const)('%s真实收集器保留条目覆盖，墨潮母舰展示实际召唤装置，源数据不变', locale => {
    const data = buildSimContext(locale), before = structuredClone(data.anomalies.get('ink-flagship')!)
    const ui = renderer(locale)
    const collected = ui.collect({ ctx: data })
    const ship = collected.get('foe-h-ink-flagship')!
    expect(ship.mounts).toEqual([FOE_MOUNT_IDS.reviveEscort])
    const line = ui.foeBriefLinesOfShip(ship)
    expect(line.mounts).toHaveLength(1)
    expect(line.mounts[0]!.name).toBe(locale === 'zh' ? '支援舰船召唤装置' : FOE_MOUNTS[FOE_MOUNT_IDS.reviveEscort].en)
    expect(line.mounts[0]!.effect).toContain('60')
    expect(line.mounts[0]!.effect).toContain('2')
    expect(line.mounts[0]!.effect).toContain(locale === 'zh' ? '优先召回墨潮干扰舰' : 'prioritizing the Ink Tide Jammer')
    expect(data.anomalies.get('ink-flagship')).toEqual(before)
    expect(data.foeShips!.get('foe-h-ink-flagship')!.mounts).toBeUndefined()
    const hatch = ui.mountEffectText(FOE_MOUNT_IDS.broodmotherHatchery)
    expect(hatch).toContain('30')
    expect(hatch).toContain('3')
    expect(hatch).toContain(locale === 'zh' ? '星髓成虫' : 'Starcore Adults')
    expect(hatch).not.toMatch(/哺育工虫|Brood Worker|\{p\d+\}/)
  })
})
