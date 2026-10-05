/** 逐炮Electron真实存盘冒烟，使用独立隐藏窗口和全新合成档。
 * 用法：生成逐炮验收档并构建后node tools/per-gun-desktop-smoke.cjs。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05 · 最后跑过2026-10-05。
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {spawnSync}=require('node:child_process')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
if(!process.argv.includes('--smoke-child')) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'whale-pergun-desktop-'))
  try {
    const synthetic=JSON.parse(fs.readFileSync(path.resolve('docs/test-saves/test-save-per-gun-20261005.json'),'utf8'))
    synthetic.savedAtWallMs=Date.now();synthetic.state.savedAtWallMs=synthetic.savedAtWallMs
    fs.writeFileSync(path.join(profile,'save.json'),JSON.stringify(synthetic),'utf8')
    const env={...process.env,WHALE_PERF_USERDATA:profile};delete env.ELECTRON_RUN_AS_NODE
    const run=spawnSync(require('electron'),[__filename,'--smoke-child'],{encoding:'utf8',windowsHide:true,timeout:40000,env})
    console.log(run.stdout);if(run.error)throw run.error;assert.equal(run.status,0,run.stderr)
    const b=JSON.parse(fs.readFileSync(path.join(profile,'save.json'),'utf8')).state.expedition.battle
    assert(b&&b.stats.meShots>0&&b.stats.foeShots>0)
    console.log(JSON.stringify({ok:true,target:path.resolve('apps/desktop/out'),IPCSaved:true}))
  } finally {
    assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)&&profile.includes('whale-pergun-desktop-'))
    fs.rmSync(profile,{recursive:true,force:true})
  }
} else {
  const {app,BrowserWindow}=require('electron')
  BrowserWindow.prototype.show=function(){}
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async()=>{
    const win=BrowserWindow.getAllWindows()[0];assert(win)
    const js=s=>win.webContents.executeJavaScript(s)
    const until=async s=>{for(let i=0;i<100;i++){try{if(await js(s))return}catch{}await sleep(100)}throw new Error('等待超时：'+s)}
    await until('!!document.querySelector(".app-root")')
    if(await js('!!document.querySelector(".app-battle-float")'))await js('document.querySelector(".app-battle-float").click()')
    await until('!!document.querySelector(".app-battle-screen:not(.is-report)")')
    await sleep(6000)
    await js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(400)
    const s=JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA,'save.json'),'utf8'))
    const b=s.state.expedition.battle;assert(b)
    const groups=new Map()
    for(const e of b.fx.filter(e=>!e.web&&!e.blink&&!e.droneDown)){
      const key=e.side+':'+e.tag+':'+e.atMs,rows=groups.get(key)||[];rows.push(e);groups.set(key,rows)
    }
    assert([...groups.values()].some(g=>g.length>=3))
    assert(b.stats.meShots>0&&b.stats.foeShots>0)
    console.log(JSON.stringify({ok:true,electronPid:process.pid,stats:b.stats,maxSameCycle:Math.max(...[...groups.values()].map(g=>g.length))}))
    app.exit(0)
  }).catch(e=>{console.error(e);app.exit(1)})
}
