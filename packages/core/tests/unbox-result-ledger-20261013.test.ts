import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { advanceGame } from '../src/engine'
import { createInitialState } from '../src/state'
import { advanceRefining, startUnboxRun, UNBOX_CYCLE_MS } from '../src/industry'
import type { UnboxResultRow } from '../src/industry'
import { addWare, countWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { simulateOffline } from '../src/simulation'
import { UnboxSessionLedger } from '../../../apps/desktop/src/renderer/src/game/unboxLedger'
import { gameSaveMethods } from './helpers/save-shell'
import { industryAvailable, refineRate } from '../src/industry'
import { stationActivityStartBlockReason } from '../src/location'
import { manualSlotOf } from '../src/activityGate'

const ctx = buildSimContext()
const root = new URL('../../../', import.meta.url)
const path = 'apps/desktop/src/renderer/src/pages/IndustryPage.tsx'
const text = readFileSync(new URL(path, root), 'utf8')
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const tr = (id: string) => l10nEntryText(L10N[id]!, 'zh')

describe('货柜拆解会话账本与实际结算', () => {
  it.each(['box-valuables', 'box-military', 'box-relic-a', 'box-relic-e', 'box-bp-deep'])('%s多件长步推进按实际入库累计，随机/产物/日志/存档不变', box => {
    const state = createInitialState({ nowWallMs: 0, seed: 20261013 })
    addWare(state, box, 3)
    expect(startUnboxRun(state, ctx, box, 'pilot').ok).toBe(true)
    const without = structuredClone(state)
    const stock = new Map<string, number>()
    const holdings = () => new Map([...Object.entries(state.moduleBay), ...Object.entries(state.blueprintStock), ...Object.entries(state.warehouse.items)])
    for (const [id, units] of holdings()) stock.set(id, units)
    const ledger = new UnboxSessionLedger()
    ledger.begin(state, box)
    const events: UnboxResultRow[] = []
    advanceGame(state, UNBOX_CYCLE_MS * 3, ctx, { onUnboxResult: row => { events.push(row); ledger.record(state, row) } })
    advanceGame(without, UNBOX_CYCLE_MS * 3, ctx)
    expect(state).toEqual(without)
    expect(events).toHaveLength(3)
    expect(state.refineRuns).toHaveLength(0)
    expect(countWare(state, box)).toBe(0)
    const gained = [...holdings()].filter(([id, units]) => units > (stock.get(id) ?? 0))
      .map(([itemId, units]) => ({ itemId, units: units - (stock.get(itemId) ?? 0) }))
    const outputs = [...ledger.get(state, box)!.outputs]
    const sort = (rows: { itemId: string; units: number }[]) => rows.sort((a, b) => a.itemId.localeCompare(b.itemId))
    expect(sort(outputs)).toEqual(sort(gained))
    expect(ledger.get(state, box)!.boxes).toBe(3)
    expect(serializeSaveFile(state, 0)).toBe(serializeSaveFile(without, 0))
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(ledger.get(loaded, box)).toBeUndefined()
    expect(new UnboxSessionLedger().get(state, box)).toBeUndefined()
  })

  it('同型军用产物合并与奢侈品数量不丢失，重新开同卡只清该卡', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ledger = new UnboxSessionLedger()
    ledger.record(state, { boxItemId: 'box-military', grants: [{ itemId: 'mod-turret-kin-3', units: 1 }, { itemId: 'mod-turret-kin-3', units: 1 }] })
    ledger.record(state, { boxItemId: 'box-military', grants: [{ itemId: 'mod-turret-kin-3', units: 1 }, { itemId: 'mod-laser-3', units: 1 }] })
    ledger.record(state, { boxItemId: 'box-valuables', grants: [{ itemId: 'lux-vintage', units: 23 }] })
    expect(ledger.get(state, 'box-military')).toEqual({ boxes: 2, outputs: [
      { itemId: 'mod-turret-kin-3', units: 3 }, { itemId: 'mod-laser-3', units: 1 },
    ] })
    ledger.begin(state, 'box-military')
    expect(ledger.get(state, 'box-military')).toEqual({ boxes: 0, outputs: [] })
    expect(ledger.get(state, 'box-valuables')!.outputs).toEqual([{ itemId: 'lux-vintage', units: 23 }])
    ledger.clear()
    expect(ledger.get(state, 'box-valuables')).toBeUndefined()
  })

  it('实空产物池记录空结果并停炉；无料和未到点不伪造事件', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const empty = { ...ctx, modules: new Map() }
    addWare(state, 'box-military', 1)
    expect(startUnboxRun(state, empty, 'box-military', 'pilot').ok).toBe(true)
    const events: UnboxResultRow[] = []
    state.gameMs = UNBOX_CYCLE_MS - 1
    advanceRefining(state, empty, undefined, row => events.push(row))
    expect(events).toEqual([])
    state.gameMs++
    advanceRefining(state, empty, undefined, row => events.push(row))
    expect(events).toEqual([{ boxItemId: 'box-military', grants: [] }])
    advanceRefining(state, empty, undefined, row => events.push(row))
    expect(events).toHaveLength(1)
    expect(state.refineRuns).toHaveLength(0)
  })

  it('离线补算仅记录本次启动新结算的产物，带回调与不带回调的存档结果一致', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    addWare(state, 'box-valuables', 2)
    expect(startUnboxRun(state, ctx, 'box-valuables', 'pilot').ok).toBe(true)
    const old = structuredClone(state)
    const ledger = new UnboxSessionLedger()
    expect(ledger.get(state, 'box-valuables')).toBeUndefined()
    simulateOffline(state, 0, 2 * UNBOX_CYCLE_MS, ctx, undefined, { onUnboxResult: row => ledger.record(state, row) })
    simulateOffline(old, 0, 2 * UNBOX_CYCLE_MS, ctx)
    expect(state).toEqual(old)
    expect(ledger.get(state, 'box-valuables')!.boxes).toBe(2)
    for (const row of ledger.get(state, 'box-valuables')!.outputs) expect(row.units).toBe(countWare(state, row.itemId))
    expect(new UnboxSessionLedger().get(loadSaveFile(serializeSaveFile(state, 0)).state, 'box-valuables')).toBeUndefined()
  })

  it('同卡并行炉累计实际完成的各件货柜，下一次通知不会重复记账', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    addWare(state, 'box-military', 4)
    expect(startUnboxRun(state, ctx, 'box-military', 'pilot').ok).toBe(true)
    state.refineRuns.push({ ...structuredClone(state.refineRuns[0]!), id: state.refineSeq++ })
    const ledger = new UnboxSessionLedger()
    state.gameMs = UNBOX_CYCLE_MS
    advanceRefining(state, ctx, undefined, row => ledger.record(state, row))
    expect(ledger.get(state, 'box-military')!.boxes).toBe(2)
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx, undefined, row => ledger.record(state, row))
    expect(ledger.get(state, 'box-military')!.boxes).toBe(4)
    const last = structuredClone(ledger.get(state, 'box-military'))
    advanceRefining(state, ctx, undefined, row => ledger.record(state, row))
    expect(ledger.get(state, 'box-military')).toEqual(last)
    for (const row of last!.outputs) expect(row.units).toBe(state.moduleBay[row.itemId])
  })

  it('真实开工外壳仅成功时清上一批；查看/失败开工和其他动作不清空', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ledger = new UnboxSessionLedger()
    ledger.record(state, { boxItemId: 'box-military', grants: [{ itemId: 'mod-laser-3', units: 2 }] })
    const engine = gameSaveMethods(['startUnboxRunAt', 'unboxLedgerOf'], { startUnboxRun }) as any
    Object.assign(engine, { state, ctx, unboxLedger: ledger, withActivitySwitch: (_key: string, run: () => unknown) => run(), persist: () => Promise.resolve(true), notify: () => {} })
    expect(engine.unboxLedgerOf('box-military').outputs).toHaveLength(1)
    expect(engine.startUnboxRunAt('box-military', 'pilot').ok).toBe(false)
    expect(engine.unboxLedgerOf('box-military').outputs).toHaveLength(1)
    addWare(state, 'box-military', 1)
    expect(engine.startUnboxRunAt('box-military', 'pilot').ok).toBe(true)
    expect(engine.unboxLedgerOf('box-military')).toEqual({ boxes: 0, outputs: [] })
    expect(engine.unboxLedgerOf('box-military')).toEqual({ boxes: 0, outputs: [] })
    state.refineRuns = []
    ledger.record(state, { boxItemId: 'box-military', grants: [{ itemId: 'mod-laser-3', units: 2 }] })
    const previous = ledger.get(state, 'box-military')
    state.shipReturns[state.shipId] = { beltId: null, legMs: 10000, phaseAccMs: 0, reason: 'miningStop' }
    expect(engine.startUnboxRunAt('box-military', 'pilot')).toMatchObject({ ok: true, queued: true })
    expect(ledger.get(state, 'box-military')).toEqual(previous)
  })

  it('会话实现不调用浏览器存储；日志裁剪和语言切换不依赖中文字符串', () => {
    const ledger = readFileSync(new URL('apps/desktop/src/renderer/src/game/unboxLedger.ts', root), 'utf8')
    expect(ledger).not.toMatch(/localStorage|sessionStorage|indexedDB|serializeSaveFile|JSON\.stringify/)
    const engine = readFileSync(new URL('apps/desktop/src/renderer/src/game/engine.ts', root), 'utf8')
    expect(engine).toContain('onUnboxResult: this.onUnboxResult')
    expect(text).toContain('engine.unboxLedgerOf(def.id) !== undefined')
    for (let n = 148; n <= 151; n++) {
      const row = L10N[`ui.IndustryPage.${n}`]!
      expect(row.enDeferred).not.toBe(true)
      expect(row.en).toMatch(/[A-Za-z]/)
      expect(row.en).not.toMatch(/[\u3400-\u9fff]/)
    }
  })
})

