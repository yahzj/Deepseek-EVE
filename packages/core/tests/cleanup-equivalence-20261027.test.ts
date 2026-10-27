import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { formatDurationMs, formatDurationShort } from '../src/time'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { RACK_MAX } from '../src/saveBattleClean'
import type { ActivityView } from '../src/activity'
import { runSaveModule } from './helpers/save-shell'

type LayoutModule = { LAYOUT_KEY: string; LAYOUT_SET_KEY: string; readLayoutPref(): 'classic' | 'modern' }
type StopResult = boolean | { ok: boolean; error?: string; errorId?: string }
type StopEngine = Record<string, (...args: unknown[]) => StopResult>
type ActivityModule = { doStop(v: ActivityView, engine: StopEngine, toast: (text: string, warn?: boolean) => void): void }
type GlyphNode = { type: unknown; props: Record<string, unknown> }
type ExplorationModule = {
  holdTone(itemId: string, iconKey: string): string
  hexRingOf(q: number, r: number): number
  explorationNumber(n: number): string
  useCountUp(value: number): number
  grabOffsetOf(el: unknown, w: number, h: number, x: number, y: number): { dx: number; dy: number }
  WhGlyph(props: { signal: 'ship' | null; exit?: boolean }): GlyphNode
  WhNebulaGlyph(): GlyphNode
}

