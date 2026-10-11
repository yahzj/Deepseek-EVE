import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { describe, expect, it, vi } from 'vitest'
import { buildPlanetCatalog, L10N, l10nEntryText } from '@whale/data'
import { PLANET_TEXT_IDS, planetMoveBillOf, planetMoveCheck, startPlanetMove, createInitialState, planetSurveyView } from '../src/index'
import { injectPlanetaryRuntimeTestState } from '../../../tools/planetary-runtime-fixture'
import { planetWheelPosition } from '../../../apps/desktop/src/renderer/src/ui/planetWheelGeometry'

const root=new URL('../../../',import.meta.url),catalog=buildPlanetCatalog()
const scope={exports:{} as {planetTraitDetails:(view:any,id:string,catalog:any)=>any},require:(id:string)=>id==='./planetText'?{pt:(key:string)=>l10nEntryText(L10N[PLANET_TEXT_IDS[key]!]!,'zh')}:{fmtNum:(value:number)=>String(value)}}
runInNewContext(ts.transpileModule(readFileSync(new URL('apps/desktop/src/renderer/src/ui/planetTraitDetails.ts',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope)

type Node={type:any;props:Record<string,any>}
const nodes=(value:any):Node[]=>Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children)]:[]
function componentHarness(file:string,name:string,props:any){
  const values:any[]=[],refs:any[]=[];let cursor=0,refCursor=0,tree:Node
  const module={exports:{} as Record<string,(props:any)=>Node>,require:(id:string):any=>{
    if(id==='react')return {useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],(next:any)=>values[i]=typeof next==='function'?next(values[i]):next]},useRef:(initial:any)=>refs[refCursor++]??={current:initial},useLayoutEffect:()=>{}}
    if(id==='react/jsx-runtime')return {jsx,jsxs,Fragment}
    if(id==='lucide-react')return new Proxy({}, {get:(_t,key)=>String(key)})
    if(id==='./planetWheelGeometry')return {planetWheelPosition}
    if(id==='./planetTraitDetails')return scope.exports
    if(id==='./planetText')return {pt:(key:string)=>l10nEntryText(L10N[PLANET_TEXT_IDS[key]!]!,'zh')}
    if(id==='./shipInfo')return {InfoTable:'info-table',infoCardContent:(name:string,lines:any[])=>({name,lines})}
    if(id==='./Tooltip')return {hoverTipProps:(value:any)=>({'data-tip-hover':'1',onMouseEnter:()=>value})}
    throw Error(id)
  }}
  runInNewContext(ts.transpileModule(readFileSync(new URL(`apps/desktop/src/renderer/src/ui/${file}`,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,module)
  const render=()=>{cursor=0;refCursor=0;tree=module.exports[name]!(props)}
  render()
  return {render,all:()=>nodes(tree),find:(test:(node:Node)=>boolean)=>nodes(tree).find(test)!}
}
describe('轮盘与特性公开修正',()=>{
  it.each([[1280,730],[1137,700],[360,390]])('四角菜单在逻辑宽高内，旋转不使用物理vw/vh，%s×%s',(width,height)=>{
    for(const anchor of [{x:0,y:0},{x:width,y:height},{x:width,y:0},{x:0,y:height}]){
      const at=planetWheelPosition(anchor,width,height)
      expect(at.x-180).toBeGreaterThanOrEqual(0);expect(at.x+180).toBeLessThanOrEqual(width)
      expect(at.y-180).toBeGreaterThanOrEqual(0);expect(at.y+180).toBeLessThanOrEqual(height)
    }
  })
  it('直接修正来自当前目录，不泄露未公开特性或错误附上整星倍率',()=>{
    const detail=scope.exports.planetTraitDetails({traitIds:['cold']},'cold',catalog)
    expect(detail.lines).toEqual([{k:'危险度',v:'+10'},{k:'宜居度',v:'-15'},{k:'障碍',v:'冰层'},{k:'改造工程',v:'低温缓和工程'}])
    expect(scope.exports.planetTraitDetails({traitIds:[]},'cold',catalog)).toBeUndefined()
    expect(scope.exports.planetTraitDetails({traitIds:['old-dome']},'old-dome',catalog).lines.some((row:any)=>row.k===L10N[PLANET_TEXT_IDS.projects!]!.zh)).toBe(true)
  })
  it('迁移预览就是原实际扣款，单点抽取不改变工期与材料',()=>{
    const state=createInitialState({seed:7,nowWallMs:0});injectPlanetaryRuntimeTestState(state)
    const planet=state.planetary!.planets['planet-prototype-large']!,a=planet.cells.find(cell=>cell.building?.id==='power')!,b=planet.cells.find(cell=>!cell.building&&!cell.obstacle)!
    const view=planetSurveyView(planet,catalog)!,before=structuredClone(planet.colony!),bill=planetMoveBillOf(planet,catalog)
    expect(view.size).toBe(6);expect(bill.durationMs).toBe(60000)
    expect(startPlanetMove(planet,catalog,a.index,b.index)).toEqual({ok:true})
    expect(planet.colony!.credits).toBe(before.credits-bill.credits)
    for(const [id,count]of Object.entries(bill.items))expect(planet.colony!.items[id]).toBe(before.items[id]!-count)
  })
  it('迁移只读校验与实际命令一致，资源/预占/保护/无效索引均不扣款',()=>{
    const state=createInitialState({seed:7,nowWallMs:0});injectPlanetaryRuntimeTestState(state)
    const planet=state.planetary!.planets['planet-prototype-large']!
    const source=planet.cells[0]!,target=planet.cells[1]!
    delete source.obstacle;delete target.obstacle;delete target.building;delete target.deposit
    source.building={id:'mine',status:'ready',powered:true,staffed:false}
    for(const [setup,reason]of [
      [()=>{},'resource-required'],
      [()=>{target.deposit={resource:'metal',sourceTraitId:'metal-veins',bonus:.2};planet.colony!.jobs=[{seq:30,kind:'clear',cellIndex:1,totalMs:1,remainingMs:1,spentCredits:0,spentItems:{},paused:false}]},'not-ready'],
      [()=>{planet.colony!.jobs=[];source.building!.id='housing'},'protected'],
      [()=>{source.building!.id='mine';source.building!.status='construction'},'not-ready'],
    ] as const){
      setup();const before=structuredClone(planet)
      expect(planetMoveCheck(planet,catalog,0,1)).toEqual({ok:false,reason})
      expect(startPlanetMove(planet,catalog,0,1)).toEqual({ok:false,reason})
      expect(planet).toEqual(before)
    }
    source.building!.status='ready'
    expect(planetMoveCheck(planet,catalog,0,36)).toEqual({ok:false,reason:'invalid-cell'})
  })
  it('真实轮盘分两页覆盖13项，禁用选项可看原因但不执行，背景/Esc只调用取消',()=>{
    const action=vi.fn(),close=vi.fn(),items=[...catalog.buildings.keys()].map((id,index)=>({id,label:id,icon:null,action,disabled:index===0,reason:index===0?'已有基地':undefined}))
    const h=componentHarness('PlanetRadialMenu.tsx','PlanetRadialMenu',{title:'地块 #1',items,anchor:{x:200,y:200},onClose:close})
    const first=h.all().filter(node=>node.props['data-wheel-item'])
    expect(first).toHaveLength(7);expect(first[0]!.props['aria-disabled']).toBe(true)
    first[0]!.props.onClick();h.render();expect(action).not.toHaveBeenCalled()
    expect(h.all().some(node=>node.props.role==='status'&&node.props.children==='已有基地')).toBe(true)
    h.find(node=>node.props['data-wheel-page']==='next').props.onClick();h.render()
    const second=h.all().filter(node=>node.props['data-wheel-item'])
    expect(second).toHaveLength(6);expect(new Set([...first,...second].map(node=>node.props['data-wheel-item'])).size).toBe(13)
    expect(h.find(node=>node.props['data-wheel-page']==='next').props.disabled).toBe(true)
    const dialog=h.find(node=>node.props.role==='dialog'),stop=vi.fn()
    dialog.props.onKeyDown({key:'Escape',preventDefault:vi.fn(),stopPropagation:stop})
    const mask=h.find(node=>node.props.className==='app-planet-wheel-mask'),target={}
    mask.props.onClick({target,currentTarget:target});expect(close).toHaveBeenCalledTimes(2);expect(stop).toHaveBeenCalledOnce()
    mask.props.onClick({target:{},currentTarget:target});expect(close).toHaveBeenCalledTimes(2)
  })
  it('真实特性标签点击、Enter和空格展示相同公开参数，不混用title与富卡',()=>{
    const view={traitIds:['cold'],unknownTraits:1},h=componentHarness('PlanetTraitTags.tsx','PlanetTraitTags',{view,catalog})
    const tag=()=>h.find(node=>node.props['data-planet-trait']==='cold')
    expect(tag().props.title).toBeUndefined();expect(tag().props['data-tip-hover']).toBe('1')
    tag().props.onClick();h.render()
    expect(h.find(node=>node.type==='info-table').props.lines).toEqual(scope.exports.planetTraitDetails(view,'cold',catalog).lines)
    const prevent=vi.fn();tag().props.onKeyDown({key:'Enter',preventDefault:prevent});h.render()
    expect(tag().props['aria-expanded']).toBe(false)
    tag().props.onKeyDown({key:' ',preventDefault:prevent});h.render()
    expect(tag().props['aria-expanded']).toBe(true);expect(prevent).toHaveBeenCalledTimes(2)
    view.traitIds=[];h.render();expect(h.all().some(node=>node.props['data-planet-trait-details'])).toBe(false)
  })
})
