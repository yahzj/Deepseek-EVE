import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { STELLAR_PIXEL_MATERIALS } from '../../../apps/desktop/src/renderer/src/ui/stellarPixelMaterials'

const text=readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/stellarPlanetShader.ts',import.meta.url),'utf8')
const scope={exports:{} as {stellarTextureSize:(pixels:number,span:number)=>number;stellarMaterialSpan:(kind:string)=>number},require:()=>({STELLAR_PIXEL_MATERIALS})}
runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope)
describe('原生材质完整分层与投影精度',()=>{
  it('全部预设保留原层序，环与耀斑不挤占本体像素',()=>{
    const expected={rocky:['Ground','Craters'],ocean:['Water','Land','Cloud'],gas:['GasLayers','Ring'],desert:['Land'],ice:['Land','Lakes','Clouds'],lava:['Land','Craters','LavaRivers'],temperate:['Land','Cloud'],'star-yellow':['Blobs','Star','StarFlares'],'black-hole':['BlackHole','Disk']}
    for(const [kind,layers]of Object.entries(expected))expect(STELLAR_PIXEL_MATERIALS.presets[kind as keyof typeof STELLAR_PIXEL_MATERIALS.presets].layers.map(layer=>layer.name)).toEqual(layers)
    expect(scope.exports.stellarMaterialSpan('gas')).toBe(3)
    expect(STELLAR_PIXEL_MATERIALS.presets['star-yellow'].layers.map(layer=>layer.scale)).toEqual([2,1,2])
    for(const preset of Object.values(STELLAR_PIXEL_MATERIALS.presets))for(const layer of preset.layers){expect(Object.keys(layer.params).length).toBeGreaterThan(0);expect(STELLAR_PIXEL_MATERIALS.shaders[layer.shader]).toContain('materialMain')}
  })
  it('原光源不再驱动纹理偏移，明暗入口独立替换，采样不再锁128',()=>{
    for(const shader of STELLAR_PIXEL_MATERIALS.shaders){expect(shader).not.toMatch(/float (?:d_light|light_d)\s*=\s*distance[^;]*light_origin/);expect(shader).not.toMatch(/hint_range|shader_type|\bCOLOR\b|\bUV\b/)}
    expect(text).toContain("if(name==='pixels')value=1024*layer.scale")
    expect(text).not.toContain('materialProbe')
  })
  it('按本体显示像素分档，带环完整外框，分辨率有界且单调',()=>{
    for(const span of [1,2,3]){
      const sizes=[10,30,50,100,200,400,800,1600,10000].map(pixels=>scope.exports.stellarTextureSize(pixels,span))
      expect(sizes.every((value,index)=>value>=64&&value<=2048&&value%64===0&&(index===0||value>=sizes[index-1]!))).toBe(true)
    }
    expect(scope.exports.stellarTextureSize(100,3)).toBeGreaterThanOrEqual(scope.exports.stellarTextureSize(100,1)*3-128)
    expect(scope.exports.stellarTextureSize(10000,3)).toBe(2048)
  })
})