describe('纯清理等价性', () => {
  it('全量与紧凑时间保持取整、零值和两种语言的原输出', () => {
    const cases: Array<[number, string, string, string, string]> = [
      [-1, '0秒', '0秒', '0s', '0s'],
      [999, '0秒', '0秒', '0s', '0s'],
      [1000, '1秒', '1秒', '1s', '1s'],
      [61001, '1分1秒', '1分1秒', '1m 1s', '1m 1s'],
      [3600000, '1小时', '1小时', '1h', '1h'],
      [86400000 + 180000 + 5000, '1天3分5秒', '1天3分', '1d 3m 5s', '1d 3m'],
      [4 * 86400000 + 21 * 3600000 + 305000, '4天21小时5分5秒', '4天21小时', '4d 21h 5m 5s', '4d 21h'],
    ]
    for (const [ms, zh, shortZh, en, shortEn] of cases) {
      expect(formatDurationMs(ms)).toBe(zh)
      expect(formatDurationShort(ms)).toBe(shortZh)
      expect(formatDurationMs(ms, 'en')).toBe(en)
      expect(formatDurationShort(ms, 'en')).toBe(shortEn)
    }
    for (const [ms, zh, en] of [[NaN, 'NaN秒', 'NaNs'], [Infinity, 'Infinity天', 'Infinityd'], [-Infinity, '0秒', '0s']] as const) {
      expect(formatDurationMs(ms)).toBe(zh)
      expect(formatDurationShort(ms, 'en')).toBe(en)
    }
  })

  it('布局偏好保留显式选择门槛、异常回落和存储键', () => {
    const values = new Map<string, string>()
    const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null) }
    const layout = runSaveModule<LayoutModule>('apps/desktop/src/renderer/src/ui/layoutPreference.ts', {}, { localStorage: storage })
    expect(layout.readLayoutPref()).toBe('classic')
    values.set(layout.LAYOUT_KEY, 'modern')
    expect(layout.readLayoutPref()).toBe('classic')
    values.set(layout.LAYOUT_SET_KEY, '1')
    expect(layout.readLayoutPref()).toBe('modern')
    values.set(layout.LAYOUT_KEY, 'unknown')
    expect(layout.readLayoutPref()).toBe('classic')
    storage.getItem.mockImplementation(() => { throw Error('blocked') })
    expect(layout.readLayoutPref()).toBe('classic')
    for (const file of ['App.tsx', 'ui/layoutStyles.ts']) {
      const source = readFileSync(new URL(`../../../apps/desktop/src/renderer/src/${file}`, import.meta.url), 'utf8')
      expect(source).toContain("from './" + (file === 'App.tsx' ? 'ui/' : '') + "layoutPreference'")
      expect(source).not.toContain('function readLayoutPref')
    }
  })

  it('双布局停止分派保留动作、参数、成功提示及失败本地化优先级', () => {
    const activity = runSaveModule<ActivityModule>('apps/desktop/src/renderer/src/panels/activityStopLabel.ts', {
      '../i18n/locale': { tr: (id: string) => id, cmdText: (r: { errorId?: string }) => r.errorId ?? '' },
    })
    const actions: Array<[ActivityView['stop'], string, unknown[], string]> = [
      ['cancel-station-pending', 'cancelPendingStationActivityNow', [], 'ui.ActivityBar.004'],
      ['remove-training', 'dequeueAt', [0], 'ui.ActivityBar.038'],
      ['stop-mining', 'stopMiningNow', [], 'ui.MapPage.080'],
      ['stop-scan', 'stopScanNow', [], 'ui.ActivityBar.039'],
      ['stop-whscan', 'wormholeScanStop', [], 'ui.ActivityBar.040'],
      ['stop-whauto', 'wormholeAutoStop', ['target'], 'ui.ActivityBar.041'],
      ['stop-salvage', 'stopSalvageOpNow', [], 'ui.ActivityBar.042'],
      ['cancel-manufacture', 'cancelManufacturingAt', ['target'], 'ui.ActivityBar.043'],
      ['stop-refine', 'stopRefineRunAt', ['target'], 'ui.ActivityBar.044'],
      ['stop-lab', 'stopLabRunAt', ['target'], 'ui.ActivityBar.068'],
      ['recall-expedition', 'recallExpeditionNow', [], 'ui.ActivityBar.045'],
      ['recall-standby', 'recallStandbyNow', [], 'ui.ActivityBar.046'],
      ['retreat-battle', 'retreatNow', [], 'ui.ActivityBar.047'],
      ['cancel-ai', 'cancelAiTaskAt', ['target'], 'ui.ShipPage.177'],
      ['cancel-deliver-trip', 'cancelDeliverTripNow', [], 'ui.ActivityBar.048'],
      ['stop-loop', 'bountyLoopAt', [null], 'ui.ActivityBar.049'],
      ['stop-invasion-loop', 'invasionLoopAt', [null], 'core.weekend.034'],
      ['stop-hauling', 'stopHaulingNow', [], 'ui.ActivityBar.050'],
    ]
    for (const [stop, method, args, text] of actions) {
      const fn = vi.fn(() => ({ ok: true })), toast = vi.fn()
      const engine = { [method]: fn } as StopEngine
      activity.doStop({ stop, stopParam: 'target' } as ActivityView, engine, toast)
      expect(fn).toHaveBeenCalledWith(...args)
      expect(toast).toHaveBeenLastCalledWith(text)
      fn.mockReturnValue({ ok: false })
      activity.doStop({ stop, stopParam: 'target' } as ActivityView, engine, toast)
      expect(toast).toHaveBeenLastCalledWith('ui.ActivityBar.061', true)
      if (args[0] === 'target') {
        fn.mockClear(); toast.mockClear()
        activity.doStop({ stop } as ActivityView, engine, toast)
        expect(fn).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
      }
    }
    const toast = vi.fn()
    for (const result of [false, { ok: false, error: 'raw' }, { ok: false, error: 'raw', errorId: 'translated' }]) {
      activity.doStop({ stop: 'stop-mining' } as ActivityView, { stopMiningNow: () => result }, toast)
      expect(toast).toHaveBeenLastCalledWith(typeof result === 'boolean' ? 'ui.ActivityBar.061' : result.errorId ?? result.error, true)
    }
    activity.doStop({ stop: 'stop-mining' } as ActivityView, { stopMiningNow: () => true }, toast)
    expect(toast).toHaveBeenLastCalledWith('ui.MapPage.080')
  })

  it('三种装配快照共用清洗但保留原来的槽序、截断和裁尾语义', () => {
    const base = JSON.parse(serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 7 })))
    const racks: unknown[] = [null, {}, [], ['a', null, '', 5, 'b', null], [null, 'c', null], Array.from({ length: RACK_MAX + 3 }, (_, i) => `m${i}`)]
    for (const rack of racks) {
      const raw = structuredClone(base)
      const fitted = { high: rack, mid: ['keep'], low: rack }
      raw.state.fitPresets = { ship: [{ name: 'test', fitted }] }
      raw.state.shipWrecks = { lost: { galaxyId: 'g', name: 'wreck', density: 1, decayAccMs: 0, fitted } }
      raw.state.wreckLog = [{ seq: 1, shipId: 'lost', shipName: 'wreck', cause: 'expedition-lost', atGameMs: 0, fitted }]
      const expected = Array.isArray(rack) ? rack.slice(0, RACK_MAX).map(x => typeof x === 'string' && x.length > 0 ? x : null) : []
      while (expected.length && expected[expected.length - 1] === null) expected.pop()
      const state = loadSaveFile(JSON.stringify(raw)).state
      for (const value of [state.fitPresets?.ship?.[0]?.fitted, state.shipWrecks?.lost?.fitted, state.wreckLog?.[0]?.fitted]) {
        expect(value).toEqual({ high: expected, mid: ['keep'], low: expected })
      }
      const again = loadSaveFile(serializeSaveFile(state)).state
      expect(again.fitPresets).toEqual(state.fitPresets)
      expect(again.shipWrecks).toEqual(state.shipWrecks)
      expect(again.wreckLog).toEqual(state.wreckLog)
    }
  })

  it('新旧探索共用表现函数，抓取边界和信号图形不改变', () => {
    const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/explorationShared.tsx', import.meta.url), 'utf8')
    const scope = { exports: {} as ExplorationModule, require: (id: string) => {
      if (id === 'react') return { useEffect: () => {}, useState: (x: unknown) => [x, () => {}] }
      if (id === 'react/jsx-runtime') return { jsx, jsxs, Fragment }
      if (id === '../ui/Glyphs') return { itemToneOf: () => 'base', RARE_WRECK_TONE: 'rare' }
      if (id === '../ui/itemSubs') return { wreckTierOf: (itemId: string) => itemId === 'rare' ? 'rare' : 'common' }
      throw Error(id)
    } }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, scope)
    const shared = scope.exports
    expect(shared.holdTone('rare', 'x')).toBe('rare')
    expect(shared.holdTone('normal', 'x')).toBe('base')
    expect(shared.explorationNumber(1234.6)).toBe('1,235')
    expect(shared.useCountUp(10)).toBe(10)
    const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) }
    expect(shared.grabOffsetOf(el, 4, 2, -1, -1)).toEqual({ dx: 0, dy: 0 })
    expect(shared.grabOffsetOf(el, 4, 2, 209, 119)).toEqual({ dx: 3, dy: 1 })
    expect(shared.grabOffsetOf(el, 4, 2, 500, 500)).toEqual({ dx: 3, dy: 1 })
    for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) expect(shared.hexRingOf(q, r)).toBe(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)))
    const blank = shared.WhGlyph({ signal: null })
    expect(blank.type).toBe('circle')
    expect(shared.WhGlyph({ signal: 'ship' }).props.d).toBe('M-7,-5 L8,0 L-7,5 Z')
    expect(shared.WhGlyph({ signal: null, exit: true }).props.d).toBe('M-7,0 L6,0 M1,-5 L7,0 L1,5')
    expect(shared.WhNebulaGlyph().props.className).toBe('app-wh-nebula')
    for (const file of ['SignalSpace.tsx', 'Wormhole.tsx']) {
      const text = readFileSync(new URL(`../../../apps/desktop/src/renderer/src/panels/${file}`, import.meta.url), 'utf8')
      expect(text).toContain("from './explorationShared'")
      expect(text).not.toContain('function grabOffsetOf')
      expect(text).not.toContain('function WhGlyph')
    }
  })
})
