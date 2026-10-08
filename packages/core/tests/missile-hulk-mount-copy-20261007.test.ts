import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS, L10N, l10nEntryText } from '@whale/data'
import { addShipToFleet, addWare, createInitialState } from '../src/index'
import { advanceBattleFor, startBattleFor, startFleetBattleFor, createFoeSpecs } from '../src/combat'
import { announceFoeGunRangeBuff } from '../src/foeRange'
import { FOE_MOUNTS, FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'
import { pushBattleNotice } from '../src/combatFx'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'
import type { BattleState } from '../src/state'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const base = buildSimContext()
const missile = FOE_SHIPS.find(s => s.id === 'foe-missile-hulk')!
const stasis = FOE_SHIPS.find(s => s.id === 'foe-d-stasis')!

function renderer(locale: 'zh' | 'en') {
  const sourceOf = (path: string) => {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    return ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
  }
  const scope: Record<string, any> = {
    exports: {}, L10N, l10nEntryText, FOE_MOUNTS, WEB_BREAK_DIST_M: 4500, signalSpaceTextId: (id: string) => id,
    localStorage: { getItem: () => locale }, navigator: { language: locale },
    createContext: () => ({ Provider: 'Provider' }),
  }
  const execute = (source: string) => runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  execute(sourceOf('apps/desktop/src/renderer/src/i18n/locale.tsx'))
  const localize = scope.exports
  scope.tr = localize.tr
  scope.isEn = localize.isEn
  execute(sourceOf('apps/desktop/src/renderer/src/ui/foeBrief.ts'))
  return { ...localize, ...scope.exports } as {
    logText: (notice: NonNullable<BattleState['notices']>[number]) => string
    mountEffectText: (id: string) => string
    mountEffectTextByName: (name: string) => string
    foeBriefLinesOfShip: (ship: FoeShipDef) => { mounts: Array<{ name: string; effect: string }> }
  }
}

/** 沿用真实舰与挂载，只缩短试验射程，让现有动能炮能命中射程外目标。 */
function battleOf(def: FoeShipDef) {
  const card: AnomalyDef = {
    ...base.anomalies.get('wh-titan-missile')!, id: 'mount-copy-repro', threat: 60,
    ships: [{ ship: { ...def, rangeMinM: 1, rangeMaxM: 3000 }, count: 1, hpMul: 60, desireRangeM: 1500 }],
    waves: [{ units: 1, hpShare: 1 }],
  }
  const ctx = { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) }
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-2'], mid: ['mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2'] }
  addWare(state, 'ammo-kinetic-l', 500)
  const battle = startBattleFor(state, ctx, uid, card.id, 0, null)!
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle }
  state.gameMs = 60_000
  advanceBattleFor(state, ctx, battle, uid, card.id)
  return { state, ctx, card, uid, battle }
}

