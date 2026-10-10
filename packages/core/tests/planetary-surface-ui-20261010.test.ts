import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { describe, expect, it, vi } from 'vitest'
import * as core from '../src/index'
import { buildPlanetCatalog, buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { injectPlanetaryRuntimeTestState } from '../../../tools/planetary-runtime-fixture'
import * as surface from '../../../apps/desktop/src/renderer/src/ui/planetSurfaceView'

const root=new URL('../../../',import.meta.url)
type Node={type:any;props:Record<string,any>}
const nodes=(value:any):Node[]=>Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children)]:[]
function harness(locale:'zh'|'en'='zh'){
  const state=core.createInitialState({seed:7,nowWallMs:0}),ctx=buildSimContext(locale),catalog=buildPlanetCatalog()
  injectPlanetaryRuntimeTestState(state)
  const values:any[]=[],refs:any[]=[];let cursor=0,refCursor=0
  const commands=vi.fn(()=>({ok:true})),close=vi.fn()
  const pt=(key:string)=>l10nEntryText(L10N[core.PLANET_TEXT_IDS[key]!]!,locale)
  const scope={exports:{} as {PlanetaryPanel:(props:any)=>Node},require:(id:string):any=>{
    if(id==='react')return {useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],(value:any)=>{values[i]=typeof value==='function'?value(values[i]):value}]},useRef:(initial:any)=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial})},useId:()=> 'surface-test',useEffect:()=>{}}
    if(id==='react/jsx-runtime')return {jsx,jsxs,Fragment}
    if(id==='@whale/core')return core
    if(id==='lucide-react')return new Proxy({}, {get:(_target,key)=>String(key)})
    if(id==='../ui/Glyphs')return {Glyph:'glyph'}
    if(id==='../ui/planetSurfaceView')return surface
    if(id==='../ui/planetText')return {pt}
    if(id==='../i18n/fmt')return {fmtNum:String,fmtInt:String,fmtCredits:String,fmtDuration:String}
    if(id==='../ui/shipInfo')return {InfoTable:'table',infoCardContent:()=>null}
    if(id==='../ui/Tooltip')return {hoverTipProps:()=>({})}
    if(id.endsWith('.css'))return {}
    throw Error(id)
  }}
  runInNewContext(ts.transpileModule(readFileSync(new URL('apps/desktop/src/renderer/src/panels/PlanetaryPanel.tsx',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope)
  let tree:Node
  const render=()=>{cursor=0;refCursor=0;tree=scope.exports.PlanetaryPanel({engine:{state,getCtx:()=>ctx},catalog,onCommand:commands,onClose:close,initialPlanetId:'planet-prototype-large'})}
  render()
  const all=()=>nodes(tree),find=(test:(node:Node)=>boolean)=>all().find(test)!
  const clickCell=(index:number)=>{find(node=>node.props['data-planet-cell']===index).props.onClick();render()}
  const button=(key:string)=>find(node=>node.type==='button'&&(node.props['aria-label']===pt(key)||nodes(node).some(child=>child.props.children===pt(key))||(node.props.children as any[])?.includes?.(pt(key))))
  return {state,catalog,pt,commands,close,all,find,render,clickCell,button,planet:state.planetary!.planets['planet-prototype-large']!}
}
describe('地表状态与图标单点',()=>{
  it('13栋完整覆盖且外形不同，所有glyph引用真实存在',()=>{
    const catalog=buildPlanetCatalog(),source=readFileSync(new URL('apps/desktop/src/renderer/src/ui/Glyphs.tsx',root),'utf8')
    const symbols=Object.values(surface.PLANET_BUILDING_GLYPHS)
    expect(new Set(symbols).size).toBe(13)
    for(const building of catalog.buildings.values())expect(surface.PLANET_BUILDING_GLYPHS[building.id]).toBeDefined()
    for(const key of [...symbols,...Object.values(surface.PLANET_RESOURCE_GLYPHS),'planet-empty','planet-rough','planet-ice','planet-corrosion','planet-rubble'])expect(source).toMatch(new RegExp("(?:'"+key+"'|\\b"+key+")\\s*:"))
  })
  it('未知不暴露数据，障碍/设施不吞天然资源，自动设施无需人员也可就绪',()=>{
    expect(surface.planetSurfaceCellView(undefined)).toMatchObject({glyph:'ico-scan',status:'unknown',nameKey:'unknown',resourceGlyph:undefined})
    const cell:core.PlanetGridCell={index:0,obstacle:'ice',deposit:{resource:'water',sourceTraitId:'ice-deposits',bonus:.2},building:{id:'water',status:'ready',powered:true,staffed:false}}
    const before=structuredClone(cell)
    expect(surface.planetSurfaceCellView(cell,{worker:'automatic'})).toMatchObject({glyph:'planet-ice',status:'obstacle',resourceGlyph:'ice'})
    delete cell.obstacle
    expect(surface.planetSurfaceCellView(cell,{worker:'automatic'})).toMatchObject({glyph:'planet-water',status:'ready',resourceGlyph:'ice'})
    expect(before.building).toEqual(cell.building)
  })
  it('施工/停用/断电/无人岗位状态优先级稳定，状态不修改引擎真值',()=>{
    const cell:core.PlanetGridCell={index:0,building:{id:'research',status:'construction',powered:false,staffed:false,enabled:false}}
    expect(surface.planetSurfaceCellView(cell,{worker:'human'}).status).toBe('construction')
    cell.building!.status='ready';expect(surface.planetSurfaceCellView(cell,{worker:'human'}).status).toBe('stopped')
    cell.building!.enabled=true;expect(surface.planetSurfaceCellView(cell,{worker:'human'}).status).toBe('unpowered')
    cell.building!.powered=true;expect(surface.planetSurfaceCellView(cell,{worker:'human'}).status).toBe('unstaffed')
    cell.building!.staffed=true;const before=structuredClone(cell)
    expect(surface.planetSurfaceCellView(cell,{worker:'human'}).status).toBe('ready');expect(cell).toEqual(before)
  })
})
describe('真实地表组件接线',()=>{
  it.each(['zh','en'] as const)('%s网格主体与资源分层，固定命令仍走原参数',locale=>{
    const h=harness(locale),cell=h.planet.cells[0]!
    cell.obstacle='ice';cell.building=undefined;cell.deposit={resource:'water',sourceTraitId:'ice-deposits',bonus:.2};h.render()
    const tile=h.find(node=>node.props['data-planet-cell']===0)
    expect(nodes(tile).some(node=>node.type==='glyph'&&node.props.name==='planet-ice')).toBe(true)
    expect(nodes(tile).some(node=>node.props['data-planet-resource']==='water')).toBe(true)
    expect(tile.props['aria-label']).toContain(h.pt('obstacle.ice'));expect(tile.props['aria-label']).toContain(h.pt('resource.water'))
    h.button('clear').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('clear',[h.planet.id,0])
    delete cell.obstacle;h.render()
    const select=h.find(node=>node.type==='select'&&node.props.value==='base')
    select.props.onChange({target:{value:'power'}});h.render();h.button('build').props.onClick()
    expect(h.commands).toHaveBeenLastCalledWith('build',[h.planet.id,0,'power'])
  })
  it('详探前不显示隐藏资源/设施，网格编号和键盘选择仍完整',()=>{
    const h=harness();h.planet.survey=1;h.render()
    expect(h.all().filter(node=>node.props['data-planet-cell']!==undefined)).toHaveLength(36)
    expect(h.all().some(node=>node.props['data-planet-resource']!==undefined)).toBe(false)
    expect(h.all().filter(node=>node.props.className==='app-planet-tile-art').every(node=>node.props.name==='ico-scan')).toBe(true)
    const tile=h.find(node=>node.props['data-planet-cell']===0)
    tile.props.onKeyDown({key:'ArrowRight',preventDefault:vi.fn()},0);h.render()
    expect(h.find(node=>node.props['data-planet-cell']===1).props['aria-pressed']).toBe(true)
    expect(h.all().some(node=>node.props.className==='app-planet-detail-commands'&&nodes(node).some(child=>child.type==='button'))).toBe(false)
  })
  it('维修/岗位/迁移/拆除与施工暂停取消命令不丢，更新不改变格规格',()=>{
    const h=harness(),cell=h.planet.cells[0]!
    delete cell.obstacle;cell.building={id:'research',status:'ready',powered:true,staffed:false,condition:.5};h.render()
    h.button('repair').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('repair',[h.planet.id,0])
    const staff=h.find(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false)
    staff.props.onChange({target:{checked:true}});expect(h.commands).toHaveBeenLastCalledWith('staff',[h.planet.id,0,true])
    h.planet.cells[1]!.building=undefined;h.planet.cells[1]!.obstacle=undefined
    h.find(node=>node.type==='select'&&node.props.value===0).props.onChange({target:{value:'1'}});h.render()
    expect(h.button('move').props.disabled).toBe(false)
    h.button('move').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('move',[h.planet.id,0,1])
    h.button('demolish').props.onClick();h.render();h.button('confirm').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('demolish',[h.planet.id,0])
    h.planet.colony!.jobs=[{seq:21,kind:'build',cellIndex:0,buildingId:'research',remainingMs:1000,totalMs:2000,spentItems:{},spentCredits:0,paused:false}];h.render()
    h.button('pause').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('pause',[h.planet.id,21,true])
    h.button('cancel').props.onClick();expect(h.commands).toHaveBeenLastCalledWith('cancel',[h.planet.id,21])
    expect(h.all().filter(node=>node.props['data-planet-cell']!==undefined)).toHaveLength(36)
  })
})
