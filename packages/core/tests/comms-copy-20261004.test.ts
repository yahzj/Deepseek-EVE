import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'
import { COMMS_MESSAGES, DIALOGUES, FIRST_TASK_MESSAGES, L10N } from '@whale/data'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { weekendWarnCommsOf, weekendSettleCommsOf } from '../src/weekendComms'
import type { WeekendResultSnapshot } from '../src/weekendEvent'

const language = { en: false }
// 沿现有外壳测试的 AST 取生产入口做法，不让 core 的类型检查拉入 JSX。
const source = ts.createSourceFile('commsText.ts', readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/commsText.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['COMMS_NAME_ID', 'COMMS_DIALOGUE_ID', 'COMMS_SUBJECT_ID', 'COMMS_BODY_EN', 'COMMS_HINT_ID', 'commsSenderText', 'commsDialogueText', 'commsBodyText', 'commsSubjectText', 'commsHintText']
const statements = source.statements.filter((node) =>
  ts.isFunctionDeclaration(node) ? names.includes(node.name?.text ?? '') :
    ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => ts.isIdentifier(decl.name) && names.includes(decl.name.text)),
)
if (statements.length !== names.length) throw new Error('通讯取词入口缺失')
const code = statements.map((node) => node.getText(source).replace(/^export\s+/, '')).join('\n') + '\nglobalThis.result = { commsBodyText, commsSubjectText, commsHintText, commsDialogueText }'
const context = {
  L10N,
  isEn: () => language.en,
  tr: (id: string) => L10N[id]?.[language.en ? 'en' : 'zh'] ?? id,
  paramText: (value: string | number) => String(value),
  result: undefined,
}
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
const { commsBodyText, commsSubjectText, commsHintText, commsDialogueText } = context.result as unknown as {
  commsBodyText: (id: string, body: readonly string[]) => readonly string[]
  commsSubjectText: (id: string, fallback: string) => string
  commsHintText: (text: string) => string
  commsDialogueText: (script: (typeof DIALOGUES)[number]) => (typeof DIALOGUES)[number]
}

const copies = [
  { id: 'msg-welcome', subject: 'ui.comms.028', prefix: 'ui.commsWelcome', count: 2 },
  { id: 'msg-salvage-crew', subject: 'ui.comms.033', prefix: 'ui.commsSalvage', count: 4 },
  { id: 'msg-lab-contraband', subject: 'ui.comms.076', prefix: 'ui.commsContraband', count: 5 },
]

