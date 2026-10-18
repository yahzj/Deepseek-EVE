import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS, L10N, l10nEntryText } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { activeFoeSpecsOf, advanceBattleFor, applyFoeOverride, applyFoeUnitDamage, createBattleState, createFoeSpecs, createPlayerSpec, startBattleFor } from '../src/combat'
import { foesWithSupport, resolveFoeRevive, foeDesiredRange } from '../src/foeSpecs'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import { foeCapacitorMultiplierOf, noteFoeCapacitorAttack } from '../src/gravekeeperCombat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ENEMY_FIELDS, enemyDocumentIssues, enemyRowsOf } from '../../../tools/data-editor-enemy-schema'
import { enemyEnginePreview } from '../../../tools/data-editor-enemy-preview'
import type { DataDocument } from '../../../tools/data-editor-contract'
import fleetParameters from '../../data/src/static/invasionFleets.json'
import mountParameters from '../src/static/foeMounts.json'
import type { AnomalyDef, SimContext } from '../src/types'

const ctx = buildSimContext(), bal = ctx.balance.battle
const ids = ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship'] as const
const expectedSpeed: Record<string, number> = {
  'foe-d-invasion-cruiser': 319, 'foe-d-invasion-bastion': 232, 'foe-d-invasion-oathkeeper': 148,
  'foe-d-invasion-eternal-tomb': 112, 'foe-d-longship': 279, 'foe-d-stasis': 155, 'foe-d-throne': 148,
}
const hpSum = (hp: { s: number; a: number; h: number }) => hp.s + hp.a + hp.h

function fixture() {
  const state = createInitialState({ nowWallMs: 0, seed: 1610 })
  state.shipId = addShipToFleet(state, 'sh-megalodon')
  const me = createPlayerSpec(state, ctx, state.shipId)!
  const card = applyFoeOverride(ctx.anomalies.get('gravekeeper-flagship')!, {
    bossShipId: 'foe-d-invasion-eternal-tomb', bossHp: 300000, bossHpMax: 300000,
    bossHpLayers: { s: 90000, a: 120000, h: 90000 },
  })
  const specs = activeFoeSpecsOf(card, bal, 3)
  const boss = specs.find(f => f.foeReviveEscort)!
  const escorts = specs.filter(f => f !== boss)
  const b = createBattleState(me, specs, 0, 5000)
  b.distanceM = 5000
  b.waveIdx = 3
  b.units[boss.tag]!.enteredAtMs = 100000
  const resolve = (at: number) => {
    state.gameMs = at
    b.lastTickGameMs = at
    resolveFoeRevive(state, b, specs, bal, at)
  }
  const kill = (tag: string) => { b.units[tag]!.hp = { s: 0, a: 0, h: 0 } }
  return { state, me, card, specs, boss, escorts, b, resolve, kill }
}

