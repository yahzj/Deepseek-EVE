import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { L10N, buildSimContext } from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

const renderer = resolve(ROOT, 'apps/desktop/src/renderer/src')
const desktopRequire = createRequire(resolve(ROOT, 'apps/desktop/package.json'))
const React = desktopRequire('react') as typeof import('react')
const { renderToStaticMarkup } = desktopRequire('react-dom/server') as typeof import('react-dom/server')

function loadPlugExchangeBody() {
  const file = resolve(renderer, 'panels/PlugExchange.tsx')
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: (id: string): unknown => {
      if (id === 'react') return React
      if (id === 'react/jsx-runtime') return desktopRequire(id)
      if (id === '@whale/core') return core
      if (id === '../i18n/locale') return {
        tr: (key: string) => L10N[key]?.zh ?? key,
        cmdText: () => '',
      }
      if (id === '../ui/Glyphs') return { Glyph: () => React.createElement('span') }
      if (id === '../ui/tones') return { toneOfAny: () => 'currentColor' }
      if (id === '../ui/shipInfo') return { moduleShortEffect: () => '' }
      if (!id.startsWith('.')) return desktopRequire(id)
      const target = resolve(dirname(file), id)
      if (!target.startsWith(renderer + sep)) throw new Error(`组件加载越界：${id}`)
      throw new Error(`未预期的组件依赖：${id}`)
    },
  }, { timeout: 2000 })
  return module.exports['PlugExchangeBody'] as (props: { engine: unknown; onToast: () => void }) => ReactNode
}

describe('声望商店通用黑匣卡', () => {
  it('插件图纸全部兑换后仍显示通用黑匣购买卡', () => {
    const ctx = buildSimContext('zh')
    const state = core.createInitialState({ nowWallMs: 0, seed: 7 })
    state.standings.dsi = core.UNIVERSAL_BLACKBOX_COST
    state.learnedRecipes = core.plugExchangeRowsOf(state, ctx).map(row => row.blueprintId)

    const html = renderToStaticMarkup(React.createElement(loadPlugExchangeBody(), {
      engine: { state, ctx },
      onToast: () => {},
    }))

    expect(html).toContain(L10N['ui.IndustryPage.137']!.zh)
    expect(html).toContain(L10N['ui.IndustryPage.141']!.zh)
    expect(html).toContain(L10N['ui.IndustryPage.145']!.zh)
    expect(html).toContain(`<button class="app-btn is-small is-primary">${L10N['ui.IndustryPage.145']!.zh}</button>`)
    expect(html.match(/class="app-belt-card app-shelf-card"/g)).toHaveLength(1)
  })
})
