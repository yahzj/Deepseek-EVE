import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { applyDamage, typeLayerMult, type Hp3 } from '../src/combatMath'
import { advanceBattleFor, startBattleFor, createPlayerSpec } from '../src/combat'
import { createFoeSpecs } from '../src/foeSpecs'
import { FOE_MOUNTS, FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'
import { triggerAcidBurst } from '../src/alienCombat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import { enemyDocumentIssues } from '../../../tools/data-editor-enemy-schema'
import parameters from '../src/static/foeMounts.json'
import { deferredL10nIssues } from '../../../tools/l10n-deferred-check'

const ctx = buildSimContext()
const root = new URL('../../../', import.meta.url)

function acidWorld(hp: Hp3, mounted = true, death = false, dc = false, seed = 611) {
  const original = ctx.foeShips!.get('foe-alien-acid-burster')!
  const ship = mounted ? original : { ...original, mounts: [FOE_MOUNT_IDS.acidCharge] }
  const card = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-shield', waves: undefined, ships: [{ ship, count: 1, dmgMul: 1 }] }
  const pilot = ctx.ships.get('sh-megalodon')!
  const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]),
    ships: new Map([...ctx.ships, [pilot.id, { ...pilot, shieldHp: 900_000, armorHp: 900_000, hullHp: 900_000 }]]),
    balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
  const { state } = alienFixture(local, 'heavy', seed)
  state.fleet[state.shipId]!.fitted = { high: [], mid: [], low: dc ? ['mod-dc-3'] : [] }
  state.warehouse.items['repairkit-dc'] = 2
  const battle = startBattleFor(state, local, state.shipId, card.id, 0, 200)!
  const spec = createPlayerSpec(state, local, state.shipId)!
  battle.units.player!.hp = { ...hp }
  battle.units.player!.weapons = battle.units.player!.weapons.map(() => 100000)
  battle.distanceM = 200
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle }
  const foe = createFoeSpecs(card, local.balance.battle)[0]!
  if (death) {
    battle.units[foe.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(triggerAcidBurst(battle, foe, 'killed', 0)).toBe(true)
  }
  state.gameMs = 100
  advanceBattleFor(state, local, battle, state.shipId, card.id)
  return { state, local, card, battle, spec, foe }
}

