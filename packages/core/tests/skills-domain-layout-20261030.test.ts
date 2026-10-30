import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SKILLS, SKILL_BRANCHES, SKILL_GROUPS, SKILL_TREE_POSITIONS, buildSkillCatalog } from '@whale/data'
import * as publicTraining from '../src/training'
import * as training from '../src/skills/training'
import * as publicLicense from '../src/skillLicense'
import * as license from '../src/skills/license'
import * as publicQueue from '../src/skillQueue'
import * as queue from '../src/skills/queue'
import { tableOf } from '../../../tools/content-schema'
import { readImplementation } from '../../../tools/source-implementation'
import { ROOT } from './helpers/save-shell'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

describe('技能功能域目录与兼容契约', () => {
  it('训练、许可与队列的旧入口保持同一导出身份', () => {
    for (const [before, after] of [[publicTraining, training], [publicLicense, license], [publicQueue, queue]]) {
      for (const name of Object.keys(after)) expect((before as Record<string, unknown>)[name], name).toBe((after as Record<string, unknown>)[name])
    }
    expect(readImplementation(resolve(ROOT, 'packages/core/src/training.ts'))).toContain('function trainingLevelProgress')
    expect(readImplementation(resolve(ROOT, 'packages/core/src/skillQueue.ts'))).toContain('function preexistingUnmet')
  })

  it('已批准纯整理的119条技能、分支与组顺序逐字等价', () => {
    // 本批整理前的固定目录摘要；有意改设计时需明确更新，不能用新实现反算预期值。
    expect(hash(SKILLS)).toBe('9e31ea169e62f1f2eb24ce8777a5585aa32a417e27a5f2c677f4385a3d7522b6')
    expect(hash(SKILL_BRANCHES)).toBe('94b025b29c3edba3e5fcceea74555c4bd5b829f23f097dd2b39fab1ba01b3eef')
    expect(hash(SKILL_GROUPS)).toBe('b2bc8c42d3da771d62fe8e1f7674a64794e9df83be89e1de5f0d8d2d120a6509')
    expect(SKILLS).toHaveLength(119)
    expect([...buildSkillCatalog().values()]).toEqual(SKILLS)
    expect(SKILL_TREE_POSITIONS).toEqual({ 'armed-ops': { x: 432, y: 52 } })
  })

  it('Excel回写登记的文件精确覆盖全部技能且不重复', () => {
    const spec = tableOf('skills')!
    const ids: string[] = []
    for (const file of spec.files) {
      const sf = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node): void {
        if (ts.isObjectLiteralExpression(node)) {
          const id = node.properties.find(n => ts.isPropertyAssignment(n) && n.name.getText(sf) === 'id')
          if (id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) ids.push(id.initializer.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    expect(ids).toEqual(SKILLS.map(def => def.id))
    expect(new Set(ids).size).toBe(SKILLS.length)
  })

  it('本批三个目录全部实现至多800行，旧入口不残留第二份实现', () => {
    for (const dir of ['packages/core/src/skills', 'packages/data/src/skills', 'apps/desktop/src/renderer/src/features/skills']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        const file = `${dir}/${name}`
        expect(readFileSync(resolve(ROOT, file), 'utf8').trimEnd().split(/\r?\n/).length, file).toBeLessThanOrEqual(800)
      }
    }
    for (const file of ['packages/core/src/training.ts', 'packages/core/src/skillLicense.ts', 'packages/core/src/skillQueue.ts',
      'packages/data/src/skills.ts', 'packages/data/src/skillTreePositions.ts', 'apps/desktop/src/renderer/src/pages/SkillsTreePage.tsx',
      'apps/desktop/src/renderer/src/pages/skillShared.tsx', 'apps/desktop/src/renderer/src/ui/skillText.ts', 'apps/desktop/src/renderer/src/ui/skillTreeLayout.ts']) {
      const sf = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      expect(sf.statements.length).toBeGreaterThan(0)
      expect(sf.statements.every(ts.isExportDeclaration), file).toBe(true)
    }
  })
})
