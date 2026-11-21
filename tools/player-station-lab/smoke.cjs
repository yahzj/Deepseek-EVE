/** 独立预览浏览器冒烟：先构建本工具，再运行 node tools/player-station-lab/smoke.cjs。
 * 自有无头 Chrome、临时 profile 和 dist 静态服务；只用真实按钮/输入操作合成预览，不读游戏档。
 * 输出轮盘、悬停详情、触屏详情与最终布局截图，以及视口收边读数；不代替观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { staticServer, CdpConnection, JourneyPage, sleep } = require('../wormhole-expedition-journey-shared.cjs')

const output = path.resolve(__dirname, '../_ui-artifacts/player-station-lab')
const WHEEL = '.app-player-station-wheel'
const cell = (index) => `.app-player-station-cell[data-cell="${index}"]`
const option = (kind) => `${WHEEL} [data-facility="${kind}"]`

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const profile = fs.mkdtempSync(path.join(output, 'chrome-smoke-'))
  let child, hosted, socket, timer
  try {
    hosted = await staticServer(path.join(__dirname, 'dist'))
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' })
    console.log('owned Chrome PID', child.pid)
    timer = setTimeout(() => child.kill(), 300_000)
    let debug
    for (let i = 0; i < 100; i++) {
      try { debug = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, 'Chrome debugging not ready')
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket), page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    const reports = []
    const wheelReports = []
    const shots = []

    async function shot(name) {
      await sleep(100)
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(image.data, 'base64'))
      shots.push(`${name}.png`)
    }
    async function populationShot(name) {
      await page.js(`document.querySelector('.app-player-station-population').scrollIntoView({block:'start'})`)
      await shot(name)
    }
    async function key(key, code = key) {
      const windowsVirtualKeyCode = { Enter: 13, Tab: 9, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key]
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode })
      await sleep(80)
    }
    async function close(index) {
      await key('Escape')
      await page.wait(`!document.querySelector('${WHEEL}')`)
      assert(await page.js(`document.activeElement === document.querySelector('${cell(index)}')`), 'Escape did not restore cell focus')
    }
    async function hover(selector) {
      const point = await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await page.wait('!!document.querySelector(".app-tip:not(.is-leaving):not(.is-measuring) [data-facility-detail]")')
      await sleep(80)
      const overlap = await page.js(`(()=>{const tip=document.querySelector('.app-tip:not(.is-leaving):not(.is-measuring)').getBoundingClientRect();return [...document.querySelectorAll('${WHEEL} button')].some(el=>{const r=el.getBoundingClientRect();return Math.min(r.right,tip.right)-Math.max(r.left,tip.left)>1&&Math.min(r.bottom,tip.bottom)-Math.max(r.top,tip.top)>1})})()`)
      assert.equal(overlap, false, 'tooltip covered a wheel control')
    }
    async function pointerTap(selector) {
      const point = await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw Error('edge control is occluded');return {x,y}})()`)
      if (page.touch) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      }
      await sleep(120)
    }
    async function snapshot() {
      await page.text('.lab-snapshots', '导出')
      const exported = JSON.parse(await page.js('document.querySelector("textarea").value'))
      const session = exported.format === 'whale-second-stage-preview' ? JSON.parse(exported.base) : exported
      return { session, state: JSON.parse(session.station).state }
    }
    async function start(index, kind, touch = false) {
      await page.tap(cell(index))
      await page.wait(`document.querySelectorAll('${WHEEL} [data-facility]').length===8`)
      await page.tap(option(kind))
      if (touch) {
        assert(await page.js(`!!document.querySelector('${WHEEL}') && !document.querySelector('${cell(index)}').classList.contains('is-building')`), 'first touch started construction')
        await page.tap(`${WHEEL} .app-player-station-wheel-detail > button`)
      }
      await page.wait(`!document.querySelector('${WHEEL}') && document.querySelector('${cell(index)}').classList.contains('is-building')`)
      assert(await page.js(`document.activeElement === document.querySelector('${cell(index)}')`), 'build did not restore cell focus')
    }
    async function bounds(label) {
      await sleep(100)
      const geometry = await page.js(`(()=>{const el=document.querySelector('${WHEEL}'),r=el.getBoundingClientRect();return {label:${JSON.stringify(label)},x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,portal:el.parentElement===document.body,leaking:el.scrollWidth>el.clientWidth+1}})()`)
      assert(geometry.portal, 'wheel was not portaled')
      assert(geometry.x >= 7 && geometry.y >= 7 && geometry.right <= geometry.width - 7 && geometry.bottom <= geometry.height - 7, `wheel outside viewport: ${JSON.stringify(geometry)}`)
      assert.equal(geometry.leaking, false, 'wheel horizontal content overflow')
      return geometry
    }

    for (const [width, height] of [[1366, 900], [390, 844]]) {
      const touch = width < 500
      page.touch = touch
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch })
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait('!!document.querySelector(".app-player-station")')
      await page.text('.app-player-station', '批准主体施工')
      await page.text('.app-player-station', '模拟到货')
      await page.text('.lab-toolbar', '+60 分钟')
      await page.text('[data-project-cell="body"]', '暂停')
      await page.text('.lab-toolbar', '+15 分钟')
      assert.equal(await page.js('document.querySelector("progress").value'), 50, 'paused body advanced')
      await page.text('[data-project-cell="body"]', '恢复')
      await page.text('.lab-toolbar', '+60 分钟')
      await page.wait('document.querySelectorAll(".app-player-station-cell").length===9')
      await start(0, 'power', touch)
      await page.tap(cell(1))
      assert.equal(await page.js(`document.querySelector('${option('power')}').getAttribute('aria-disabled')`), 'true', 'second startup power was allowed')
      await close(1)
      await page.text('.lab-toolbar', '+60 分钟')

      // 缺料入口仍可 hover/focus；通过真实数字输入改变库存，并检查工程学折后料单。
      await page.number('input[aria-label="钛钢合金预览库存"]', 0)
      await page.tap('.lab-engineering select')
      await key('End')
      await key('Tab')
      assert.equal(await page.js('document.querySelector(".lab-engineering select").value'), '5', 'engineering select did not change')
      await page.tap(cell(8))
      assert.equal(await page.js(`document.querySelector('${option('service')}').disabled`), false, 'missing materials used native disabled')
      assert.equal(await page.js(`document.querySelector('${option('service')}').getAttribute('aria-disabled')`), 'true')
      await shot(`wheel-overview-${width}`)
      if (touch) {
        // JourneyPage.tap 特意拒绝 aria-disabled；这里用真实触点检查不可建选项仍能查看详情。
        const point = await page.js(`(()=>{const r=document.querySelector('${option('service')}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.wait(`!!document.querySelector('${WHEEL} .app-player-station-wheel-detail [data-facility-detail="service"]')`)
        assert(await page.js(`document.querySelector('${WHEEL} .app-player-station-wheel-detail').textContent.includes('预览库存不足')`))
        await shot(`wheel-touch-missing-${width}`)
      } else {
        await hover(option('service'))
        const tip = await page.js('document.querySelector(".app-tip").innerText')
        for (const label of ['服务中心', '公共服务', '效果', '占地', '工期', '施工耗电', '运行耗电', '需求', '可用', '缺少', '预览库存不足']) assert(tip.includes(label), `tooltip missing ${label}`)
        assert(tip.includes('30,000'), 'engineering-adjusted material need was not shown')
        await shot(`wheel-hover-missing-${width}`)
        await pointerTap(option('service'))
        assert(await page.js(`!!document.querySelector('${WHEEL}') && !document.querySelector('${cell(8)}').classList.contains('is-building')`), 'missing-material click started construction')
        await key('Home')
        await key('ArrowRight')
        await key('ArrowRight')
        assert(await page.js(`document.activeElement===document.querySelector('${option('service')}')`), 'missing-material option was not focusable')
        assert(await page.js(`document.querySelector('${WHEEL} .app-player-station-wheel-detail').textContent.includes('预览库存不足')`), 'missing-material focus detail missing')
        await shot(`wheel-keyboard-missing-${width}`)
      }
      const edgeReadings = [await bounds('normal')]
      await close(8)
      await page.tap('button[aria-label="恢复预览初始库存"]')

      // 只移动合成页面的空地块 DOM 锚点来覆盖视口右侧/底部；业务状态仍由真实按钮推进。
      for (const edge of ['right', 'bottom', 'bottom-right']) {
        await page.js(`(()=>{const el=document.querySelector('${cell(8)}');el.style.position='fixed';el.style.zIndex='10';el.style.width='90px';el.style.height='90px';el.style.left=${edge === 'bottom' ? "'8px'" : "'calc(100vw - 98px)'"};el.style.top=${edge === 'right' ? "'8px'" : "'calc(100dvh - 98px)'"}})()`)
        await pointerTap(cell(8))
        edgeReadings.push(await bounds(edge))
        if (touch) {
          await page.tap(option('service'))
          edgeReadings.push(await bounds(`${edge}-detail`))
        } else {
          await hover(option('service'))
          const tip = await page.js('(()=>{const r=document.querySelector(".app-tip").getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()')
          assert(tip.x >= 7 && tip.y >= 7 && tip.right <= tip.width - 7 && tip.bottom <= tip.height - 7, `tooltip outside viewport: ${JSON.stringify(tip)}`)
        }
        await shot(`wheel-${edge}-${width}`)
        await close(8)
        await page.js(`document.querySelector('${cell(8)}').removeAttribute('style')`)
      }

      // 键盘开盘、方向键选择、详情与 Tab 循环；不借 DOM click 绕过按钮事件。
      await page.tap(cell(8))
      await page.tap(`${WHEEL} button[aria-label="关闭建造轮盘"]`)
      await page.wait(`!document.querySelector('${WHEEL}')`)
      assert(await page.js(`document.activeElement===document.querySelector('${cell(8)}')`), 'close button lost focus')
      await key('Enter')
      await page.wait(`!!document.querySelector('${WHEEL} .app-player-station-wheel-detail')`)
      await key('ArrowRight')
      assert(await page.js(`document.activeElement===document.querySelector('${option('life-support')}')`))
      assert(await page.js(`!!document.querySelector('${WHEEL} .app-player-station-wheel-detail [data-facility-detail="life-support"]')`))
      for (let i = 0; i < 6; i++) {
        await key('Tab')
        assert(await page.js(`document.querySelector('${WHEEL}').contains(document.activeElement)`), 'Tab escaped wheel')
      }
      await shot(`wheel-keyboard-${width}`)
      await close(8)
      await page.tap(cell(8))
      await page.tap('.lab-header h1')
      await page.wait(`!document.querySelector('${WHEEL}')`)
      assert(await page.js(`document.activeElement===document.querySelector('${cell(8)}')`), 'outside close lost focus')

      await start(1, 'life-support', touch)
      await start(2, 'life-support', touch)
      let state = (await snapshot()).state
      assert.equal(state.projects.length, 2, 'two facilities were not started in parallel')
      assert.equal(state.project, undefined, 'facility leaked into body project')
      assert.deepEqual(state.projects.map(p => p.cellIndex), [1, 2], 'project start order changed')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.tap(cell(1))
      await page.text('[data-project-cell="1"]', '暂停')
      await page.text('.lab-toolbar', '+15 分钟')
      state = (await snapshot()).state
      assert.equal(state.projects.find(p => p.cellIndex === 1).progressMs, 15 * 60_000)
      assert.equal(state.projects.find(p => p.cellIndex === 2).progressMs, 30 * 60_000)
      await page.tap(cell(2))
      await page.text('[data-project-cell="2"]', '暂停')
      await page.tap(cell(1))
      await page.text('[data-project-cell="1"]', '恢复')
      await page.text('.lab-toolbar', '+15 分钟')
      state = (await snapshot()).state
      assert.equal(state.projects.find(p => p.cellIndex === 1).progressMs, 30 * 60_000)
      assert.equal(state.projects.find(p => p.cellIndex === 2).progressMs, 30 * 60_000)
      await page.tap(cell(2))
      await page.text('[data-project-cell="2"]', '恢复')
      await shot(`parallel-projects-${width}`)

      await page.tap(cell(0))
      await page.tap('input[role="switch"]')
      await page.wait('document.querySelector(".app-player-station-project-list").textContent.includes("缺电")')
      await page.text('.lab-toolbar', '+15 分钟')
      state = (await snapshot()).state
      assert(state.projects.every(p => p.progressMs === 30 * 60_000), 'unpowered project advanced')
      await page.tap(cell(8))
      if (touch) {
        const point = await page.js(`(()=>{const r=document.querySelector('${option('service')}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.wait(`!!document.querySelector('${WHEEL} [data-power-shortfall="4"]')`)
      } else {
        await hover(option('service'))
        await page.wait(`!!document.querySelector('.app-tip [data-power-shortfall="4"]')`)
      }
      await shot(`wheel-power-shortfall-${width}`)
      await close(8)
      await page.tap(cell(0))
      await page.tap('input[role="switch"]')
      const beforeCancel = await snapshot()
      await page.tap(cell(2))
      await page.text('[data-project-cell="2"]', '取消施工')
      const afterCancel = await snapshot()
      state = afterCancel.state
      assert.deepEqual(state.projects.map(p => p.cellIndex), [1], 'cell cancellation affected another project')
      assert(afterCancel.session.inventory['min-tritanium'] > beforeCancel.session.inventory['min-tritanium'], 'facility cancellation did not refund host inventory')
      await start(2, 'service', touch)
      await page.text('.lab-toolbar', '+60 分钟')
      const saved = await snapshot()
      assert(saved.state.built)
      assert.equal(saved.state.cells.length, 3)
      assert.equal(saved.state.projects.length, 0)
      await page.text('.lab-toolbar', '+1 分钟')
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, saved.session, 'snapshot changed inventory or module')
      const geometry = await page.js(`(()=>{
        document.querySelector('.lab-station-window').scrollTop=0;
        document.querySelector('.lab-workspace').scrollTop=0;
        const grid=document.querySelector('.app-player-station-grid').getBoundingClientRect();
        return {width:innerWidth,bodyWidth:document.documentElement.scrollWidth,grid:{x:grid.x,y:grid.y,width:grid.width,height:grid.height},
          leaking:[...document.querySelectorAll('.app-player-station-cell')].filter(el=>el.scrollWidth>el.clientWidth+1).length,
          missingText:document.body.innerText.includes('ui.playerStation.')};
      })()`)
      assert.equal(geometry.bodyWidth, width, 'horizontal page overflow')
      assert.equal(geometry.leaking, 0, 'cell text overflow')
      assert.equal(geometry.missingText, false, 'unresolved text id')
      reports.push({ ...geometry, edges: edgeReadings })
      await shot(`preview-${width}`)
      await page.tap(cell(3))
      if (touch) await pointerTap(option('refinery'))
      else await hover(option('refinery'))
      const noEngineerDetails = await page.js(`document.querySelector('${touch ? `${WHEEL} .app-player-station-wheel-detail` : '.app-tip'}').textContent`)
      for (const label of ['基础精炼设施', '施工工程师', '可用工程师', '缺少可用基础工程师']) assert(noEngineerDetails.includes(label), `no-engineer detail missing ${label}`)
      await close(3)
      await page.tap('input[aria-label="模拟发现古代休眠站"]')
      await page.number('input[aria-label="合成副船有效余舱"]', 99)
      await page.text('.app-player-station-population', '安排复苏与接收')
      await page.wait('document.querySelector(".app-player-station-population").textContent.includes("等待可用副船与运力")')
      let population = (await snapshot()).session.population
      assert.equal(population.people.filter(p => p.status !== 'dormant').length, 0, 'insufficient cargo reserved population')
      await page.number('input[aria-label="合成副船有效余舱"]', 600)
      await page.text('.lab-toolbar', '+15 分钟')
      population = (await snapshot()).session.population
      assert.equal(population.people[0].status, 'aboard', 'revived population became resident before reception')
      const revivalInventory = (await snapshot()).session.inventory
      await page.tap(cell(2))
      await page.tap('input[role="switch"]')
      await page.wait('!!document.querySelector("[data-population-phase=safety-return]")')
      await page.text('.lab-toolbar', '+1 分钟')
      population = (await snapshot()).session.population
      assert.equal(population.people[0].status, 'protected', 'interrupted passenger was not protected at source')
      assert.equal((await snapshot()).session.ships[0].available, true, 'protected passenger did not release ship')
      await populationShot(`population-protected-${width}`)
      await page.text('.app-player-station-population', '停止后续')
      await page.tap(cell(2))
      await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).session.population.people[0].status, 'protected', 'stopped plan restarted on restoration')
      await page.text('.app-player-station-population', '安排复苏与接收')
      await page.text('.lab-toolbar', '+15 分钟')
      let populationSaved = await snapshot()
      assert.equal(populationSaved.session.population.people[0].status, 'resident', 'protected passenger was not received')
      assert.deepEqual(populationSaved.session.inventory, revivalInventory, 'recovery charged revival materials again')
      await page.text('.app-player-station-population', '安排复苏与接收')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.lab-toolbar', '+1 分钟')
      await page.text('.lab-toolbar', '+1 分钟')
      populationSaved = await snapshot()
      assert.equal(populationSaved.session.population.people[1].status, 'receiving', 'second person was received early')
      assert.equal(populationSaved.session.ships[0].available, false, 'ship released before complete reception')
      await populationShot(`population-receiving-${width}`)
      await page.text('.lab-toolbar', '+1 分钟')
      assert.equal((await snapshot()).session.population.people.filter(p => p.status === 'resident').length, 2)
      await page.tap('textarea')
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await page.send('Input.insertText', { text: JSON.stringify(populationSaved.session) })
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, populationSaved.session, 'population snapshot changed materials or ship occupation')
      await page.text('.lab-toolbar', '+1 分钟')
      const completed = (await snapshot()).session
      assert.equal(completed.population.people.filter(p => p.status === 'resident').length, 2, 'snapshot replay duplicated residents')
      assert.equal(completed.ships[0].available, true)
      const populationGeometry = await page.js(`(()=>{const el=document.querySelector('.app-player-station-population');return {leaking:el.scrollWidth>el.clientWidth+1,bodyWidth:document.documentElement.scrollWidth,missingText:document.body.innerText.includes('ui.playerStation.')}})()`)
      assert.equal(populationGeometry.leaking, false, 'population panel overflow')
      assert.equal(populationGeometry.bodyWidth, width, 'population horizontal page overflow')
      assert.equal(populationGeometry.missingText, false, 'population unresolved text')
      await populationShot(`population-received-${width}`)
      const trainingInventory = (await snapshot()).session.inventory
      await page.text('.app-player-station-training', '加入课程队列')
      await page.tap('.app-player-station-training select')
      await key('End')
      await key('Tab')
      await page.text('.app-player-station-training', '加入课程队列')
      await page.text('.app-player-station-training', '加入课程队列')
      let trainingSession = (await snapshot()).session
      assert.equal(trainingSession.training.active.personIndex, 0, 'course did not claim first resident')
      assert.deepEqual(trainingSession.training.queue, ['researcher', 'researcher'], 'course queue changed order')
      assert.equal(await page.js('document.querySelector("[data-person-status=resident]").textContent.trim()'), '受训占用', 'population did not show trainee occupancy')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.app-player-station-training', '暂停')
      await page.text('.lab-toolbar', '+15 分钟')
      trainingSession = (await snapshot()).session
      assert.equal(trainingSession.training.active.progressMs, 15 * 60_000, 'paused course advanced')
      assert.equal(trainingSession.training.active.personIndex, 0, 'paused course released trainee')
      await page.tap('button[aria-label="移除第2项排队课程"]')
      assert.deepEqual((await snapshot()).session.training.queue, ['researcher'], 'queue removal affected active course')
      await page.text('.app-player-station-training', '恢复')
      await page.tap(cell(2))
      await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      trainingSession = (await snapshot()).session
      assert.equal(trainingSession.training.active.progressMs, 15 * 60_000, 'unpowered course advanced')
      assert(await page.js('document.querySelector("[data-training-status]").textContent.includes("等待生命维持与服务中心恢复")'), 'course missing power wait reason')
      await page.js(`document.querySelector('.app-player-station-training').scrollIntoView({block:'start'})`)
      await shot(`training-blocked-${width}`)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, trainingSession, 'training snapshot changed occupancy or progress')
      await page.tap(cell(2))
      await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      trainingSession = (await snapshot()).session
      assert.deepEqual(trainingSession.training.qualifications.slice(0, 2), ['engineer', null], 'first qualification not assigned to original person')
      assert.equal(trainingSession.training.active.personIndex, 1, 'second course reused qualified resident')
      assert.equal(trainingSession.training.active.progressMs, 0, 'second course borrowed previous course time')
      await page.js(`document.querySelector('.app-player-station-training').scrollIntoView({block:'start'})`)
      await shot(`training-second-course-${width}`)
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.lab-toolbar', '+15 分钟')
      trainingSession = (await snapshot()).session
      assert.deepEqual(trainingSession.training.qualifications.slice(0, 2), ['engineer', 'researcher'])
      assert.equal(trainingSession.training.active, undefined)
      assert.deepEqual(trainingSession.inventory, trainingInventory, 'course charged materials')
      assert.equal(trainingSession.population.people.filter(person => person.status === 'resident').length, 2, 'training duplicated population')
      await page.text('.app-player-station-training', '加入课程队列')
      await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).session.training.active, undefined, 'qualified person was retrained')
      assert(await page.js('document.querySelector("[data-training-wait]").textContent.includes("等待普通待命居民")'), 'course missing resident wait reason')
      await page.tap('button[aria-label="移除第1项排队课程"]')
      const trainingGeometry = await page.js(`(()=>{const el=document.querySelector('.app-player-station-training');return {width:innerWidth,bodyWidth:document.documentElement.scrollWidth,leaking:el.scrollWidth>el.clientWidth+1,missingText:document.body.innerText.includes('ui.playerStation.')}})()`)
      assert.equal(trainingGeometry.leaking, false, 'training panel overflow')
      assert.equal(trainingGeometry.bodyWidth, width, 'training horizontal page overflow')
      assert.equal(trainingGeometry.missingText, false, 'training unresolved text')
      await page.js(`document.querySelector('.app-player-station-training').scrollIntoView({block:'start'})`)
      await shot(`training-qualified-${width}`)
      console.log(`PASS training ${width}: single seat, original person, pause and power waits, queue removal, qualifications, no resource charge, whole-session snapshot`)
      await start(3, 'refinery', touch)
      let engineerSaved = await snapshot()
      assert.equal(engineerSaved.state.projects[0].engineerIndex, 0, 'refinery did not bind original engineer')
      assert.deepEqual(engineerSaved.session.training.qualifications.slice(0, 2), ['engineer', 'researcher'])
      assert.equal(await page.js('document.querySelector("[data-person-qualification=engineer]").textContent.trim()'), '地块 4 施工占用', 'population missing construction occupancy')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.tap(cell(3))
      await page.text('[data-project-cell="3"]', '暂停')
      await page.text('.lab-toolbar', '+15 分钟')
      engineerSaved = await snapshot()
      assert.equal(engineerSaved.state.projects[0].progressMs, 15 * 60_000, 'paused engineering advanced')
      assert.equal(engineerSaved.state.projects[0].engineerIndex, 0, 'paused engineering released person')
      const occupiedInventory = engineerSaved.session.inventory
      await page.tap(cell(4))
      assert.equal(await page.js(`document.querySelector('${option('research')}').getAttribute('aria-disabled')`), 'true', 'same engineer was offered to another project')
      if (touch) await pointerTap(option('research'))
      else await hover(option('research'))
      await shot(`engineering-occupied-${width}`)
      await close(4)
      assert.deepEqual((await snapshot()).session.inventory, occupiedInventory, 'unavailable project charged materials')
      await page.tap(cell(3))
      await page.text('[data-project-cell="3"]', '取消施工')
      const cancelledEngineering = await snapshot()
      assert.equal(cancelledEngineering.state.projects.length, 0)
      assert(cancelledEngineering.session.inventory['part-gyro'] > occupiedInventory['part-gyro'], 'engineering cancellation did not refund original investment')
      await start(3, 'refinery', touch)
      await page.text('.lab-toolbar', '+60 分钟')
      engineerSaved = await snapshot()
      assert(engineerSaved.state.cells.some(entry => entry.kind === 'refinery' && entry.cellIndex === 3), 'refinery did not complete after 60 minutes')
      assert.equal(engineerSaved.state.projects.length, 0)
      assert(await page.js(`document.querySelector('${cell(3)}').textContent.includes('待机')`), 'completed refinery did not enter standby')
      await start(4, 'research', touch)
      await page.text('.lab-toolbar', '+60 分钟')
      await page.tap(cell(0))
      await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      engineerSaved = await snapshot()
      assert.equal(engineerSaved.state.projects[0].progressMs, 60 * 60_000, 'unpowered research construction advanced')
      assert.equal(engineerSaved.state.projects[0].engineerIndex, 0)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, engineerSaved.session, 'construction snapshot lost engineer/material/qualification state')
      await page.tap(cell(0))
      await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.lab-toolbar', '+15 分钟')
      engineerSaved = await snapshot()
      assert.equal(engineerSaved.state.projects.length, 0)
      assert.equal(engineerSaved.state.cells.length, 5)
      assert(engineerSaved.state.cells.some(entry => entry.kind === 'research' && entry.cellIndex === 4), 'research room did not complete after 90 effective minutes')
      assert.equal(engineerSaved.session.population.people.filter(person => person.status === 'resident').length, 2, 'construction duplicated residents')
      assert.equal(await page.js('document.querySelector("[data-person-qualification=engineer]").textContent.trim()'), '基础工程师待命', 'completion did not release engineer')
      const postConstructionInventory = engineerSaved.session.inventory
      await page.text('.lab-toolbar', '+60 分钟')
      assert.deepEqual((await snapshot()).session.inventory, postConstructionInventory, 'standby facilities produced or consumed materials')
      await page.tap(cell(4))
      await shot(`engineering-completed-${width}`)
      assert.equal(await page.js('document.documentElement.scrollWidth'), width, 'engineering horizontal overflow')
      console.log(`PASS engineering ${width}: five real facilities, required engineer, pause holds person, cancellation refunds/releases, 60/90 effective minutes, power wait, consistent snapshots, standby without production`)
      // 新增第三名普通居民，无课程即可承担精炼；原人/工程/课程的占用需一致。
      await page.text('.app-player-station-population', '安排复苏与接收')
      await page.text('.lab-toolbar', '+15 分钟')
      for (let i = 0; i < 3; i++) await page.text('.lab-toolbar', '+1 分钟')
      await page.tap('select[aria-label="精炼人员"]')
      await key('End'); await key('Tab')
      await page.number('input[aria-label="橄榄岩预览库存"]', 150)
      const beforeRefining = (await snapshot()).session
      await page.text('.app-player-station-refining', '安排精炼')
      let refiningSaved = await snapshot()
      assert.equal(refiningSaved.session.refining.runs[0].personIndex, 2, 'refining did not use selected ordinary resident')
      assert.equal(refiningSaved.session.training.qualifications[2], null, 'ordinary worker was granted a course qualification')
      assert.deepEqual(refiningSaved.session.inventory, beforeRefining.inventory, 'assignment charged input before batch completion')
      await page.text('.lab-toolbar', '+1 分钟')
      refiningSaved = await snapshot()
      const firstRun = refiningSaved.session.refining.runs[0]
      assert.equal(firstRun.batchesDone, 1, 'refining did not complete one full batch')
      assert.equal(refiningSaved.session.inventory['ore-veldspar'], 50, 'refining consumed an incomplete batch')
      assert(refiningSaved.session.inventory['min-tritanium'] > beforeRefining.inventory['min-tritanium'], 'refining did not put real output in shared preview inventory')
      assert.equal(await page.js('document.querySelectorAll("[data-person-status=resident]")[2].textContent.trim()'), '地块 4 精炼占用', 'population missing refining occupation')
      assert(await page.js('document.querySelector("[data-refining-status]").textContent.includes("原料不足一批")'), 'missing-material wait not visible')
      await page.text('.app-player-station-training', '加入课程队列')
      assert.equal((await snapshot()).session.training.active, undefined, 'course stole ordinary resident from refining')
      const materialWait = (await snapshot()).session
      await page.text('.lab-toolbar', '+15 分钟')
      assert.deepEqual((await snapshot()).session.inventory, materialWait.inventory, 'waiting refinery produced output')
      await page.number('input[aria-label="橄榄岩预览库存"]', 200)
      await page.tap(cell(0)); await page.tap('input[role="switch"]')
      const powerWait = (await snapshot()).session
      await page.text('.lab-toolbar', '+1 分钟')
      assert.deepEqual((await snapshot()).session.inventory, powerWait.inventory, 'unpowered refinery consumed or produced material')
      assert.equal((await snapshot()).session.refining.runs[0].batchesDone, 1, 'unpowered refinery advanced')
      await page.js(`document.querySelector('.app-player-station-refining').scrollIntoView({block:'start'})`)
      await shot(`refining-power-wait-${width}`)
      await page.tap('textarea')
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await page.send('Input.insertText', { text: JSON.stringify(powerWait) })
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, powerWait, 'refining snapshot changed inventory, worker or batch')
      await page.tap(cell(0)); await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+1 分钟')
      refiningSaved = await snapshot()
      assert.equal(refiningSaved.session.refining.runs[0].batchesDone, 3, 'refinery did not resume after power/material restoration')
      assert.equal(refiningSaved.session.inventory['ore-veldspar'], 0)
      await page.text('.app-player-station-refining', '停止并释放人员')
      refiningSaved = await snapshot()
      assert.equal(refiningSaved.session.refining.runs[0].personIndex, undefined, 'stop did not release refinery worker')
      assert.equal(refiningSaved.session.training.active.personIndex, 2, 'queued course did not receive released ordinary worker')
      await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).session.refining.runs[0].batchesDone, 3, 'stopped refinery restarted automatically')
      const refiningGeometry = await page.js(`(()=>{const el=document.querySelector('.app-player-station-refining');return {width:innerWidth,bodyWidth:document.documentElement.scrollWidth,leaking:el.scrollWidth>el.clientWidth+1,missingText:document.body.innerText.includes('ui.playerStation.')}})()`)
      assert.equal(refiningGeometry.leaking, false, 'refining panel overflow')
      assert.equal(refiningGeometry.bodyWidth, width, 'refining horizontal page overflow')
      assert.equal(refiningGeometry.missingText, false, 'refining unresolved text')
      await page.js(`document.querySelector('.app-player-station-refining').scrollIntoView({block:'start'})`)
      await shot(`refining-completed-${width}`)
      console.log(`PASS refining ${width}: ordinary resident, shared input/output, full batches only, material/power waits, no course steal, consistent snapshot, explicit stop releases person without auto-restart`)
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.app-player-station-population', '安排复苏与接收')
      await page.text('.lab-toolbar', '+15 分钟')
      for (let i = 0; i < 3; i++) await page.text('.lab-toolbar', '+1 分钟')
      await page.tap('select[aria-label="采矿人员"]'); await key('End'); await key('Tab')
      // 精炼用另一名居民，等待来源矿船回港；选择真实目录中的本站原料。
      await page.tap('select[aria-label="精炼人员"]'); await key('Home'); await key('Tab')
      const gasOptionIndex = await page.js('[...document.querySelector("select[aria-label=精炼原料]").options].findIndex(option=>option.value==="gas-phosphor")')
      assert(gasOptionIndex >= 0, 'local feedstock option missing')
      await page.tap('select[aria-label="精炼原料"]')
      await key('Home')
      for (let i = 0; i < gasOptionIndex; i++) await key('ArrowDown')
      await key('Tab')
      assert.equal(await page.js('document.querySelector("select[aria-label=精炼原料]").value'), 'gas-phosphor')
      await page.text('.app-player-station-refining', '安排精炼')
      const beforeMining = (await snapshot()).session
      assert.equal(beforeMining.inventory['gas-phosphor'], 0, 'synthetic ore was granted before mining')
      await page.text('.app-player-station-mining', '安排采矿')
      let miningSaved = (await snapshot()).session
      assert.equal(miningSaved.mining.runs[0].personIndex, 3, 'mining did not claim ordinary resident')
      assert.equal(miningSaved.training.qualifications[3], null)
      assert.equal(miningSaved.ships.find(ship => ship.id === 'lab-miner').available, false, 'mining did not claim ship')
      await page.text('.lab-toolbar', '+1 分钟')
      miningSaved = (await snapshot()).session
      assert(miningSaved.mining.runs[0].cargo['gas-phosphor'] > 0, 'mining cycle did not put ore on ship')
      assert.equal(miningSaved.inventory['gas-phosphor'], 0, 'mined cargo was available before return')
      assert.equal(miningSaved.refining.runs[0].batchesDone, 0, 'refinery used cargo still on mining ship')
      assert.equal(await page.js('document.querySelectorAll("[data-person-status=resident]")[3].textContent.trim()'), '采矿占用')
      await page.text('.app-player-station-mining', '暂停')
      const pausedMining = (await snapshot()).session
      await page.text('.lab-toolbar', '+1 分钟')
      assert.deepEqual((await snapshot()).session.mining, pausedMining.mining, 'paused mining advanced or released task')
      await page.text('.app-player-station-training', '加入课程队列')
      assert.equal((await snapshot()).session.training.active, undefined, 'course stole mining resident')
      await page.js(`document.querySelector('.app-player-station-mining').scrollIntoView({block:'start'})`)
      await shot(`mining-cargo-${width}`)
      await page.text('.app-player-station-mining', '恢复')
      for (let i = 0; i < 30; i++) {
        miningSaved = (await snapshot()).session
        if ((miningSaved.mining.runs[0].cargo['gas-phosphor'] ?? 0) >= 100) break
        await page.text('.lab-toolbar', '+1 分钟')
      }
      assert((miningSaved.mining.runs[0].cargo['gas-phosphor'] ?? 0) >= 100, 'mining test did not collect one refinery batch')
      await page.text('.app-player-station-mining', '停止并返航')
      miningSaved = (await snapshot()).session
      assert.equal(miningSaved.mining.runs[0].phase, 'returning')
      assert.equal(miningSaved.mining.runs[0].stopping, true)
      assert.equal(miningSaved.ships.find(ship => ship.id === 'lab-miner').available, false, 'stop released ship before arrival')
      assert.equal(await page.js('document.querySelectorAll("[data-person-status=resident]")[3].textContent.trim()'), '采矿返航占用')
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session, miningSaved, 'mining snapshot changed cargo, elapsed journey or ownership')
      await page.js(`document.querySelector('.app-player-station-mining').scrollIntoView({block:'start'})`)
      await shot(`mining-returning-${width}`)
      await page.text('.lab-toolbar', '+15 分钟')
      miningSaved = (await snapshot()).session
      assert.equal(miningSaved.mining.runs.length, 0, 'stopped mining restarted after unloading')
      assert.equal(miningSaved.ships.find(ship => ship.id === 'lab-miner').available, true)
      assert.equal(miningSaved.training.active.personIndex, 3, 'returned resident was not released to queued course')
      const gasRefinery = miningSaved.refining.runs.find(run => run.itemId === 'gas-phosphor')
      assert(gasRefinery.batchesDone > 0, 'unloaded mining cargo did not feed refinery automatically')
      assert(miningSaved.inventory['min-isotope'] > beforeMining.inventory['min-isotope'], 'mining/refining chain produced no minerals')
      const miningGeometry = await page.js(`(()=>{const el=document.querySelector('.app-player-station-mining');return {width:innerWidth,bodyWidth:document.documentElement.scrollWidth,leaking:el.scrollWidth>el.clientWidth+1,missingText:document.body.innerText.includes('ui.playerStation.')}})()`)
      assert.equal(miningGeometry.leaking, false, 'mining panel overflow')
      assert.equal(miningGeometry.bodyWidth, width, 'mining horizontal overflow')
      assert.equal(miningGeometry.missingText, false, 'mining unresolved text')
      await page.js(`document.querySelector('.app-player-station-mining').scrollIntoView({block:'start'})`)
      await shot(`mining-unloaded-${width}`)
      console.log(`PASS mining ${width}: ordinary resident, actual cargo cycle, pause holds ship/person, return holds ownership, consistent snapshot, arrival feeds refinery, no auto-restart after stop`)
      // 以原研究员和已建研究室开始首项科研，不依赖新增人口或自动派工。
      const researchBefore = (await snapshot()).session
      await page.text('.app-player-station-research', '安排研究')
      let researchSaved = (await snapshot()).session
      assert.deepEqual(researchSaved.research.assignment, { cellIndex: 4, personIndex: 1, paused: false })
      assert.equal(await page.js('document.querySelector("[data-person-qualification=researcher]").textContent.trim()'), '地块 5 科研占用')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.app-player-station-research', '暂停')
      await page.text('.lab-toolbar', '+15 分钟')
      researchSaved = (await snapshot()).session
      assert.equal(researchSaved.research.progressMs, 15 * 60_000)
      assert.equal(researchSaved.research.assignment.personIndex, 1)
      await page.text('.app-player-station-research', '恢复')
      await page.tap(cell(0)); await page.tap('input[role="switch"]')
      await page.text('.lab-toolbar', '+15 分钟')
      researchSaved = (await snapshot()).session
      assert.equal(researchSaved.research.progressMs, 15 * 60_000)
      assert(await page.js('document.querySelector("[data-research-status]").textContent.includes("缺电")'))
      await page.js(`document.querySelector('.app-player-station-research').scrollIntoView({block:'start'})`)
      await shot(`research-power-wait-${width}`)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).session.research, researchSaved.research)
      await page.tap(cell(0)); await page.tap('input[role="switch"]')
      await page.text('.app-player-station-research', '撤出人员，保留进度')
      await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).session.research.progressMs, 15 * 60_000)
      await page.text('.app-player-station-research', '安排研究')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('.lab-toolbar', '+15 分钟')
      researchSaved = (await snapshot()).session
      assert.equal(researchSaved.research.completed, true)
      assert.equal(researchSaved.research.assignment, undefined)
      assert.equal(researchSaved.research.progressMs, 60 * 60_000)
      assert.equal(researchSaved.population.people.filter(person => person.status === 'resident').length, 4)
      assert.deepEqual(JSON.parse(researchSaved.station).state.cells, JSON.parse(researchBefore.station).state.cells, 'research completion created a facility/expansion')
      assert.equal(await page.js('document.querySelector("[data-research-status]").textContent.trim()'), '技术已掌握')
      const researchGeometry = await page.js(`(()=>{const el=document.querySelector('.app-player-station-research');return {leaking:el.scrollWidth>el.clientWidth+1,width:innerWidth,bodyWidth:document.documentElement.scrollWidth}})()`)
      assert.equal(researchGeometry.leaking, false)
      assert.equal(researchGeometry.bodyWidth, width)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.equal((await snapshot()).session.research.completed, true)
      await page.js(`document.querySelector('.app-player-station-research').scrollIntoView({block:'start'})`)
      await shot(`research-completed-${width}`)
      console.log(`PASS research ${width}: original researcher, one project, pause/power progress preservation, release/reassign, whole snapshot, automatic completion without construction`)
      console.log(`PASS ${width}: parallel projects, individual pause/resume/cancel, wheel hover/keyboard/touch, numeric power shortfall, edges, snapshots`)
      console.log(`PASS population ${width}: cargo wait, revived versus received, safety return, stopped plan, recovery without material recharge, whole-session snapshot`)
    }

    // 与正式菜单共用展示组件；增加按钮不改变模块建筑目录、库存或存档。
    for (const [width, height] of [[1366, 900], [390, 844], [320, 740]]) {
      const touch = width < 500
      page.touch = touch
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch })
      const positions = new Map()
      for (const count of [5, 6, 7]) {
        await page.send('Page.navigate', { url: new URL(`wheel-fixture.html?count=${count}&missing=1`, hosted.url).href })
        await page.wait('!!document.querySelector("[data-wheel-anchor]")')
        await pointerTap('[data-wheel-anchor]')
        await page.wait(`document.querySelectorAll('${WHEEL} [data-facility]').length===${count}`)
        const geometry = await page.js(`(()=>{
          const ring=document.querySelector('.app-player-station-wheel-ring').getBoundingClientRect();
          const buttons=[...document.querySelectorAll('${WHEEL} [data-facility]')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.facility,slot:el.dataset.wheelSlot,x:r.x-ring.x,y:r.y-ring.y,width:r.width,height:r.height,leaking:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1}});
          const center=document.querySelector('.app-player-station-wheel-center').getBoundingClientRect();
          const gaps=buttons.flatMap((a,i)=>buttons.slice(i+1).map(b=>Math.hypot(Math.max(0,Math.max(a.x,b.x)-Math.min(a.x+a.width,b.x+b.width)),Math.max(0,Math.max(a.y,b.y)-Math.min(a.y+a.height,b.y+b.height)))));
          return {count:buttons.length,ringWidth:ring.width,ringHeight:ring.height,buttons,minGap:Math.min(...gaps),centerBuild:!!document.querySelector('.app-player-station-wheel-center [data-facility]'),centerOverlaps:buttons.some(a=>Math.min(a.x+a.width,center.right-ring.x)-Math.max(a.x,center.x-ring.x)>1&&Math.min(a.y+a.height,center.bottom-ring.y)-Math.max(a.y,center.y-ring.y)>1)};
        })()`)
        assert.equal(geometry.count, count)
        assert.equal(geometry.centerBuild, false, 'center contained a build action')
        assert.equal(geometry.centerOverlaps, false, 'center overlapped building buttons')
        assert(Math.abs(geometry.ringWidth - geometry.ringHeight) < 1, 'wheel was not square')
        assert(geometry.minGap >= 8, `touch targets too close: ${geometry.minGap}`)
        for (const button of geometry.buttons) {
          assert(button.width >= 60 && button.height >= 60, 'wheel target too small')
          assert.equal(button.leaking, false, 'building label overflow')
          const old = positions.get(button.id)
          if (old) assert.deepEqual(button, old, 'adding a building moved existing options')
          positions.set(button.id, button)
        }
        const before = await bounds(`fixture-${count}`)
        await shot(`wheel-${count}-options-${width}`)
        if (touch) {
          await pointerTap(option('fixture-2'))
          await page.wait(`!!document.querySelector('${WHEEL} [data-facility-detail="fixture-2"]')`)
          assert.equal(await page.js('document.querySelector("[data-fixture-built]").textContent'), '', 'first touch built immediately')
          assert.equal(await page.js(`document.querySelector('${WHEEL} .app-player-station-wheel-detail > button').getAttribute('aria-disabled')`), 'true')
          await pointerTap(`${WHEEL} .app-player-station-wheel-detail > button`)
          assert.equal(await page.js('document.querySelector("[data-fixture-built]").textContent'), '', 'missing sample was selected')
          await bounds(`fixture-${count}-detail`)
          const visible = await page.js(`(()=>{const selectors=['${WHEEL} .app-player-station-wheel-detail > button','${WHEEL} .app-player-station-wheel-center button','${option('fixture-0')}'];return selectors.every(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`)
          assert(visible, 'touch details hid a required control')
          assert.equal(await page.js(`(()=>{const el=document.querySelector('.app-player-station-wheel-detail-content');return el.scrollWidth>el.clientWidth+1})()`), false, 'touch detail horizontal overflow')
          await shot(`wheel-${count}-touch-${width}`)
        } else {
          for (let index = 0; index < count; index++) {
            await hover(option(`fixture-${index}`))
            await page.wait(`!!document.querySelector('.app-tip [data-facility-detail="fixture-${index}"]')`)
          }
          const after = await bounds(`fixture-${count}-hover`)
          assert.equal(after.x, before.x, 'hover moved wheel horizontally')
          assert.equal(after.y, before.y, 'hover moved wheel vertically')
          await shot(`wheel-${count}-hover-${width}`)
          await key('Home')
          await key('ArrowLeft')
          assert(await page.js(`document.activeElement===document.querySelector('${option(`fixture-${count - 1}`)}')`), 'keyboard did not wrap in slot order')
          await key('ArrowRight')
          assert(await page.js(`document.activeElement===document.querySelector('${option('fixture-0')}')`), 'keyboard did not return to first slot')
        }
        await pointerTap(`${WHEEL} .app-player-station-wheel-center button`)
        await page.wait(`!document.querySelector('${WHEEL}')`)
        assert(await page.js('document.activeElement===document.querySelector("[data-wheel-anchor]")'), 'central close lost anchor focus')
        await pointerTap('[data-wheel-anchor]')
        await page.wait(`document.querySelectorAll('${WHEEL} [data-facility]').length===${count}`)
        await pointerTap(option('fixture-0'))
        if (touch) {
          assert.equal(await page.js('document.querySelector("[data-fixture-built]").textContent'), '', 'first touch selected sample immediately')
          await pointerTap(`${WHEEL} .app-player-station-wheel-detail > button`)
        }
        await page.wait(`!document.querySelector('${WHEEL}')`)
        assert.equal(await page.js('document.querySelector("[data-fixture-built]").textContent'), 'fixture-0', 'confirmation selected wrong sample')
        assert(await page.js('document.activeElement===document.querySelector("[data-wheel-anchor]")'), 'selection lost anchor focus')
        wheelReports.push({ width, height, ...geometry })
        console.log(`PASS wheel ${count} options at ${width}: stable slots, central close, gaps, labels, ${touch ? 'touch detail' : 'unobscured hover and keyboard'}`)
      }
    }
    assert.equal(connection.errors.length, 0, 'browser runtime errors')
    fs.writeFileSync(path.join(output, 'browser-readings.json'), JSON.stringify({ reports, wheelReports, shots, runtimeErrors: connection.errors }, null, 2))
    console.log('PASS: desktop/mobile; wheel and hover screenshots saved; no overflow/runtime errors')
  } finally {
    clearTimeout(timer)
    socket?.close()
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    const resolved = path.resolve(profile)
    if (resolved.startsWith(output + path.sep) && path.basename(resolved).startsWith('chrome-smoke-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
