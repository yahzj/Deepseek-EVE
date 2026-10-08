import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ANNOUNCEMENTS, L10N } from '@whale/data'
import { weekendFamilyForWindow } from '../src/weekendEvent'

const root = new URL('../../../', import.meta.url)
const baseline = 'dc012f8f'
function historical(file: string): string {
  return execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true })
}
const draft = historical('docs/design/announcement-draft-two-release-20261008.md')
function section(heading: string, language: 'zh' | 'en') {
  const text = draft.split(heading)[1]!.split('\n## ')[0]!
  const body = text.split(language === 'zh' ? '### 中文正文' : '### English')[1]!.split('\n### ')[0]!
  return body.split(/\r?\n/).flatMap(line => /^\d+\. /.test(line) ? [line.replace(/^\d+\. /, '')] : [])
}
const releases = [
  { id: 'ann-alien-invasion-20261007', heading: '## 二、公告一：异形虫群入侵',
    title: { zh: '异形虫群入侵', en: 'Alien Swarm Incursion' }, tag: { zh: '内容', en: 'Content' } },
  { id: 'ann-balance-mechanics-summary-20261008', heading: '## 三、公告二：数据调整与新增机制',
    title: { zh: '数据调整与新增机制', en: 'Balance Changes and New Mechanics' }, tag: { zh: '系统', en: 'System' } },
]

type Node = { type: string; props: Record<string, any>; children: unknown[] }
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('children' in value)) return []
  const node = value as Node
  return [node, ...node.children.flatMap(nodes)]
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'children' in value) return text((value as Node).children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

describe('船长获批两篇公告发布', () => {
  it.each(releases)('$id中英文逐字等于获批稿，各五条并走唯一表', release => {
    const announcement = ANNOUNCEMENTS.find(row => row.id === release.id)!
    expect(announcement).toBeDefined()
    expect(announcement.date).toBe('2026-10-09')
    expect(announcement.bulletIds).toHaveLength(5)
    expect(announcement.bullets).toHaveLength(5)
    for (const language of ['zh', 'en'] as const) {
      expect(L10N[announcement.titleId!]![language]).toBe(release.title[language])
      expect(L10N[announcement.tagId!]![language]).toBe(release.tag[language])
      expect(announcement.bulletIds!.map(id => L10N[id]![language])).toEqual(section(release.heading, language))
    }
    expect(announcement.title).toBe(L10N[announcement.titleId!]!.zh)
    expect(announcement.tag).toBe(L10N[announcement.tagId!]!.zh)
    expect(announcement.bullets).toEqual(announcement.bulletIds!.map(id => L10N[id]!.zh))
  })
  it('只在顶部新增两篇，历史正文与顺序逐项相同，编号唯一', () => {
    const source = historical('packages/data/src/announcements.ts')
    const scope = { exports: {} as { ANNOUNCEMENTS: typeof ANNOUNCEMENTS }, require: () => ({ L10N }) }
    runInNewContext(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, scope)
    expect(ANNOUNCEMENTS.slice(0, 2).map(row => row.id)).toEqual(releases.map(row => row.id))
    expect(JSON.parse(JSON.stringify(ANNOUNCEMENTS.slice(2)))).toEqual(JSON.parse(JSON.stringify(scope.exports.ANNOUNCEMENTS)))
    expect(new Set(ANNOUNCEMENTS.map(row => row.id)).size).toBe(ANNOUNCEMENTS.length)
  })
  it('公告排期对应10月9日20点异形期，未开放内容与UI不混入正文', () => {
    expect(weekendFamilyForWindow(new Date(2026, 9, 9, 20).getTime())).toBe('C')
    const text = ANNOUNCEMENTS.slice(0, 2).flatMap(row => row.bullets).join('\n')
    expect(text).not.toMatch(/数据编辑器|测试档|待审|待验收|主树|Worker|深空探测机|星球建设|动态星图|CPU插件.*120/)
    expect(text).toContain('每次爆发')
    expect(text).toContain('只收不卖')
    expect(text).toContain('其他存活队友')
    expect(text).toContain('10月9日20:00')
  })
  it.each(['zh', 'en'] as const)('%s实际公告组件通过已有按钮显示两篇完整正文，不重写已读状态机制', language => {
    const source = ts.createSourceFile('Announcements.tsx', readFileSync(new URL('apps/desktop/src/renderer/src/panels/Announcements.tsx', root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n')
    const slots: unknown[] = [], seen = new Map([['whale-idle:announce-seen', ANNOUNCEMENTS[0]!.id]])
    let cursor = 0
    const tr = (id: string) => L10N[id]![language]
    const scope = { exports: {} as { AnnouncementHub: (props: unknown) => unknown }, ANNOUNCEMENTS, tr,
      weekendFlagshipBattleActive: () => false, localStorage: { getItem: (key: string) => seen.get(key), setItem: (key: string, value: string) => seen.set(key, value) },
      React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
      useEffect: () => {}, useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => { const at = cursor++; if (!(at in slots)) slots[at] = typeof value === 'function' ? (value as () => unknown)() : value; return [slots[at], (next: unknown) => { slots[at] = next }] },
    }
    runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
    const render = () => { cursor = 0; return nodes(scope.exports.AnnouncementHub({ engine: { state: {} } })) }
    const first = render()
    first.find(node => node.type === 'button' && node.props.title === tr('ui.Announcements.001'))!.props.onClick()
    const items = render().filter(node => String(node.props.className ?? '').split(' ').includes('app-ann-item'))
    expect(items).toHaveLength(ANNOUNCEMENTS.length)
    for (const [index, release] of releases.entries()) {
      const item = items[index]!
      expect(text(item)).toContain(release.title[language])
      expect(text(item)).toContain('2026-10-09')
      expect(nodes(item).filter(node => node.type === 'li').map(text)).toEqual(section(release.heading, language))
    }
    expect(seen.get('whale-idle:announce-seen')).toBe(ANNOUNCEMENTS[0]!.id)
  })
})