describe('导弹残段独立观瞄显示', () => {
  it('实际挂载独立，解析提示随件；倍率与舰船战斗值不变', () => {
    expect(missile.mounts).toEqual([FOE_MOUNT_IDS.gunRangeX15Titan])
    expect(stasis.mounts).toEqual([FOE_MOUNT_IDS.gunRangeX15])
    const a = resolveFoeMounts(missile.mounts)
    const b = resolveFoeMounts(stasis.mounts)
    expect(a.names).toEqual(['巨构齐射观瞄'])
    expect(a.foeGunRangeNoticeId).toBe('core.combat.012')
    expect(b.foeGunRangeNoticeId).toBe('core.combat.013')
    expect(a.foeGunRangeMulOnHit).toBe(b.foeGunRangeMulOnHit)
    expect(missile.rangeMaxM).toBe(11_000)
    expect(missile.rangeMinM).toBe(3000)
    expect(missile.gunCount).toBe(4)
    expect(missile.dmgMix).toEqual({ explosive: 10 })
  })

  it.each(['zh', 'en'] as const)('%s真实显示函数：悬停、简报与图鉴共用导弹说明，不串静滞件', locale => {
    const ui = renderer(locale)
    const effect = ui.mountEffectText(FOE_MOUNT_IDS.gunRangeX15Titan)
    expect(effect).toBe(L10N['ui.foeIntro.114']![locale].replace('{p1}', '1.5'))
    expect(ui.mountEffectTextByName('巨构齐射观瞄')).toBe(effect)
    expect(ui.foeBriefLinesOfShip(missile).mounts).toEqual([{ name: locale === 'zh' ? '巨构齐射观瞄' : 'Megastructure Salvo Optics', effect }])
    expect(ui.mountEffectText(FOE_MOUNT_IDS.gunRangeX15)).toBe(L10N['ui.foeIntro.101']![locale].replace('{p1}', '1.5'))
    expect(effect).not.toMatch(/静滞|炮台|Stasis|guns|\{p\d+\}/)
  })

  it.each([missile, stasis])('$id真引擎触发只提示一次，中文原意与英文都按件渲染', def => {
    const { state, ctx, card, uid, battle } = battleOf(def)
    const id = def.id === missile.id ? 'core.combat.012' : 'core.combat.013'
    expect(battle.foeGunRangeBuff).toBe(1.5)
    expect(battle.notices?.filter(n => n.textId === id)).toHaveLength(1)
    const notice = battle.notices!.find(n => n.textId === id)!
    expect(notice.textParams).toEqual({ p1: 50 })
    for (const locale of ['zh', 'en'] as const) expect(renderer(locale).logText(notice)).toBe(L10N[id]![locale].replace('{p1}', '50'))
    state.gameMs += 60_000
    advanceBattleFor(state, ctx, battle, uid, card.id)
    expect(battle.notices?.filter(n => n.textId === id)).toHaveLength(1)
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle?.notices).toBeUndefined()
  })

  it('射程内命中不提示；数值读实际触发件而非固定50%', () => {
    const { battle, card } = battleOf(missile)
    const unit = createFoeSpecs(card, base.balance.battle)[0]!
    delete battle.foeGunRangeBuff
    battle.notices = []
    battle.distanceM = 1000
    announceFoeGunRangeBuff(unit, battle)
    expect(battle.notices).toEqual([])
    battle.distanceM = 6000
    announceFoeGunRangeBuff({ ...unit, foeGunRangeMulOnHit: 1.8 }, battle)
    expect(battle.notices?.[0]?.textParams).toEqual({ p1: 80 })
  })

  it('全体攻击打到副目标导弹残段，同样使用导弹件提示', () => {
    const target = { ...missile, hp: 40_000, rangeMinM: 1, rangeMaxM: 3000, shotDmg: 1, evasion: 0 }
    const plain = { ...target, id: 'plain-foe', name: '试验主目标', mounts: [], rangeMaxM: 5000 }
    const card: AnomalyDef = { ...anomaly('mount-copy-all', 'galaxy-hub'),
      ships: [{ ship: plain, count: 1 }, { ship: target, count: 1 }], waves: [{ units: 2, hpShare: 1 }] }
    const ctx = makeTestCtx({
      ships: [ship('copy-hull', { slots: { high: 3, mid: 2, low: 2 }, cpu: 400, shieldHp: 5000, armorHp: 200_000, hullHp: 200_000 })],
      modules: [
        moduleDef('copy-missile', 'missile', 0, { damageType: 'explosive', dmgMult: 1, hitRate: 1, falloff: 1, maxRangeM: 5000, reloadMs: 1000, cpuUse: 10, hitsAllFoes: true }),
        moduleDef('copy-lock', 'target-lock', 0, { lockDmgBonus: 0.1, cpuUse: 1 }),
      ],
      anomalies: [card],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const uid = addShipToFleet(state, 'copy-hull')
    state.shipId = uid
    state.fleet[uid]!.fitted = { high: ['copy-missile', 'copy-lock'], mid: [], low: [] }
    state.warehouse.items['ammo-explosive-l'] = 5000
    const battle = startFleetBattleFor(state, ctx, [uid], card.id, 0)!
    state.gameMs = 30_000
    advanceBattleFor(state, ctx, battle, uid, card.id)
    expect(battle.notices?.filter(n => n.textId === 'core.combat.012')).toHaveLength(1)
    expect(battle.notices?.some(n => n.textId === 'core.combat.013')).toBe(false)
  })

  it('编号提示与旧正文兼容，同类去重、异类保留，战斗页使用真实译文出口', () => {
    const { battle } = battleOf(missile)
    battle.notices = []
    pushBattleNotice(battle, 'legacy')
    pushBattleNotice(battle, '', 'core.combat.012', { p1: 50 })
    pushBattleNotice(battle, '', 'core.combat.013', { p1: 50 })
    pushBattleNotice(battle, '', 'core.combat.012', { p1: 80 })
    pushBattleNotice(battle, 'legacy')
    expect(battle.notices).toHaveLength(3)
    expect(battle.notices!.find(n => n.textId === 'core.combat.012')!.textParams).toEqual({ p1: 80 })
    expect(renderer('en').logText(battle.notices!.find(n => n.text === 'legacy')!)).toBe('legacy')
    const screen = readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/BattleScreen.tsx', import.meta.url), 'utf8')
    expect(screen).toContain('text: logText(n)')
  })
})