describe('守墓入侵隔离调参', () => {
  it('静态表只增加入侵速度和盾动抗，后续确认的末波标签/四型近界精确单列', () => {
    const previous = JSON.parse(execFileSync('git', ['show', 'f8470a57:packages/data/src/static/invasionFleets.json'], { encoding: 'utf8' })) as typeof fleetParameters
    previous.groups.parameters.find(row => row.id === 'gravekeeper-flagship')!.threat = 191
    const current = structuredClone(fleetParameters)
    for (const row of current.groups.parameters) {
      if (!ids.includes(row.id as typeof ids[number])) continue
      for (const key of Object.keys(row)) if (/^ships_\d+_(speedMul|shieldResist_kinetic)$/.test(key)) delete (row as Record<string, unknown>)[key]
    }
    expect(current).toEqual(previous)
    const originalShips = JSON.parse(execFileSync('git', ['show', 'f8470a57:packages/data/src/static/foeShips.json'], { encoding: 'utf8' }))
    for (const row of originalShips.groups.parameters) if (['foe-d-invasion-cruiser', 'foe-d-invasion-bastion', 'foe-d-invasion-oathkeeper', 'foe-d-invasion-eternal-tomb'].includes(row.id)) row.rangeMinM = 100
    Object.assign(originalShips.groups.parameters.find((row: { id: string }) => row.id === 'foe-d-invasion-eternal-tomb'), { split_s: .3, split_a: .4, split_h: .3 })
    expect(JSON.parse(readFileSync(new URL('../../data/src/static/foeShips.json', import.meta.url), 'utf8'))).toEqual(originalShips)
  })

  it.each(ids)('%s每艘基础速度乘1.2，盾动抗30%，血量火力射程及期望不变', id => {
    const card = ctx.anomalies.get(id)!
    const old: AnomalyDef = { ...card, ships: card.ships!.map(({ speedMul: _speed, shieldResist: _shield, ...slot }) => slot) }
    for (let wave = 0; wave < card.waves!.length; wave++) {
      const current = activeFoeSpecsOf(card, bal, wave), before = activeFoeSpecsOf(old, bal, wave)
      for (let i = 0; i < current.length; i++) {
        const f = current[i]!, original = before[i]!
        expect(f.speedMps).toBe(expectedSpeed[f.foeShipId!])
        expect(f.resists.shield).toEqual({ kinetic: .3 })
        expect(f.resists.armor).toEqual(original.resists.armor)
        expect(f.resists.hull).toEqual(original.resists.hull)
        expect(f.hp).toEqual(original.hp)
        expect(f.weapons).toEqual(original.weapons)
        expect(f.evasion).toBe(original.evasion)
      }
      expect(foeDesiredRange(current[0]!, current, bal)).toBe(foeDesiredRange(before[0]!, before, bal))
    }
  })

  it('普通D舰不提速不增抗，条目抗性覆写仍保留舰级其他类型', () => {
    for (const ship of FOE_SHIPS.filter(s => s.family === 'D')) {
      const card: AnomalyDef = { ...ctx.anomalies.get('gravekeeper-drift')!, ships: [{ ship }], waves: undefined }
      const f = createFoeSpecs(card, bal)[0]!
      expect(f.speedMps).toBe(Math.round(bal.hullClassBaseSpeedMps[ship.hullClassTier] * ship.speedRatio))
      expect(f.resists.shield).toEqual(ship.shieldResist)
      if (ship.id === 'foe-d-invasion-eternal-tomb') expect(f.foeReviveEscort).toEqual({ everyMs: 60000, all: true })
      else expect(f.foeReviveEscort).toBeUndefined()
    }
    const ship = { ...FOE_SHIPS.find(s => s.id === 'foe-d-longship')!, shieldResist: { kinetic: .1, plasma: .2 } }
    const card: AnomalyDef = { ...ctx.anomalies.get('gravekeeper-drift')!, ships: [{ ship, shieldResist: { kinetic: .3 } }], waves: undefined }
    expect(createFoeSpecs(card, bal)[0]!.resists.shield).toEqual({ kinetic: .3, plasma: .2 })
    expect(ship.shieldResist).toEqual({ kinetic: .1, plasma: .2 })
  })

  it('30%盾动抗实际减伤、其他弹系不改，共享池仍最后覆盖30万', () => {
    const w = fixture()
    const hit = (kinetic: boolean, resistant: boolean) => {
      const b = structuredClone(w.b)
      const f = resistant ? w.boss : { ...w.boss, resists: { ...w.boss.resists, shield: {} } }
      const before = b.units[f.tag]!.hp.s
      applyFoeUnitDamage(b, f, 100, kinetic ? 'kinetic' : 'plasma')
      return before - b.units[f.tag]!.hp.s
    }
    expect(hit(true, true)).toBeCloseTo(hit(true, false) * .7, 8)
    expect(hit(false, true)).toBe(hit(false, false))
    expect(hpSum(w.boss.hp)).toBe(300000)
    expect(w.boss.hp).toEqual({ s: 90000, a: 120000, h: 90000 })
  })

  it('蓄能按1.3乘算，非加法；装填仍1.1，武器分账不改', () => {
    const { b, boss } = fixture()
    b.foeShieldCapacitorActive = { [boss.tag]: true }
    for (let n = 0; n < 8; n++) noteFoeCapacitorAttack(b, boss, 0)
    expect(foeCapacitorMultiplierOf(b, boss, 0, 'damageMul')).toBeCloseTo(1.3 ** 8, 8)
    expect(foeCapacitorMultiplierOf(b, boss, 0, 'damageMul')).not.toBeCloseTo(1 + .3 * 8, 5)
    expect(foeCapacitorMultiplierOf(b, boss, 0, 'reloadMul')).toBeCloseTo(1.1 ** 8, 8)
    expect(foeCapacitorMultiplierOf(b, boss, 'pd', 'damageMul')).toBe(1)
  })
})