describe('三封已审通讯的中英接线', () => {
  beforeEach(() => { language.en = false })

  it.each(copies)('$id 标题和正文按同组 id 取词，英文不回落中文', ({ id, subject, prefix, count }) => {
    const message = COMMS_MESSAGES.find((m) => m.id === id)!
    const entries = Array.from({ length: count }, (_, i) => L10N[`${prefix}.${String(i + 1).padStart(3, '0')}`]!)
    expect(message.subject).toBe(L10N[subject]!.zh)
    expect(message.body).toEqual(entries.map((entry) => entry.zh))
    expect(commsBodyText(id, message.body)).toEqual(message.body)
    language.en = true
    expect(commsSubjectText(id, message.subject)).toBe(L10N[subject]!.en)
    expect(commsBodyText(id, message.body)).toEqual(entries.map((entry) => entry.en))
    expect(commsBodyText(id, message.body).join('')).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('黑市强调段仍与正文同序，协会处罚的表述不变成求助', () => {
    const message = COMMS_MESSAGES.find((m) => m.id === 'msg-lab-contraband')!
    expect(message.highlight).toEqual([message.body[3], message.body[4]])
    expect(message.body[3]).toContain('真让协会查到，挨罚的是你')
    expect(message.trigger).toEqual({ kind: 'labOpened' })
    expect(message.hint).toEqual({ text: '工业页的实验室能造这两样。', page: 'industry' })
  })

  it('管制与工会的触发及跳转不随重写改变', () => {
    const welcome = COMMS_MESSAGES.find((m) => m.id === 'msg-welcome')!
    const salvage = COMMS_MESSAGES.find((m) => m.id === 'msg-salvage-crew')!
    expect(welcome.trigger).toEqual({ kind: 'start' })
    expect(welcome.hint?.page).toBe('map')
    expect(salvage.trigger).toEqual({ kind: 'explored', count: 6 })
    expect(salvage.hint).toEqual({ text: '星图 · 残骸打捞页有各星系的残骸存量。', page: 'map', tab: 'salvage' })
  })
})

describe('其余通讯整批中英接线与行为守恒', () => {
  beforeEach(() => { language.en = false })
  it.each(COMMS_MESSAGES)('$id 正文与主题在英文下完整，不因段数变化回落', (message) => {
    language.en = true
    const body = commsBodyText(message.id, message.body)
    expect(body).toHaveLength(message.body.length)
    expect(body.join('')).not.toMatch(/[\u4e00-\u9fff]/)
    expect(commsSubjectText(message.id, message.subject)).not.toMatch(/[\u4e00-\u9fff]/)
  })
  it.each(DIALOGUES)('$id 弹出对白与收件箱镜像的英文同源', (script) => {
    language.en = true
    const popup = commsDialogueText(script)
    expect(popup.lines).toHaveLength(script.lines.length)
    const inbox = commsBodyText(`dlg:${script.id}`, script.lines.map((line) => `${line.speaker}：${line.text}`))
    expect(inbox).toEqual(popup.lines.map((line) => `${line.speaker}: ${line.text}`))
    expect(inbox.join('') + popup.title + commsSubjectText(`dlg:${script.id}`, script.subject ?? '')).not.toMatch(/[\u4e00-\u9fff]/)
    language.en = false
    expect(commsDialogueText(script)).toBe(script)
  })
  it('静态消息的发件方、触发、弹窗、跳转和奖励与本批前一致', () => {
    const before = execFileSync('git', ['show', '71ca2ba0:packages/data/src/messages.ts'], { encoding: 'utf8' })
    const ast = ts.createSourceFile('messages.ts', before, ts.ScriptTarget.Latest, true)
    const text = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast).replace(/^export\s+/, '')).join('\n')
    const bindings = { FIRST_TASK_MESSAGES, L10N, result: undefined }
    runInNewContext(ts.transpileModule(text + '\nglobalThis.result = COMMS_MESSAGES', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, bindings)
    function policy(messages: typeof COMMS_MESSAGES) {
      return messages.map(({ subject: _subject, body: _body, ...rest }) => rest)
    }
    expect(policy(COMMS_MESSAGES)).toEqual(policy(bindings.result as unknown as typeof COMMS_MESSAGES))
  })
  it('建站对白 id、角色、主题、行数与挂靠不变', () => {
    const before = execFileSync('git', ['show', '71ca2ba0:packages/data/src/dialogues.ts'], { encoding: 'utf8' })
    const ast = ts.createSourceFile('dialogues.ts', before, ts.ScriptTarget.Latest, true)
    const text = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast).replace(/^export\s+/, '')).join('\n')
    const bindings = { result: undefined }
    runInNewContext(ts.transpileModule(text + '\nglobalThis.result = DIALOGUES', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, bindings)
    const policy = (scripts: typeof DIALOGUES) => scripts.map(({ lines, ...rest }) => ({ ...rest, speakers: lines.map((line) => line.speaker) }))
    expect(policy(DIALOGUES)).toEqual(policy(bindings.result as unknown as typeof DIALOGUES))
  })
  it('实际 Communicator 组件使用英文对白，而非直接显示中文 script', () => {
    language.en = true
    const file = ts.createSourceFile('communicator.tsx', readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/communicator.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Communicator')!
    const bindings = {
      tr: context.tr, commsDialogueText,
      React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props, children }) },
      result: undefined,
    }
    runInNewContext(ts.transpileModule(fn.getText(file).replace(/^export\s+/, '') + '\nglobalThis.result = Communicator', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, bindings)
    for (const script of DIALOGUES) {
      const node = (bindings.result as unknown as (props: object) => object)({ script, onClose: () => {} })
      const texts: string[] = []
      function collect(value: unknown): void {
        if (typeof value === 'string') texts.push(value)
        else if (Array.isArray(value)) value.forEach(collect)
        else if (value && typeof value === 'object' && 'children' in value) collect((value as { children: unknown[] }).children)
      }
      collect(node)
      expect(texts.join('')).not.toMatch(/[\u4e00-\u9fff]/)
      expect(texts).toContain(commsDialogueText(script).lines[0]!.text)
    }
  })
})

