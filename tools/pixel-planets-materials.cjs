/** 本机原生材质导出及WebGL语法适配生成，不成为游戏运行依赖。
 * node tools/pixel-planets-materials.cjs export <不存在的输出JSON绝对路径>
 * node tools/pixel-planets-materials.cjs generate <原生输出JSON绝对路径>
 * Godot3.5/游戏v0.1.0/档v31，2026-10-10。
 */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), [mode, input] = process.argv.slice(2)
assert(input && path.isAbsolute(input))
assert(path.resolve(input).startsWith(path.join(root,'tools/_ui-artifacts')+path.sep))
if (mode === 'export') {
  assert(!fs.existsSync(input), '不覆盖研究输出')
  const exe = path.resolve(root,'../PixelPlanetsWindows.exe')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),'7f3fed02dd20d21e36c159883b9cface6bc63f0797e53f3828a83fce67153538')
  const run = spawnSync(exe,['--no-window','--audio-driver','Dummy','--video-driver','GLES2','--script',path.join(__dirname,'pixel-planets-materials-export.gd')],{
    cwd:path.dirname(input),env:{...process.env,WHALE_MATERIAL_INPUT:path.join(root,'apps/desktop/src/renderer/src/assets/stellar/parameters.json'),WHALE_MATERIAL_OUTPUT:input},encoding:'utf8',windowsHide:true,timeout:60000,
  })
  console.log(run.stdout); assert.equal(run.status,0,run.stderr); assert(!/SCRIPT ERROR|ERROR:/i.test(run.stderr),run.stderr)
} else if (mode === 'generate') {
  const original = JSON.parse(fs.readFileSync(input,'utf8'))
  assert(Object.values(original.presets).every(preset=>preset.layers.every(layer=>Object.keys(layer.params).length>0)), '材质参数不能为空')
  const shaders = original.shaders.map(source => {
    let code = source.replace(/\/\/[^\n]*/g,'').replace(/shader_type\s+\w+\s*;|render_mode[^;]+;/g,'')
    code = code.replace(/uniform\s+(\w+)\s+(\w+)(?:\s*:\s*[^;=]+)?(?:\s*=\s*[^;]+)?\s*;/g,'uniform $1 $2;')
    code = code.replace(/void fragment\(\)/,'void materialMain()').replace(/\bUV\b/g,'materialUv').replace(/\bCOLOR\b/g,'materialColor').replace(/\btexture\(/g,'texture2D(').replace(/\bround\((\w+)\)/g,'floor($1+0.5)')
    code = code.replace(/for\s*\(int i\s*=\s*0;\s*i\s*<\s*OCTAVES\s*;\s*i\+\+\s*\)\s*\{/g,'for(int i=0;i<20;i++){if(i>=OCTAVES)break;')
    code = code.replace(/sqrt\(1\.0 - dot\(centered\.xy, centered\.xy\)\)/g,'sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)))')
    code = code.replace(/(Cells\([^\n]+,\s*)(10|20)(\))/g,'$1$2.0$3')
    code = code.replace(/float (d_light|light_d)\s*=\s*(distance\([^;]+);/g,(match,name,expression)=>expression.includes('light_origin')?`float ${name} = illuminationDistance();`:match)
    assert(!/shader_type|hint_range|hint_color|void fragment|\bUV\b|\bCOLOR\b|\bround\(/.test(code))
    return code.trim()
  })
  const output = path.join(root,'apps/desktop/src/renderer/src/ui/stellarPixelMaterials.ts')
  const header = '// 自动生成：tools/pixel-planets-materials.cjs；手改会被覆盖。\n// PixelPlanets (c) 2020 Deep-Fold，MIT；源提交a712f460077119aeb5f3b688c0785021df8cabb3。\n// 原层算法/参数来自指纹一致的Godot3.5程序；语法适配与光照入口替换，非逐像素相同光照。\n// 原作者注明：Cells源自Dave_Hoskins https://www.shadertoy.com/view/4djGRh；circleNoise源自Leukbaars https://www.shadertoy.com/view/4tK3zR。\n'
  fs.writeFileSync(output,header+'export const STELLAR_PIXEL_MATERIALS = '+JSON.stringify({shaders,presets:original.presets},null,2)+'\n','utf8')
  console.log(JSON.stringify({ok:true,shaders:shaders.length,presets:Object.keys(original.presets).length,output}))
} else throw Error('命令：export / generate')
