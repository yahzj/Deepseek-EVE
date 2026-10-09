// PixelPlanets (c) 2020 Deep-Fold, MIT。复用其周期噪声/三次插值/fbm；
// 球面经纬度驱动表面，法线/逐光源强度独立于纹理时间，星环轴不随本体旋转。
import type { StellarPlanetKind, StellarSystem } from '@whale/core'
import type { StellarLighting } from '../panels/stellarMotion'

export const STELLAR_MATERIAL_CODES: Record<StellarPlanetKind, number> = { rocky: 0, ocean: 1, desert: 2, ice: 3, lava: 4, temperate: 5, gas: 6 }
export const stellarMaterialSpan = (kind: StellarPlanetKind): number => kind === 'gas' ? 2 : 1
export const STELLAR_PLANET_VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`
export const STELLAR_PLANET_FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform vec3 lightDirection;
uniform vec3 lightDirection2;
uniform vec2 lightStrength;
uniform vec3 lightTint;
uniform float ambient;
uniform float phase;
uniform float cloudPhase;
uniform float seed;
uniform float materialCode;
uniform float span;
uniform vec3 starTint;
uniform float pixels;
const float PI=3.14159265359;
float rand(vec2 c){c=mod(c,vec2(16.,8.));return fract(sin(dot(c,vec2(12.9898,78.233)))*15.5453*seed);}
float noise(vec2 c){vec2 i=floor(c),f=fract(c);float a=rand(i),b=rand(i+vec2(1.,0.)),v=rand(i+vec2(0.,1.)),d=rand(i+vec2(1.,1.));vec2 t=f*f*(3.-2.*f);return mix(a,b,t.x)+(v-a)*t.y*(1.-t.x)+(d-b)*t.x*t.y;}
float fbm(vec2 c){float value=0.,weight=.5;for(int i=0;i<4;i++){value+=noise(c)*weight;c*=2.;weight*=.5;}return value;}
void main(){
 vec2 p=((floor(uv*pixels)+.5)/pixels*2.-1.)*span;
 float rr=dot(p,p);
 vec2 ringUv=vec2(p.x*.94+p.y*.34,-p.x*.34+p.y*.94);
 float ringR=length(vec2(ringUv.x,ringUv.y*3.));
 float ringMask=step(1.25,ringR)*step(ringR,1.90);
 if(materialCode<-1.5){
   float angle=atan(ringUv.y*3.,ringUv.x);
   float band=.5+.5*sin(ringR*85.+noise(vec2(angle*3.+phase*16.,ringR*9.))*5.);
   if(rr<.90){gl_FragColor=vec4(.014,.014,.025,1.);return;}
   if(ringMask<.5)discard;
   float wave=.65+.35*sin(angle-phase*2.*PI);
   gl_FragColor=vec4(mix(vec3(.40,.16,.11),vec3(1.,.72,.32),band)*wave,1.);return;
 }
 bool ring=materialCode>5.5&&ringMask>.5&&(rr>1.||ringUv.y<0.);
 if(rr>1.&&!ring)discard;
 vec3 normal=vec3(p,sqrt(max(0.,1.-rr)));
 if(ring)normal=normalize(vec3(p.x,p.y,.7));
 vec2 surface=vec2(atan(normal.x,normal.z)/(2.*PI)+phase,asin(normal.y)/PI+.5);
 if(ring)surface=vec2(atan(ringUv.y*3.,ringUv.x)/(2.*PI),ringR*.2);
 vec2 terrain=surface*vec2(16.,8.);
 float relief=fbm(terrain);
 if(materialCode<-.5){
   float granulation=noise(terrain*3.)*.4+relief*.6;
   vec3 hot=mix(starTint*.58,vec3(1.),smoothstep(.38,.78,granulation));
   gl_FragColor=vec4(hot*(.7+.3*normal.z),1.);return;
 }
 vec3 rock=mix(vec3(.46,.48,.57),vec3(.71,.72,.77),step(.48,relief));
 vec2 cells=terrain;vec2 cell=floor(cells),local=fract(cells);float h=rand(cell);
 float crater=1.-smoothstep(.14,.24,length(local-vec2(.25+h*.5)));
 rock=mix(rock,rock*.68,crater*step(.61,h));
 vec3 water=mix(vec3(.10,.28,.48),vec3(.22,.58,.68),step(.49,relief));
 vec3 land=mix(vec3(.25,.46,.36),vec3(.62,.73,.50),step(.58,relief));
 vec3 material=rock;
 if(materialCode>.5&&materialCode<1.5)material=mix(water,land,step(.56,relief));
 if(materialCode>1.5&&materialCode<2.5){float dunes=.5+.5*sin(surface.y*60.+relief*8.);material=mix(vec3(.53,.33,.22),vec3(.84,.68,.43),dunes);}
 if(materialCode>2.5&&materialCode<3.5){float cracks=step(.48,relief)*step(relief,.52);material=mix(vec3(.70,.86,.91),vec3(.21,.42,.57),cracks);}
 if(materialCode>3.5&&materialCode<4.5){float lava=step(.49,relief)*step(relief,.53);material=mix(vec3(.31,.24,.33),vec3(.98,.35,.13),lava);}
 if(materialCode>4.5&&materialCode<5.5)material=mix(water,mix(vec3(.22,.42,.30),vec3(.58,.68,.41),step(.62,relief)),step(.47,relief));
 if(materialCode>5.5){float bands=.5+.5*sin(surface.y*95.+relief*7.);material=mix(vec3(.46,.36,.50),vec3(.89,.72,.48),bands);if(ring)material=mix(vec3(.47,.36,.43),vec3(.86,.72,.58),.5+.5*sin(ringR*75.));}
 float clouds=fbm(vec2((surface.x-phase+cloudPhase)*16.,surface.y*8.)+vec2(3.,1.));
 float cloudy=(materialCode>.5&&materialCode<1.5)||(materialCode>4.5&&materialCode<5.5)?1.:0.;
 material=mix(material,vec3(.88,.93,.96),cloudy*step(.67,clouds)*.90);
 float diffuse=max(0.,dot(normal,normalize(lightDirection)));
 float diffuse2=max(0.,dot(normal,normalize(lightDirection2)));
 float direct=min(1.05,(floor(diffuse*5.+.5)/5.*lightStrength.x+floor(diffuse2*5.+.5)/5.*lightStrength.y)*1.25);
 vec3 color=material*(vec3(ambient)+direct*lightTint);
 if(materialCode>3.5&&materialCode<4.5)color+=material*step(.49,relief)*step(relief,.53)*.18;
 gl_FragColor=vec4(color,1.);
}`

