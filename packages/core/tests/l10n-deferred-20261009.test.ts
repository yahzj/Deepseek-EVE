import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ANNOUNCEMENTS, L10N, l10nEntryText, type L10nEntry } from '@whale/data'
import { deferredL10nIssues } from '../../../tools/l10n-deferred-check'
import { MECHANICS_APPROVED_ZH } from './fixtures/announcement-mechanics-brief-20261009'

const root = new URL('../../../', import.meta.url)
const backlog = readFileSync(new URL('docs/l10n-pending.md', root), 'utf8')
const brief = ANNOUNCEMENTS.find(row => row.id === 'ann-balance-mechanics-summary-20261008')!

describe('综合公告短句与英文显式延期', () => {
  it('38条逐字批准中文，每个改动点一句且当前显示不含光环', () => {
    expect(brief.bullets).toEqual([...MECHANICS_APPROVED_ZH])
    expect(brief.bullets.every(row => (row.match(/。/g) ?? []).length === 1 && !row.includes('\n'))).toBe(true)
    expect(brief.bullets.join('')).not.toMatch(/光环|垂暮|叠光|聚焦/)
    expect(brief.id).toBe('ann-balance-mechanics-summary-20261008')
    expect(brief.date).toBe('2026-10-09')
  })
  it('全部新正文只记待译，不准备英文，不用中文或占位伪填英文列', () => {
    expect(deferredL10nIssues(L10N, backlog)).toEqual([])
    expect(Object.values(L10N).filter(entry => entry.enDeferred === true)).toHaveLength(38)
    for (const id of brief.bulletIds!) {
      expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
      expect(backlog).toContain(`| \`${id}\` |`)
      expect(l10nEntryText(L10N[id]!, 'en')).toBe(L10N[id]!.zh)
    }
  })
  it('非待译与异形既有文本和全部已有英文逐字不变', () => {
    const old = execFileSync('git', ['show', 'c6fee0f1:packages/data/src/l10n/table.ts'], { cwd: root, encoding: 'utf8', windowsHide: true })
    const scope = { exports: {} as { L10N: typeof L10N } }
    runInNewContext(ts.transpileModule(old, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
    for (const [id, entry] of Object.entries(scope.exports.L10N)) expect(L10N[id], id).toEqual(entry)
  })
  it('登记和标记必须成对，未登记、伪填、过期或不存在记录拒绝', () => {
    const id = 'ano.sample.001', row = { zh: '测试{p1}', en: '', enDeferred: true } as const
    const record = `| \`${id}\` | 测试 | 待本地化 |`
    expect(deferredL10nIssues({ [id]: row }, record)).toEqual([])
    expect(deferredL10nIssues({ [id]: row }, '').length).toBe(1)
    expect(deferredL10nIssues({ [id]: { ...row, en: 'pending' } }, record).length).toBe(1)
    expect(deferredL10nIssues({ [id]: { zh: '测试', en: 'Test' } }, record).length).toBe(1)
    expect(deferredL10nIssues({}, record).length).toBe(1)
    expect(l10nEntryText({ zh: '测试', en: 'Test' }, 'en')).toBe('Test')
  })
  it('真实渲染层取词及槽/日志在英文延期时回退中文，不显示空白或ID', () => {
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/i18n/locale.tsx', root), 'utf8')
    const exports = {} as { textOf(id: string, locale: 'zh' | 'en'): string; futureTr(id: string, params?: Record<string, number>): string;
      logText(entry: { text: string; textId: string; textParams: Record<string, unknown> }): string }
    const table = { ...L10N, 'ui.deferredProbe.001': { zh: '数量{p1}', en: '', enDeferred: true } } as const
    const mocks: Record<string, unknown> = { react: { createContext: () => ({}) },
      '@whale/data': { L10N: table, l10nEntryText }, '@whale/core': { signalSpaceTextId: (id: string) => id } }
    runInNewContext(ts.transpileModule(source, { fileName: 'locale.tsx', compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    } }).outputText, { exports, require: (id: string) => mocks[id],
      localStorage: { getItem: () => 'en' }, navigator: { language: 'en' } })
    const module = exports
    expect(module.textOf(brief.bulletIds![0]!, 'en')).toBe(brief.bullets[0])
    expect(module.textOf('not-found', 'en')).toBe('not-found')
    const fixture: L10nEntry = { zh: '测试{p1}', en: '', enDeferred: true }
    expect(l10nEntryText(fixture, 'en').replace('{p1}', '3')).toBe('测试3')
    expect(module.futureTr(brief.bulletIds![13]!)).toBe(brief.bullets[13])
    expect(module.futureTr('ui.deferredProbe.001', { p1: 3 })).toBe('数量3')
    expect(module.logText({ text: '', textId: 'core.events.001', textParams: {
      p1: '', p2: '', p1Id: 'ui.deferredProbe.001', p1p1: 7,
    } })).toBe('✦ 数量7')
  })
  it('真实主进程取词也用共享回退，带参数不丢值', () => {
    const source = ts.createSourceFile('main.ts', readFileSync(new URL('apps/desktop/src/main/index.ts', root), 'utf8'), ts.ScriptTarget.Latest, true)
    const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 't')!
    const scope = { L10N: { 'ui.deferredProbe.001': { zh: '数量{p1}', en: '', enDeferred: true } }, l10nEntryText,
      mainLocale: 'en', result: '' }
    runInNewContext(ts.transpileModule(`${fn.getText(source)}; globalThis.result=t('ui.deferredProbe.001',{p1:3})`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, scope)
    expect(scope.result).toBe('数量3')
  })
})
