import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import { fitModule } from '../src/equipment'
import { advanceBattleFor, ammoLoadTotals, createPlayerSpec, startBattleFor } from '../src/combat'
import { countWare } from '../src/inventory'
import { resolveAmmoTier } from '../src/combatAmmo'
import { ammoTiersOf } from '../src/ammoTiers'
import type { BattleFx } from '../src/state'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const FRAG = 'mod-wh-a-frag'
const base = buildSimContext()

function world(extra: string[] = [], mk2 = false) {
  const s = createInitialState({ nowWallMs: 0, seed: 42, prologue: true })
  s.shipId = addShipToFleet(s, 'sh-hammerhead')
  for (const id of [FRAG, ...extra]) {
    s.moduleBay[id] = (s.moduleBay[id] ?? 0) + 1
    expect(fitModule(s, id, base).ok).toBe(true)
  }
  s.warehouse.items['ammo-kinetic-l'] = 10_000
  s.warehouse.items[mk2 ? 'ammo-explosive-2' : 'ammo-explosive-l'] = 10_000
  if (mk2) s.fleet[s.shipId]!.ammoPref = { explosive: 'ammo-explosive-2' }
  return s
}

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] }
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (value && typeof value === 'object' && 'children' in value) {
    const n = value as Node
    return [n, ...n.children.flatMap(nodes)]
  }
  return []
}
function display(state: ReturnType<typeof world>) {
  const path = new URL('../../../apps/desktop/src/renderer/src/pages/FitPage.tsx', import.meta.url)
  const ast = ts.createSourceFile('FitPage.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = ['AMMO_TYPES', 'AmmoTierSection', 'fmt', 'ammoChipOf']
  const text = ast.statements.filter(n =>
    ts.isFunctionDeclaration(n) ? names.includes(n.name?.text ?? '') :
      ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(ast))),
  ).map(n => n.getText(ast)).join('\n')
  const tr = (id: string, params?: Record<string, string | number>) => (L10N[id]?.zh ?? id)
    .replace(/\{(\w+)\}/g, (raw, key: string) => String(params?.[key] ?? raw))
  const bindings = {
    createPlayerSpec, ammoLoadTotals, ammoTiersOf, countWare, resolveAmmoTier, tr, cmdText: String,
    DMG_LABEL: { kinetic: '动能', explosive: '爆炸', plasma: '能量' },
    DmgChip: 'DmgChip', exports: {},
    React: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node =>
      ({ type, props: props ?? {}, children }) },
    render: undefined as undefined | ((props: object) => unknown),
    chip: undefined as undefined | ((module: unknown) => Node),
  }
  runInNewContext(ts.transpileModule(`${text}\nglobalThis.render = AmmoTierSection; globalThis.chip = ammoChipOf;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, bindings, { timeout: 2000 })
  const tree = bindings.render!({ engine: { state, ctx: base }, target: state.shipId, onToast: () => {} })
  const rows = nodes(tree).filter(n => n.props.className === 'app-fit-ammotier-row')
  const types = rows.map(n => (n.children.find(c => c && typeof c === 'object' && (c as Node).type === 'DmgChip') as Node).props.t)
  return { types, rows, chip: bindings.chip!(base.modules.get(FRAG)!) }
}

describe('掠袭破片炮真实弹药', () => {
  it('权威主弹种是爆破，动能仅为副伤害，预载不要求动能弹', () => {
    const s = world()
    expect(base.modules.get(FRAG)!.damageType).toBe('explosive')
    expect(base.modules.get(FRAG)!.secondaryDamageType).toBe('kinetic')
    const spec = createPlayerSpec(s, base, s.shipId)!
    const w = spec.weapons.find(w => w.label === base.modules.get(FRAG)!.name)!
    expect(Object.keys(w.shotsByType!)).toEqual(['explosive'])
    expect(w.secondaryDamagePct).toBe(0.5)
    expect(ammoLoadTotals(spec, base.balance.battle, s).explosive).toBeGreaterThan(0)
    expect(ammoLoadTotals(spec, base.balance.battle, s).kinetic).toBeUndefined()
    expect(display(s).chip.props.t).toBe('explosive')
  })

  it.each([false, true])('实际预载与开火仅消耗爆破弹药（MK2=%s）', mk2 => {
    const s = world([], mk2)
    const bed = base.ships.get('sh-hammerhead')!
    const foe: FoeShipDef = {
      id: 'fragment-audit-foe', name: '弹药核查耐久靶', family: 'A', hullClassTier: 3, speedRatio: 0,
      hp: 1e9, split: { s: 0, a: 0, h: 1 }, shotDmg: 0, hitRate: 0, reloadMs: 1000,
      rangeMinM: 1, rangeMaxM: 20000, falloff: 1, tactic: 'orbit', desireRangeM: 1000, evasion: 0,
    }
    const card: AnomalyDef = {
      id: 'fragment-audit-card', name: '弹药核查', galaxyId: 'galaxy-hub', threat: 20,
      standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 120, description: '', ships: [{ ship: foe, count: 1 }],
    }
    const ctx = { ...base,
      ships: new Map(base.ships).set(bed.id, { ...bed, shieldHp: 0, armorHp: 0, hullHp: 1e9, evasion: 0 }),
      anomalies: new Map(base.anomalies).set(card.id, card),
    }
    const battle = startBattleFor(s, ctx, s.shipId, card.id, 0)!
    expect(battle.ammo.kin).toBe(0)
    expect(s.warehouse.items['ammo-kinetic-l']).toBe(10_000)
    expect(battle.ammoIds?.explosive).toBe(mk2 ? 'ammo-explosive-2' : 'ammo-explosive-l')
    const loaded = battle.ammo.exp
    const events: BattleFx[] = []
    for (let at = 100; at <= 18_000 && !battle.ended; at += 100) {
      const seq = battle.fxSeq
      battle.distanceM = 1000
      battle.myDesireM = 1000
      s.gameMs = at
      advanceBattleFor(s, ctx, battle, s.shipId, card.id)
      events.push(...battle.fx.filter(f => f.seq >= seq && f.side === 'me' && f.src === 'turret'))
    }
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(f => f.type === 'explosive')).toBe(true)
    expect(loaded - battle.ammo.exp).toBe(events.length)
    expect(s.warehouse.items['ammo-kinetic-l']).toBe(10_000)
    console.log('[实跑]', { mk2, preloaded: loaded, shots: events.length, explosiveUsed: loaded - battle.ammo.exp, kineticWarehouse: 10_000 })
  })
})

describe('装配弹药档位与真实预载一致', () => {
  const pure = display(world()).types
  const mixed = display(world(['mod-turret-kin-1'])).types
  it('纯破片炮只显示爆破档位，不能按炮台槽硬判动能', () => {
    console.log('[零号弹药档位]', pure)
    expect(pure).toEqual(['explosive'])
  })
  it('混装破片炮和动能炮同时显示两族', () => {
    console.log('[混装弹药档位]', mixed)
    expect(mixed).toEqual(['kinetic', 'explosive'])
  })
  it('没有耗弹武器时不显示弹药档位', () => {
    const state = world()
    state.fleet[state.shipId]!.fitted.high.fill(null)
    expect(display(state).types).toEqual([])
  })
})
