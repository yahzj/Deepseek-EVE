import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildSimContext, L10N, l10nEntryText, EN_ITEMS, ITEMS, overlayList } from '@whale/data'
import { createInitialState } from '../src/state'
import { useSynapticAccelerant } from '../src/consumables'
import { SYNAPTIC_ACCELERANT_MS } from '../src/training'
import { deferredL10nIssues } from '../../../tools/l10n-deferred-check'

const root = new URL('../../../', import.meta.url)
const copy = 'item.synaptic.001'

describe('突触加速剂已批准中文与延期英文', () => {
  it('实际目录与界面覆盖说明统一，英文未准备时回退新中文而非旧禁用规则', () => {
    const want = '技能训练加速消耗品，每枚增加24小时有效时间；可重复使用，训练速度倍率不叠加。可在物品、货仓或技能加速窗口使用，自动续用需另行开启。'
    expect(L10N[copy]!.zh).toBe(want)
    expect(L10N[copy]).toMatchObject({ en: '', enDeferred: true })
    for (const locale of ['zh', 'en'] as const) expect(buildSimContext(locale).items.get('synaptic-accelerant')!.description).toBe(want)
    expect(overlayList(ITEMS, EN_ITEMS, 'en').find(i => i.id === 'synaptic-accelerant')!.description).toBe(want)
    expect(want).toContain(String(SYNAPTIC_ACCELERANT_MS / 3_600_000))
  })
  it('三处使用入口不再引用旧限制，成功提示与有效时间累加一致', () => {
    for (const page of ['ItemsPage', 'CargoPage', 'SkillsTreePage']) {
      const source = readFileSync(new URL(`apps/desktop/src/renderer/src/pages/${page}.tsx`, root), 'utf8')
      expect(source).not.toMatch(/tr\(['"]ui\.ItemsPage\.05[45]['"]\)/)
      expect(source).toContain("tr('ui.boost.012')")
      expect(source).toContain("tr('ui.boost.013')")
    }
    expect(L10N['ui.boost.012']!.zh).toBe('使用：技能加速有效时间增加24小时，倍率不叠加')
    expect(l10nEntryText(L10N['ui.boost.013']!, 'en')).toBe('突触加速剂已使用：有效时间增加24小时。')
    const s = createInitialState({ nowWallMs: 0, seed: 9 })
    s.warehouse.items['synaptic-accelerant'] = 2
    useSynapticAccelerant(s)
    s.gameMs = 10_000
    useSynapticAccelerant(s)
    const log = s.logs.at(-1)!
    expect(log.textId).toBe('core.consumable.017')
    expect(log.text).toBe(L10N[log.textId!]!.zh.replace('{p1}', '24'))
    expect(s.skillBoostUntilMs).toBe(2 * SYNAPTIC_ACCELERANT_MS)
  })
  it('全部新条目与待译台账成对，已有英文逐字保留，不复用旧预警英文', () => {
    const old = execFileSync('git', ['show', 'd32bf55b:packages/data/src/l10n/table.ts'], { cwd: root, encoding: 'utf8', windowsHide: true })
    const scope = { exports: {} as { L10N: typeof L10N } }
    runInNewContext(ts.transpileModule(old, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
    for (const [id, row] of Object.entries(scope.exports.L10N)) expect(L10N[id], id).toEqual(row)
    const backlog = readFileSync(new URL('docs/l10n-pending.md', root), 'utf8')
    expect(deferredL10nIssues(L10N, backlog)).toEqual([])
    for (const id of [copy, 'ui.boost.012', 'ui.boost.013', 'core.consumable.017', ...[1, 2, 3, 4, 5].map(n => `ui.battleAmmo.00${n}`)]) {
      expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
      expect(backlog).toContain(`| \`${id}\` |`)
    }
  })
})
