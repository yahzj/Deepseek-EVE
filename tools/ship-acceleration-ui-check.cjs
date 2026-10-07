/** 加速状态真实舰影读数；游戏v0.1.0 / 档v31，2026-10-07。
 * 用法：npm run ui:layout-css后，node tools/ship-acceleration-ui-check.cjs。
 * 合成容器挂载真BattleScreen与真引擎视图，非完整应用/原生窗口观感验收。
 * 覆盖两布局、桌面/横屏/竖屏旋转、逐舰周期/捕获网/死亡、静止交距、镜像及减少动态。
 * 仅自建Chrome临时profile与回环服务，结束关闭自己的PID；不读取个人档。
 * 输出tools/_ui-artifacts/ship-acceleration-20261007。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { build } = require('esbuild')
const { ROOT, sleep, staticServer, stopOwned, removeProfile, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/ship-acceleration-20261007')

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{buildSimContext}from'@whale/data';import{createInitialState,addShipToFleet}from'@whale/core';
    import{startFleetBattleFor,advanceBattleFor}from'../packages/core/src/combat';
    import{BattleScreen}from'../apps/desktop/src/renderer/src/panels/BattleScreen';
    const ctx=buildSimContext(),state=createInitialState({nowWallMs:0,seed:611});
    const fleet=['sh-megalodon','sh-megalodon','sh-wh-c-frigate','sh-wh-c-frigate'].map(id=>addShipToFleet(state,id));
    state.shipId=fleet[0];for(const id of fleet)state.fleet[id].fitted={high:[],mid:[],low:[]};
    state.fleet[fleet[0]].fitted.mid=['mod-prop-1'];state.fleet[fleet[1]].fitted.mid=['mod-mwd-1'];state.fleet[fleet[2]].fitted.mid=['mod-prop-1'];
    const card='alien-main',battle=startFleetBattleFor(state,ctx,fleet,card,0,10000);
    state.gameMs=100;advanceBattleFor(state,ctx,battle,state.shipId,card);battle.myDesireM=10000;battle.lastTickGameMs=3000;
    state.expedition={...state.expedition,active:true,phase:'battle',anomalyId:card,battle};
    const engine={state,ctx,wormholeSpeedActive:()=>1,wormholeSpeedOptions:()=>[],setWormholeSpeed:()=>{},battleSetDesireAt:()=>({ok:true}),retreatNow:()=>({ok:true})};
    let refresh;function App(){const[,tick]=useState(0);refresh=()=>tick(x=>x+1);return <BattleScreen engine={engine} onToast={()=>{}} onClose={()=>{}}/>};
    createRoot(document.getElementById('root')).render(<App/>);
    window.accelProbe={clock:t=>{battle.lastTickGameMs=t;refresh()},web:()=>{const tag=battle.myFleet[0].tag;battle.meWebDebuffs={[tag]:{byTag:'foe-0',slowMul:.5,noThruster:true,noEvasion:true,rangeDownM:1000,atMs:0}};refresh()},stop:()=>{delete battle.meWebDebuffs;battle.lastTickGameMs=3000;for(const rt of Object.values(battle.foeCharges))rt.on=false;battle.units[battle.myFleet[2].tag].hp={s:0,a:0,h:0};refresh()}};`,
    resolveDir: path.join(ROOT, 'tools'), loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', outfile: path.join(OUT, 'probe.js'), jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@whale/core': path.join(ROOT, 'packages/core/src/index.ts'), '@whale/data': path.join(ROOT, 'packages/data/src/index.ts'), '@whale/ui': path.join(ROOT, 'packages/ui/src/index.tsx') },
  })
  await fs.copyFile(path.join(ROOT, 'packages/ui/src/index.css'), path.join(OUT, 'ui.css'))
  for (const layout of ['classic', 'modern']) await fs.copyFile(path.join(ROOT, `apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`), path.join(OUT, `${layout}.css`))
  await fs.writeFile(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"><link id="layout" rel="stylesheet" href="./classic.css"><div id="root" class="app-root is-layout-classic" style="height:100vh"></div><script src="./probe.js"></script>')
  const { server, url } = await staticServer(OUT)
  const prefix = 'whale-ship-acceleration-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  let chrome, socket
  try {
    chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log(`自建加速读数Chrome PID=${chrome.pid}`)
    let debug
    for (let i=0;i<100;i++) { try { debug=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');break } catch { await sleep(100) } }
    assert(debug)
    const target=await(await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`,{method:'PUT'})).json()
    socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
    const connection=new CdpConnection(socket),page=new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable');await page.send('Runtime.enable')
    const read=`(()=>({rows:[...document.querySelectorAll('[data-tag]')].filter(e=>e.querySelector('.app-bts-ship')).map(e=>{const s=e.querySelector('.app-bts-ship');return {tag:e.dataset.tag,mode:s.dataset.acceleration??'',box:s.getBoundingClientRect().toJSON(),flames:s.querySelectorAll('.accel-flame').length,lines:s.querySelectorAll('.accel-lines').length,flip:s.querySelector('.app-bts-acceleration>g')?.style.transform,animation:s.querySelector('.accel-lines')?getComputedStyle(s.querySelector('.accel-lines')).animationName:'',transform:s.querySelector('.accel-lines')?getComputedStyle(s.querySelector('.accel-lines')).transform:''}})}))()`
    const reports=[]
    for(const layout of ['classic','modern'])for(const[width,height]of [[1366,768],[844,390],[390,844]]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      await page.send('Page.navigate',{url});await page.wait('!!window.accelProbe&&!!document.querySelector(".app-battle-screen")')
      await page.js(`document.getElementById('layout').href='./${layout}.css';document.getElementById('root').className='app-root is-layout-${layout}'`)
      if(width===390)await page.js(`(()=>{const root=document.getElementById('root');root.classList.add('is-mobile-rot');for(const[k,v]of Object.entries({'--mob-w':'1200px','--mob-h':'554.502px','--mob-scale':'0.703333','--mob-y':'844px','--mob-x':'0px'}))root.style.setProperty(k,v)})()`)
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===390?'reduce':'no-preference'}]})
      await sleep(1100)
      const active=await page.js(read)
      assert.equal(active.rows.filter(r=>r.mode==='boost').length,3)
      assert.equal(active.rows.filter(r=>r.mode==='charge').length,4)
      assert(active.rows.filter(r=>r.mode==='charge').every(r=>r.flames===0&&r.lines===1))
      assert(active.rows.every(r=>r.box.width>0&&r.box.height>0))
      if(width===390)assert(active.rows.filter(r=>r.mode).every(r=>r.animation==='none'))
      else {await sleep(130);const moving=await page.js(read);assert(active.rows.some((r,i)=>r.mode&&r.transform!==moving.rows[i].transform),'静止交距下速度线未运动')}
      await fs.writeFile(path.join(OUT,`${layout}-${width}.png`),Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
      await page.js('window.accelProbe.clock(10000)');await sleep(200)
      const shortOff=await page.js(read);assert.equal(shortOff.rows.filter(r=>r.mode==='boost').length,2)
      await page.js('window.accelProbe.web()');await sleep(200)
      const web=await page.js(read);assert.equal(web.rows.filter(r=>r.mode==='boost').length,1)
      await page.js('window.accelProbe.clock(60000)');await sleep(200)
      const cool=await page.js(read);assert.equal(cool.rows.filter(r=>r.mode==='boost').length,0)
      await fs.writeFile(path.join(OUT,`diagnostic-${layout}-${width}.json`),JSON.stringify({active,shortOff,web,cool},null,2))
      for(const row of cool.rows){const old=active.rows.find(r=>r.tag===row.tag);assert(Math.abs(old.box.width-row.box.width)<1&&Math.abs(old.box.height-row.box.height)<1,'加速开关改变舰影尺寸')}
      await page.js('window.accelProbe.stop()');await sleep(200)
      const stopped=await page.js(read);assert.equal(stopped.rows.filter(r=>r.mode==='charge').length,0);assert.equal(stopped.rows.filter(r=>r.mode==='boost').length,2)
      reports.push({layout,width,height,active,shortOff,web,cool,stopped})
      console.log(`${layout}/${width}：逐舰点火/短周期/网/冷却/死亡/冲锋解除及尺寸通过`)
    }
    assert.equal(connection.errors.length,0)
    await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({reports,errors:connection.errors,scope:'真实BattleScreen、合成状态与只读引擎视图；读数不代表观感验收。'},null,2))
  }finally{socket?.close();await stopOwned(chrome);await new Promise(resolve=>server.close(resolve));await removeProfile(profile,prefix)}
}
main().catch(error=>{console.error(error);process.exitCode=1})
