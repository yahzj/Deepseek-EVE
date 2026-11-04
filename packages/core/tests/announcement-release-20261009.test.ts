import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ANNOUNCEMENTS, L10N, l10nEntryText } from '@whale/data'
import { MECHANICS_APPROVED_ZH } from './fixtures/announcement-mechanics-brief-20261009'
import { INCURSION_APPROVED_BRIEF, INCURSION_APPROVED_LOOT } from './fixtures/announcement-incursion-brief-20261009'
import { weekendFamilyForWindow } from '../src/weekendEvent'
import { approvedMk1CopyDelta } from './helpers/approved-mk1-copy-delta'

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
function expectedIncursion(language: 'zh' | 'en') {
  const original = section(releases[0]!.heading, language)
  return [original[0]!, ...INCURSION_APPROVED_BRIEF, INCURSION_APPROVED_LOOT]
}
const releases = [
  { id: 'ann-alien-invasion-20261007', heading: '## 二、公告一：异形虫群入侵',
    title: { zh: '异形虫群入侵', en: 'Alien Swarm Incursion' }, tag: { zh: '内容', en: 'Content' } },
  { id: 'ann-balance-mechanics-summary-20261008', heading: '## 三、公告二：数据调整与新增机制',
    title: { zh: '数据调整与新增机制', en: 'Balance Changes and New Mechanics' }, tag: { zh: '系统', en: 'System' } },
]
const currentReleases = [
  { id: 'ann-equipment-retune-20261019', prefix: 'ano.equipmentRetune', title: { zh: '装备与说明调整', en: 'Equipment and Description Updates' }, bullets: [
    '跃迁规避装置更名为短距离跃迁装置，调整为中槽战斗支援件，不再触发推进器对隐秘行动的限制；多件安装仍只采用一件效果。',
    '掠袭者护盾笼CPU占用由46降至36。',
    '酸液喷吐器射程调整为2500米、装填间隔为3.8秒；命中后每层降低目标装甲全抗性5%，持续15秒，加法叠加、独立到期。',
    '磁轨蓄能说明明确为按本炮单发伤害附加能量伤害；每次开火后比例+30%、装填间隔+10%，最多5层，加法累计。',
    '装备叠加说明按实际规则修正，部分当前战斗提示改用%，近盲说明移除自伤备注。',
  ] },
  { id: 'ann-depth-damage-retune-20261019', prefix: 'ano.depthRetune', title: { zh: '信号空间资源与战损调整', en: 'Signal Space Resources and Damage Mods' }, bullets: [
    '玩家探索信号空间时，每深入一层，矿脉与墓场普通残骸各增加一堆。',
    '信号空间单堆资源仍随层数增加，每层增幅由20%降至8%；自动探索同步调整。',
    '舰船战损插件每件属性减幅由15%降至5%，允许同种重复获得，按剩余属性乘算叠加，不设件数上限。',
  ] },
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
  it.each(currentReleases)('$id采用10月19日批准稿，正文双语完整且不列敌方数值', release => {
    const row = ANNOUNCEMENTS.find(row => row.id === release.id)!
    expect(row.bullets).toEqual(release.bullets)
    expect(row.date).toBe('2026-10-19')
    expect(row.title).toBe(release.title.zh)
    expect(row.bulletIds).toEqual(release.bullets.map((_, i) => `${release.prefix}.${String(i + 3).padStart(3, '0')}`))
    expect(row.bullets.join('')).not.toMatch(/永陵|旗舰伤害|主树|回归|验收/)
    for (const id of [row.titleId!, row.tagId!, ...row.bulletIds!]) {
      expect(L10N[id]!.en).toMatch(/[A-Za-z]/)
      expect(L10N[id]!.en).not.toMatch(/[\u3400-\u9fff]|\{\w+\}/)
      expect(L10N[id]!.enDeferred).not.toBe(true)
    }
    expect(ANNOUNCEMENTS.slice(0, 2).map(row => row.id)).toEqual(currentReleases.map(row => row.id))
  })
  it.each(releases)('$id按原获批稿或船长本次短句裁定接线', release => {
    const announcement = ANNOUNCEMENTS.find(row => row.id === release.id)!
    expect(announcement).toBeDefined()
    expect(announcement.date).toBe('2026-10-09')
    const mechanics = release.id === 'ann-balance-mechanics-summary-20261008'
    expect(announcement.bulletIds).toHaveLength(mechanics ? 38 : 5)
    expect(announcement.bullets).toHaveLength(mechanics ? 38 : 5)
    for (const language of ['zh', 'en'] as const) {
      expect(L10N[announcement.titleId!]![language]).toBe(release.title[language])
      expect(L10N[announcement.tagId!]![language]).toBe(release.tag[language])
      const expected = language === 'zh' ? mechanics ? [...MECHANICS_APPROVED_ZH] : expectedIncursion(language)
        : announcement.bulletIds!.map(id => approvedMk1CopyDelta(id, { zh: L10N[id]!.zh, en: '', enDeferred: true }).en)
      expect(announcement.bulletIds!.map(id => l10nEntryText(L10N[id]!, language))).toEqual(expected)
    }
    expect(announcement.title).toBe(L10N[announcement.titleId!]!.zh)
    expect(announcement.tag).toBe(L10N[announcement.tagId!]!.zh)
    expect(announcement.bullets).toEqual(announcement.bulletIds!.map(id => L10N[id]!.zh))
  })
  it('两篇历史发布相邻且正文与后续顺序保持，新公告可在前方新增', () => {
    const source = historical('packages/data/src/announcements.ts')
    const scope = { exports: {} as { ANNOUNCEMENTS: typeof ANNOUNCEMENTS }, require: () => ({ L10N }) }
    runInNewContext(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, scope)
    const first = ANNOUNCEMENTS.findIndex(row => row.id === releases[0]!.id)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(ANNOUNCEMENTS.slice(first, first + 2).map(row => row.id)).toEqual(releases.map(row => row.id))
    expect(JSON.parse(JSON.stringify(ANNOUNCEMENTS.slice(first + 2)))).toEqual(JSON.parse(JSON.stringify(scope.exports.ANNOUNCEMENTS)))
    expect(new Set(ANNOUNCEMENTS.map(row => row.id)).size).toBe(ANNOUNCEMENTS.length)
  })
  it('公告排期对应10月9日20点异形期，未开放内容与UI不混入正文', () => {
    expect(weekendFamilyForWindow(new Date(2026, 9, 9, 20).getTime())).toBe('C')
    const text = releases.flatMap(release => ANNOUNCEMENTS.find(row => row.id === release.id)!.bullets).join('\n')
    expect(text).not.toMatch(/数据编辑器|测试档|待审|待验收|主树|Worker|深空探测机|星球建设|动态星图|CPU插件.*120/)
    expect(text).toContain(INCURSION_APPROVED_BRIEF[0])
    expect(INCURSION_APPROVED_BRIEF.join('')).not.toMatch(/\d|百分|百分点|双倍/)
    expect(text).toContain('只收不卖')
    expect(text).toContain('不再恢复自身')
    expect(text).toContain('10月9日20:00')
  })
  it.each(['zh', 'en'] as const)('%s实际公告组件通过已有按钮显示两篇完整正文，不重写已读状态机制', language => {
    const source = ts.createSourceFile('Announcements.tsx', readFileSync(new URL('apps/desktop/src/renderer/src/panels/Announcements.tsx', root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n')
    const slots: unknown[] = [], seen = new Map([['whale-idle:announce-seen', ANNOUNCEMENTS[0]!.id]])
    let cursor = 0
    const tr = (id: string) => l10nEntryText(L10N[id]!, language)
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
    for (const release of releases) {
      const index = ANNOUNCEMENTS.findIndex(row => row.id === release.id)
      const item = items[index]!
      expect(text(item)).toContain(release.title[language])
      expect(text(item)).toContain('2026-10-09')
      const announcement = ANNOUNCEMENTS[index]!
      const expected = language === 'zh' ? release.id === 'ann-balance-mechanics-summary-20261008' ? [...MECHANICS_APPROVED_ZH] : expectedIncursion(language)
        : announcement.bulletIds!.map(id => approvedMk1CopyDelta(id, { zh: L10N[id]!.zh, en: '', enDeferred: true }).en)
      expect(nodes(item).filter(node => node.type === 'li').map(text)).toEqual(expected)
    }
    for (const release of currentReleases) {
      const index = ANNOUNCEMENTS.findIndex(row => row.id === release.id)
      const row = ANNOUNCEMENTS[index]!, item = items[index]!
      expect(text(item)).toContain(release.title[language])
      expect(nodes(item).filter(node => node.type === 'li').map(text)).toEqual(language === 'zh' ? release.bullets : row.bulletIds!.map(id => L10N[id]!.en))
    }
    expect(seen.get('whale-idle:announce-seen')).toBe(ANNOUNCEMENTS[0]!.id)
  })
})
