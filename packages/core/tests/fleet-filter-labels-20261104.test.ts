import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/pages/ShipPage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ShipPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'ShipPage')!

function initializer(name: string): string {
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) expression = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(page)
  expect(expression, name).toBeDefined()
  return expression!.getText(ast)
}

const roles = ['industrial', 'hauler', 'armed', 'armored', 'other'].map(key => ({ key }))
const tiers = [1, 2, 3, 4, 5].map(tier => ({ key: `t${tier}` }))

function filters(fleetEntries: Array<{ def: { role: string; tier: number } }>, fleetRole: string, fleetTier: string) {
  const scope = {
    SHIP_DOMAIN_SUBS: roles,
    SHIP_TIER_SUBS: tiers,
    SUB_ALL: '__all__',
    fleetEntries, fleetRole, fleetTier,
    shipRolePasses: (def: { role: string }, role: string) => role === '__all__' || def.role === role,
    shipTierPasses: (def: { tier: number }, tier: string) => tier === '__all__' || `t${def.tier}` === tier,
    fleetRoles: [] as typeof roles,
    fleetTiers: [] as typeof tiers,
    fleetRoleMissing: false,
    fleetTierMissing: false,
  }
  for (const name of ['fleetRoles', 'fleetTiers', 'fleetRoleMissing', 'fleetTierMissing']) {
    runInNewContext(`${name} = ${initializer(name)}`, scope)
  }
  return scope
}

describe('我的舰队完整筛选标签', () => {
  it.each([
    { name: '空舰队', entries: [] },
    { name: '仅有T1采矿舰', entries: [{ def: { role: 'industrial', tier: 1 } }] },
  ])('$name时仍使用完整类别与级别表', ({ entries }) => {
    const view = filters(entries, '__all__', '__all__')
    expect(view.fleetRoles).toBe(roles)
    expect(view.fleetTiers).toBe(tiers)
    expect(source).toContain('fleetRoles.map(')
    expect(source).toContain('fleetTiers.map(')
    expect(source).toContain('FLEET_STATE_TABS.map(')
  })

  it('没有匹配舰船的类别与级别保持选中，不触发缺失重置', () => {
    const view = filters([{ def: { role: 'industrial', tier: 1 } }], 'armored', 't5')
    expect(view.fleetRoleMissing).toBe(false)
    expect(view.fleetTierMissing).toBe(false)
  })

  it('不在完整定义表中的无效筛选值仍会触发缺失重置', () => {
    const view = filters([], 'unknown-role', 't99')
    expect(view.fleetRoleMissing).toBe(true)
    expect(view.fleetTierMissing).toBe(true)
  })
})
