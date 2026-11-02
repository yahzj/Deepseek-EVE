import { describe, expect, it } from 'vitest'
import { buildSimContext, COMMS_MESSAGES, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceComms, commsInbox, commsPopupQueue, dismissCommsPopup } from '../src/comms'
import { noteStandingEarned } from '../src/standing'
import { advanceGame } from '../src/engine'
import { COMMAND_STANDING_REQUIRED } from '../src/combat/command/rules'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const ID = 'msg-fleet-command-unlock'
const message = COMMS_MESSAGES.find(row => row.id === ID)!
const full = buildSimContext()
const ctx = { ...full, commsMessages: new Map([[ID, message]]) }

function world(earned: number) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261031 })
  state.standingsEarned = { dsi: earned }
  state.standings.dsi = earned
  return state
}

describe('多舰编队解锁通讯', () => {
  it('20点门槛与编队单点相同，通讯弹窗并跳转到舰船技能大类', () => {
    expect(COMMAND_STANDING_REQUIRED).toBe(20)
    expect(message.trigger).toEqual({ kind: 'standing', factionId: 'dsi', min: COMMAND_STANDING_REQUIRED })
    expect(message.popup).toBe(true)
    expect(message.hint).toEqual({ text: L10N['ui.commsFleetUnlock.004']!.zh, page: 'skills', tab: '舰船', skillBranch: 'b-command' })
    expect(message.subject).toBe(L10N['ui.commsFleetUnlock.001']!.zh)
    expect(message.body).toEqual([
      L10N['ui.commsFleetUnlock.002']!.zh,
      L10N['ui.commsFleetUnlock.003']!.zh,
    ])
  })

  it.each([0, 19, 20, 21])('累计协会声望%s按门槛一次性送达', earned => {
    const state = world(earned)
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID] !== undefined).toBe(earned >= COMMAND_STANDING_REQUIRED)
    expect(commsPopupQueue(state).includes(ID)).toBe(earned >= COMMAND_STANDING_REQUIRED)
    advanceComms(state, ctx)
    expect(commsInbox(state, ctx).filter(row => row.id === ID)).toHaveLength(earned >= COMMAND_STANDING_REQUIRED ? 1 : 0)
  })

  it('累计19后真实引擎记入第20点，送达并弹窗且不重复', () => {
    const state = world(19)
    advanceGame(state, 1000, ctx, { nowWallMs: 0 })
    expect(state.commsDelivered?.[ID]).toBeUndefined()
    noteStandingEarned(state, 'dsi', 1)
    advanceGame(state, 1000, ctx, { nowWallMs: 0 })
    const delivered = state.commsDelivered?.[ID]
    expect(delivered).toBeDefined()
    expect(commsPopupQueue(state)).toContain(ID)
    advanceGame(state, 5000, ctx, { nowWallMs: 0 })
    expect(state.commsDelivered?.[ID]).toBe(delivered)
    expect(commsInbox(state, ctx).filter(row => row.id === ID)).toHaveLength(1)
  })

  it('门槛读取累计声望，不读取可支配余额', () => {
    const state = world(19)
    state.standings.dsi = 100
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeUndefined()
    state.standingsEarned!.dsi = 20
    state.standings.dsi = 0
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeDefined()
  })

  it('完整消息目录同期投递时优先弹出编队解锁信，已有弹窗不会丢失', () => {
    const state = world(20)
    state.onboarding.step = 99
    state.commsPopups = ['existing-popup']
    advanceComms(state, full)
    expect(commsPopupQueue(state)).toEqual(['existing-popup', ID])
    expect(commsInbox(state, full).find(row => row.id === ID)?.from).toBe('深空工业协会 · 训练处')
  })

  it('达标存档补发一次，关闭并往返读档后不重复弹出', () => {
    let state = loadSaveFile(serializeSaveFile(world(50), 0)).state
    advanceComms(state, ctx)
    expect(commsPopupQueue(state)).toEqual([ID])
    expect(dismissCommsPopup(state, ID)).toBe(true)
    state = loadSaveFile(serializeSaveFile(state, 0)).state
    advanceComms(state, ctx)
    expect(commsPopupQueue(state)).not.toContain(ID)
    expect(commsInbox(state, ctx).filter(row => row.id === ID)).toHaveLength(1)
    expect(state.commsRead?.[ID]).toBe(true)
  })

  it('App共用通讯跳转桥传递目标技能书，普通大类跳转仍兼容', () => {
    const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../../../apps/desktop/src/renderer/src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let declaration: ts.FunctionDeclaration | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'gotoFromComms') declaration = node
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!declaration) throw new Error('通讯跳转桥缺失')
    const calls: unknown[] = []
    const bindings = { focusSkillGroup: (group: string, branch?: string) => calls.push(['skill', group, branch]),
      changePage: (page: string) => calls.push(['page', page]), changeMapTab() {}, focusTaskTab() {}, changeShipTab() {}, result: undefined }
    runInNewContext(ts.transpileModule(`${declaration.getText(source)}\nglobalThis.result = gotoFromComms`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, bindings)
    const jump = bindings.result as unknown as (page: string, tab?: string, shipTab?: string, taskTab?: string, branch?: string) => void
    jump(message.hint!.page, message.hint!.tab, undefined, undefined, message.hint!.skillBranch)
    expect(calls).toEqual([['skill', '舰船', 'b-command'], ['page', 'skills']])
    calls.length = 0
    jump('skills', '工程')
    expect(calls).toEqual([['skill', '工程', undefined], ['page', 'skills']])
  })

  it('批准稿使用本地化ID，同事已完成的英文非空且不再延期', () => {
    for (const id of ['ui.commsFleetUnlock.001', 'ui.commsFleetUnlock.002', 'ui.commsFleetUnlock.003', 'ui.commsFleetUnlock.004']) {
      expect(L10N[id]!.en).not.toBe('')
      expect(L10N[id]!.en).not.toMatch(/[\u3400-\u9fff]/)
      expect(L10N[id]!.enDeferred).toBeUndefined()
    }
    expect(message.subject).toBe(L10N['ui.commsFleetUnlock.001']!.zh)
    expect(message.body).toEqual([L10N['ui.commsFleetUnlock.002']!.zh, L10N['ui.commsFleetUnlock.003']!.zh])
    expect(message.hint!.text).toBe(L10N['ui.commsFleetUnlock.004']!.zh)
  })

})
