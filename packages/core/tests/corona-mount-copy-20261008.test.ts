import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, L10N } from '@whale/data'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import type { FoeShipDef } from '../src/types'

// 沿用导弹残段文案测试的真实源码执行夹具，不把界面编译配置带进核心包。
function renderer(locale: 'zh' | 'en') {
  const scope: Record<string, unknown> = {
    exports: {}, L10N, FOE_MOUNTS, WEB_BREAK_DIST_M: 4500, signalSpaceTextId: (id: string) => id,
    localStorage: { getItem: () => locale }, navigator: { language: locale }, createContext: () => ({ Provider: 'Provider' }),
  }
  const execute = (path: string) => {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const code = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
    runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  }
  execute('apps/desktop/src/renderer/src/i18n/locale.tsx')
  const localize = scope.exports as Record<string, unknown>
  scope.tr = localize.tr
  scope.isEn = localize.isEn
  execute('apps/desktop/src/renderer/src/ui/foeBrief.ts')
  return scope.exports as {
    mountEffectText: (id: string) => string | null
    mountEffectTextByName: (name: string) => string | null
    foeBriefLinesOfShip: (ship: FoeShipDef) => { mounts: Array<{ name: string; effect: string }> }
  }
}

describe('光环四件说明共用出口', () => {
  it.each(['zh', 'en'] as const)('%s说明逐字匹配已审稿，没有漏参', locale => {
    const ui = renderer(locale)
    const cases = [
      [FOE_MOUNT_IDS.coronaStandbyShield, '待机护盾阵列', 'ui.foeIntro.112', { p1: 50, p2: 1 }],
      [FOE_MOUNT_IDS.coronaFocusArray, '聚焦阵列', 'ui.foeIntro.113', { p1: 120, p2: 200, p3: 200 }],
      [FOE_MOUNT_IDS.coronaOverlayDrive, '叠光装置', 'ui.foeIntro.115', { p1: 0.4, p2: 0.5, p3: 0.3 }],
      [FOE_MOUNT_IDS.coronaOverlayBeacon, '叠光支援信标', 'ui.foeIntro.116', { p1: 60 }],
    ] as const
    for (const [id, name, textId, params] of cases) {
      const expected = L10N[textId]![locale].replace(/\{(\w+)\}/g, (_, key: string) => String((params as Record<string, number>)[key]))
      expect(ui.mountEffectText(id)).toBe(expected)
      expect(ui.mountEffectTextByName(name)).toBe(expected)
      expect(expected).not.toMatch(/\{p\d+\}|undefined/)
    }
    for (const shipId of ['foe-r-corona-nexus', 'foe-r-corona-overlay', 'foe-r-corona-dusk']) {
      const ship = FOE_SHIPS.find(s => s.id === shipId)!
      const lines = ui.foeBriefLinesOfShip(ship)
      expect(lines!.mounts).toHaveLength(ship.mounts!.length)
      expect(lines!.mounts.every(mount => mount.effect.length > 0)).toBe(true)
    }
  })
})
