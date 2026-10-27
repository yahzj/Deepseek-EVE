import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { shipSlotsOf, shipCategoryKeyOf, signalSpaceTextId, wormholeScanBonusOf } from '../src/index'
import type { ShipDef } from '../src/types'
import { ROOT } from './helpers/save-shell'

function renderer(locale: 'zh' | 'en') {
  const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/i18n/locale.tsx'), 'utf8')
  const exports = {} as { tr: (id: string, params?: Record<string, string | number>) => string }
  const mocks: Record<string, unknown> = {
    react: { createContext: () => ({}) }, '@whale/data': { L10N, l10nEntryText }, '@whale/core': { signalSpaceTextId },
  }
  runInNewContext(ts.transpileModule(source, { fileName: 'locale.tsx', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText, { exports, require: (id: string) => mocks[id], localStorage: { getItem: () => locale }, navigator: { language: locale } })
  const ast = ts.createSourceFile('shipInfo.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/features/ships/info/shipLines.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'shipInfoLines')!
  const scope = { exports: {} as { shipInfoLines: (ship: ShipDef) => Array<{ k: string; v: string }> },
    tr: exports.tr, fmt: String, pct: (value: number) => `${Math.round(value * 100)}%`,
    shipRoleText: () => '', shipSubClassText: () => '', shipCategoryKeyOf, shipTierText: () => '',
    DMG_LABEL: {}, shipSlotsOf, resistsText: () => '', slotListText: () => '',
  }
  runInNewContext(ts.transpileModule(fn.getText(ast), { fileName: 'shipInfo.tsx', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText, scope)
  return { tr: exports.tr, shipInfoLines: scope.exports.shipInfoLines }
}

describe('真实映射后的舰船扫描富文本', () => {
  it.each(['zh', 'en'] as const)('%s：全部侦察舰/电子舰实际信息行写明同类取最高，两类相加', locale => {
    const ctx = buildSimContext(locale)
    const view = renderer(locale)
    const ships = [...ctx.ships.values()].filter(ship => ship.wormholeScanRadiusBonus)
    expect(ships.map(ship => ship.id)).toContain('sh-nautilus')
    expect(ships.some(ship => ship.subClass === '电子舰')).toBe(true)
    expect(signalSpaceTextId('ui.shipInfo.125')).toBe('ui.signalSpace.069')
    for (const ship of ships) {
      const bonus = ship.subClass === '侦察舰' ? 2 : 1
      expect(ship.wormholeScanRadiusBonus).toBe(bonus)
      const expected = locale === 'zh'
        ? `信号空间扫描范围 +${bonus} 圈；同类舰船取最高，侦察舰与电子舰可相加`
        : `Signal Space scan range +${bonus} rings; only the highest bonus in each ship class applies, and scout and EW bonuses add together`
      const rows = view.shipInfoLines(ship).map(row => row.v)
      expect(rows.filter(text => text.includes(expected)), ship.id).toHaveLength(1)
      expect(rows.join('|'), ship.id).not.toMatch(/编入队伍即生效、可叠加|as soon as it joins the fleet, and stacks/)
      expect(wormholeScanBonusOf(ctx, [ship.id, `${ship.id}#2`])).toBe(bonus)
    }
  })

  it.each(['zh', 'en'] as const)('%s：队伍扫描提示及信号空间映射提示都不再写无条件叠加', locale => {
    const view = renderer(locale)
    expect(signalSpaceTextId('ui.Wormhole.319')).toBe('ui.signalSpace.097')
    for (const text of [L10N['ui.Wormhole.319']![locale], view.tr('ui.Wormhole.319')]) {
      expect(text).toContain(locale === 'zh' ? '同类舰船取最高，侦察舰与电子舰可相加' : 'only the highest bonus in each ship class applies, and scout and EW bonuses add together')
      expect(text).not.toMatch(/编入队伍即生效、可叠加|they apply as soon as the ship joins and they stack/)
    }
  })
})
