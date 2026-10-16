import { beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

let rendered: Record<string, { svg: string; points: { engines: Array<{x:number;y:number}>; muzzles: Array<{x:number;y:number}> }; effects: string[] }>
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup as render}from'react-dom/server';
    import{FOE_SHIP_ART}from'./apps/desktop/src/renderer/src/ui/shipArtFoe';
    import{FOE_SHIP_MOUNTS}from'./apps/desktop/src/renderer/src/ui/shipMounts';
    import{foeBriefLinesOfShip}from'./apps/desktop/src/renderer/src/ui/foeBrief';
    import{FOE_SHIPS}from'@whale/data';
    export const data=Object.fromEntries(FOE_SHIPS.filter(s=>s.id.startsWith('foe-d-invasion-')).map(s=>[s.id,{
      svg:render(React.createElement('svg',{viewBox:'0 0 240 110'},FOE_SHIP_ART[s.id])),points:FOE_SHIP_MOUNTS[s.id],effects:foeBriefLinesOfShip(s).mounts.map(m=>m.effect)}]));`,
    resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader:'tsx' }, bundle:true,write:false,platform:'node',format:'cjs',
    external:['react','react-dom/server'],plugins:[{name:'locale',setup(api){api.onLoad({filter:/[\\/]i18n[\\/]locale\.tsx$/},()=>({contents:"export const tr=(id)=>id;export const isEn=()=>false;",loader:'js'}))}}] })
  const mod={exports:{}}
  runInNewContext(bundle.outputFiles[0]!.text,{module:mod,exports:mod.exports,require:createRequire(import.meta.url)})
  rendered=(mod.exports as {data:typeof rendered}).data
})
it('四舰独立线稿、坐标边界与发动机/炮口挂点齐备，特殊机制悬停可达',()=>{
  expect(Object.keys(rendered)).toHaveLength(4)
  const shapes=[]
  for(const row of Object.values(rendered)) {
    expect(row.svg).toContain('<path')
    expect(row.svg).not.toMatch(/NaN|undefined/)
    expect(row.points.engines.length).toBeGreaterThan(0)
    expect(row.points.muzzles.length).toBeGreaterThan(0)
    for(const point of [...row.points.engines,...row.points.muzzles]) {
      expect(point.x).toBeGreaterThanOrEqual(0);expect(point.x).toBeLessThanOrEqual(240)
      expect(point.y).toBeGreaterThanOrEqual(0);expect(point.y).toBeLessThanOrEqual(110)
    }
    expect(row.effects.length).toBeGreaterThan(0)
    expect(row.effects.every(s=>s.startsWith('ui.gravekeeper.'))).toBe(true)
    shapes.push(row.svg)
  }
  expect(new Set(shapes).size).toBe(4)
})
