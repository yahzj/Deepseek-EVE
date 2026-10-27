import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as publicCombat from '../src/combat'
import { stepBattle } from '../src/combat/step'
import { firePlayerPhase } from '../src/combat/playerFire'
import { fireEnemyPhase } from '../src/combat/enemyFire'
import { ROOT } from './helpers/save-shell'
import { readImplementation } from '../../../tools/source-implementation'

const domains = [
  'packages/core/src/combat', 'packages/core/src/expedition', 'packages/core/src/encounters',
  'packages/core/src/invasion', 'packages/core/src/ai', 'packages/core/src/ships/fitting',
  'packages/core/src/wormhole/battle', 'packages/core/src/wormhole/foes', 'packages/core/src/persistence',
  'packages/data/src/combat', 'packages/data/src/invasion',
  'apps/desktop/src/renderer/src/features/combat', 'apps/desktop/src/renderer/src/features/ships',
  'apps/desktop/src/renderer/src/features/expedition', 'apps/desktop/src/renderer/src/features/stations',
  'apps/desktop/src/renderer/src/features/transport',
]
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = resolve(dir, e.name)
    return e.isDirectory() ? sources(file) : /\.tsx?$/.test(e.name) ? [file] : []
  })
}

describe('已确认战斗域目录与边界', () => {
  it('已迁移实现按职责分目录，每份文件至多800行', () => {
    const files = domains.flatMap(d => sources(resolve(ROOT, d)))
    expect(files.length).toBeGreaterThan(100)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text.trimEnd().split(/\r?\n/).length, relative(ROOT, file)).toBeLessThanOrEqual(800)
      expect(text, relative(ROOT, file)).not.toMatch(/import\(['"]H:[/\\]/)
    }
  })

  it('公共入口保持原函数身份，内部阶段独立且先玩家后敌人', () => {
    expect(publicCombat.advanceBattleFor).toBeTypeOf('function')
    expect(publicCombat.startBattleFor).toBeTypeOf('function')
    expect(firePlayerPhase).toBeTypeOf('function')
    expect(fireEnemyPhase).toBeTypeOf('function')
    const source = stepBattle.toString()
    expect(source.indexOf('firePlayerPhase(')).toBeGreaterThan(-1)
    expect(source.indexOf('firePlayerPhase(')).toBeLessThan(source.indexOf('fireEnemyPhase('))
    expect(source.indexOf('fireEnemyPhase(')).toBeLessThan(source.indexOf('resolvePointDefense('))
  })

  it('兼容出口源码取证跟随真实实现，不因只读转导出而跳过契约', () => {
    const original = readFileSync(resolve(ROOT, 'packages/core/src/playerSpec.ts'), 'utf8')
    const implementation = readImplementation(resolve(ROOT, 'packages/core/src/playerSpec.ts'))
    expect(original).not.toContain('function createPlayerSpec')
    expect(implementation).toContain('function createPlayerSpec')
    expect(implementation).toContain('refs?.weaponRanges?.push')
    expect(readImplementation(resolve(ROOT, 'packages/core/src/weekendEvent.ts'))).toContain('export const WEEKEND_MIN_STANDING = 40')
  })
})
