// PixelPlanets (c) 2020 Deep-Fold，MIT。完整原层由stellarPixelMaterials生成。
import type { StellarPlanetKind, StellarSystem } from '@whale/core'
import type { StellarLighting } from '../panels/stellarMotion'
import { STELLAR_PIXEL_MATERIALS } from './stellarPixelMaterials'

export const stellarMaterialSpan = (kind: StellarPlanetKind): number => STELLAR_PIXEL_MATERIALS.presets[kind].span
export const stellarStarSpan = (): number => 2
export function stellarTextureSize(bodyPixels: number, span: number): number {
  const needed = Math.max(64, Math.min(1024, Math.ceil(bodyPixels * 1.5))) * span
  return Math.min(2048, Math.ceil(needed / 64) * 64)
}

export const STELLAR_PLANET_VERTEX = `
attribute vec2 position;
uniform float layerScale;
uniform float sceneSpan;
varying vec2 materialUv;
varying vec2 bodyUv;
void main(){
 materialUv=vec2(position.x,-position.y)*.5+.5;
 bodyUv=(materialUv-.5)*layerScale+.5;
 gl_Position=vec4(position*layerScale/sceneSpan,0.,1.);
}`
const HEADER = `
precision highp float;
varying vec2 materialUv;
varying vec2 bodyUv;
uniform vec3 lightDirection;
uniform vec3 lightDirection2;
uniform vec2 lightStrength;
uniform vec3 lightTint;
uniform float ambient;
uniform float emissive;
uniform float glowFloor;
vec4 materialColor;
vec3 bodyNormal(){vec2 p=(bodyUv-.5)*2.;return normalize(vec3(p.x,-p.y,sqrt(max(0.,1.-dot(p,p)))));}
float directLight(){vec3 n=bodyNormal();return max(0.,dot(n,normalize(lightDirection)))*lightStrength.x+max(0.,dot(n,normalize(lightDirection2)))*lightStrength.y;}
float illuminationDistance(){
 float total=lightStrength.x+lightStrength.y;
 float diffuse=total>0.?directLight()/total:0.;
 return mix(.85,.15,clamp(diffuse,0.,1.));
}
`
const FOOTER = `
void main(){
 materialColor=vec4(0.);materialMain();
 if(materialColor.a<=0.)discard;
 if(emissive<.5){
   float direct=min(1.05,directLight()*1.25);
   materialColor.rgb*=max(vec3(glowFloor),vec3(ambient)+direct*lightTint);
 }
 gl_FragColor=materialColor;
}`

type Layer = { name: string; shader: number; scale: number; params: Record<string, unknown> }
type Preset = { span: number; layers: Layer[] }
type Ramp = { colors: number[][]; offsets: number[] }
const PRESETS: Record<string, Preset> = STELLAR_PIXEL_MATERIALS.presets
const unlit: StellarLighting = { directions: [], strengths: [], tint: [1,1,1], ambient: 1 }

