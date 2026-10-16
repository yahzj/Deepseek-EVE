/** 守墓入侵隐藏Electron冒烟：自建合成档、隔离userData、真实IPC存盘/重载。
 * 用法：构建后 node tools/gravekeeper-native-check.cjs。
 * 版本：v0.1.0/档v31，2026-10-16；不作观感验收，不读取个人档。
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {spawnSync}=require('node:child_process')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const output=path.resolve('tools/_ui-artifacts/gravekeeper-invasion')
const gear=process.argv.includes('--gear')
if(!process.argv.includes('--smoke-child')) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'whale-gravekeeper-'))
  try {
    const fixture=spawnSync(process.execPath,['--import','tsx',gear?'tools/gravekeeper-gear-fixture.ts':'tools/gravekeeper-invasion-check.ts','--smoke-save'],{encoding:'utf8',windowsHide:true})
    assert.equal(fixture.status,0,fixture.stderr)
    fs.copyFileSync(path.join(output,gear?'gear-smoke-save.json':'smoke-save.json'),path.join(profile,'save.json'))
    const env={...process.env,WHALE_PERF_USERDATA:profile};delete env.ELECTRON_RUN_AS_NODE
    const electron=process.argv.find(arg=>arg.startsWith('--electron='))?.slice(11)??require('electron')
    const run=spawnSync(electron,[__filename,'--smoke-child',...(gear?['--gear']:[])],{encoding:'utf8',windowsHide:true,timeout:75000,env})
    console.log(run.stdout)
    assert.equal(run.status,0,run.stderr)
    const after=JSON.parse(fs.readFileSync(path.join(profile,'save.json'),'utf8')).state
    assert.equal(after.weekendEvent.family,'D')
    assert.equal(after.encounter.battle.foeOverride.bossHpMax,300000)
    assert.equal(after.encounter.battle.foeOverride.threat,191)
    assert.deepEqual(Object.values(after.encounter.battle.units).filter(unit=>unit.side==='foe'&&unit.tag.startsWith('w3-')).map(unit=>unit.foeShipId).sort(),
      ['foe-d-invasion-eternal-tomb','foe-d-invasion-oathkeeper','foe-d-invasion-bastion','foe-d-invasion-bastion'].sort())
    if(gear) {
      assert.equal(after.encounter.battle.meCrisisActive.player,true)
      assert(after.encounter.battle.meRailStacks['player#0']>=3)
    }
    console.log(JSON.stringify({ok:true,target:path.resolve('apps/desktop/out'),isolatedSave:true,IPCSaved:true}))
  } finally {
    const target=path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('whale-gravekeeper-'))
    fs.rmSync(target,{recursive:true,force:true})
  }
} else {
  const {app,BrowserWindow}=require('electron')
  BrowserWindow.prototype.show=function(){}
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async()=>{
    const win=BrowserWindow.getAllWindows()[0];assert(win)
    win.webContents.setBackgroundThrottling(false)
    const errors=[]
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)})
    const js=source=>win.webContents.executeJavaScript(source)
    async function until(source) {
      for(let i=0;i<150;i++){try{if(await js(source))return}catch{}await sleep(100)}
      throw new Error('等待超时:'+source)
    }
    await until('!!document.querySelector(".app-root")')
    if(await js('!!document.querySelector(".app-battle-float")'))await js('document.querySelector(".app-battle-float").click()')
    await until('!!document.querySelector(".app-battle-screen:not(.is-report)")')
    const names=await js('document.querySelector(".app-battle-screen").textContent')
    assert(names.includes('永陵'))
    await js(`(()=>{const el=[...document.querySelectorAll('.app-bts-chip.is-foe[data-tip-hover]')].find(el=>el.textContent.includes('敌挂载'));if(!el)throw new Error('缺少敌方挂载入口');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));return true})()`)
    await until(`!![...document.querySelectorAll('.app-tip [data-battle-mount]')].find(el=>el.textContent.includes('陵寝重构协议'))`)
    if(gear) {
      assert(names.includes('危机超载协议'))
      assert(await js('!!document.querySelector("[data-battle-weapon-cycle][aria-label*=磁轨蓄能炮]")'))
    }
    await js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(500)
    const before=JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA,'save.json'),'utf8')).state.encounter.battle
    assert(before&&before.foeOverride.bossHpMax===300000)
    assert(Number.isFinite(before.foeReviveAtMs))
    await win.webContents.reload()
    await until('!!document.querySelector(".app-root")')
    await sleep(500)
    await js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(500)
    const after=JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA,'save.json'),'utf8')).state.encounter.battle
    assert(after&&after.lastTickGameMs>=before.lastTickGameMs)
    assert.equal(after.foeReviveAtMs,before.foeReviveAtMs)
    assert.equal(errors.length,0,errors.join('\n'))
    console.log(JSON.stringify({ok:true,pid:process.pid,flagshipVisible:true,reloadContinues:true,runtimeErrors:0}))
    app.exit(0)
  }).catch(error=>{console.error(error);app.exit(1)})
}