type UiNode = { type: any; props: Record<string, any>; children: unknown[] }
const jsx = { createElement: (type: any, props: Record<string, unknown> | null, ...children: unknown[]): UiNode => ({ type, props: props ?? {}, children }) }
const nodes = (value: unknown): UiNode[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'children' in value ? [value as UiNode, ...(value as UiNode).children.flatMap(nodes)] : []

function component(name: string, bindings: Record<string, unknown>) {
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!
  const scope = { React: jsx, tr, fmtInt: (n: number) => n.toLocaleString('zh-CN'), ...bindings, result: undefined as any }
  runInNewContext(ts.transpileModule(fn.getText(source) + `\nglobalThis.result = ${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  return scope.result as (props: any) => UiNode
}

describe('精炼货柜卡真实组件', () => {
  it('物品、装备、普通与舰船图纸每种一行，名称在左数量在右，分别复用富卡', () => {
    const row = component('UnboxLedgerRows', { ItemHover: 'ItemHover', ModuleHover: 'ModuleHover', InfoHover: 'InfoHover', blueprintHoverLines: (_ctx: unknown, bp: any) => ({ title: bp.name, lines: ['产物/材料/工期'], note: bp.description }) })
    const ids = ['lux-1', 'mod-laser-3', 'bp-turret-1', 'sbp-wh-a-frigate']
    for (const id of ids) expect(ctx.items.has(id) || ctx.modules.has(id) || ctx.blueprints.has(id) || ctx.shipBlueprints.has(id), id).toBe(true)
    const result = nodes(row({ engine: { ctx }, record: { boxes: 4, outputs: ids.map(itemId => ({ itemId, units: 27 })) } }))
    const entries = result.filter(node => node.type === 'li')
    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect((entry.children[0] as UiNode).props.className).toBe('app-unbox-ledger-name')
      expect((entry.children[1] as UiNode).props.className).toBe('app-unbox-ledger-qty')
      expect((entry.children[1] as UiNode).children.join('')).toBe('×27')
    }
    expect(result.filter(node => ['ItemHover', 'ModuleHover', 'InfoHover'].includes(node.type)).map(node => node.type)).toEqual(['ItemHover', 'ModuleHover', 'InfoHover', 'InfoHover'])
    expect(result.filter(node => ['li', 'span', 'strong', 'ul'].includes(node.type)).some(node => node.props.title)).toBe(false)
  })

  it('空记录有明确空态，不伪造0件产物行', () => {
    const row = component('UnboxLedgerRows', {})
    expect(nodes(row({ engine: { ctx }, record: { boxes: 0, outputs: [] } })).some(node => node.children.includes(tr('ui.IndustryPage.150')))).toBe(true)
  })

  it('只有货柜卡有展开按钮；查看不调用开始或清账，按钮状态可展开收起', () => {
    const values: any[] = []
    let cursor = 0, starts = 0
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const engine = { state, ctx, belts: [], refineRunViews: () => [], unboxLedgerOf: () => ({ boxes: 1, outputs: [] }), startUnboxRunAt: () => { starts++; return { ok: true } } }
    const card = component('FurnaceCard', {
      useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [values[at], (next: any) => values[at] = typeof next === 'function' ? next(values[at]) : next] },
      useId: () => ':ledger:', refineRate, industryAvailable, stationActivityStartBlockReason, manualSlotOf,
      bestAiCoreOf: () => null, usableAiCoresOf: () => [],
      countWare, UNBOX_CYCLE_MS, RowGlyph: 'RowGlyph', MarkStar: 'MarkStar', itemGlyphName: () => 'container',
      NetIncomeLine: 'NetIncomeLine', AiCoreSelect: 'AiCoreSelect', UnboxLedgerRows: 'UnboxLedgerRows',
      History: 'History',
      m3: String, marketPriceOf: () => 0,
    })
    const render = (id = 'box-military') => { cursor = 0; return nodes(card({ engine, def: ctx.items.get(id), onToast: () => {} })) }
    const button = render().find(node => node.props.className === 'app-btn is-small app-unbox-ledger-toggle')!
    expect(button.props['aria-expanded']).toBe(false)
    expect(button.props['aria-controls']).toBe(':ledger:')
    button.props.onClick()
    const opened = render()
    expect(opened.some(node => node.type === 'UnboxLedgerRows')).toBe(true)
    expect(opened.find(node => node.props['aria-expanded'] !== undefined)!.props['aria-expanded']).toBe(true)
    expect(starts).toBe(0)
    opened.find(node => node.props['aria-expanded'] !== undefined)!.props.onClick()
    expect(render().some(node => node.type === 'UnboxLedgerRows')).toBe(false)
    expect(render('ore-veldspar').some(node => node.props.className === 'app-btn is-small app-unbox-ledger-toggle')).toBe(false)
  })
})
