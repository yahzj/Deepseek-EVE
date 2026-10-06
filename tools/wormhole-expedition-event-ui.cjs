/** 六事件72组UI分支测试，合成当前事件，不是十层旅程。
 * 游戏v0.1.0 / 档v31；2026-10-06。
 * 用法：npm run build --prefix web，然后node tools/wormhole-expedition-event-ui.cjs。
 * 六事件×中英×双布局×1366x768/390x844/568x320；每组检查20组件、0回合、3包额度。
 * 输入仅fixture.state的离线副本；真实UI打开、滚动、免费退出，不注入战斗胜负。
 * 输出tools/_ui-artifacts/wormhole-expedition-event-ui.json及截图；自建localhost/profile/PID。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const {
  ROOT, OUTPUT, sleep, dependencies, createFixture, settingsScript, CdpConnection, JourneyPage,
  staticServer, stopOwned, removeProfile,
} = require('./wormhole-expedition-journey-shared.cjs')

const EVENTS = ['maintenance', 'transport', 'controller', 'relay', 'storm', 'distress']
const VIEWPORTS = [[1366, 768, false], [390, 844, true], [568, 320, true]]

function makeBranch(input, key, boundary) {
  const { core, grid } = dependencies()
  const state = structuredClone(input.made.state)
  const run = state.wormhole.run
  const cell = grid.gridCellAt(run.grid, run.grid.pos)
  const other = run.grid.cells.find(candidate => candidate.key !== cell.key)
  cell.place = 'empty'
  delete cell.foe
  delete cell.elite
  delete cell.eventResolved
  cell.eventKey = key
  cell.event = {
    supply: { 'repairkit-mil': 20, 'drone-assault': 4 }, containerId: 'box-relic-a',
    identity: 'ambush', intelKey: other.key, ruinsKey: other.key,
  }
  if (key === 'controller') other.place = 'ruins'
  run.pendingEvent = { key, cellKey: cell.key }
  run.supplies.items['repairkit-mil'] = 20
  run.turnsLeft = boundary === 'zero-turns' ? 0 : Math.max(8, run.turnsLeft)
  run.supplyPackagesTaken = boundary === 'quota-three' ? 3 : 0
  state.modeChosen = true
  state.onboarding.step = 99
  return { state, save: core.serializeSaveFile(state, Date.now()) }
}

async function reach(page, selector) {
  await page.js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`)
  await page.js(`(async()=>{
    const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('选项没有渲染');
    let previous,stable=0;
    for(let frame=0;frame<120;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const r=el.getBoundingClientRect(),sample=[r.x,r.y,r.width,r.height];
      for(let parent=el.parentElement;parent;parent=parent.parentElement)sample.push(parent.scrollLeft,parent.scrollTop);
      if(previous&&sample.length===previous.length&&sample.every((value,index)=>Math.abs(value-previous[index])<.2))stable++;else stable=0;
      previous=sample;
      if(stable>=4)return true;
    }
    throw Error('滚动/控件矩形未稳定');
  })()`)
  const geometry = await page.js(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('选项没有渲染');
    const rect=el.getBoundingClientRect();let l=Math.max(0,rect.left),t=Math.max(0,rect.top),r=Math.min(innerWidth,rect.right),b=Math.min(innerHeight,rect.bottom);
    for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(s.overflow+s.overflowX+s.overflowY)){l=Math.max(l,q.left);t=Math.max(t,q.top);r=Math.min(r,q.right);b=Math.min(b,q.bottom)}}
    const points=[[(l+r)/2,(t+b)/2],[l+(r-l)*.25,t+(b-t)*.25],[l+(r-l)*.75,t+(b-t)*.75]];
    const point=points.find(([x,y])=>{const hit=document.elementFromPoint(x,y);return hit&&(hit===el||el.contains(hit))});
    return {width:rect.width,height:rect.height,visibleWidth:r-l,visibleHeight:b-t,disabled:el.disabled,text:el.textContent.trim(),stableFrames:4,point:point?{x:point[0],y:point[1]}:null};
  })()`)
  assert(geometry.visibleWidth > 1 && geometry.visibleHeight > 1 && geometry.point, `事件选项滚动后不可达:${selector}:${JSON.stringify(geometry)}`)
  return geometry
}

async function clickAt(page, point, mobile) {
  if (mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await sleep(60)
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
}

async function branchCheck(cdp, url, input, options) {
  const { locale, layout, width, height, mobile, key, boundary } = options
  const { core, data } = dependencies()
  const fixture = makeBranch(input, key, boundary)
  const ctx = data.buildSimContext(locale)
  const model = core.wormholeEventView(fixture.state, ctx)
  assert(model, '专项夹具没有合法事件预览')
  const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let page
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('专项CDP连接失败')), { once: true })
    })
    const connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection), { touch: mobile })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width, height, screenWidth: width, screenHeight: height, mobile, deviceScaleFactor: 1,
      screenOrientation: { type: width < height ? 'portraitPrimary' : 'landscapePrimary', angle: width < height ? 0 : 90 },
    })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
    const script = `${settingsScript(input.announcement, fixture.save)};localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});`
    const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: script })
    await page.send('Page.navigate', { url })
    await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    await sleep(250)
    for (let n = 0; n < 20; n++) {
      if (!await page.js('!!document.querySelector(".app-modal-mask .app-comms-eave-extra button")')) break
      await page.tap('.app-modal-mask .app-comms-eave-extra button')
    }
    await page.tap('.app-activitybar-item.is-wormhole')
    await page.wait(`!!document.querySelector('[data-wh-event=${key}]')`)
    const selector = `[data-wh-event=${key}]`
    const content = await page.js(`document.querySelector(${JSON.stringify(selector)}).innerText`)
    assert(content.includes(data.L10N[model.titleId][locale]), '事件标题未按当前语言显示')
    assert(!/\{p\d|ui\.whExpedition\./.test(content), '未填参数或文案ID泄露')
    const actions = []
    for (const choice of model.choices) {
      const button = `[data-wh-event-action=${JSON.stringify(choice.action)}]`
      const measured = await reach(page, button)
      assert.equal(measured.text, data.L10N[choice.labelId][locale], '选项文案未按当前语言显示')
      assert.equal(measured.disabled, !choice.plan.ok, 'UI拒绝状态与core预览不一致')
      if (choice.rejection) {
        const rejectionText = await page.js(`document.querySelector(${JSON.stringify(button)}).closest('.app-wh-event-option').querySelector('[role=status]')?.textContent`)
        assert(rejectionText?.length > 0, '拒因未展示')
      }
      actions.push({ action: choice.action, battle: choice.plan.battle, error: choice.plan.error, ...measured })
    }
    if (key === 'maintenance' && boundary === 'ready-twenty-kit') assert(actions.find(action => action.action === 'repair').disabled === false, '20组件正好够时整修仍被拒绝')
    if ((key === 'transport' || key === 'maintenance') && boundary === 'quota-three') {
      const action = actions.find(choice => choice.action === (key === 'transport' ? 'supply' : 'search'))
      assert(action.disabled && action.error === 'packages-exhausted', '3包额度没有拒绝额外补给')
    }
    const free = key === 'distress' ? 'reject' : 'bypass'
    const before = await page.snapshot()
    const measured = await reach(page, `[data-wh-event-action=${JSON.stringify(free)}]`)
    assert.equal(measured.disabled, false, '免费退出被拒绝')
    const screenshot = `wormhole-expedition-event-ui-${key}-${locale}-${layout}-${width}-${height}-${boundary}.png`
    await page.screenshot(screenshot)
    await clickAt(page, measured.point, mobile)
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.pendingEvent === undefined', 5000)
    const after = await page.snapshot()
    assert.equal(after.wormhole.run.turnsLeft, before.wormhole.run.turnsLeft, '免费退出扣了回合')
    assert.equal(after.wormhole.run.patrolActionSeq, before.wormhole.run.patrolActionSeq, '免费退出推进巡逻')
    assert.deepEqual(after.wormhole.run.supplies, before.wormhole.run.supplies, '免费退出扣了组件/物资')
    assert.deepEqual(after.warehouse.items, before.warehouse.items, '免费退出改了母港库存')
    assert(!after.wormhole.run.battle, '免费退出产生战斗')
    assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
    return { boundary, success: true, actions, screenshot, freeAction: free, freeExitVerified: true }
  } catch (error) {
    const screenshot = `wormhole-expedition-event-ui-${key}-${locale}-${layout}-${width}-${height}-${boundary}-failure.png`
    await page?.screenshot(screenshot).catch(() => {})
    return { boundary, success: false, failure: error instanceof Error ? error.message : String(error), screenshot }
  } finally {
    socket.close()
    await fetch(`${cdp}/json/close/${target.id}`).catch(() => {})
  }
}

async function main() {
  const input = createFixture()
  const { server, url } = await staticServer(path.join(ROOT, 'web', 'dist'))
  const prefix = 'whale-whexpedition-event-ui-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const rows = []
  let chrome
  try {
    chrome = spawn(process.env.WH_JOURNEY_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log(`六事件专项自建Chrome PID ${chrome.pid}`)
    let debug
    for (let n = 0; n < 100; n++) {
      try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, '自建浏览器未启动')
    const cdp = `http://127.0.0.1:${debug.split('\n')[0]}`
    for (const locale of ['zh', 'en']) for (const layout of ['classic', 'modern']) {
      for (const [width, height, mobile] of VIEWPORTS) for (const key of EVENTS) {
        const row = { locale, layout, width, height, mobile, key, branches: [] }
        for (const boundary of ['ready-twenty-kit', 'zero-turns', 'quota-three']) row.branches.push(await branchCheck(cdp, url, input, { ...row, boundary }))
        row.success = row.branches.every(branch => branch.success)
        rows.push(row)
        await fs.mkdir(OUTPUT, { recursive: true })
        await fs.writeFile(path.join(OUTPUT, 'wormhole-expedition-event-ui.json'), JSON.stringify({ kind: 'synthetic-ui-branches-not-ten-layer-journey', pid: chrome.pid, rows, passed: rows.filter(result => result.success).length }, null, 2), 'utf8')
        console.log(JSON.stringify({ ...row, branches: row.branches.map(branch => ({ boundary: branch.boundary, success: branch.success, failure: branch.failure?.slice(0,180) })) }))
      }
    }
    assert.equal(rows.length, 72)
    assert(rows.every(row => row.success), `六事件72组专项失败:${rows.filter(row => !row.success).length}/72`)
    console.log('六事件72组UI专项全部通过；未执行风险战斗，不是十层通关。')
  } finally {
    await stopOwned(chrome)
    await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, prefix)
  }
}

module.exports = { reach, clickAt }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