export function createStellarPlanetRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true })
  if (!gl) return null
  const programs = new Map<number, { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>; types: Map<string,string> }>()
  const textures = new Map<Ramp, WebGLTexture>()
  const buffer = gl.createBuffer()
  let failure = false
  function dispose() {
    for (const value of programs.values()) gl!.deleteProgram(value.program)
    for (const value of textures.values()) gl!.deleteTexture(value)
    if (buffer) gl!.deleteBuffer(buffer)
    programs.clear(); textures.clear()
  }
  function compile(index: number) {
    const old = programs.get(index)
    if (old) return old
    const program = gl!.createProgram()
    if (!program) throw Error('WebGL allocation failed')
    const shaders: WebGLShader[] = []
    try {
      for (const [type, source] of [[gl!.VERTEX_SHADER,STELLAR_PLANET_VERTEX],[gl!.FRAGMENT_SHADER,HEADER+STELLAR_PIXEL_MATERIALS.shaders[index]+FOOTER]] as const) {
        const shader = gl!.createShader(type)
        if (!shader) throw Error('WebGL shader allocation failed')
        shaders.push(shader); gl!.shaderSource(shader,source); gl!.compileShader(shader)
        if (!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS)) throw Error(gl!.getShaderInfoLog(shader) ?? 'Shader failed')
        gl!.attachShader(program,shader)
      }
      gl!.linkProgram(program)
      if (!gl!.getProgramParameter(program,gl!.LINK_STATUS)) throw Error(gl!.getProgramInfoLog(program) ?? 'Shader link failed')
      const uniforms = new Map<string,WebGLUniformLocation|null>(), types = new Map<string,string>()
      for (const match of (HEADER+STELLAR_PIXEL_MATERIALS.shaders[index]+STELLAR_PLANET_VERTEX).matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g)) {
        uniforms.set(match[2]!,gl!.getUniformLocation(program,match[2]!));types.set(match[2]!,match[1]!)
      }
      const result = { program,uniforms,types };programs.set(index,result);return result
    } catch (error) { gl!.deleteProgram(program);throw error }
    finally { for (const shader of shaders) gl!.deleteShader(shader) }
  }
  function ramp(value: Ramp) {
    const old = textures.get(value)
    if (old) return old
    const texture = gl!.createTexture()
    if (!texture) throw Error('WebGL texture allocation failed')
    const bytes = new Uint8Array(256*4)
    for (let x=0;x<256;x++) {
      const at=x/255
      let end=value.offsets.findIndex(offset=>offset>=at)
      if(end<0)end=value.offsets.length-1
      const start=Math.max(0,end-1), from=value.offsets[start]!,to=value.offsets[end]!,weight=to===from?0:(at-from)/(to-from)
      for(let c=0;c<4;c++)bytes[x*4+c]=Math.round(255*(value.colors[start]![c]!*(1-weight)+value.colors[end]![c]!*weight))
    }
    gl!.bindTexture(gl!.TEXTURE_2D,texture)
    gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,256,1,0,gl!.RGBA,gl!.UNSIGNED_BYTE,bytes)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MIN_FILTER,gl!.LINEAR);gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MAG_FILTER,gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_S,gl!.CLAMP_TO_EDGE);gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_T,gl!.CLAMP_TO_EDGE)
    textures.set(value,texture);return texture
  }
  function draw(preset: Preset, lighting: StellarLighting, timeMs: number, seed: number, emissive: boolean, size = Math.min(canvas.width,canvas.height)) {
    if (failure) return
    try {
      const pixels=Math.min(size,canvas.width,canvas.height),y=canvas.height-pixels
      gl!.viewport(0,y,pixels,pixels);gl!.enable(gl!.SCISSOR_TEST);gl!.scissor(0,y,pixels,pixels)
      gl!.clearColor(0,0,0,0);gl!.clear(gl!.COLOR_BUFFER_BIT)
      gl!.enable(gl!.BLEND);gl!.blendFuncSeparate(gl!.SRC_ALPHA,gl!.ONE_MINUS_SRC_ALPHA,gl!.ONE,gl!.ONE_MINUS_SRC_ALPHA)
      gl!.bindBuffer(gl!.ARRAY_BUFFER,buffer)
      for (const layer of preset.layers) {
        const { program,uniforms,types }=compile(layer.shader)
        gl!.useProgram(program)
        const position=gl!.getAttribLocation(program,'position')
        gl!.enableVertexAttribArray(position);gl!.vertexAttribPointer(position,2,gl!.FLOAT,false,0,0)
        let sampler=0
        for(const [name,original] of Object.entries(layer.params)) {
          let value=original
          if(name==='pixels')value=1024*layer.scale
          if(name==='seed')value=Math.max(.01,((Math.trunc(seed)%1000)+1000)%1000/100)
          if(name==='should_dither')value=false
          // 原纹理速度/层间差异保留；会话时间共享，循环边界不重置原材质。
          if(name==='time')value=Number(original)+(timeMs/(layer.name.toLowerCase().includes('cloud')?50000:40000))*(Number(original)/.17)
          const location=uniforms.get(name)??null,type=types.get(name)
          if(type==='sampler2D'&&value&&typeof value==='object'&&'colors' in value) {
            gl!.activeTexture(gl!.TEXTURE0+sampler);gl!.bindTexture(gl!.TEXTURE_2D,ramp(value as Ramp));gl!.uniform1i(location,sampler++)
          } else if(type==='int'||type==='bool')gl!.uniform1i(location,Number(value)||0)
          else if(Array.isArray(value)) {
            if(value.length===2)gl!.uniform2fv(location,value)
            else if(value.length===4)gl!.uniform4fv(location,value)
          } else gl!.uniform1f(location,Number(value)||0)
        }
        gl!.uniform1f(uniforms.get('layerScale')??null,layer.scale);gl!.uniform1f(uniforms.get('sceneSpan')??null,preset.span)
        gl!.uniform3fv(uniforms.get('lightDirection')??null,lighting.directions[0]??[0,0,1]);gl!.uniform3fv(uniforms.get('lightDirection2')??null,lighting.directions[1]??[0,0,1])
        gl!.uniform2fv(uniforms.get('lightStrength')??null,[lighting.strengths[0]??0,lighting.strengths[1]??0])
        gl!.uniform3fv(uniforms.get('lightTint')??null,lighting.tint);gl!.uniform1f(uniforms.get('ambient')??null,lighting.ambient)
        gl!.uniform1f(uniforms.get('emissive')??null,Number(emissive))
        gl!.uniform1f(uniforms.get('glowFloor')??null,layer.name==='LavaRivers'?.18:0)
        gl!.drawArrays(gl!.TRIANGLES,0,6)
      }
    } catch(error) { failure=true;canvas.dataset.shaderError=String(error);throw error }
    finally { gl!.disable(gl!.SCISSOR_TEST) }
  }
  try {
    if(!buffer)throw Error('WebGL buffer allocation failed')
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW)
    // 初始化完整材质集，任何失败都走现有明确静态降级，不显示部分空白天体。
    for(let index=0;index<STELLAR_PIXEL_MATERIALS.shaders.length;index++)compile(index)
    return { dispose,
      draw(direction: [number,number,number], timeMs: number, seed: number, ocean: boolean) { draw(PRESETS[ocean?'ocean':'rocky']!,{directions:[direction],strengths:[.86],tint:[1,1,1],ambient:.14},timeMs,seed,false) },
      drawPlanet(lighting: StellarLighting,timeMs: number,seed: number,kind: StellarPlanetKind,pixels?:number) { draw(PRESETS[kind]!,lighting,timeMs,seed,false,pixels) },
      drawStar(timeMs: number,seed: number,starClass: StellarSystem['starClass'],pixels?:number) {
        const key=starClass==='black-hole'?'black-hole':starClass==='red'||starClass==='orange'?'star-red':starClass==='blue'||starClass==='neutron'?'star-blue':starClass==='white'?'star-white':'star-yellow'
        draw(PRESETS[key]!,unlit,timeMs,seed,true,pixels)
      } }
  } catch(error) { canvas.dataset.shaderError=String(error);dispose();return null }
}
