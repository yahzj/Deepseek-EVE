import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { L10N } from '../../data/src/l10n/table'

const root = resolve(__dirname, '../../..')
const text = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('酸液仅装甲减抗现行说明接线', () => {
  it('玩家装备说明与规格、爆虫说明与战场提示只描述装甲减抗', () => {
    expect(buildSimContext().modules.get('mod-alien-acid-launcher')!.description).toBe(L10N['mod.alienLoot.002']!.zh)
    for (const id of ['mod.alienLoot.002', 'ui.alienLoot.002', 'ui.alienArmor.001', 'ui.alienArmor.002']) {
      const row = L10N[id]!
      expect(row.zh).toContain('装甲')
      expect(row.zh).not.toContain('结构')
      expect(row.en).toBe('')
      expect(row.enDeferred).toBe(true)
    }
    expect(text('apps/desktop/src/renderer/src/ui/foeBrief.ts')).toContain("tr('ui.alienArmor.001'")
    expect(text('apps/desktop/src/renderer/src/panels/BattleScreen.tsx')).toContain("tr('ui.alienArmor.002'")
    expect(text('apps/desktop/src/renderer/src/ui/shipInfo.tsx')).toContain("tr('ui.alienLoot.002'")
  })

  it('旧英文和历史公告不追改，新说明登记待译', () => {
    expect(L10N['ui.alien.001']!.en).toContain('armor and hull')
    expect(L10N['ui.alien.004']!.en).toContain('armor and hull')
    expect(L10N['ano.incursionRelease.004']!.zh).toContain('装甲、结构')
    expect(L10N['ano.incursionBrief.001']!.zh).toContain('装甲与结构')
    const pending = text('docs/l10n-pending.md')
    for (const id of ['ui.alienArmor.001', 'ui.alienArmor.002']) expect(pending).toContain(id)
  })
})