describe('陵寝重构协议', () => {
  it('只挂入侵永陵，保留原镀层/蓄能及王座支援，不改墨潮复活件', () => {
    const w = fixture()
    expect(w.specs.filter(s => s.foeReviveEscort)).toEqual([w.boss])
    expect(w.boss.foeReviveEscort).toEqual({ everyMs: 60000, all: true })
    expect(w.boss.foeCoatingArmor).toBeDefined()
    expect(w.boss.foeShieldCapacitor).toBeDefined()
    expect(activeFoeSpecsOf(w.card, bal, 1).find(f => f.foeShipId === 'foe-d-throne')!.foeSupportCall).toBeDefined()
    expect(w.escorts.find(f => f.foeShipId === 'foe-d-invasion-oathkeeper')!.foeRebirthProtocol).toBeDefined()
    expect(w.escorts.filter(f => f.foeShipId === 'foe-d-invasion-bastion')).toHaveLength(2)
    expect(FOE_MOUNTS[FOE_MOUNT_IDS.reviveEscort].reviveEscort).toEqual({ everyMs: 60000, count: 2, priorityShipIds: ['foe-h-ink-jammer'] })
  })

  it('从永陵本波入场起满60秒，一次满血复活全部3艘，携带本卡速度与抗性', () => {
    const w = fixture()
    for (const f of w.escorts) w.kill(f.tag)
    const oldBoss = structuredClone(w.b.units[w.boss.tag]!.hp)
    w.resolve(159999)
    expect(w.b.foeReviveCount).toBeUndefined()
    w.resolve(160000)
    expect(w.b.foeReviveCount).toBe(3)
    const supports = foesWithSupport(w.b, w.specs).filter(f => f.tag.startsWith('sup'))
    expect(supports).toHaveLength(3)
    expect(supports.map(f => f.name).sort()).toEqual(['守誓级', '碑卫级', '碑卫级'].sort())
    for (const f of supports) {
      expect(w.b.units[f.tag]!.hp).toEqual(f.hp)
      expect(w.b.units[f.tag]!.enteredAtMs).toBe(160000)
      expect(f.speedMps).toBe(expectedSpeed[f.foeShipId!])
      expect(f.resists.shield).toEqual({ kinetic: .3 })
    }
    expect(w.b.units[w.boss.tag]!.hp).toEqual(oldBoss)
    expect(w.b.foeReviveAtMs).toBe(220000)
    expect(w.state.logs.filter(l => l.textId === 'core.combat.001')).toHaveLength(3)
  })

  it('活舰不治疗、不复制；死亡的支援舰后续周期可再满血补回，不超编', () => {
    const w = fixture()
    w.b.units[w.escorts[0]!.tag]!.hp.s = 1
    const original = structuredClone(w.b.units[w.escorts[0]!.tag]!.hp)
    w.resolve(160000)
    expect(w.b.foeReviveCount).toBeUndefined()
    expect(w.b.units[w.escorts[0]!.tag]!.hp).toEqual(original)
    for (const f of w.escorts) w.kill(f.tag)
    w.resolve(160001)
    expect(w.b.foeReviveCount).toBeUndefined()
    w.resolve(220000)
    expect(w.b.foeReviveCount).toBe(3)
    const supports = foesWithSupport(w.b, w.specs).filter(f => f.tag.startsWith('sup'))
    w.kill(supports[0]!.tag)
    w.resolve(280000)
    expect(w.b.foeReviveCount).toBe(4)
    w.resolve(340000)
    expect(w.b.foeReviveCount).toBe(4)
    expect(foesWithSupport(w.b, w.specs).filter(f => hpSum(w.b.units[f.tag]!.hp) > 0)).toHaveLength(4)
  })

  it('不复活之前波次，不复活永陵自身，永陵被击沉立即停用', () => {
    const w = fixture()
    const earlier = activeFoeSpecsOf(w.card, bal, 0)
    const earlierRt = createBattleState(w.me, earlier, 0, 5000).units
    for (const f of earlier) w.b.units[f.tag] = { ...earlierRt[f.tag]!, hp: { s: 0, a: 0, h: 0 } }
    w.resolve(160000)
    expect(w.b.foeReviveCount).toBeUndefined()
    for (const f of w.escorts) w.kill(f.tag)
    w.kill(w.boss.tag)
    w.resolve(220000)
    expect(w.b.foeReviveCount).toBeUndefined()
  })

  it('长段补算不提前复活，入场时刻按实际战斗拍，不推到整段预算末尾', () => {
    const w = fixture()
    for (const f of w.escorts) w.kill(f.tag)
    w.state.gameMs = 300000
    w.b.lastTickGameMs = 100000
    resolveFoeRevive(w.state, w.b, w.specs, bal, 300000)
    expect(w.b.foeReviveCount).toBeUndefined()
    w.b.lastTickGameMs = 160000
    resolveFoeRevive(w.state, w.b, w.specs, bal, 300000)
    expect(w.b.foeReviveCount).toBe(3)
    expect(w.b.foeReviveAtMs).toBe(220000)
    for (const f of foesWithSupport(w.b, w.specs).filter(f => f.tag.startsWith('sup'))) {
      expect(w.b.units[f.tag]!.enteredAtMs).toBe(160000)
    }
  })

  it('总开关关闭或战斗结束时不启动重构；只有一艘阵亡时只补一艘', () => {
    const w = fixture()
    w.kill(w.escorts[0]!.tag)
    w.b.lastTickGameMs = w.state.gameMs = 160000
    resolveFoeRevive(w.state, w.b, w.specs, { ...bal, foeReviveEnabled: false }, 160000)
    expect(w.b.foeReviveAtMs).toBeUndefined()
    w.b.ended = 'foe'
    resolveFoeRevive(w.state, w.b, w.specs, bal, 160000)
    expect(w.b.foeReviveAtMs).toBeUndefined()
    w.b.ended = null
    w.resolve(160000)
    expect(w.b.foeReviveCount).toBe(1)
  })

  it('同场存档往返保留复活时钟与在场支援，不重复补满、不提前触发', () => {
    const w = fixture()
    for (const f of w.escorts) w.kill(f.tag)
    w.resolve(160000)
    w.state.encounter = { ...w.state.encounter, active: true, battle: w.b, shipId: w.state.shipId,
      anomalyId: w.card.id, galaxyId: 'galaxy-maw', name: w.card.name, origin: '入侵', threat: w.card.threat,
      invitedAtGameMs: 0, deadlineGameMs: 1e9 }
    const state = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const b = state.encounter!.battle!
    expect(b.foeReviveCount).toBe(3)
    expect(b.foeReviveAtMs).toBe(220000)
    const supports = foesWithSupport(b, w.specs).filter(f => f.tag.startsWith('sup'))
    expect(supports).toHaveLength(3)
    for (const f of supports) expect(b.units[f.tag]!.hp).toEqual(w.b.units[f.tag]!.hp)
    resolveFoeRevive(state, b, w.specs, bal, 220000)
    expect(b.foeReviveCount).toBe(3)
  })

  it('真实末波中复活舰完成入场后开火、可被击沉，并阻止提前清波', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    state.shipId = addShipToFleet(state, 'sh-megalodon')
    const specs = activeFoeSpecsOf(ctx.anomalies.get('gravekeeper-flagship')!, bal, 3)
    const card: AnomalyDef = { ...ctx.anomalies.get('gravekeeper-flagship')!, id: 'retune-live', waves: undefined,
      ships: ctx.anomalies.get('gravekeeper-flagship')!.ships!.filter(s => s.wave === 3).map(s => ({ ...s, wave: 0 })) }
    const context: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card),
      balance: { ...ctx.balance, battle: { ...bal, cannotEngageMs: 1e9 } } }
    const b = startBattleFor(state, context, state.shipId, card.id, 0, 5000)!
    const current = activeFoeSpecsOf(card, bal, 0), boss = current.find(f => f.foeReviveEscort)!
    for (const rt of Object.values(b.units)) { delete rt.enteredAtMs; rt.weapons.fill(1e9) }
    b.units.player!.hp = { s: 1e9, a: 1e9, h: 1e9 }
    b.units.player!.hpMax = { s: 1e9, a: 1e9, h: 1e9 }
    for (const f of current) if (f !== boss) b.units[f.tag]!.hp = { s: 0, a: 0, h: 0 }
    const realtimeState = structuredClone(state), realtime = structuredClone(b)
    state.gameMs = 60010
    advanceBattleFor(state, context, b, state.shipId, card.id)
    expect(b.foeReviveCount).toBe(3)
    for (let t = 1000; t <= 60000; t += 1000) {
      realtimeState.gameMs = t
      advanceBattleFor(realtimeState, context, realtime, realtimeState.shipId, card.id)
    }
    realtimeState.gameMs = 60010
    advanceBattleFor(realtimeState, context, realtime, realtimeState.shipId, card.id)
    expect(realtime.foeReviveAtMs).toBe(b.foeReviveAtMs)
    expect(realtime.foeReviveCount).toBe(b.foeReviveCount)
    expect(realtime.units).toEqual(b.units)
    expect(realtime.stats).toEqual(b.stats)
    const shots = b.stats.foeShots
    state.gameMs = 70000
    advanceBattleFor(state, context, b, state.shipId, card.id)
    expect(b.stats.foeShots).toBeGreaterThan(shots)
    b.units[boss.tag]!.hp = { s: 0, a: 0, h: 0 }
    state.gameMs = 70010
    advanceBattleFor(state, context, b, state.shipId, card.id)
    expect(b.ended).toBeNull()
    const supports = foesWithSupport(b, current).filter(f => f.tag.startsWith('sup'))
    for (const f of supports) applyFoeUnitDamage(b, f, 1e10, 'plasma')
    const guarded = supports.find(f => f.foeRebirthProtocol)!
    expect(b.foeRebirths?.[guarded.tag]).toBeDefined()
    expect(b.units[guarded.tag]!.hp.h).toBeGreaterThanOrEqual(1)
    state.gameMs = 70020
    advanceBattleFor(state, context, b, state.shipId, card.id)
    expect(b.ended).toBeNull()
    state.gameMs = 72000
    advanceBattleFor(state, context, b, state.shipId, card.id)
    for (const f of supports) applyFoeUnitDamage(b, f, 1e10, 'plasma')
    state.gameMs = 72010
    advanceBattleFor(state, context, b, state.shipId, card.id)
    expect(b.ended).toBe('me')
    expect(specs.filter(f => f.foeReviveEscort)).toHaveLength(1)
  })
})