describe('入侵通讯表文与中文随档兜底', () => {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  function check(mail: ReturnType<typeof weekendWarnCommsOf>) {
    const params = mail.params ?? {}
    const fill = (id: string) => L10N[id]!.zh.replace(/\{(\w+)\}/g, (m, key: string) => String(params[key] ?? m))
    expect(mail.subject).toBe(fill(mail.subjectId))
    expect(mail.paragraphs).toEqual(mail.bodyIds.map(fill))
    for (const id of mail.bodyIds) {
      const en = L10N[id]!.en.replace(/\{(\w+)\}/g, (m, key: string) => String(params[key] ?? m))
      expect(en).not.toMatch(/\{\w+\}/)
    }
  }
  it.each([false, true])('高安点火=%s：参数和怀疑段与实际留痕一致', (suspicion) => {
    const ev = { seq: 1, family: 'H', coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], startedAtWallMs: 0, contributed: {}, beaconHighSec: suspicion }
    const mail = weekendWarnCommsOf(state, ctx, ev)
    check(mail)
    expect(mail.bodyIds.includes('core.weekend.044')).toBe(suspicion)
    expect(mail.hint?.page).toBe('map')
  })
  it.each([false, true])('有奖励=%s：发放表述、零奖励分支和结算动作不变', (paid) => {
    const snapshot: WeekendResultSnapshot = {
      seq: 1, family: 'H', coreId: 'galaxy-kor', endedAtWallMs: 1,
      flagshipOutcome: 'window', share: paid ? 0.2 : 0, tier: paid ? 'D' : 'none',
      galaxies: [], isk: paid ? 1000 : 0, wreck: 0, blackBox: 0, standing: paid ? 3 : 0,
    }
    const mail = weekendSettleCommsOf(state, ctx, snapshot)
    check(mail)
    expect(mail.bodyIds[0]).toBe(paid ? 'core.weekend.014' : 'core.weekend.015')
    expect(mail.hint?.action).toBe('weekendSummary')
    expect(mail.rewards).toEqual(paid ? [{ isk: 1000 }] : [])
  })
})

describe('教程整批通讯', () => {
  beforeEach(() => { language.en = false })
  it.each(FIRST_TASK_MESSAGES)('$id 中英正文与主题齐备，完成信回重要任务', (message) => {
    expect(message.trigger).toEqual({ kind: 'firstTask', taskId: message.id })
    expect(message.hint).toEqual({ text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' })
    expect(message.body).toHaveLength(3)
    expect(commsSubjectText(message.id, message.subject)).toBe(message.subject)
    expect(commsBodyText(message.id, message.body)).toEqual(message.body)
    language.en = true
    const en = commsBodyText(message.id, message.body)
    expect(en).toHaveLength(3)
    expect(en.join('')).not.toMatch(/[\u4e00-\u9fff]/)
    expect(commsSubjectText(message.id, message.subject)).not.toMatch(/[\u4e00-\u9fff]/)
    expect(commsHintText(message.hint!.text)).toBe(L10N['ui.comms.051']!.en)
  })
  it('开场两段中英对齐，跳转定位重要任务', () => {
    const message = COMMS_MESSAGES.find((m) => m.id === 'msg-briefing')!
    expect(message.body).toHaveLength(2)
    expect(message.hint?.taskTab).toBe('important')
    language.en = true
    expect(commsBodyText(message.id, message.body)).toEqual([L10N['ui.firstBriefing.001']!.en, L10N['ui.firstBriefing.002']!.en])
    expect(commsHintText(message.hint!.text)).toBe(L10N['ui.comms.052']!.en)
  })
})
