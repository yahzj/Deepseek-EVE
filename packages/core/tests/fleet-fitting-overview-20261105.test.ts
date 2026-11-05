import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/combat'
import type { GameState } from '../src/state'
import type { UnitSpec } from '../src/combat/model'

const root = new URL('../../../', import.meta.url)
const ctx = buildSimContext()
let renderSummary: (spec: UnitSpec | null) => string
let renderSelect: (state: GameState, target: string) => string

beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';
      import{buildSimContext}from'@whale/data';
      import{FittingSummary}from'./apps/desktop/src/renderer/src/features/ships/fitting/FittingSummary';
      import{FitTargetSelect}from'./apps/desktop/src/renderer/src/features/ships/fitting/FitTargetSelect';
      const ctx=buildSimContext();export const summary=spec=>renderToStaticMarkup(<FittingSummary spec={spec}/>);
      export const select=(state,value)=>renderToStaticMarkup(<FitTargetSelect state={state} ctx={ctx} value={value} onChange={()=>{}}/>);`,
      resolveDir: fileURLToPath(root), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom/server', 'react/jsx-runtime'],
    plugins: [{ name: 'test-css', setup(api) { api.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })) } }],
  })
  const output = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, { module: output, exports: output.exports,
    require: createRequire(import.meta.url), console, structuredClone, navigator: { language: 'zh-CN' } })
  const view = output.exports as { summary: typeof renderSummary; select: typeof renderSelect }
  renderSummary = view.summary
  renderSelect = view.select
})

describe('舰队统计清理与装配概览', () => {
  it('删除测试统计，不移除完整筛选或全部修理', () => {
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/pages/ShipPage.tsx', root), 'utf8')
    expect(source).not.toMatch(/hud-kpi|ui\.fleetKpi|FLEET CARGO|avgDurabilityPct|totalCargoM3/)
    expect(source).toContain('const fleetRoles = SHIP_DOMAIN_SUBS')
    expect(source).toContain('const fleetTiers = SHIP_TIER_SUBS')
    expect(source).toContain('engine.repairFleetAt()')
    expect(source).toContain('commandBudgetOf(')
  })

  it('指标沿用现有名义火力和三系平均抗性承伤算法', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1105 })
    const id = addShipToFleet(state, 'sh-megalodon')
    state.fleet[id]!.fitted = { high: ['mod-turret-kin-2', 'mod-laser-2'], mid: ['mod-shield-kin-2'], low: ['mod-armor-plate-2'] }
    state.fleet[id]!.droneLoad = { 'drone-scout': 2 }
    const spec = createPlayerSpec(state, ctx, id)!
    const dps = spec.weapons.filter(weapon => weapon.label !== '基础舰炮').reduce((sum, weapon) => {
      const per = weapon.kind === 'gun' ? Object.values(weapon.shotsByType ?? {})[0] ?? 0 : weapon.shotDmg ?? 0
      return sum + per * (weapon.count ?? 1) / Math.max(.1, weapon.reloadMs / 1000)
    }, 0)
    const ehp = (['s', 'a', 'h'] as const).reduce((sum, layer) => {
      const r = spec.resists[layer === 's' ? 'shield' : layer === 'a' ? 'armor' : 'hull'] ?? {}
      const avg = Math.min(.95, ((r.kinetic ?? 0) + (r.explosive ?? 0) + (r.plasma ?? 0)) / 3)
      return sum + Math.round(spec.hp[layer] / Math.max(.05, 1 - avg))
    }, 0)
    const html = renderSummary(spec)
    expect(html).toContain(`>${Math.round(dps).toLocaleString('zh-CN')}</span>`)
    expect(html).toContain(`>${ehp.toLocaleString('zh-CN')}</span>`)
    expect(html).toContain('DPS')
    expect(html).toContain('EHP')
    expect(html).toContain('无人机')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('选船仅显示名字与活动标记，活动项不可选，自定义名和同型编号保留', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1105 })
    const busy = addShipToFleet(state, 'sh-megalodon')
    const twin = addShipToFleet(state, 'sh-megalodon')
    state.fleet[busy]!.customName = '巡航一号'
    state.aiAssignments[busy] = { task: { kind: 'mining' } } as never
    const html = renderSelect(state, state.shipId)
    expect(html).toContain('class="app-select app-fit-target-select"')
    expect(html).toContain(`value="${busy}" disabled="">巡航一号 · 正在活动</option>`)
    expect(html).toContain(`value="${twin}">巨齿鲨级战列舰 #2</option>`)
    expect(html).not.toMatch(/\[当前|\[非主控|\(巨齿鲨|就地切换/)
    delete state.aiAssignments[busy]
    const idleHtml = renderSelect(state, busy)
    expect(idleHtml).toContain(`value="${busy}" selected="">巡航一号</option>`)
    expect(idleHtml).not.toContain('正在活动')
  })

  it('已打开舰开始活动仍只读，弹药与选装UI读取同一门禁', () => {
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/pages/FitPage.tsx', root), 'utf8')
    expect(source).toContain('<FittingSummary spec={spec}')
    expect(source).toContain('<FitTargetSelect state={state}')
    expect(source).toContain('data-fit-activity')
    const ammo = source.slice(source.indexOf('function AmmoTierSection'), source.indexOf('function AmmoTierSection') + 4000)
    expect(ammo).toContain("shipOperationBlockReason(state, ctx, target, 'configure')")
    expect(ammo).toContain('disabled={configurationBlock !== null}')
  })
})
