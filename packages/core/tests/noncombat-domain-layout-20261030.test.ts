import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as publicRules from '../src/achievements'
import * as rules from '../src/achievements/rules'
import * as publicCatalog from '../../data/src/achievements'
import * as catalog from '../../data/src/achievements/catalog'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

const renderer = resolve(ROOT, 'apps/desktop/src/renderer/src')
const desktopRequire = createRequire(resolve(ROOT, 'apps/desktop/package.json'))
const React = desktopRequire('react') as typeof import('react')
const { renderToStaticMarkup } = desktopRequire('react-dom/server') as typeof import('react-dom/server')

function renderModules(locale: 'zh' | 'en') {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const format = (id: string, params?: Record<string, unknown>) =>
    (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (whole, key: string) => String(params?.[key] ?? whole))
  function load(file: string): Record<string, unknown> {
    const known = cache.get(file)
    if (known) return known.exports
    const module = { exports: {} }
    cache.set(file, module)
    const output = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    runInNewContext(output, {
      module, exports: module.exports,
      require: (id: string): unknown => {
        if (id === '@whale/core') return core
        if (id === '@whale/ui') return { Panel: ({ children, title, right, className }: {
          children: import('react').ReactNode; title: string; right: import('react').ReactNode; className: string
        }) => React.createElement('section', { className }, title, right, children) }
        if (!id.startsWith('.')) return desktopRequire(id)
        const target = resolve(dirname(file), id)
        if (target === resolve(renderer, 'ui/Glyphs')) return { Glyph: () => React.createElement('span', { 'data-glyph': true }) }
        if (target === resolve(renderer, 'ui/Tooltip')) return { hoverTipProps: () => ({}) }
        if (target === resolve(renderer, 'i18n/locale')) return { tr: format }
        if (target === resolve(renderer, 'i18n/fmt')) return { fmtDuration: (ms: number) => `${ms}ms` }
        if (!target.startsWith(renderer + sep)) throw new Error('组件加载越界')
        return load(target + '.tsx')
      },
    }, { timeout: 2000 })
    return module.exports
  }
  return { load, format }
}

describe('非战斗功能域第一批：成就', () => {
  it('公开入口保留原函数和目录对象身份，域实现没有复制', () => {
    for (const name of Object.keys(rules) as Array<keyof typeof rules>) expect(publicRules[name], name).toBe(rules[name])
    expect(publicCatalog.ACHIEVEMENTS).toBe(catalog.ACHIEVEMENTS)
    expect(publicCatalog.achievementOf).toBe(catalog.achievementOf)
    expect(publicCatalog.achievementsOfChain).toBe(catalog.achievementsOfChain)
    expect(core.advanceAchievements).toBe(rules.advanceAchievements)
  })

  it('已迁移成就实现每份不超过800行，旧路径只转导出', () => {
    for (const directory of ['packages/core/src/achievements', 'packages/data/src/achievements',
      'apps/desktop/src/renderer/src/features/achievements']) {
      for (const name of readdirSync(resolve(ROOT, directory))) {
        const file = resolve(ROOT, directory, name)
        const source = readFileSync(file, 'utf8')
        expect(source.trimEnd().split(/\r?\n/).length, relative(ROOT, file)).toBeLessThanOrEqual(800)
      }
    }
    for (const file of ['packages/core/src/achievements.ts', 'packages/data/src/achievements.ts',
      'apps/desktop/src/renderer/src/pages/AchievementsPage.tsx', 'apps/desktop/src/renderer/src/panels/Achievements.tsx']) {
      const source = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      expect(source.statements.length, file).toBe(1)
      expect(ts.isExportDeclaration(source.statements[0]!), file).toBe(true)
    }
  })

  it.each(['zh', 'en'] as const)('%s实际页面保留顺序、隐藏规则、已获得状态与只读渲染', locale => {
    const { load, format } = renderModules(locale)
    const entry = load(resolve(renderer, 'pages/AchievementsPage.tsx'))
    const actual = load(resolve(renderer, 'features/achievements/AchievementsPage.tsx'))
    const panel = load(resolve(renderer, 'panels/Achievements.tsx'))
    expect(entry.AchievementsPage).toBe(actual.AchievementsPage)
    expect(panel.Achievements).toBe(load(resolve(renderer, 'features/achievements/Achievements.tsx')).Achievements)
    const state = core.createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = buildSimContext(locale)
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 1200
    rules.advanceAchievements(state, ctx.achievements, 5000)
    const before = structuredClone(state)
    const page = entry.AchievementsPage as import('react').ComponentType<{ engine: unknown }>
    const html = renderToStaticMarkup(React.createElement(page, { engine: { state, ctx } }))
    const visible = rules.achievementOverview(state, ctx.achievements)
    expect(html.match(/class="app-ach-badge(?: is-earned)?"/g)).toHaveLength(visible.length)
    expect(html.match(/class="app-ach-badge is-earned"/g)).toHaveLength(rules.achievementCount(state))
    const names = [...html.matchAll(/class="app-ach-name">([^<]*)<\/span>/g)].map(match => match[1])
    expect(names).toEqual(visible.map(row => row.def.name))
    expect(visible.every(row => !row.def.hidden)).toBe(true)
    expect(html).toContain(format('ui.Achievements.004'))
    expect(html).toContain('page-stack page-fill')
    expect(html).toContain('is-fill win-fixed-body')
    expect(state).toEqual(before)
  })
})
