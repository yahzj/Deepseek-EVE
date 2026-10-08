import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { weekendFlagshipBattleActive } from '../src/weekendLaunch'
import { mainActivityOf } from '../src/activityGate'
import type { ActivityStopKind, ActivityView } from '../src/activity'
import { vi } from 'vitest'
import { ROOT } from './helpers/save-shell'

function productionFunction<T>(relative: string, names: string[], bindings: Record<string, unknown>): T {
  const file = resolve(ROOT, relative)
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fns = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''))
  if (fns.length !== names.length) throw new Error('活动生产入口不存在')
  const code = fns.map((node) => node.getText(source).replace(/^export\s+/, '')).join('\n') + `\nglobalThis.result = ${names[names.length - 1]}`
  const context = { ...bindings, result: undefined }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.result as T
}
const sceneOfShipwin = productionFunction<(s: ReturnType<typeof createInitialState>) => string>(
  'apps/desktop/src/renderer/src/ui/ShipStatusWin.tsx', ['sceneOfShipwin'], { weekendFlagshipBattleActive })
const activityKindOf = productionFunction<(s: ReturnType<typeof createInitialState>) => string | null>(
  'apps/desktop/src/renderer/src/ui/ActivityScreen.tsx', ['activityOf', 'activityKindOf'], { sceneOfShipwin })

describe('主控活动显示与交战优先级', () => {
  it('主控船遭遇战压过采矿与打捞，不能继续上屏作业动画', () => {
    for (const kind of ['mining', 'salvaging'] as const) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      state[kind].active = true
      state.encounter.active = true
      state.encounter.shipId = state.shipId
      state.encounter.battle = {} as NonNullable<typeof state.encounter.battle>
      expect(sceneOfShipwin(state)).toBe('combat')
      expect(activityKindOf(state)).toBeNull()
    }
  })
  it('副船遭遇战不替主控切交战场景', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.mining.active = true
    state.encounter.active = true
    state.encounter.shipId = 'OTHER-SHIP'
    state.encounter.battle = {} as NonNullable<typeof state.encounter.battle>
    expect(sceneOfShipwin(state)).toBe('work-mine')
    expect(activityKindOf(state)).toBe('mine')
  })
  it('四个既有活动动画与主控判据对应，返航不继续画作业', () => {
    const choices = { mining: 'mine', salvaging: 'salvage', hauling: 'haul', wormholeScan: 'scan' } as const
    for (const [key, animation] of Object.entries(choices)) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      if (key === 'wormholeScan') state.wormholeScan = { active: true, progressMs: 0 }
      else state[key as 'mining' | 'salvaging' | 'hauling'].active = true
      expect(mainActivityOf(state)).toBe(key)
      expect(activityKindOf(state)).toBe(animation)
      if (key === 'mining' || key === 'salvaging') {
        state[key].phase = 'returning'
        expect(sceneOfShipwin(state)).toBe('travel')
        expect(activityKindOf(state)).toBeNull()
      }
    }
  })
})

const STOP_METHODS: Record<ActivityStopKind, { method: string; args: unknown[] }> = {
  'remove-training': { method: 'dequeueAt', args: [0] },
  'stop-mining': { method: 'stopMiningNow', args: [] },
  'stop-scan': { method: 'stopScanNow', args: [] },
  'stop-whscan': { method: 'wormholeScanStop', args: [] },
  'stop-whauto': { method: 'wormholeAutoStop', args: ['7'] },
  'stop-salvage': { method: 'stopSalvageOpNow', args: [] },
  'cancel-manufacture': { method: 'cancelManufacturingAt', args: ['7'] },
  'stop-refine': { method: 'stopRefineRunAt', args: ['7'] },
  'stop-lab': { method: 'stopLabRunAt', args: ['7'] },
  'recall-expedition': { method: 'recallExpeditionNow', args: [] },
  'retreat-battle': { method: 'retreatNow', args: [] },
  'cancel-ai': { method: 'cancelAiTaskAt', args: ['7'] },
  'recall-standby': { method: 'recallStandbyNow', args: [] },
  'cancel-deliver-trip': { method: 'cancelDeliverTripNow', args: [] },
  'stop-loop': { method: 'bountyLoopAt', args: [null] },
  'stop-invasion-loop': { method: 'invasionLoopAt', args: [null] },
  'stop-hauling': { method: 'stopHaulingNow', args: [] },
}
describe('两套活动栏停止动作逐项一致', () => {
  for (const layout of ['ActivityBar', 'ActivityBarClassic']) {
    const stop = productionFunction<(view: ActivityView, engine: object, toast: (message: string, warn?: boolean) => void) => void>(
      `apps/desktop/src/renderer/src/panels/${layout}.tsx`, ['doStop'], {
        tr: (id: string) => id, cmdText: (result: { error?: string }) => result.error,
      })
    it(`${layout} 全部停止入口和参数契约`, () => {
      for (const [action, expected] of Object.entries(STOP_METHODS)) {
        const method = vi.fn(() => ({ ok: true }))
        const toast = vi.fn()
        stop({ stop: action, stopParam: '7' } as ActivityView, { [expected.method]: method }, toast)
        expect(method, action).toHaveBeenCalledTimes(1)
        expect(method, action).toHaveBeenCalledWith(...expected.args)
        expect(toast).toHaveBeenCalledTimes(1)
      }
    })
    it(`${layout} 引擎拒绝不报告动作成功`, () => {
      const toast = vi.fn()
      stop({ stop: 'stop-mining' } as ActivityView, { stopMiningNow: () => ({ ok: false, error: 'LOCKED' }) }, toast)
      expect(toast).toHaveBeenCalledTimes(1)
      expect(toast).toHaveBeenCalledWith('LOCKED', true)
    })
  }
})