describe('重构挂载说明与编辑器', () => {
  it('新增挂载与每条入侵速度/抗性数字均进入字段契约，旧表仍合法', () => {
    expect(enemyDocumentIssues(fleetParameters, 'invasionFleets')).toEqual([])
    expect(enemyDocumentIssues(mountParameters, 'foeMounts')).toEqual([])
    const meta = ENEMY_FIELDS.foeMounts.find(r => r.id === FOE_MOUNT_IDS.dReconstruction)!
    expect(meta.references!.some(r => r.id === 'gravekeeper-flagship')).toBe(true)
    for (const id of ids) {
      const fields = enemyRowsOf('invasionFleets', fleetParameters as DataDocument).find(row => row.id === id)!.fields
      expect(fields.filter(f => f.path.endsWith('_speedMul'))).toHaveLength(ctx.anomalies.get(id)!.ships!.length)
      const shield = fields.filter(f => f.path.endsWith('_shieldResist_kinetic'))
      expect(shield).toHaveLength(ctx.anomalies.get(id)!.ships!.length)
      expect(shield.every(f => f.percent && f.label === '护盾抗性 · 动能')).toBe(true)
    }
    const preview = enemyEnginePreview({ table: 'foeMounts', id: FOE_MOUNT_IDS.dReconstruction, mode: 'base', depth: 1, role: 'ordinary' })
    expect(preview.references.some(r => r.id === 'gravekeeper-flagship')).toBe(true)
  })

  it('战斗/手册共用的说明按参数展示全体复活，英文覆盖不误写墨潮两艘规则', () => {
    const root = new URL('../../../', import.meta.url)
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/ui/foeBrief.ts', root), 'utf8')
    const scope = { exports: {} as { mountEffectText: (id: string) => string; briefShipsOf: (card: AnomalyDef) => Array<{ id: string; mounts: Array<{ name: string; effect: string }> }> },
      require: (id: string) => id === '@whale/core' ? { FOE_MOUNTS } : {
        isEn: () => true,
        tr: (id: string, params: Record<string, unknown> = {}) => l10nEntryText(L10N[id]!, 'en').replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? '')),
      } }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
    const text = scope.exports.mountEffectText(FOE_MOUNT_IDS.dReconstruction)
    expect(text).toBe(L10N['ui.gravekeeperRetune.001']!.en.replace('{p1}', '60'))
    expect(text).toContain('all destroyed allies at full health')
    expect(text).toContain('Every 60 seconds')
    expect(text).not.toContain('jammer')
    const card = ctx.anomalies.get('gravekeeper-flagship')!, snapshot = structuredClone(card)
    const brief = scope.exports.briefShipsOf(card).find(f => f.id === 'foe-d-invasion-eternal-tomb')!
    expect(brief.mounts.some(m => m.name === 'Mausoleum Reconstruction Protocol' && m.effect === text)).toBe(true)
    expect(card).toEqual(snapshot)
    expect(L10N['ui.gravekeeperRetune.001']!.enDeferred).toBeUndefined()
  })
})
