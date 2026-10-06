/** 六事件UI专项夹具，不是十层旅程，不能据此宣称真实通关。
 * 游戏v0.1.0 / 档v31；2026-10-06。
 * 用法：node tools/wormhole-expedition-journey-ui.cjs --matrix-only。
 * 合成当前地点六事件及缺回合分支，中英/双布局/桌面低高度/手机横竖检查真实点击。
 * 输出tools/_ui-artifacts/wormhole-expedition-event-ui-matrix.json与截图；不读个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {
  OUTPUT, sleep, dependencies, createFixture, settingsScript, CdpConnection, JourneyPage,
} = require('./wormhole-expedition-journey-shared.cjs')
const { reach, clickAt } = require('./wormhole-expedition-event-ui.cjs')

const EVENTS = ['maintenance', 'transport', 'controller', 'relay', 'storm', 'distress']
const ACTIONS = {
  maintenance: ['repair', 'search', 'bypass'], transport: ['supply', 'container', 'bypass'],
  controller: ['investigate', 'force', 'bypass'], relay: ['investigate', 'force', 'bypass'],
  storm: ['wait', 'cross', 'bypass'], distress: ['verify', 'respond', 'reject'],
}

function branchSave(key, blocked) {
  const { core, grid } = dependencies()
  const input = createFixture()
  const state = structuredClone(input.made.state)
  const run = state.wormhole.run
  const cell = grid.gridCellAt(run.grid, run.grid.pos)
  cell.place = 'empty'
  delete cell.foe
  delete cell.elite
  delete cell.eventResolved
  cell.eventKey = key
  const other = run.grid.cells.find(candidate => candidate.key !== cell.key)
  cell.event = {
    supply: { 'repairkit-mil': 20, 'drone-assault': 4 }, containerId: 'box-relic-a',
    identity: 'ambush', intelKey: other.key, ruinsKey: other.key,
  }
  if (key === 'controller') other.place = 'ruins'
  run.pendingEvent = { key, cellKey: cell.key }
  run.turnsLeft = blocked ? 0 : Math.max(8, run.turnsLeft)
  state.modeChosen = true
  return { input, save: core.serializeSaveFile(state, Date.now()) }
}

async function runEventMatrix(cdp, url) {
  const sizes = [[1366, 540, false], [390, 844, true], [568, 320, true]]
  const rows = []
  const file = path.join(OUTPUT, 'wormhole-expedition-event-ui-matrix.json')
  const saveRows = async () => {
    await fs.mkdir(OUTPUT, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ kind: 'synthetic-ui-branches-not-ten-layer-journey', total: rows.length, passed: rows.filter(row => row.success).length, failed: rows.filter(row => !row.success).length, rows }, null, 2), 'utf8')
  }
  for (const locale of ['zh', 'en']) for (const layout of ['classic', 'modern']) {
    for (const [width, height, mobile] of sizes) for (const key of EVENTS) for (const blocked of [false, true]) {
      const row = { locale, layout, width, height, mobile, key, blocked, success: false }
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
        const branch = branchSave(key, blocked)
        const script = `${settingsScript(branch.input.announcement, branch.save)};localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});`
        const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: script })
        await page.send('Page.navigate', { url })
        await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
        await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
        await sleep(250)
        if (await page.js('!!document.querySelector(".app-modal-mask .app-comms-eave-extra button")')) {
          for (let n = 0; n < 20; n++) {
            if (!await page.js('!!document.querySelector(".app-modal-mask .app-comms-eave-extra button")')) break
            await page.tap('.app-modal-mask .app-comms-eave-extra button')
          }
        }
        await page.tap('.app-activitybar-item.is-wormhole')
        await page.wait(`!!document.querySelector('[data-wh-event=${key}]')`)
        const event = await page.js(`(()=>{const el=document.querySelector('[data-wh-event=${key}]');return {text:el.innerText,actions:[...el.querySelectorAll('[data-wh-event-action]')].map(button=>({action:button.dataset.whEventAction,disabled:button.disabled,text:button.textContent.trim()})),rect:{width:el.clientWidth,height:el.clientHeight},rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
        assert.deepEqual(event.actions.map(action => action.action), ACTIONS[key])
        assert(!event.text.includes('{p'), '事件文案参数未填充')
        assert(!event.text.includes('ui.whExpedition.'), '事件文案ID泄露')
        assert(event.rect.width > 0 && event.rect.height > 0, '事件窗口空白')
        row.choiceGeometry = []
        for (const action of ACTIONS[key]) {
          const geometry = await reach(page, `[data-wh-event-action=${JSON.stringify(action)}]`)
          row.choiceGeometry.push({ action, ...geometry })
        }
        const free = key === 'distress' ? 'reject' : 'bypass'
        const freeButton = event.actions.find(action => action.action === free)
        assert.equal(freeButton.disabled, false, '免费退出不可达')
        if (blocked) {
          const paid = key === 'relay' ? ['investigate'] : ACTIONS[key].filter(action => action !== free)
          for (const action of paid) assert(event.actions.find(button => button.action === action).disabled, `0回合仍能执行:${action}`)
          assert(await page.js(`document.querySelector('[data-wh-event=${key}]').querySelector('[role=status]')?.textContent.length>0`), '缺回合拒因没有展示')
        }
        const before = await page.snapshot()
        const shot = `wormhole-expedition-event-${key}-${locale}-${layout}-${width}-${height}-${blocked ? 'blocked' : 'ready'}.png`
        const freeSelector = `[data-wh-event-action=${JSON.stringify(free)}]`
        await reach(page, freeSelector)
        await page.screenshot(shot)
        const freeGeometry = await reach(page, freeSelector)
        await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(freeSelector)});window.__whEventClickEvidence=[];for(const kind of ['touchstart','touchend','click'])document.addEventListener(kind,event=>{const button=event.target.closest?.('[data-wh-event-action]');window.__whEventClickEvidence.push({kind:event.type,trusted:event.isTrusted,targetTag:event.target.tagName,action:button?.dataset.whEventAction,expectedTarget:el===event.target||el.contains(event.target)})},{once:true,capture:true})})()`)
        await clickAt(page, freeGeometry.point, mobile)
        await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.pendingEvent === undefined')
        row.clickEvidence = await page.js('window.__whEventClickEvidence')
        assert(row.clickEvidence.some(entry => entry.kind === 'click' && entry.trusted && entry.expectedTarget), '免费退出没有落在预期按钮的真实用户输入click事件')
        const after = await page.snapshot()
        assert.equal(after.wormhole.run.pendingEvent, undefined)
        assert.equal(after.wormhole.run.turnsLeft, before.wormhole.run.turnsLeft)
        assert.equal(after.wormhole.run.patrolActionSeq, before.wormhole.run.patrolActionSeq)
        assert.deepEqual(after.wormhole.run.supplies, before.wormhole.run.supplies)
        assert(!after.wormhole.run.battle, '免费退出意外开战')
        assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
        row.measure = event
        row.screenshot = shot
        row.success = true
      } catch (error) {
        row.failure = error instanceof Error ? error.message : String(error)
        row.clickEvidence = await page?.js('window.__whEventClickEvidence ?? []').catch(() => [])
      } finally {
        socket.close()
        await fetch(`${cdp}/json/close/${target.id}`).catch(() => {})
        rows.push(row)
        await saveRows()
      }
      console.log(JSON.stringify({ locale, layout, width, height, key, blocked, success: row.success, failure: row.failure, clickEvidence: row.clickEvidence }))
    }
  }
  assert(rows.every(row => row.success), `六事件UI矩阵失败:${rows.filter(row => !row.success).length}/${rows.length}`)
  console.log(`六事件UI专项:${rows.length}组通过；合成分支，不是十层旅程。`)
  return rows
}

module.exports = { runEventMatrix }
