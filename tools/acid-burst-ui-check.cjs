/** 爆虫专属动画读数：真实BattleScreen与真实合成战斗，不访问个人档。
 * 用法：npm run ui:layout-css后，node tools/acid-burst-ui-check.cjs。
 * 游戏v0.1.0 / 档v31，2026-10-07；覆盖两布局、桌面/横屏/竖屏旋转、减少动态、近远死亡。
 * 合成容器直接挂载真组件，非完整应用或原生窗口验收；截图不代表观感通过。
 * 只创建临时Chrome profile及回环服务，结束仅关闭自建PID；输出tools/_ui-artifacts/acid-burst-20261007。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { build } = require('esbuild')
const { ROOT, sleep, staticServer, stopOwned, removeProfile, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/acid-burst-20261007')

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{buildSimContext}from'@whale/data';import{startFleetBattleFor,advanceBattleFor}from'../packages/core/src/combat';
    import{triggerAcidBurst}from'../packages/core/src/alienCombat';import{createFoeSpecs}from'../packages/core/src/foeSpecs';
    import{alienFixture}from'./alien-invasion-fixture';import{BattleScreen}from'../apps/desktop/src/renderer/src/panels/BattleScreen';
    const base=buildSimContext(),def=base.ships.get('sh-megalodon');
    const ctx={...base,ships:new Map([...base.ships,[def.id,{...def,shieldHp:900000,armorHp:900000,hullHp:900000}]])};
    const{state,ships}=alienFixture(ctx,'heavy',611,4);for(const id of ships)state.fleet[id].fitted={high:[],mid:[],low:[]};
    const id='alien-vanguard',battle=startFleetBattleFor(state,ctx,ships,id,0,200);battle.distanceM=200;
    for(const unit of Object.values(battle.units))if(unit.side==='me')unit.weapons=unit.weapons.map(()=>100000);
    state.expedition={...state.expedition,active:true,phase:'battle',anomalyId:id,battle};
    const engine={state,ctx,wormholeSpeedActive:()=>1,wormholeSpeedOptions:()=>[],setWormholeSpeed:()=>{},battleSetDesireAt:()=>({ok:true}),retreatNow:()=>({ok:true})};
    let refresh,remount;function App(){const[,tick]=useState(0),[key,setKey]=useState(0);refresh=()=>tick(x=>x+1);remount=()=>setKey(x=>x+1);return <BattleScreen key={key} engine={engine} onToast={()=>{}} onClose={()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
    window.acidProbe={step:(scenario)=>{if(scenario!=='attack'){const foe=createFoeSpecs(ctx.anomalies.get(id),ctx.balance.battle)[0];battle.units[foe.tag].hp={s:0,a:0,h:0};battle.distanceM=scenario==='far'?500:200;triggerAcidBurst(battle,foe,'killed',0);}state.gameMs+=100;advanceBattleFor(state,ctx,battle,state.shipId,id);refresh();return{corrosion:battle.alienCorrosion,shots:battle.stats.foeShots,events:battle.fx.filter(e=>e.acidBurst)}},remount:()=>remount(),refresh:()=>refresh()};`,
      resolveDir: path.join(ROOT, 'tools'), loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', outfile: path.join(OUT, 'probe.js'), jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@whale/core': path.join(ROOT, 'packages/core/src/index.ts'), '@whale/data': path.join(ROOT, 'packages/data/src/index.ts'), '@whale/ui': path.join(ROOT, 'packages/ui/src/index.tsx') },
    plugins: [{ name: 'fixture-assert', setup(api) {
      api.onResolve({ filter: /^node:assert\/strict$/ }, () => ({ path: 'fixture-assert', namespace: 'probe' }))
      api.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({ contents: 'export default function assert(value,message){if(!value)throw Error(message)}', loader: 'js' }))
    } }],
  })
  await fs.copyFile(path.join(ROOT, 'packages/ui/src/index.css'), path.join(OUT, 'ui.css'))
  for (const layout of ['classic', 'modern']) await fs.copyFile(path.join(ROOT, `apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`), path.join(OUT, `${layout}.css`))
  await fs.writeFile(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"><link id="layout" rel="stylesheet" href="./classic.css"><div id="root" class="app-root is-layout-classic" style="height:100vh"></div><script src="./probe.js"></script>')
  const { server, url } = await staticServer(OUT)
  const prefix = 'whale-acid-fx-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  let chrome, socket
  try {
    chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log(`隔离动画读数 PID=${chrome.pid}`)
    let debug
    for (let i = 0; i < 100; i++) { try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket), page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('whale-idle:locale','zh');" })
    const reports = []
    const cases = ['classic', 'modern'].flatMap(layout => [[1366, 768], [844, 390], [390, 844]].map(([width, height]) => ({layout,width,height,scenario:'attack'})))
    cases.push({layout:'classic',width:1366,height:768,scenario:'killed'},{layout:'modern',width:1366,height:768,scenario:'far'})
    for (const {layout,width,height,scenario} of cases) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url })
      await page.wait('!!window.acidProbe && !!document.querySelector(".app-battle-screen")')
      await page.js(`document.getElementById('layout').href='./${layout}.css';document.getElementById('root').className='app-root is-layout-${layout}'`)
      if (width === 390) await page.js(`(()=>{const root=document.getElementById('root');root.classList.add('is-mobile-rot');for(const[key,value]of Object.entries({'--mob-w':'1200px','--mob-h':'554.502px','--mob-scale':'0.703333','--mob-y':'844px','--mob-x':'0px'}))root.style.setProperty(key,value)})()`)
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: width === 390 ? 'reduce' : 'no-preference' }] })
      await sleep(600)
      const before = await page.js(`(()=>{const lane=document.querySelector('.app-bts-lane');const rect=lane.getBoundingClientRect();return {lane:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},foes:[...document.querySelectorAll('.app-bts-unit')].map(e=>({tag:e.dataset.tag,box:e.getBoundingClientRect().toJSON()}))}})()`)
      const state = await page.js(`window.acidProbe.step(${JSON.stringify(scenario)})`)
      if (scenario !== 'far') await page.wait('document.querySelectorAll("[data-acid-kind=burst]").length===5', 3000)
      await sleep(scenario === 'attack' ? 120 : 540)
      if (scenario === 'far') { await page.js('window.acidProbe.refresh()');await sleep(60) }
      const effects = await page.js(`(()=>{const nodes=[...document.querySelectorAll('[data-acid-kind]')];return {bolts:document.querySelectorAll('.app-bts-bolt,.app-bts-beamline').length,boom:document.querySelectorAll('.app-bts-boom').length,nodes:nodes.map(e=>({kind:e.dataset.acidKind,tag:e.dataset.acidTag,box:e.getBoundingClientRect().toJSON(),color:getComputedStyle(e).color,opacity:getComputedStyle(e.firstElementChild).opacity,animation:getComputedStyle(e.firstElementChild).animationName})),units:[...document.querySelectorAll('.app-bts-unit')].map(e=>({tag:e.dataset.tag,box:e.querySelector('.app-bts-corpse').getBoundingClientRect().toJSON()})),hidden:[...document.querySelectorAll('.app-bts-unit .app-bts-corpse')].every(e=>getComputedStyle(e).opacity==='0')}})()`)
      await fs.writeFile(path.join(OUT, `diagnostic-${scenario}-${layout}-${width}.json`), JSON.stringify({state,before,effects,errors:connection.errors},null,2))
      if (scenario === 'far') {
        assert.equal(effects.nodes.length,0);assert.equal(state.events.length,0);assert.equal(state.corrosion,undefined);assert.equal(effects.boom,1)
        reports.push({layout,width,height,scenario,state,before,effects});console.log('远距击杀：无腐蚀或专属爆发，普通死亡爆炸保留');continue
      }
      assert.equal(effects.bolts, 0); assert.equal(effects.boom, 0); assert(effects.hidden)
      assert.equal(effects.nodes.filter(e=>e.kind==='coating').length, 4)
      assert(effects.nodes.every(e=>e.box.width>0 && e.box.height>0 && Number(e.opacity)>0))
      if (width === 390) assert(effects.nodes.every(e=>e.animation==='app-bts-acid-coat'))
      for (const effect of effects.nodes.filter(e=>e.kind==='burst')) {
        const unit=effects.units.find(e=>e.tag===effect.tag)
        assert(unit)
        assert(Math.abs((effect.box.left+effect.box.right-unit.box.left-unit.box.right)/2)<1, '爆发横坐标偏离本体')
        assert(Math.abs((effect.box.top+effect.box.bottom-unit.box.top-unit.box.bottom)/2)<1, '爆发纵坐标偏离本体')
      }
      assert.equal(state.events.length, 5); assert(Math.abs(state.corrosion-.75)<1e-8)
      const snap = await page.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(OUT, `${scenario}-${layout}-${width}.png`), Buffer.from(snap.data, 'base64'))
      await sleep(1200)
      assert.equal(await page.js('document.querySelectorAll("[data-acid-kind]").length'), 0)
      await page.js('window.acidProbe.remount()'); await sleep(250)
      assert.equal(await page.js('document.querySelectorAll("[data-acid-kind]").length'), 0)
      reports.push({ layout, width, height, scenario, state, before, effects })
      console.log(`${scenario}/${layout}/${width}: 5次本体爆发、4舰附着，无通用弹道或重复爆炸；清理/重进通过`)
    }
    assert.equal(connection.errors.length, 0)
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ reports, errors: connection.errors, scope: '真实BattleScreen、合成引擎、隔离桌面及横屏手机读数；非观感验收。' }, null, 2))
  } finally { socket?.close(); await stopOwned(chrome); await new Promise(resolve=>server.close(resolve)); await removeProfile(profile,prefix) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
