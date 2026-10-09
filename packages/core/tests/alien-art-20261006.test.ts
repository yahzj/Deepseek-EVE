import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

let assets: { ships: Record<string, string>; mounts: Record<string, { muzzles: { x: number; y: number }[] }>; drone: { svg: string; slots: unknown[] }; playerDrone: { svg: string; slots: unknown[]; bolt: unknown } }
beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup as render} from 'react-dom/server';
      import {FOE_SHIP_ART} from './apps/desktop/src/renderer/src/ui/shipArtFoe';
      import {FOE_SHIP_MOUNTS} from './apps/desktop/src/renderer/src/ui/shipMounts';
      import {droneModelOf} from './apps/desktop/src/renderer/src/ui/droneArt';
      export const ships=Object.fromEntries(Object.entries(FOE_SHIP_ART).map(([id,art])=>[id,render(React.createElement('svg',{viewBox:'0 0 240 110'},art))]));
      export const mounts=FOE_SHIP_MOUNTS;const model=droneModelOf('foe-drone-c-jawclaw');export const drone={svg:render(React.createElement('svg',{},model.art)),slots:model.slots};
      const player=droneModelOf('drone-jawclaw');export const playerDrone={svg:render(React.createElement('svg',{},player.art)),slots:player.slots,bolt:player.bolt};`,
      resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom/server'],
    plugins: [{ name: 'test-locale', setup(api) { api.onLoad({ filter: /[\\/]i18n[\\/]locale\.tsx$/ }, () => ({ contents: "export const tr=(id)=>id;export const isEn=()=>false;", loader: 'js' })) } }],
  })
  const output = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, { module: output, exports: output.exports, require: createRequire(import.meta.url) })
  assets = output.exports as typeof assets
})

describe('新异形资产真实表覆盖', () => {
  it('四舰独立SVG可渲染，挂点数量按炮数登记', () => {
    const rendered: string[] = []
    for (const [id, guns] of [['foe-alien-acid-burster', 1], ['foe-alien-brood-worker', 4], ['foe-alien-hiveback', 1], ['foe-alien-broodmother', 2]] as const) {
      const text = assets.ships[id]!
      expect(text).toBeDefined()
      expect(text).toContain('<path')
      expect(text).not.toMatch(/NaN|undefined/)
      expect(assets.mounts[id]!.muzzles).toHaveLength(guns)
      for (const p of assets.mounts[id]!.muzzles) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(240)
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(110)
      }
      rendered.push(text)
    }
    expect(new Set(rendered).size).toBe(4)
  })
  it('颚钳机型有独立机体、阵位和动能弹点形制', () => {
    const model = assets.drone
    expect(model).toBeDefined()
    expect(model.slots.length).toBeGreaterThan(0)
    expect(model.svg).toContain('<path')
    expect(assets.playerDrone.svg).toBe(model.svg)
    expect(assets.playerDrone.slots).toEqual(model.slots)
    expect(assets.playerDrone.bolt).toMatchObject({ style: 'dot', len: 8, width: 1.8, tail: false })
  })
})
