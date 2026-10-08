import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { startBattleFor, battleArcsFor } from '../src/combat'
import { pushBattleFx } from '../src/combatFx'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import * as core from '../src/index'
import * as data from '@whale/data'

const root = new URL('../../../', import.meta.url)
let compiled = ''
beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('apps/desktop/src/renderer/src/panels/BattleScreen.tsx', root))],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'transform',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    banner: { js: "var React = require('react');" }, external: ['react', 'lucide-react', '@whale/core', '@whale/data'],
    plugins: [{ name: 'render-only-shell', setup(builder) {
      builder.onLoad({ filter: /[\\/]i18n[\\/]locale\.tsx$/ }, () => ({ loader: 'js', contents:
        'export const tr=globalThis.__tr; export const futureTr=tr; export const isEn=()=>false; export const cmdText=()=>""; export const mountNamesTextOf=(x)=>x??[]; export const logText=(x)=>x.text??"";' }))
      builder.onLoad({ filter: /[\\/]ui[\\/]Tooltip\.tsx$/ }, () => ({ loader: 'js', contents:
        'export const hoverTipProps=()=>({}); export const TIP_DELAY_MS=500;' }))
      builder.onLoad({ filter: /[\\/]ui[\\/]battleFit\.ts$/ }, () => ({ loader: 'js', contents: 'export const useBattleFit=()=>{};' }))
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: '' }))
    } }],
  })
  compiled = result.outputFiles[0]!.text
})

type Node = { type: unknown; props: Record<string, any>; children: unknown[] }
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('children' in value)) return []
  const node = value as Node
  return [node, ...node.children.flatMap(nodes)]
}
function harness() {
  const slots: any[] = []
  let index = 0, now = 1000
  const react = {
    createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useRef: (value: unknown) => { const at = index++; return slots[at] ??= { current: value } },
    useState: (value: unknown) => { const at = index++; if (!(at in slots)) slots[at] = value; return [slots[at], (v: unknown) => { slots[at] = v }] },
    useMemo: (fn: () => unknown) => { index++; return fn() },
    useEffect: () => { index++ },
  }
  const module = { exports: {} as { BattleScreen: (props: unknown) => unknown } }
  const realRequire = createRequire(import.meta.url)
  runInNewContext(compiled, { module, exports: module.exports,
    __tr: (id: string, params?: Record<string, unknown>) => (L10N[id]?.zh ?? id).replace(/\{(\w+)\}/g, (s, k) => String(params?.[k] ?? s)),
    performance: { now: () => now }, console,
    require: (id: string) => id === 'react' ? react : id === '@whale/core' ? core : id === '@whale/data' ? data
      : id === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : realRequire(id),
  })
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 19 })
  state.shipId = addShipToFleet(state, 'sh-nautilus')
  const engine = { state, ctx, wormholeSpeedActive: () => 1, wormholeSpeedOptions: () => [] }
  const open = (startMs: number) => {
    const b = startBattleFor(engine.state, ctx, state.shipId, 'ano-training', startMs, 1000)!
    b.lastTickGameMs = startMs + 1000
    engine.state.expedition = { ...engine.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    return b
  }
  const render = () => {
    index = 0
    now += 10
    const tree = nodes(module.exports.BattleScreen({ engine, onToast: () => {}, onClose: () => {} }))
    expect(tree.some(n => String(n.props.className ?? '').includes('app-battle-screen'))).toBe(true)
    return tree
  }
  const bolts = (tree: Node[]) => tree.filter(n => String(n.props.className ?? '').split(' ').includes('app-bts-bolt'))
  return { engine, ctx, open, render, bolts }
}

describe('实际战场渲染链换场与读档', () => {
  it('同一组件旧游标999→新场seq0仍产生弹道，旧弹道不串场', () => {
    const h = harness(), old = h.open(0)
    old.fxSeq = 999
    pushBattleFx(old, { atMs: 1000, side: 'me', tag: 'player', to: 'foe-0', type: 'kinetic', src: 'turret', hit: true })
    const oldTree = h.render()
    expect(h.bolts(oldTree)).toHaveLength(1)
    const fresh = h.open(5000)
    pushBattleFx(fresh, { atMs: 6000, side: 'me', tag: 'player', to: 'foe-0', type: 'plasma', src: 'laser', hit: true })
    const shots = h.bolts(h.render())
    expect(shots).toHaveLength(1)
    expect(shots[0]!.props.className).toContain('is-plasma')
    expect(shots[0]!.props.className).not.toContain('is-kinetic')
  })
  it('同场重载序号重排后继续产生新弹道，陈旧历史不重放', () => {
    const h = harness(), b = h.open(0)
    b.fxSeq = 999
    pushBattleFx(b, { atMs: 1000, side: 'me', tag: 'player', to: 'foe-0', type: 'kinetic', src: 'turret', hit: true })
    expect(h.bolts(h.render())).toHaveLength(1)
    h.engine.state = loadSaveFile(serializeSaveFile(h.engine.state, 0)).state
    const back = h.engine.state.expedition.battle!
    back.lastTickGameMs = 2000
    pushBattleFx(back, { atMs: 2000, side: 'foe', tag: 'foe-0', to: 'player', type: 'explosive', src: 'turret', hit: true })
    const shots = h.bolts(h.render())
    expect(shots).toHaveLength(1)
    expect(shots[0]!.props.className).toContain('is-explosive')
  })
  it('新机未放飞不画机群，出击数由真实core视图提供', () => {
    const h = harness()
    h.engine.state.fleet[h.engine.state.shipId]!.droneLoad = { 'drone-scout': 2 }
    const b = h.open(0)
    const view = battleArcsFor(h.engine.state, h.ctx)!
    expect(view.myUnits[0]!.drones[0]).toMatchObject({ count: 2, deployed: 0 })
    expect(h.render().filter(n => String(n.props.className ?? '').includes('app-bts-drone-wing'))).toHaveLength(0)
    for (const pool of Object.values(b.dronePools!)) pool.launched = true
    expect(battleArcsFor(h.engine.state, h.ctx)!.myUnits[0]!.drones[0]!.deployed).toBe(2)
  })
  it('紧凑界面保持同源演出单点，复位在舰位计算之前', () => {
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/panels/BattleScreen.tsx', root), 'utf8')
    expect(source.indexOf('battleFxArrivals(fxCursorRef.current, battle)')).toBeLessThan(source.indexOf('const foeAliveTags'))
    expect(source).toContain('droneSortieRef.current.clear()')
    expect(source).toContain('blinkRef.current.clear()')
    expect(source).toContain('popupsRef.current = []')
    expect(source).not.toContain('{arcs.me.map((w, wi) => (')
  })
})
