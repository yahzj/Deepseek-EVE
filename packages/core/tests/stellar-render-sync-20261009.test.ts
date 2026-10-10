import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { jsx, jsxs } from 'react/jsx-runtime'
import { describe, expect, it, vi } from 'vitest'
import { generateStellarSystem } from '../src/stellarGeneration'
import * as motion from '../../../apps/desktop/src/renderer/src/panels/stellarMotion'
import * as geometry from '../../../apps/desktop/src/renderer/src/panels/stellarMapView'

const root = new URL('../../../',import.meta.url)
function layerHarness(adaptive=false) {
  let index=0, pending:Array<()=>void>=[]
  const slots:Array<{value?:any;deps?:any[];cleanup?:()=>void}>=[]
  const callbacks=new Map<number,(time:number)=>void>();let sequence=0
  const renderer={drawPlanet:vi.fn(),drawStar:vi.fn(),dispose:vi.fn()}
  const context=Object.fromEntries(['setTransform','clearRect','drawImage','save','restore','translate','rotate','beginPath','moveTo','lineTo','stroke'].map(name=>[name,vi.fn()]))
  const surface={clientWidth:978,clientHeight:323,width:0,height:0,dataset:{} as Record<string,string>,getContext:()=>context,getClientRects:()=>[{}]}
  const tile=()=>({width:0,height:0,addEventListener:vi.fn(),removeEventListener:vi.fn(),getContext:()=>context})
  const nodes=new Map<string,{setAttribute:ReturnType<typeof vi.fn>;querySelector:ReturnType<typeof vi.fn>}>()
  const system=generateStellarSystem(3).system
  const svg={current:{querySelector:(selector:string)=>{
    if(!nodes.has(selector)) nodes.set(selector,{setAttribute:vi.fn(),querySelector:vi.fn(()=>({setAttribute:vi.fn()}))})
    return nodes.get(selector)
  }}}
  const scope={exports:{} as {StellarMotionLayer:(props:any)=>any},require:(name:string):any=>{
    if(name==='react')return {useRef:(value:any)=>{const at=index++;return slots[at]?.value??(slots[at]={value:{current:value}}).value},useLayoutEffect:(callback:()=>any,deps?:any[])=>{const at=index++,old=slots[at];if(!old?.deps||deps?.some((value,n)=>!Object.is(value,old.deps![n])))pending.push(()=>{old?.cleanup?.();slots[at]={deps,cleanup:callback()}})}}
    if(name==='react/jsx-runtime')return {jsx,jsxs}
    if(name==='./stellarMotion')return motion
    if(name==='./stellarMapView')return geometry
    if(name==='./stellarSceneDraw')return {stellarSceneProjection:(view:any,width:number,height:number)=>{const box=geometry.stellarViewBox(view),scale=Math.min(width/box.width,height/box.height);return {scale,x:(width-box.width*scale)/2-box.x*scale,y:(height-box.height*scale)/2-box.y*scale}}}
    if(name==='../ui/stellarPlanetShader')return {createStellarPlanetRenderer:()=>renderer,stellarMaterialSpan:(kind:string)=>kind==='gas'?3:1,stellarStarSpan:()=>2,stellarTextureSize:(pixels:number,span:number)=>adaptive?Math.ceil(Math.max(64,pixels*1.5)*span/64)*64:128}
    throw Error(name)
  },document:{hidden:false,createElement:tile,addEventListener:vi.fn(),removeEventListener:vi.fn()},window:{devicePixelRatio:1},performance:{now:()=>0},matchMedia:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:(cb:(time:number)=>void)=>{callbacks.set(++sequence,cb);return sequence},cancelAnimationFrame:(id:number)=>callbacks.delete(id)}
  const text=readFileSync(new URL('apps/desktop/src/renderer/src/panels/StellarMotionLayer.tsx',root),'utf8')
  runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,scope)
  let props={system,view:{zoom:1,pan:{x:0,y:0}},svg,radiiOf:()=>Object.fromEntries(system.bodies.map(body=>[body.planetId,18])),unit:1,onReady:vi.fn()}
  const render=(view=props.view)=>{props={...props,view};index=0;const tree=scope.exports.StellarMotionLayer(props);tree.ref.current=surface;for(const run of pending.splice(0))run()}
  render()
  const frame=(time:number)=>{const [id,cb]=callbacks.entries().next().value!;callbacks.delete(id);cb(time)}
  return {renderer,surface,nodes,render,frame,cleanup:()=>slots.forEach(slot=>slot.cleanup?.())}
}
describe('视口同步与时间节流分离',()=>{
  it('拖动/缩放不等待下一动画帧，暂停时也同步Canvas与交互节点',()=>{
    const h=layerHarness(),clock=motion.stellarMotionSession('system-v1-3')
    try{
      clock.paused=true;h.renderer.drawPlanet.mockClear()
      h.render({zoom:2,pan:{x:45,y:-20}})
      expect(h.surface.dataset.renderedView).toBe('2,45,-20')
      expect(h.renderer.drawPlanet).not.toHaveBeenCalled()
      expect(h.nodes.get('[data-stellar-body="system-v1-3-p1"]')!.setAttribute).toHaveBeenCalledWith('transform',expect.stringMatching(/^translate\(/))
      const count=h.renderer.drawPlanet.mock.calls.length
      h.frame(10)
      expect(h.renderer.drawPlanet.mock.calls.length).toBe(count)
    }finally{clock.paused=false;h.cleanup()}
  })
  it('自适应纹理在暂停平移时复用，缩放跨清晰度档才重绘',()=>{
    const h=layerHarness(true),clock=motion.stellarMotionSession('system-v1-3')
    try{
      clock.paused=true;h.renderer.drawPlanet.mockClear()
      h.render({zoom:1,pan:{x:25,y:10}})
      expect(h.renderer.drawPlanet).not.toHaveBeenCalled()
      h.render({zoom:4,pan:{x:25,y:10}})
      expect(h.renderer.drawPlanet).toHaveBeenCalled()
      h.renderer.drawPlanet.mockClear()
      h.render({zoom:4,pan:{x:45,y:-30}})
      expect(h.renderer.drawPlanet).not.toHaveBeenCalled()
      expect(h.surface.dataset.renderedView).toBe('4,45,-30')
    }finally{clock.paused=false;h.cleanup()}
  })
})
