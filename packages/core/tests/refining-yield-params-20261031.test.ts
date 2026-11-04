import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { createInitialState } from '../src/state'
import { startRefineRun, startRecycleRun, stopRefineRun } from '../src/industry'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { yieldNoteFor } from '../src/industry/refining/yieldNote'
import type { LogSeg } from '../src/logParts'
import { makeTestCtx } from './helpers'

const ctx = makeTestCtx()
const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/i18n/locale.tsx', import.meta.url), 'utf8')

/** 使用现有渲染函数，不在测试里复制槽位解析算法。 */
function renderer(locale: 'zh' | 'en') {
  const exports = {} as { logText(entry: { text: string; textId?: string; textParams?: Record<string, unknown> }): string }
  const mocks: Record<string, unknown> = {
    react: { createContext: () => ({}) }, '@whale/data': { L10N, l10nEntryText },
    '@whale/core': { signalSpaceTextId: (id: string) => id },
  }
  runInNewContext(ts.transpileModule(source, { fileName: 'locale.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, { exports, require: (id: string) => mocks[id],
    localStorage: { getItem: () => locale }, navigator: { language: locale } })
  return exports.logText
}

function rows(count: number) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`yield-${index}`, count - index]))
}

describe('精炼与回收所得参数', () => {
  it('没有新子段标记的既有日志仍按原段链渲染，不修改正文或参数', () => {
    const log = {
      text: '精炼炉停：矿甲 原料耗尽（共 1 批）；精炼所得：矿粉min-a×24。',
      textId: 'core.industry.077',
      textParams: { p1: '矿甲', p2: 1, seg2Id: 'core.industry.067',
        seg2p1: '矿粉min-a×24', seg2p1p1: '矿粉min-a×24', seg2p1p2: '',
        seg2p1Id: 'core.industry.044', seg3Id: 'core.state.042',
        parts: ['core.industry.067', 'core.state.042'] },
    }
    const before = structuredClone(log)
    expect(renderer('zh')(log)).toBe(log.text)
    expect(renderer('en')(log)).toBe('Refinery stopped: 矿甲 ran out of feedstock (1 batches); refined: 矿粉min-a×24.')
    expect(log).toEqual(before)
    expect(renderer('en')({ text: '旧日志正文' })).toBe('旧日志正文')
  })

  it.each([0, 1, 6, 7])('%i种产物的精炼段没有漏参、重复清单或错误折叠尾注', count => {
    const note = yieldNoteFor(ctx, { min: rows(count), mod: {}, frag: {} }, 'refine')
    expect(note.parts).toHaveLength(count ? 1 : 0)
    if (!count) { expect(note.text).toBe(''); return }
    const seg = note.parts[0]!
    for (const locale of ['zh', 'en'] as const) {
      const text = renderer(locale)({ text: seg.text, textId: seg.id, textParams: seg.params })
      expect(text).not.toMatch(/\{\w+\}/)
      const list = Object.entries(rows(count)).slice(0, 6).map(([id, n]) => `${id}×${n}`).join('、')
      expect(text).toBe(list + (count > 6 ? locale === 'zh' ? ' 等7种' : ' and 7 kinds in all' : ''))
    }
  })

  it.each([1, 6, 7])('%i种明细覆盖回收的原材料、装备、机群、图纸与碎片段', count => {
    const record = rows(count)
    const note = yieldNoteFor(ctx, { min: record, mod: record, drone: record, blueprint: record, frag: record }, 'recycle')
    const segments: LogSeg[] = [note.parts[0]!, ...note.parts[1]!.subs!]
    expect(segments.map(seg => seg.id)).toEqual(['core.industry.058', 'core.industry.059', 'core.industry.060', 'core.industry.061', 'core.industry.062'])
    for (const seg of segments) for (const locale of ['zh', 'en'] as const) {
      const text = renderer(locale)({ text: seg.text, textId: seg.id, textParams: seg.params })
      expect(text).not.toMatch(/\{\w+\}/)
      expect(text.match(/yield-0×/g)).toHaveLength(1)
      if (count > 6) expect(text).toContain(locale === 'zh' ? ' 等7种' : ' and 7 kinds in all')
      else expect(text).not.toMatch(/等\d+种|kinds in all/)
    }
  })

  it.each(['manual', 'exhausted', 'insufficient'] as const)('%s真实停炉日志保留所得和原始数量', mode => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.warehouse.items['ore-a'] = 25
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    const id = state.refineRuns[0]!.id
    advanceGame(state, 7_000, ctx)
    const stock = { ...state.warehouse.items }
    if (mode === 'manual') expect(stopRefineRun(state, ctx, id).ok).toBe(true)
    else {
      state.warehouse.items['ore-a'] = mode === 'exhausted' ? 0 : 5
      advanceGame(state, 7_000, ctx)
    }
    expect(state.refineRuns).toHaveLength(0)
    expect(state.warehouse.items['min-a']).toBe(stock['min-a'])
    expect(state.warehouse.items['min-b']).toBe(stock['min-b'])
    const log = [...state.logs].reverse().find(row => row.text.includes('精炼所得'))!
    expect(log).toBeDefined()
    expect(renderer('zh')(log).split('；精炼所得：')[1]).toBe(log.text.split('；精炼所得：')[1])
    for (const locale of ['zh', 'en'] as const) {
      const text = renderer(locale)(log)
      expect(text).not.toMatch(/\{\w+\}/)
      expect(text.match(/矿粉min-a×24/g)).toHaveLength(1)
      expect(text.match(/矿粉min-b×6/g)).toHaveLength(1)
    }
  })

  it('七种产物的完整停炉日志仅显示一次折叠尾注，英文不遗留中文尾注', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.warehouse.items['ore-a'] = 20
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    const run = state.refineRuns[0]!
    run.recAcc = { min: rows(7), mod: {}, frag: {} }
    expect(stopRefineRun(state, ctx, run.id).ok).toBe(true)
    const log = state.logs.at(-1)!
    expect(renderer('zh')(log)).toBe(log.text)
    const en = renderer('en')(log)
    expect(en).not.toMatch(/\{\w+\}|等7种/)
    expect(en.match(/and 7 kinds in all/g)).toHaveLength(1)
    expect(en.match(/yield-0×7/g)).toHaveLength(1)
    expect(en).not.toContain('yield-6')
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.logs.at(-1)!
    expect(renderer('zh')(back)).toBe(renderer('zh')(log))
    expect(renderer('en')(back)).toBe(en)
  })

  it('回收完整停炉日志逐类显示现有译文，不丢装备、机群、图纸或碎片', () => {
    const live = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.warehouse.items['wreck-rare-a-hi'] = 30
    expect(startRecycleRun(state, 'wreck-rare-a-hi', 'pilot', live).ok).toBe(true)
    const run = state.refineRuns[0]!
    run.recAcc = { min: { 'min-tritanium': 10 }, mod: { 'mod-turret-kin-2': 2 },
      drone: { 'drone-scout': 3 }, blueprint: { 'bp-turret-2': 4 }, frag: { 'frag-test': 5 } }
    expect(stopRefineRun(state, live, run.id).ok).toBe(true)
    const log = state.logs.at(-1)!
    const en = renderer('en')(log)
    expect(en).not.toMatch(/\{\w+\}|保底原材料|额外掉落|装备 |无人机 |图纸 |蓝图碎片 /)
    for (const label of ['Guaranteed raw materials', 'Extra drops:', 'equipment ', 'drones ', 'blueprints ', 'blueprint fragments ']) expect(en).toContain(label)
    for (const quantity of ['×10', '×2', '×3', '×4', '×5']) expect(en.match(new RegExp(quantity, 'g'))).toHaveLength(1)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.logs.at(-1)!
    expect(renderer('zh')(back)).toBe(renderer('zh')(log))
    expect(renderer('en')(back)).toBe(en)
  })
})
