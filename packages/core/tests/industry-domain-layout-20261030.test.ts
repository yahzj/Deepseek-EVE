import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as facade from '../src/industry'
import * as manufacturing from '../src/manufacturing'
import * as params from '../src/industry/refining/params'
import * as refiningView from '../src/industry/refining/view'
import * as refiningStart from '../src/industry/refining/start'
import * as refiningAdvance from '../src/industry/refining/advance'
import * as blueprints from '../src/industry/manufacturing/blueprints'
import * as materials from '../src/industry/manufacturing/materials'
import * as duration from '../src/industry/manufacturing/duration'
import * as start from '../src/industry/manufacturing/start'
import * as advance from '../src/industry/manufacturing/advance'
import { readImplementation } from '../../../tools/source-implementation'
import { ROOT } from './helpers/save-shell'

describe('工业域目录与旧路径兼容', () => {
  it('公开符号保持同一函数/常量身份，源码契约能跟随旧入口', () => {
    for (const [entry, modules] of [[facade, [params, refiningView, refiningStart, refiningAdvance]],
      [manufacturing, [blueprints, materials, duration, start, advance]]] as const) {
      for (const module of modules) for (const key of Object.keys(entry)) {
        if (key in module) expect(entry[key as keyof typeof entry]).toBe((module as Record<string, unknown>)[key])
      }
    }
    expect(readImplementation(resolve(ROOT, 'packages/core/src/industry.ts'))).toContain('function advanceRefining')
    expect(readImplementation(resolve(ROOT, 'packages/core/src/manufacturing.ts'))).toContain('function spendMaterialsFor')
  })

  it('五个旧入口只有具名出口，新实现文件不超过800行', () => {
    for (const file of ['packages/core/src/industry.ts', 'packages/core/src/manufacturing.ts',
      'apps/desktop/src/renderer/src/pages/IndustryPage.tsx', 'apps/desktop/src/renderer/src/pages/IndustryHudPage.tsx',
      'apps/desktop/src/renderer/src/panels/Industry.tsx']) {
      const ast = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      expect(ast.statements.length).toBeGreaterThan(0)
      expect(ast.statements.every(ts.isExportDeclaration), file).toBe(true)
    }
    for (const dir of ['packages/core/src/industry', 'apps/desktop/src/renderer/src/features/industry']) {
      for (const name of readdirSync(resolve(ROOT, dir), { recursive: true }).map(String).filter(n => /\.tsx?$/.test(n))) {
        const file = resolve(ROOT, dir, name)
        expect(readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).length, file).toBeLessThanOrEqual(800)
      }
    }
  })
})
