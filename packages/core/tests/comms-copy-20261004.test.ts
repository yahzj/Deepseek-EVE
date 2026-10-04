import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'
import { COMMS_MESSAGES, L10N } from '@whale/data'

const language = { en: false }
// 沿现有外壳测试的 AST 取生产入口做法，不让 core 的类型检查拉入 JSX。
const source = ts.createSourceFile('commsText.ts', readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/commsText.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['COMMS_SUBJECT_ID', 'COMMS_BODY_EN', 'commsBodyText', 'commsSubjectText']
const statements = source.statements.filter((node) =>
  ts.isFunctionDeclaration(node) ? names.includes(node.name?.text ?? '') :
    ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => ts.isIdentifier(decl.name) && names.includes(decl.name.text)),
)
if (statements.length !== names.length) throw new Error('通讯取词入口缺失')
const code = statements.map((node) => node.getText(source).replace(/^export\s+/, '')).join('\n') + '\nglobalThis.result = { commsBodyText, commsSubjectText }'
const context = {
  L10N,
  isEn: () => language.en,
  tr: (id: string) => L10N[id]?.[language.en ? 'en' : 'zh'] ?? id,
  paramText: (value: string | number) => String(value),
  result: undefined,
}
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
const { commsBodyText, commsSubjectText } = context.result as unknown as {
  commsBodyText: (id: string, body: readonly string[]) => readonly string[]
  commsSubjectText: (id: string, fallback: string) => string
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
