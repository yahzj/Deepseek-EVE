import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { tooltipLayout } from '../../../apps/desktop/src/renderer/src/ui/tooltipGeometry'

const root=new URL('../../../',import.meta.url)
describe('共享悬浮窗宽度与边缘布局',()=>{
  it.each([[1366,768,false,560],[1200,700,true,600],[390,640,false,374],[320,240,false,304]] as const)('%s×%s按逻辑空间限宽与四角避让',(bw,bh,rot,max)=>{
    for(const point of [{x:0,y:0},{x:bw,y:0},{x:0,y:bh},{x:bw,y:bh}]){
      const estimated=tooltipLayout({bw,bh,rot},point)
      expect(estimated.maxWidth).toBe(max)
      const measured=tooltipLayout({bw,bh,rot},point,{width:max,height:estimated.maxHeight})
      expect(measured.x).toBeGreaterThanOrEqual(8);expect(measured.y).toBeGreaterThanOrEqual(8)
      expect(measured.x+max).toBeLessThanOrEqual(bw-8)
      expect(measured.y+measured.maxHeight).toBeLessThanOrEqual(bh-8+.5)
    }
  })
  it('短提示定位按实际尺寸而不是强制撑满，无另一个CSS限宽',()=>{
    const layout=tooltipLayout({bw:1366,bh:768,rot:false},{x:900,y:300},{width:80,height:30})
    expect(layout.x).toBe(914);expect(layout.y).toBe(316)
    const css=readFileSync(new URL('apps/desktop/src/renderer/src/styles.css',root),'utf8')
    for(const match of css.matchAll(/[^{}]*\.app-tip\s*\{([^}]+)\}/g))expect(match[1]).not.toMatch(/max-(?:width|height)\s*:/)
    expect(css).toContain('.app-tip .app-info-key { flex: 0 0 112px; width: 112px; }')
    expect(css).toMatch(/\.app-tip\s*\{\s*position: fixed;\s*width: max-content;/)
  })
  it('真实提示单例首帧/精修同源并应用可用区，延迟和旧接管机制不变',()=>{
    const effects:Function[]=[],layouts:Function[]=[],listener:Record<string,Function>={},states:any[]=[],ref={current:{offsetWidth:80,offsetHeight:30}}
    let state:any=null,tree:any
    const scope={exports:{} as any,window:{innerWidth:320,innerHeight:240,addEventListener:(name:string,fn:Function)=>listener[name]=fn,removeEventListener:vi.fn()},document:{querySelector:()=>null},require:(id:string):any=>{
      if(id==='react')return {useEffect:(fn:Function)=>effects.push(fn),useLayoutEffect:(fn:Function)=>layouts.push(fn),useRef:()=>ref,useState:()=>[state,(next:any)=>{state=typeof next==='function'?next(state):next;states.push(state)}]}
      if(id==='react/jsx-runtime')return {jsx:(type:any,props:any)=>({type,props})}
      if(id==='./tooltipGeometry')return {tooltipLayout}
      throw Error(id)
    }}
    runInNewContext(ts.transpileModule(readFileSync(new URL('apps/desktop/src/renderer/src/ui/Tooltip.tsx',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope)
    scope.exports.TooltipLayer();effects[0]!();effects[1]!()
    scope.exports.showTip('短提示',310,230)
    expect(state.maxWidth).toBe(304);expect(state.maxHeight).toBe(192)
    layouts.length=0;tree=scope.exports.TooltipLayer();layouts[0]!()
    tree=scope.exports.TooltipLayer()
    expect(tree.props.style).toEqual({left:218,top:190,maxWidth:304,maxHeight:192})
    expect(scope.exports.TIP_DELAY_MS).toBe(500)
    listener.resize!();expect(state).toBeNull()
  })
})
