/** 战斗距离轴遮挡回归：node tools/battle-distance-axis-check.cjs。
 * 合成状态挂载真实 BattleScreen，隐藏 Electron 测双布局/桌面/手机旋转与滑条键盘操作。
 * 不读个人档；报告与截图输出 tools/_ui-artifacts/battle-distance-axis-20261105/。
 * 游戏v0.1.0 / 档v31；核对与运行2026-11-05，跨两个存档版本须复核夹具。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { build } = require('esbuild')
const { ROOT, JourneyPage, sleep, staticServer, removeProfile } = require('./wormhole-expedition-journey-shared.cjs')

const OUT = path.join(ROOT, 'tools/_ui-artifacts/battle-distance-axis-20261105')

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  await build({
    stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{buildSimContext}from'@whale/data';import{createInitialState,addShipToFleet,battleArcsFor}from'@whale/core';
      import{startFleetBattleFor}from'../packages/core/src/combat';
      import{BattleScreen}from'../apps/desktop/src/renderer/src/features/combat/BattleScreen';
      const ctx=buildSimContext(),state=createInitialState({nowWallMs:0,seed:611});
      state.shipId=addShipToFleet(state,'sh-megalodon');
      const battle=startFleetBattleFor(state,ctx,[state.shipId],'ano-training',0,10000);
      if(!battle)throw Error('battle fixture failed');
      battle.distanceM=5000;battle.myDesireM=5000;
      state.expedition={...state.expedition,active:true,phase:'battle',anomalyId:'ano-training',battle};
      let refresh=()=>{};let writes=0;let viewKey=0;
      const engine={state,ctx,wormholeSpeedActive:()=>1,wormholeSpeedOptions:()=>[],
        battleSetDesireAt:(v)=>{battle.myDesireM=v;writes++;refresh();return{ok:true}},retreatNow:()=>({ok:true})};
      function App(){const[,tick]=useState(0);refresh=()=>tick(n=>n+1);
        return <BattleScreen key={viewKey} engine={engine} onToast={()=>{}} onClose={()=>{}}/>}
      createRoot(document.getElementById('mount')).render(<App/>);
      window.axisCheck={set:(ratio)=>{const arcs=battleArcsFor(state,ctx);const near=arcs.nearM,far=arcs.maxM;
        battle.distanceM=far-ratio*(far-near);battle.myDesireM=battle.distanceM;viewKey++;refresh()},writes:()=>writes};`,
      resolveDir: path.join(ROOT, 'tools'), loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', outfile: path.join(OUT, 'probe.js'), jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'axis-no-audio', setup(api) {
      api.onLoad({ filter: /[\\/]features[\\/]combat[\\/]battleSfx\.ts$/ }, () => ({ contents: 'export const useBattleSfx=()=>{}', loader: 'js' }))
    } }],
    alias: { '@whale/core': path.join(ROOT, 'packages/core/src/index.ts'), '@whale/data': path.join(ROOT, 'packages/data/src/index.ts'), '@whale/ui': path.join(ROOT, 'packages/ui/src/index.tsx') },
  })
  await fs.copyFile(path.join(ROOT, 'packages/ui/src/index.css'), path.join(OUT, 'ui.css'))
  for (const layout of ['classic', 'modern']) await fs.copyFile(path.join(ROOT, `apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`), path.join(OUT, `${layout}.css`))
  await fs.writeFile(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><link id="layout" rel="stylesheet" href="classic.css"><link rel="stylesheet" href="probe.css"><div id="root"><div id="axis-root" class="app-root is-layout-classic" style="height:100vh"><div id="mount"></div></div></div><script src="probe.js"></script>')
  const { server, url } = await staticServer(OUT)
  const prefix = 'whale-distance-axis-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const env = { ...process.env, BATTLE_AXIS_CHECK_URL: url, BATTLE_AXIS_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
  console.log(`距离轴隐藏Electron PID=${child.pid}`)
  const timer = setTimeout(() => child.kill(), 90000)
  try {
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '距离轴原生几何检查失败')
  } finally {
    clearTimeout(timer)
    await new Promise(resolve => server.close(resolve))
    assert.equal(await fs.realpath(profile), path.resolve(profile), '不清理链接指向的临时目录')
    await removeProfile(profile, prefix)
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  console.log('距离轴检查：等待Electron就绪')
  const profile = process.env.BATTLE_AXIS_CHECK_PROFILE
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith('whale-distance-axis-'))
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  app.disableHardwareAcceleration()
  await app.whenReady()
  console.log('距离轴检查：创建离屏窗口')
  const win = new BrowserWindow({ width: 1366, height: 768, show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true, nodeIntegration: false, contextIsolation: true } })
  win.webContents.on('paint', () => {})
  await win.loadURL(process.env.BATTLE_AXIS_CHECK_URL)
  console.log('距离轴检查：页面已加载')
  win.webContents.debugger.attach('1.3')
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage(win.webContents.debugger.sendCommand.bind(win.webContents.debugger))
  const rows = []
  try {
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.wait('!!window.axisCheck&&!!document.querySelector(".app-bts-axisTrack")')
    for (const layout of ['classic', 'modern']) for (const [width, height] of [[1366, 768], [844, 390], [390, 844]]) {
      win.setContentSize(width, height)
      await page.js(`(()=>{const root=document.getElementById('axis-root');root.className='app-root is-layout-${layout}';root.removeAttribute('style');if(${width}!==390)root.style.height='100vh';document.getElementById('layout').href='${layout}.css';
        if(${width}===390){root.classList.add('is-mobile-rot');for(const[k,v]of Object.entries({'--mob-w':'1200px','--mob-h':'554.502px','--mob-scale':'0.703333','--mob-y':'844px','--mob-x':'0px'}))root.style.setProperty(k,v)}})()`)
      await sleep(500)
      for (const ratio of [0, .5, 1]) {
        await page.js(`window.axisCheck.set(${ratio})`)
        await sleep(300)
        const row = await page.js(`(()=>{const track=document.querySelector('.app-bts-axisTrack'),scale=track.querySelector('.app-bts-scale'),knob=track.querySelector('.app-bts-knob'),chip=track.querySelector('.app-bts-cur-chip');
          const rel=e=>{let y=0;for(let p=e;p&&p!==track;p=p.offsetParent)y+=p.offsetTop;return y};
          const localTop=e=>rel(e)+new DOMMatrixReadOnly(getComputedStyle(e).transform).m42;
          const bounds=e=>e.getBoundingClientRect().toJSON();const chipBottom=localTop(chip)+chip.offsetHeight;
          return{scaleCenter:localTop(scale)+scale.offsetHeight/2,knobCenter:localTop(knob)+knob.offsetHeight/2,
            gap:localTop(knob)-chipBottom,chip:bounds(chip),knob:bounds(knob),text:chip.textContent.trim(),
            value:Number(knob.value),scaleHeight:scale.offsetHeight,knobHeight:knob.offsetHeight}})()`)
        rows.push({ layout, width, height, ratio, ...row })
        assert(Math.abs(row.scaleCenter - row.knobCenter) <= 2, `滑块未对齐刻度:${JSON.stringify(rows.at(-1))}`)
        assert(row.gap >= 2, `距离读数被滑块覆盖:${JSON.stringify(rows.at(-1))}`)
        assert(row.chip.left >= 0 && row.chip.top >= 0 && row.chip.right <= width && row.chip.bottom <= height, `读数越出视口:${JSON.stringify(rows.at(-1))}`)
        if (ratio === .5) {
          await fs.writeFile(path.join(OUT, `${layout}-${width}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
          const before = await page.js('window.axisCheck.writes()')
          await page.js(`document.querySelector('.app-bts-knob').focus()`)
          await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
          await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
          await sleep(200)
          assert(await page.js('window.axisCheck.writes()') > before, '滑块键盘操作未提交期望距离')
          const pointer = await page.js(`(()=>{const input=document.querySelector('.app-bts-knob'),box=input.getBoundingClientRect();
            return ${width}===390?{x:box.x+box.width/2,y:box.y+box.height*.5,endX:box.x+box.width/2,endY:box.y+box.height*.7}
              :{x:box.x+box.width*.5,y:box.y+box.height/2,endX:box.x+box.width*.7,endY:box.y+box.height/2}})()`)
          const beforeDrag = await page.js('window.axisCheck.writes()')
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointer.x, y: pointer.y, button: 'left', clickCount: 1 })
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.endX, y: pointer.endY, button: 'left', buttons: 1 })
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer.endX, y: pointer.endY, button: 'left', clickCount: 1 })
          await sleep(250)
          assert(await page.js('window.axisCheck.writes()') > beforeDrag, '滑块鼠标拖动未提交期望距离')
        }
      }
    }
    assert.equal(errors.length, 0)
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, target: '真实BattleScreen＋合成状态，隐藏Electron；非个人档或观感验收', rows, errors }, null, 2))
    console.log(`距离轴检查通过：${rows.length}组几何，6组键盘及6组拖动操作`)
  } catch (error) {
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: false, rows, errors, error: String(error) }, null, 2))
    throw error
  } finally {
    win.destroy()
  }
  app.quit()
}

;(process.argv.includes('--child') ? child() : parent()).catch(error => { console.error(error); process.exit(1) })