export function createStellarPlanetRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram(), buffer = gl.createBuffer()
  function dispose() { for (const shader of shaders) gl!.deleteShader(shader); if (program) gl!.deleteProgram(program); if (buffer) gl!.deleteBuffer(buffer) }
  try {
    if (!program || !buffer) throw new Error('WebGL allocation failed')
    for (const [type, source] of [[gl.VERTEX_SHADER, STELLAR_PLANET_VERTEX], [gl.FRAGMENT_SHADER, STELLAR_PLANET_FRAGMENT]] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('WebGL shader allocation failed')
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed')
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const uniforms = Object.fromEntries(['lightDirection','lightDirection2','lightStrength','lightTint','ambient','phase','cloudPhase','seed','materialCode','pixels','span','starTint'].map(name => [name, gl.getUniformLocation(program, name)]))
    const drawMaterial = (timeMs: number, value: number, code: number, span: number, lighting: StellarLighting, tint: [number,number,number] = [1,.8,.4]) => {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program); gl.uniform3fv(uniforms.lightDirection, lighting.directions[0] ?? [0,0,1]); gl.uniform3fv(uniforms.lightDirection2, lighting.directions[1] ?? [0,0,1])
      gl.uniform2fv(uniforms.lightStrength, [lighting.strengths[0] ?? 0,lighting.strengths[1] ?? 0]); gl.uniform3fv(uniforms.lightTint,lighting.tint); gl.uniform1f(uniforms.ambient,lighting.ambient)
      gl.uniform1f(uniforms.phase, (timeMs / 40000) % 1); gl.uniform1f(uniforms.cloudPhase, (timeMs / 50000) % 1)
      gl.uniform1f(uniforms.seed, 1 + (value % 997) / 100); gl.uniform1f(uniforms.materialCode,code); gl.uniform1f(uniforms.pixels,128); gl.uniform1f(uniforms.span,span); gl.uniform3fv(uniforms.starTint,tint)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    return { dispose,
      draw(direction: [number, number, number], timeMs: number, value: number, isOcean: boolean) {
        drawMaterial(timeMs,value,Number(isOcean),1,{directions:[direction],strengths:[.86],tint:[1,1,1],ambient:.14})
      },
      drawPlanet(lighting: StellarLighting,timeMs: number,value: number,kind: StellarPlanetKind) { drawMaterial(timeMs,value,STELLAR_MATERIAL_CODES[kind],stellarMaterialSpan(kind),lighting) },
      drawStar(timeMs: number,value: number,starClass: StellarSystem['starClass']) {
        const tint: [number,number,number] = starClass === 'red'||starClass==='orange' ? [1,.46,.28] : starClass==='blue'||starClass==='neutron' ? [.38,.69,1] : starClass==='white' ? [.88,.93,1] : [1,.77,.23]
        drawMaterial(timeMs,value,starClass==='black-hole'?-2:-1,starClass==='black-hole'?2:1,{directions:[],strengths:[],tint:[1,1,1],ambient:1},tint)
      } }
  } catch { dispose(); return null }
}
