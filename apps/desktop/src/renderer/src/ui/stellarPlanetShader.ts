// PixelPlanets (c) 2020 Deep-Fold, MIT。复用其周期噪声/三次插值/fbm；
// 本试作改为球面经纬度驱动表面，法线光照独立于纹理时间，避免原光源参与纹理噪声。
export const STELLAR_PLANET_VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`
export const STELLAR_PLANET_FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform vec3 lightDirection;
uniform float phase;
uniform float cloudPhase;
uniform float seed;
uniform float ocean;
uniform float pixels;
const float PI=3.14159265359;
float rand(vec2 c){c=mod(c,vec2(16.,8.));return fract(sin(dot(c,vec2(12.9898,78.233)))*15.5453*seed);}
float noise(vec2 c){vec2 i=floor(c),f=fract(c);float a=rand(i),b=rand(i+vec2(1.,0.)),v=rand(i+vec2(0.,1.)),d=rand(i+vec2(1.,1.));vec2 t=f*f*(3.-2.*f);return mix(a,b,t.x)+(v-a)*t.y*(1.-t.x)+(d-b)*t.x*t.y;}
float fbm(vec2 c){float value=0.,weight=.5;for(int i=0;i<4;i++){value+=noise(c)*weight;c*=2.;weight*=.5;}return value;}
void main(){
 vec2 p=(floor(uv*pixels)+.5)/pixels*2.-1.;
 float rr=dot(p,p);if(rr>1.)discard;
 vec3 normal=vec3(p,sqrt(max(0.,1.-rr)));
 vec2 surface=vec2(atan(normal.x,normal.z)/(2.*PI)+phase,asin(normal.y)/PI+.5);
 vec2 terrain=surface*vec2(16.,8.);
 float relief=fbm(terrain);
 vec3 rock=mix(vec3(.46,.48,.57),vec3(.71,.72,.77),step(.48,relief));
 vec2 cells=terrain;vec2 cell=floor(cells),local=fract(cells);float h=rand(cell);
 float crater=1.-smoothstep(.14,.24,length(local-vec2(.25+h*.5)));
 rock=mix(rock,rock*.68,crater*step(.61,h));
 vec3 water=mix(vec3(.10,.28,.48),vec3(.22,.58,.68),step(.49,relief));
 vec3 land=mix(vec3(.25,.46,.36),vec3(.62,.73,.50),step(.58,relief));
 vec3 material=mix(rock,mix(water,land,step(.56,relief)),ocean);
 float clouds=fbm(vec2((surface.x-phase+cloudPhase)*16.,surface.y*8.)+vec2(3.,1.));
 material=mix(material,vec3(.88,.93,.96),ocean*step(.67,clouds)*.90);
 float diffuse=max(0.,dot(normal,normalize(lightDirection)));
 float lighting=.14+floor(diffuse*5.+.5)/5.*.86;
 gl_FragColor=vec4(material*lighting,1.);
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
    const light = gl.getUniformLocation(program, 'lightDirection'), phase = gl.getUniformLocation(program, 'phase'), cloudPhase = gl.getUniformLocation(program, 'cloudPhase'), seed = gl.getUniformLocation(program, 'seed'), ocean = gl.getUniformLocation(program, 'ocean'), pixels = gl.getUniformLocation(program, 'pixels')
    return { dispose, draw(direction: [number, number, number], timeMs: number, value: number, isOcean: boolean) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program); gl.uniform3fv(light, direction); gl.uniform1f(phase, (timeMs / 40000) % 1)
      gl.uniform1f(cloudPhase, (timeMs / 50000) % 1)
      gl.uniform1f(seed, 1 + (value % 997) / 100); gl.uniform1f(ocean, Number(isOcean)); gl.uniform1f(pixels, 96)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    } }
  } catch { dispose(); return null }
}
