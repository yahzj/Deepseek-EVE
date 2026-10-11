/** 原层移植真实GPU读数，隐藏Electron/独立临时配置，不打开个人档。
 * node tools/stellar-material-check.cjs；游戏v0.1.0/档v31，2026-10-11补暗面像素对比。
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {spawn}=require('node:child_process'),{once}=require('node:events')
const {execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),out=path.join(root,'tools/_ui-artifacts/stellar-material-20261010')
const ts=require('typescript')
function shaderCode(baseline=false){
  const compile=file=>ts.transpileModule(baseline&&file==='stellarPlanetShader.ts'
    ?execFileSync('git',['show','830da494:apps/desktop/src/renderer/src/ui/'+file],{cwd:root,encoding:'utf8',windowsHide:true})
    :fs.readFileSync(path.join(root,'apps/desktop/src/renderer/src/ui',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  return `const materialModule={exports:{}};((exports)=>{${compile('stellarPixelMaterials.ts')}})(materialModule.exports);const require=name=>{if(name==='./stellarPixelMaterials')return materialModule.exports;throw Error(name)};${compile('stellarPlanetShader.ts')}`
}
module.exports={shaderCode}
async function parent(){
  fs.mkdirSync(out,{recursive:true})
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'whale-material-'))
  try{
    const env={...process.env,WHALE_MATERIAL_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(require('electron'),[__filename,'--child'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>process.stderr.write(b))
    const timer=setTimeout(()=>child.kill(),120000),[status]=await once(child,'exit');clearTimeout(timer)
    assert.equal(status,0)
  }finally{
    const checked=path.resolve(profile)
    assert(checked.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(checked).startsWith('whale-material-'))
    fs.rmSync(checked,{recursive:true,force:true,maxRetries:5,retryDelay:300})
  }
}
async function child(){
  const {app,BrowserWindow}=require('electron')
  console.log('材质检查：独立配置初始化')
  app.setPath('userData',process.env.WHALE_MATERIAL_PROFILE);await app.whenReady()
  console.log('材质检查：Electron就绪')
  const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{backgroundThrottling:false}})
  win.webContents.on('console-message',(_event,_level,message)=>console.log(message))
  win.webContents.on('render-process-gone',(_event,details)=>console.error('材质检查渲染进程退出：'+JSON.stringify(details)))
  await win.loadURL('data:text/html,<body style="margin:0;background:%23090f17"></body>')
  console.log('材质检查：开始真实GPU编译与像素读数')
  const result=await win.webContents.executeJavaScript(`(()=>{const exports={};${shaderCode()};
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const renderer=exports.createStellarPlanetRenderer(canvas);
    if(!renderer){console.error(canvas.dataset.shaderError||'WebGL unavailable');throw Error(canvas.dataset.shaderError||'WebGL unavailable')};
    const gl=canvas.getContext('webgl');
    const lighting=direction=>({directions:[direction],strengths:[.8],tint:[1,1,1],ambient:.32});
    const baseline=(()=>{const exports={};${shaderCode(true)};return exports.createStellarPlanetRenderer(canvas)})();
    function read(){const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}
    function stats(p){let sum=0,n=0,left=0,right=0,ln=0,rn=0,edge=0;const colors=new Set();for(let i=0;i<p.length;i+=4){if(!p[i+3])continue;n++;sum+=p[i]+p[i+1]+p[i+2];colors.add(p[i]+','+p[i+1]+','+p[i+2]);const x=i/4%canvas.width,y=Math.floor(i/4/canvas.width);if(x<canvas.width*.4){left+=p[i]+p[i+1]+p[i+2];ln++}if(x>canvas.width*.6){right+=p[i]+p[i+1]+p[i+2];rn++}if(!x||!y||x===canvas.width-1||y===canvas.height-1)edge++}return {painted:n,brightness:sum/Math.max(n,1),colors:colors.size,left:left/Math.max(ln,1),right:right/Math.max(rn,1),edge}}
    function changed(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1])n++;return n}
    const board=document.createElement('canvas');board.width=1400;board.height=1000;const ctx=board.getContext('2d');ctx.fillStyle='#090f17';ctx.fillRect(0,0,1400,1000);ctx.font='18px sans-serif';ctx.fillStyle='#e2eaf2';ctx.fillText('PixelPlanets original layers / realtime WebGL',24,28);
    const kinds=['rocky','ocean','desert','ice','lava','temperate','gas'];const materials=[];
    for(let index=0;index<kinds.length;index++){
      const kind=kinds[index],seed={rocky:127,ocean:583,desert:391,ice:219,lava:672,temperate:328,gas:846}[kind];
      renderer.drawPlanet(lighting([-1,.3,.35]),0,seed,kind);const a=read();
      const x=index%4*350,y=55+Math.floor(index/4)*310;ctx.drawImage(canvas,x+25,y,300,260);ctx.fillText(kind,x+30,y+285);
      renderer.drawPlanet(lighting([1,-.3,.35]),0,seed,kind);const b=read();
      renderer.drawPlanet(lighting([-1,.3,.35]),10000,seed,kind);const c=read();
      renderer.drawPlanet({directions:[[-1,.3,.35]],strengths:[0],tint:[1,1,1],ambient:1},0,seed,kind);const p=read();
      renderer.drawPlanet({directions:[[1,-.3,.35]],strengths:[0],tint:[1,1,1],ambient:1},0,seed,kind);const q=read();
      renderer.drawPlanet({directions:[],strengths:[],tint:[1,1,1],ambient:.20},0,seed,kind);const night=stats(read());
      baseline.drawPlanet({...lighting([-1,.3,.35]),ambient:.14},0,seed,kind);const old=stats(read());
      baseline.drawPlanet({directions:[],strengths:[],tint:[1,1,1],ambient:.09},0,seed,kind);const oldNight=stats(read());
      materials.push({kind,...stats(a),otherLight:stats(b),rotationChanged:changed(a,c),geometryProbeChanged:changed(p,q),night,old,oldNight});
    }
    const stars=[];for(let index=0;index<6;index++){
      const kind=['yellow','red','blue','white','neutron','black-hole'][index];renderer.drawStar(0,420,kind);const a=read();
      if(index===0){ctx.drawImage(canvas,1075,365,300,260);ctx.fillText('star / 3 layers',1080,650)}
      if(index===5){ctx.drawImage(canvas,25,675,300,260);ctx.fillText('black hole / 2 layers',30,960)}
      renderer.drawStar(15000,420,kind);stars.push({kind,...stats(a),changed:changed(a,read())})
    }
    const brightness=[];for(const strength of [.8,.18,0]){renderer.drawPlanet({directions:[[-1,0,.35]],strengths:[strength],tint:[1,1,1],ambient:strength? .32:.20},0,127,'rocky');brightness.push(stats(read()).brightness)}
    renderer.drawPlanet(lighting([-1,0,.35]),0,583,'ocean',128);const tile=new Uint8Array(128*128*4);gl.readPixels(0,384,128,128,gl.RGBA,gl.UNSIGNED_BYTE,tile);
    canvas.width=128;canvas.height=128;renderer.drawPlanet(lighting([-1,0,.35]),0,583,'ocean');const standalone=read();
    const viewportChanged=changed(tile,standalone);
    const error=gl.getError();renderer.dispose();baseline.dispose();return {materials,stars,brightness,viewportChanged,error,image:board.toDataURL('image/png')};
  })()`)
  fs.writeFileSync(path.join(out,'materials.png'),Buffer.from(result.image.split(',')[1],'base64'));delete result.image
  fs.writeFileSync(path.join(out,'readings.json'),JSON.stringify(result,null,2),'utf8')
  console.log(JSON.stringify(result))
  assert.equal(result.error,0)
  assert.equal(result.viewportChanged,0,'共享缓冲小视口与独立画布像素不一致')
  assert(result.materials.every(row=>row.painted>2000&&row.colors>8&&row.rotationChanged>500&&row.geometryProbeChanged===0))
  assert(result.stars.every(row=>row.painted>2000&&row.changed>500&&row.edge===0))
  assert(result.brightness[0]>result.brightness[1]&&result.brightness[1]>result.brightness[2])
  assert(result.materials.every(row=>row.night.brightness>row.oldNight.brightness*1.8&&row.right>row.old.right*1.5&&row.painted===row.old.painted),'暗面提亮或原轮廓守恒失败')
  const ocean=result.materials.find(row=>row.kind==='ocean');assert(ocean.left>ocean.right*1.5&&ocean.otherLight.right>ocean.otherLight.left*1.5)
  app.exit(0)
}
if(require.main===module||process.argv.some(argument=>path.resolve(argument)===__filename)){if(process.argv.includes('--child'))child().catch(e=>{console.error(e);require('electron').app.exit(1)})
else parent().catch(e=>{console.error(e);process.exitCode=1})}