describe('酸液破盾腔独立乘区', () => {
  it('在原动能基础倍率上乘二，不改全局克制，无盾时和原来逐字相同', () => {
    expect(typeLayerMult('kinetic', 'shield')).toBe(1.5)
    const hp = { s: 1000, a: 1000, h: 1000 }
    expect(applyDamage(hp, {}, 100, 'kinetic').hp).toEqual({ s: 850, a: 1000, h: 1000 })
    expect(applyDamage(hp, {}, 100, 'kinetic', 2).hp).toEqual({ s: 700, a: 1000, h: 1000 })
    expect(applyDamage(hp, { shield: { kinetic: .5 } }, 100, 'kinetic', 2).hp.s).toBe(850)
    for (const shieldless of [{ s: 0, a: 1000, h: 1000 }, { s: 0, a: 0, h: 1000 }]) {
      expect(applyDamage(shieldless, {}, 100, 'kinetic', 2)).toEqual(applyDamage(shieldless, {}, 100, 'kinetic'))
    }
  })
  it('破盾余量只按原始伤害传递，保留整发原落点系数，不把乘二带到后层', () => {
    // 原始伤害落点在装甲，基础整发系数仍为0.75；盾层另外乘二。
    expect(applyDamage({ s: 60, a: 1000, h: 1000 }, {}, 100, 'kinetic', 2).hp).toEqual({ s: 0, a: 955, h: 1000 })
    // 原始落点在结构：盾消费50原伤，甲消费50原伤，结构仅消费剩余100。
    expect(applyDamage({ s: 100, a: 50, h: 1000 }, {}, 200, 'kinetic', 2).hp).toEqual({ s: 0, a: 0, h: 900 })
    expect(applyDamage({ s: 300, a: 1000, h: 1000 }, {}, 200, 'kinetic', 2).hp).toEqual({ s: 0, a: 850, h: 1000 })
  })
  it('挂载参数、静态字段契约、舰级/条目覆写与真建档同源', () => {
    const mount = FOE_MOUNTS[FOE_MOUNT_IDS.acidShield]
    expect(mount.name).toBe('酸液破盾腔')
    expect(mount.acidShieldDamageMul).toBe(2)
    expect(resolveFoeMounts([mount.id]).acidShieldDamageMul).toBe(2)
    expect(enemyDocumentIssues(parameters, 'foeMounts')).toEqual([])
    for (const id of ['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother']) {
      const card = ctx.anomalies.get(id)!
      const units = createFoeSpecs(card, ctx.balance.battle).filter(unit => unit.acidBurst)
      expect(units.length).toBeGreaterThan(0)
      for (const unit of units) {
        expect(unit.acidBurst!.shieldDamageMul).toBe(2)
        expect(unit.foeMountNames).toContain(mount.name)
      }
      const override = { ...card, waves: undefined, ships: [{ ship: ctx.foeShips!.get('foe-alien-acid-burster')!, mounts: [] }] }
      expect(createFoeSpecs(override, ctx.balance.battle)[0]!.acidBurst!.shieldDamageMul).toBeUndefined()
    }
    for (const ship of ctx.foeShips!.values()) if (ship.id !== 'foe-alien-acid-burster') expect(ship.mounts ?? []).not.toContain(mount.id)
  })
  it.each([false, true])('真实%s死亡路径只增加护盾伤害，先扣血再腐蚀，重载不重打', death => {
    for (const hp of [{ s: 900_000, a: 900_000, h: 900_000 }, { s: 100, a: 900_000, h: 900_000 }, { s: 0, a: 0, h: 900_000 }]) {
      const world = acidWorld(hp, true, death)
      const old = acidWorld(hp, false, death)
      const fx = world.battle.fx.find(event => event.acidBurst)!
      expect(fx.hit).toBe(true)
      expect(world.battle.units.player!.hp).toEqual(applyDamage(hp, world.spec.resists, world.foe.acidBurst!.damage!, 'kinetic', 2).hp)
      expect(old.battle.units.player!.hp).toEqual(applyDamage(hp, old.spec.resists, old.foe.acidBurst!.damage!, 'kinetic').hp)
      expect(world.battle.alienCorrosion).toBe(.15)
      expect(world.battle.stats.foeShots).toBe(1)
      expect(world.battle.acidBursts![world.foe.tag]!.cause).toBe(death ? 'killed' : 'attack')
      const loaded = loadSaveFile(serializeSaveFile(world.state, 0)).state.expedition.battle!
      const before = structuredClone(loaded.units.player!.hp)
      world.state.gameMs = 1000
      advanceBattleFor(world.state, world.local, loaded, world.state.shipId, world.card.id)
      expect(loaded.units.player!.hp).toEqual(before)
      expect(loaded.stats.foeShots).toBe(1)
      expect(loaded.alienCorrosion).toBe(.15)
    }
  })
  it.each([{ s: 60, a: 0, h: 110 }, { s: 20, a: 0, h: 127 }])('破盾增强使原来非致死的爆发触发损管，精度边界%s也不漏判', hp => {
    const old = acidWorld(hp, false, false, true)
    const world = acidWorld(hp, true, true, true)
    expect(old.battle.dcKitsUsed ?? 0).toBe(0)
    expect(old.battle.units.player!.hp.h).toBeGreaterThan(1)
    expect(world.battle.fx.find(event => event.acidBurst)!.hit).toBe(true)
    expect(world.battle.units.player!.hp.h).toBeGreaterThanOrEqual(1)
    expect(world.battle.units.player!.hp.h).toBeLessThan(1.00001)
    expect(world.battle.dcKitsUsed).toBe(1)
    expect(world.state.warehouse.items['repairkit-dc']).toBe(1)
    expect(world.battle.meVolleyDmg!.player).toBeLessThanOrEqual((world.spec.hp.s + world.spec.hp.a + world.spec.hp.h) * .8)
  })
  it('真实未命中仍自毁/腐蚀，但不会扣双倍护盾伤害', () => {
    const hp = { s: 900_000, a: 900_000, h: 900_000 }
    let misses = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { battle } = acidWorld(hp, true, false, false, seed)
      if (battle.fx.find(event => event.acidBurst)!.hit) continue
      misses++
      expect(battle.units.player!.hp).toEqual(hp)
      expect(battle.alienCorrosion).toBe(.15)
    }
    expect(misses).toBeGreaterThan(0)
  })
  it('真实挂载说明与名称可从图鉴和战斗反查，中文回退且待译登记完整', () => {
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/ui/foeBrief.ts', root), 'utf8')
    const scope = { exports: {} as { mountEffectText: (id: string) => string; mountEffectTextByName: (name: string) => string },
      require: (id: string) => id === '@whale/core' ? { FOE_MOUNTS } : { tr: (id: string) => l10nEntryText(L10N[id]!, 'en') } }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    expect(scope.exports.mountEffectText(FOE_MOUNT_IDS.acidShield)).toBe('自爆对护盾造成的伤害翻倍。')
    expect(scope.exports.mountEffectTextByName('酸液破盾腔')).toBe('自爆对护盾造成的伤害翻倍。')
    const backlog = readFileSync(new URL('docs/l10n-pending.md', root), 'utf8')
    expect(deferredL10nIssues(L10N, backlog)).toEqual([])
    expect(backlog).toContain('foe-mount-c-acid-shield')
  })
})
