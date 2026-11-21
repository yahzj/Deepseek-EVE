/** 正式本机构建的真实点击冒烟；只读合成档，不调用业务测试命令或虫洞step。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { CdpConnection, JourneyPage, settingsScript, staticServer, sleep, stopOwned, removeProfile } = require('../wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const { gameFixture } = require('./fixture.ts')
const { L10N } = require('../../packages/data/src/index.ts')
const { PLAYER_STATION_TEXT_IDS } = require('../../packages/data/src/playerStationText.ts')
const { loadSaveFile } = require('../../packages/core/src/save.ts')

const ROOT = path.resolve(__dirname, '../..')
const DIST = path.join(ROOT, 'tools/_ui-artifacts/player-station-game-dist')
const OUTPUT = path.join(ROOT, 'tools/_ui-artifacts', `player-station-game-smoke-${Date.now()}`)
const SAVE_KEY = 'whale:idle:save'
const MARKER = 'g[data-station-id="ancient-hibernation-station"]'
const CARD = 'section[data-station-id="ancient-hibernation-station"]'
const CONTENT = '.app-page-content[data-page="playerStation"]'
const PANEL = `${CONTENT} [role="tabpanel"]`
const TABS = ['construction', 'population', 'production', 'research', 'crew', 'security']
const text = id => {
  const key = PLAYER_STATION_TEXT_IDS[id] ?? id
  assert(L10N[key]?.zh, `缺少文案:${id}:${key}`)
  return L10N[key].zh
}

async function screenshot(page, name) {
  const image = await page.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(OUTPUT, `${name}.png`)
  await fs.writeFile(file, Buffer.from(image.data, 'base64'))
  return file
}

async function dismiss(page) {
  for (let n = 0, quiet = 0; n < 60 && quiet < 5; n++) {
    const selector = await page.js(`(()=>{for(const selector of ['.app-comm-pop .app-comms-eave-extra button','.app-comm-mask .app-comm-foot button','.app-modal-mask .app-comms-eave-extra button'])if(document.querySelector(selector))return selector;return null})()`)
    if (selector) { await page.tap(selector); quiet = 0 } else { quiet++; await sleep(100) }
  }
  if (await page.js('!!document.querySelector(".app-log-side:not(.is-collapsed) .app-log-head-right button")')) await page.tap('.app-log-head-right button')
}

async function openMap(page) {
  await dismiss(page)
  await page.text('.app-nav-side', text('ui.App.001'))
  await page.wait('!!document.querySelector(".app-starmap")')
}

async function navState(page) {
  return page.js(`(()=>{const buttons=[...document.querySelectorAll('.app-nav-side .app-nav-item')];return {station:buttons.filter(b=>b.textContent.trim()===${JSON.stringify(text('ui.playerStationGame.pageTitle'))}).length,oldStellar:buttons.filter(b=>b.dataset.navPage==='stellar'||b.dataset.navPage==='planetary'||b.textContent.trim()==='星系').map(b=>b.textContent.trim())}})()`)
}

async function openAncientCard(page) {
  await openMap(page)
  await page.wait(`!!document.querySelector(${JSON.stringify(MARKER)})`)
  await page.tap(MARKER)
  await page.wait(`!!document.querySelector(${JSON.stringify(CARD)})`)
  assert((await page.js('document.body.innerText')).includes('穹顶墓园'), '古站详情没有位于穹顶墓园')
}

async function checkRawIds(page) {
  const leaked = await page.js(`document.body.innerText.match(/(?:ui|core)\.playerStation(?:Game)?\.[A-Za-z0-9_.-]+/g)||[]`)
  assert.deepEqual(leaked, [], '可见界面泄漏本地化ID')
}

function assets(state) {
  return { warehouse: state.warehouse.items, fleet: state.fleet,
    people: state.playerStation?.population.people.filter(person => person.status !== 'dormant') ?? [], shipId: state.shipId }
}

async function persistAndRead(page) {
  // 唯一允许的写测试桥：正式存盘；绝不调用step或业务命令。
  const result = await page.command('persist')
  assert.equal(result.ok, true, '正式存盘失败')
  const saved = await page.js(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`)
  return loadSaveFile(saved).state
}

async function geometry(page) {
  return page.js(`(()=>{
    const root=document.querySelector('.app-root'),outer=document.querySelector(${JSON.stringify(CONTENT)}),panel=document.querySelector(${JSON.stringify(PANEL)});
    const controls=[...panel.querySelectorAll('button,input,select')].filter(el=>el.getClientRects().length);
    const overflow=[...panel.querySelectorAll('*')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+2&&getComputedStyle(el).overflowX!=='auto'&&getComputedStyle(el).overflowX!=='scroll').map(el=>({tag:el.tagName,class:el.className,width:el.clientWidth,scroll:el.scrollWidth})).slice(0,12);
    const before=panel.scrollTop;panel.scrollTop=panel.scrollHeight;const bottom=panel.scrollTop;panel.scrollTop=0;
    const last=controls.at(-1);let lastReachable=true;if(last){last.scrollIntoView({block:'nearest',inline:'nearest'});const a=last.getBoundingClientRect(),b=panel.getBoundingClientRect();lastReachable=a.left>=b.left-2&&a.right<=b.right+2&&a.top>=b.top-2&&a.bottom<=b.bottom+2}
    panel.scrollTop=before;
    const nav=document.querySelector('.app-nav-side'),navBox=nav.getBoundingClientRect(),rootBox=root.getBoundingClientRect();
    const navigation=[...nav.querySelectorAll('.app-nav-item')].map(el=>{const box=el.getBoundingClientRect(),x=(box.left+box.right)/2,y=(box.top+box.bottom)/2,hit=document.elementFromPoint(x,y);return {name:el.textContent.trim(),width:el.clientWidth,scroll:el.scrollWidth,reachable:box.left>=Math.max(navBox.left,rootBox.left)-2&&box.right<=Math.min(navBox.right,rootBox.right)+2&&box.top>=Math.max(navBox.top,rootBox.top)-2&&box.bottom<=Math.min(navBox.bottom,rootBox.bottom)+2&&!!hit&&(hit===el||el.contains(hit))}});
    const rootOverflow=[...root.querySelectorAll('*')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+2&&!panel.contains(el)&&getComputedStyle(el).overflowX!=='auto'&&getComputedStyle(el).overflowX!=='scroll').map(el=>({tag:el.tagName,class:el.className,width:el.clientWidth,scroll:el.scrollWidth,overflowX:getComputedStyle(el).overflowX})).slice(0,12);
    return {rootWidth:root.clientWidth,rootScroll:root.scrollWidth,rootScrollLeft:root.scrollLeft,rootOverflow,navigation,documentWidth:document.documentElement.clientWidth,documentScroll:document.documentElement.scrollWidth,outerHeight:outer.clientHeight,outerScrollHeight:outer.scrollHeight,panelWidth:panel.clientWidth,panelScrollWidth:panel.scrollWidth,panelHeight:panel.clientHeight,panelScrollHeight:panel.scrollHeight,overflowY:getComputedStyle(panel).overflowY,bottom,lastReachable,overflow,rotated:root.classList.contains('is-mobile-rot'),viewport:{width:innerWidth,height:innerHeight}};
  })()`)
}

async function main() {
  await fs.mkdir(OUTPUT, { recursive: true })
  const report = { target: DIST, output: OUTPUT, started: new Date().toISOString(), cases: [], screenshots: [], consoleErrors: [], exceptions: [], failures: [], success: false }
  report.buildModified = (await fs.stat(path.join(DIST, 'index.html'))).mtime.toISOString()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-player-station-game-'))
  let child, hosted, socket, page, connection, injection, timeout
  let currentCase = 'startup'
  try {
    hosted = await staticServer(DIST)
    report.url = hosted.url
    child = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' })
    report.ownedPid = child.pid
    console.log('自建 Chrome PID', child.pid, '输出', OUTPUT)
    timeout = setTimeout(() => { if (child?.exitCode === null) child.kill() }, 240_000)
    let portFile
    for (let n = 0; n < 100; n++) {
      try { portFile = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(portFile, '自建Chrome未启动调试端口')
    const target = await (await fetch(`http://127.0.0.1:${portFile.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection))
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        report.consoleErrors.push({ case: currentCase, text: message.params.args.map(arg => arg.value ?? arg.description).join(' ') })
      }
    })
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    const desktopUa = await page.js('navigator.userAgent')
    const boot = async (mode, layout, width, debug = true) => {
      currentCase = `${layout}-${width}-${mode}-${debug ? 'debug' : 'normal'}`
      console.log('开始', currentCase)
      const fixture = gameFixture(mode)
      page.touch = width < 500
      await page.send('Emulation.setUserAgentOverride', { userAgent: page.touch
        ? 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
        : desktopUa })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: page.touch, maxTouchPoints: page.touch ? 5 : 1 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width < 500 ? 844 : 768, screenWidth: width, screenHeight: width < 500 ? 844 : 768,
        deviceScaleFactor: 1, mobile: width < 500, screenOrientation: width < 500 ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 } })
      if (injection) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection })
      injection = (await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage.clear();${settingsScript(fixture.announcement, fixture.save, { debug, test: debug, layout, future: false })}`,
      })).identifier
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait(`!!document.querySelector('.app-root.is-layout-${layout}')${debug ? '&&!!window.__whExpeditionTest' : ''}`, 30_000)
      await page.wait(`document.querySelector('.app-root').classList.contains('is-mobile-rot')===${width < 500}`)
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection }); injection = null
      await dismiss(page)
      return fixture
    }

    for (const layout of ['classic', 'modern']) {
      await boot('unexplored', layout, 1366)
      await openMap(page)
      assert.equal(await page.js(`document.querySelectorAll(${JSON.stringify(MARKER)}).length`), 0, '未全探索泄漏古站标记')
      assert.equal(await page.js(`document.querySelectorAll(${JSON.stringify(CARD)}).length`), 0)
      await checkRawIds(page)
      report.cases.push({ case: currentCase, markerAbsent: true })

      await boot('discovered', layout, 1366)
      const nav = await navState(page)
      assert.equal(nav.station, 1, '调试空间站导航缺失')
      assert.deepEqual(nav.oldStellar, [], '旧stellar调试导航仍存在')
      await openAncientCard(page)
      await checkRawIds(page)
      report.screenshots.push(await screenshot(page, `${layout}-grave-card`))
      await page.text(CARD, text('ui.playerStationGame.enter'))
      await page.wait(`!!document.querySelector(${JSON.stringify(CONTENT)})`)
      const before = await page.snapshot()
      assert.equal(before.playerStation?.active ?? false, false)
      await page.text(CONTENT, text('ui.playerStationGame.activate'))
      await page.wait(`!!document.querySelector(${JSON.stringify(PANEL)})`)
      const activated = await page.snapshot()
      assert.equal(activated.playerStation.active, true)
      assert.deepEqual(assets(activated), assets(before), '激活凭空改变物资、舰船或人口')
      assert.equal(activated.playerStation.population.people.length, 6)
      assert(activated.playerStation.population.people.every(person => person.status === 'dormant'), '激活凭空复苏人口')
      await page.text(PANEL, text('ui.playerStation.approve'))
      await page.wait('window.__whExpeditionTest.snapshot().playerStation.station.bodyApproved')
      const approved = await page.snapshot()
      assert.deepEqual(assets(approved), assets(activated), '批准主体提前扣料或发放资产')
      await page.text(PANEL, text('ui.playerStationGame.deliverBody'))
      await page.wait('!!window.__whExpeditionTest.snapshot().playerStation.delivery')
      const transported = await page.snapshot(), delivery = transported.playerStation.delivery
      assert.equal(delivery.target, 'body')
      assert.notEqual(delivery.shipId, transported.shipId)
      assert(approved.fleet[delivery.shipId], '运输未绑定原有副船')
      assert.equal(transported.playerStation.shipLocks[delivery.shipId], 'population')
      assert(Object.keys(delivery.cargo).length > 0, '航单无实际物资')
      for (const id of new Set([...Object.keys(approved.warehouse.items), ...Object.keys(transported.warehouse.items)])) {
        assert.equal(transported.warehouse.items[id] ?? 0, (approved.warehouse.items[id] ?? 0) - (delivery.cargo[id] ?? 0), `原仓扣料不守恒:${id}`)
      }
      assert.deepEqual(transported.fleet, approved.fleet, '运输复制或改写原舰船')
      assert.deepEqual(transported.playerStation.population.people, approved.playerStation.population.people)
      const saved = await persistAndRead(page)
      assert.equal(saved.playerStation.delivery.shipId, delivery.shipId)
      assert.deepEqual(saved.playerStation.delivery.cargo, delivery.cargo)
      assert.equal(saved.playerStation.shipLocks[delivery.shipId], 'population')
      assert.deepEqual(saved.warehouse.items, transported.warehouse.items)
      await page.send('Page.reload')
      await page.wait('!!window.__whExpeditionTest&&!!document.querySelector(".app-root")')
      await dismiss(page)
      const reloaded = await page.snapshot()
      assert.deepEqual(reloaded.playerStation.delivery.cargo, delivery.cargo)
      assert.equal(reloaded.playerStation.delivery.shipId, delivery.shipId)
      assert.equal(reloaded.playerStation.shipLocks[delivery.shipId], 'population')
      await page.text('.app-nav-side', text('ui.playerStationGame.pageTitle'))
      await page.wait(`!!document.querySelector(${JSON.stringify(PANEL)})`)
      await checkRawIds(page)
      report.screenshots.push(await screenshot(page, `${layout}-body-delivery-reloaded`))
      report.cases.push({ case: currentCase, nav, markerCardEntry: true, activationNoAssets: true, approvalNoAssets: true,
        delivery: { shipId: delivery.shipId, cargo: delivery.cargo }, warehouseConserved: true, originalShipLocked: true, savedAndReloaded: true })

      for (const width of [1366, 390]) {
        await boot('ready', layout, width)
        await page.text('.app-nav-side', text('ui.playerStationGame.pageTitle'))
        await page.wait(`!!document.querySelector(${JSON.stringify(PANEL)})`)
        assert.equal(await page.js(`document.querySelectorAll(${JSON.stringify(CONTENT + ' [role="tab"]')}).length`), 6)
        const tabs = []
        for (const tab of TABS) {
          await page.text(`${CONTENT} [role="tablist"]`, text(`ui.playerStationGame.tab.${tab}`))
          await page.wait(`document.querySelector(${JSON.stringify(CONTENT + ' [role="tab"][aria-selected="true"]')})?.textContent.trim()===${JSON.stringify(text(`ui.playerStationGame.tab.${tab}`))}`)
          await checkRawIds(page)
          const reading = await geometry(page)
          const checks = {
            panelHasHeight: reading.panelHeight > 0,
            secondaryScroll: reading.overflowY === 'auto',
            panelNoHorizontalOverflow: reading.panelScrollWidth <= reading.panelWidth + 2,
            rootNoHorizontalOverflow: reading.rootScroll <= reading.rootWidth + 2,
            primaryNoVerticalOverflow: reading.outerScrollHeight <= reading.outerHeight + 2,
            lastControlReachable: reading.lastReachable,
            descendantsNoHorizontalOverflow: reading.overflow.length === 0,
            modernNavigationReachable: layout !== 'modern' || reading.navigation.every(button => button.reachable && button.scroll <= button.width + 2),
          }
          for (const [check, passed] of Object.entries(checks)) if (!passed) report.failures.push({ case: currentCase, tab, check, reading })
          tabs.push({ tab, ...reading })
          report.screenshots.push(await screenshot(page, `${layout}-${width}-${tab}`))
        }
        assert(tabs.some(tab => tab.bottom > 0), '未覆盖真实二级滚动')
        report.cases.push({ case: currentCase, tabs })

        const sourceFixture = await boot('source', layout, width)
        const sourceLoaded = loadSaveFile(sourceFixture.save).state
        assert.deepEqual(sourceLoaded.playerStation.sourceShips, [sourceFixture.shipId])
        assert.equal(sourceLoaded.playerStation.shipLocks[sourceFixture.shipId], 'population')
        assert.equal(sourceLoaded.playerStation.population.people[0].status, 'protected')
        await fs.writeFile(path.join(OUTPUT, `${layout}-${width}-source-save.json`), sourceFixture.save)
        await page.text('.app-nav-side', text('ui.playerStationGame.pageTitle'))
        await page.wait(`!!document.querySelector(${JSON.stringify(PANEL)})`)
        await page.text(`${CONTENT} [role="tablist"]`, text('ui.playerStationGame.tab.population'))
        await page.wait(`!!document.querySelector(${JSON.stringify(PANEL + ' .app-player-station-population')})`)
        await checkRawIds(page)
        const beforeReturn = await page.snapshot()
        assert.deepEqual(beforeReturn.playerStation.sourceShips, [sourceFixture.shipId])
        assert.equal(beforeReturn.playerStation.population.plan.stopped, false)
        const returnInPopulation = await page.js(`!![...document.querySelectorAll(${JSON.stringify(PANEL + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(text('ui.playerStationGame.returnSourceShip'))})`)
        report.screenshots.push(await screenshot(page, `${layout}-${width}-source-population`))
        if (!returnInPopulation) {
          report.failures.push({ case: currentCase, check: 'populationReturnEntryPresent', actualTab: 'construction' })
          await page.text(`${CONTENT} [role="tablist"]`, text('ui.playerStationGame.tab.construction'))
        }
        report.screenshots.push(await screenshot(page, `${layout}-${width}-source-before-return`))
        await page.text(PANEL, text('ui.playerStationGame.returnSourceShip'))
        await page.wait('window.__whExpeditionTest.snapshot().playerStation.delivery?.target==="return"')
        const returning = await page.snapshot(), returnTrip = returning.playerStation.delivery
        assert.equal(returnTrip.shipId, sourceFixture.shipId)
        assert.equal(returnTrip.durationMs, 120_000)
        assert.deepEqual(returnTrip.cargo, {})
        assert(returnTrip.progressMs < returnTrip.durationMs)
        assert.equal(returning.playerStation.shipLocks[sourceFixture.shipId], 'population')
        assert.equal(returning.playerStation.sourceShips?.includes(sourceFixture.shipId) ?? false, false)
        assert.equal(returning.playerStation.population.plan, undefined)
        assert.deepEqual(assets(returning), assets(beforeReturn), '来源船返回改变原仓、真实舰船或人口')
        const returnSaved = await persistAndRead(page)
        assert.equal(returnSaved.playerStation.delivery.target, 'return')
        assert.equal(returnSaved.playerStation.delivery.shipId, sourceFixture.shipId)
        assert.equal(returnSaved.playerStation.delivery.durationMs, 120_000)
        assert.equal(returnSaved.playerStation.shipLocks[sourceFixture.shipId], 'population')
        await fs.writeFile(path.join(OUTPUT, `${layout}-${width}-return-save.json`), await page.js(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`))
        await checkRawIds(page)
        report.screenshots.push(await screenshot(page, `${layout}-${width}-source-return-started`))
        report.cases.push({ case: currentCase, sourceReturn: { entryTab: returnInPopulation ? 'population' : 'construction', shipId: sourceFixture.shipId,
          target: returnTrip.target, durationMs: returnTrip.durationMs, lockRetained: true, assetsUnchanged: true, sourceAndReturnLoadValidated: true, waitedForArrival: false } })

        await boot('discovered', layout, width, false)
        const hidden = await navState(page)
        assert.equal(hidden.station, 0, '调试关闭仍显示空间站导航')
        assert.deepEqual(hidden.oldStellar, [])
        await openAncientCard(page)
        assert.equal(await page.js(`document.querySelector(${JSON.stringify(CARD)})?.querySelectorAll('button').length`), 0, '调试关闭仍显示进入按钮')
        await checkRawIds(page)
        report.screenshots.push(await screenshot(page, `${layout}-${width}-debug-off-card`))
        report.cases.push({ case: currentCase, navAbsent: true, entryAbsent: true, discoveredMarkerAndCardRemain: true })
      }
    }
    report.exceptions = connection.errors
    assert.deepEqual(report.exceptions, [], '浏览器未捕获异常')
    assert.deepEqual(report.consoleErrors, [], '浏览器console.error')
    assert.equal(report.failures.length, 0, `界面断言失败${report.failures.length}项，逐项见report.failures`)
    report.success = true
    console.log('正式空间站浏览器冒烟通过', report.cases.length, '组，截图', report.screenshots.length)
  } catch (error) {
    report.failedCase = currentCase
    report.error = String(error.stack ?? error)
    report.exceptions = connection?.errors ?? []
    if (page) {
      report.body = await page.js('document.body.innerText').catch(() => '')
      report.geometry = await geometry(page).catch(() => null)
      report.panelAncestors = await page.js(`(()=>{const rows=[];for(let el=document.querySelector(${JSON.stringify(PANEL)});el;el=el.parentElement){const css=getComputedStyle(el),rect=el.getBoundingClientRect();rows.push({tag:el.tagName,class:el.className,width:el.clientWidth,height:el.clientHeight,scrollHeight:el.scrollHeight,display:css.display,flex:css.flex,overflow:css.overflow,rect:rect.toJSON()})}return rows})()`).catch(() => [])
      report.screenshots.push(await screenshot(page, 'failure').catch(() => ''))
    }
    throw error
  } finally {
    clearTimeout(timeout)
    report.finished = new Date().toISOString()
    await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    socket?.close()
    await stopOwned(child)
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    await removeProfile(profile, 'whale-player-station-game-')
    console.log('报告', path.join(OUTPUT, 'report.json'))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
