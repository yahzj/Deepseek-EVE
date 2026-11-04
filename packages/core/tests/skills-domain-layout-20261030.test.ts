import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SKILLS, SKILL_BRANCHES, SKILL_GROUPS, SKILL_TREE_POSITIONS, buildSkillCatalog } from '@whale/data'
import { COMMAND_SKILLS } from '../src/combat/command/rules'
import { COMMAND_SKILL_DEFS } from '../../data/src/skills/command'
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

  it('技能目录数量、ID顺序、分支和大类清单保持稳定', () => {
    expect(SKILLS).toHaveLength(122)
    expect(SKILL_GROUPS).toEqual(['舰船', '工业', '矿业', '战斗', '工程', '贸易', '探索', '物流'])
    expect(SKILL_BRANCHES).toHaveLength(28)
    expect([...buildSkillCatalog().values()]).toEqual(SKILLS)
    expect(SKILL_TREE_POSITIONS).toEqual({ 'armed-ops': { x: 432, y: 52 } })
    // 只排除获批的新增编队技能与归类变化，原119项技能的内容及顺序仍受固定快照保护。
    const legacySkills = SKILLS.filter(skill => skill.branch !== 'b-command')
      .map(skill => skill.branch === 'b-warship' ? { ...skill, group: '战斗' } : skill)
    const legacyBranches = SKILL_BRANCHES.filter(branch => !['b-warship', 'b-command'].includes(branch.id))
    legacyBranches.splice(legacyBranches.findIndex(branch => branch.id === 'b-protect'), 0, { id: 'b-warship', group: '战斗' })
    expect(hash(legacySkills)).toBe('9e31ea169e62f1f2eb24ce8777a5585aa32a417e27a5f2c677f4385a3d7522b6')
    expect(hash(legacyBranches)).toBe('94b025b29c3edba3e5fcceea74555c4bd5b829f23f097dd2b39fab1ba01b3eef')
    expect(hash(SKILL_GROUPS)).toBe('b2bc8c42d3da771d62fe8e1f7674a64794e9df83be89e1de5f0d8d2d120a6509')
  })

  it('编队指挥与战舰操作技能归入舰船大类，其他战斗技能仍归战斗', () => {
    const shipOperationIds = [
      'armed-ops', 'armored-ops', 'frigate-ops', 'destroyer-ops', 'cruiser-ops', 'battleship-ops',
      'fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration',
    ]
    for (const branchId of ['b-warship', 'b-command']) {
      expect(SKILL_BRANCHES.find(branch => branch.id === branchId)?.group).toBe('舰船')
      expect(SKILLS.filter(skill => skill.branch === branchId).every(skill => skill.group === '舰船')).toBe(true)
    }
    for (const id of shipOperationIds) expect(buildSkillCatalog().get(id)?.group).toBe('舰船')
    expect(SKILLS.filter(skill => ['b-weapon', 'b-aim', 'b-ammo', 'b-drone'].includes(skill.branch ?? '')).every(skill => skill.group === '战斗')).toBe(true)
  })

  it('Excel静态回写文件与配置生成技能分别覆盖目录且不重复', () => {
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
    const generatedIds = COMMAND_SKILLS.map(skill => skill.id)
    expect(generatedIds).toEqual(['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration'])
    expect(COMMAND_SKILL_DEFS.map(skill => skill.id)).toEqual(generatedIds)
    expect(ids).toEqual(SKILLS.filter(def => !generatedIds.includes(def.id)).map(def => def.id))
    expect(new Set([...ids, ...generatedIds]).size).toBe(SKILLS.length)
    expect(COMMAND_SKILL_DEFS).toEqual(SKILLS.filter(def => generatedIds.includes(def.id)))
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
