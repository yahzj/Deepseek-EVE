/** 完整站内经营验收：合成快照起步，实际UI扩站/升级/建造/制造/培训/维修。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { CdpConnection, JourneyPage, staticServer, stopOwned, removeProfile, sleep } = require('../wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const { developmentFixture } = require('./development-fixture.ts')
const { manufacturingRecipe, MANUFACTURING_RECIPES } = require('./manufacturing-baseline.ts')
const OUTPUT = path.resolve(__dirname, '../_ui-artifacts/player-station-operations')
const cell = index => `.app-player-station-cell[data-cell="${index}"]`
async function main() {
  await fs.mkdir(OUTPUT, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-station-operations-'))
  let child, socket, hosted, page
  const rows = []
  try {
    hosted = await staticServer(path.join(__dirname, 'dist'))
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log('owned Chrome PID', child.pid)
    let debug
    for (let n = 0; n < 100; n++) { try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const cdp = new CdpConnection(socket)
    page = new JourneyPage(cdp.send.bind(cdp))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    async function snapshot() {
      await page.text('.lab-snapshots', '导出')
      const exported = JSON.parse(await page.js('document.querySelector("textarea").value'))
      return exported.format === 'whale-second-stage-preview' ? JSON.parse(exported.base) : exported
    }
    async function input(selector, text) {
      await page.tap(selector)
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await page.send('Input.insertText', { text })
    }
    async function select(selector, index) {
      await page.tap(selector)
      for (const key of ['Home', ...Array(index).fill('ArrowDown'), 'Tab']) {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
      }
    }
    async function advance(minutes) { for (let n = 0; n < minutes / 60; n++) await page.text('.lab-toolbar', '+60 分钟') }
    for (const [width, height] of [[1366, 900], [390, 844]]) {
      const touch = width < 500
      page.touch = touch
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch })
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait('!!document.querySelector("textarea")')
      const fixture = developmentFixture(), blueprintId = MANUFACTURING_RECIPES[0].blueprintId, recipe = manufacturingRecipe(blueprintId, 0)
      for (const [id, n] of Object.entries(recipe.input)) fixture.setInventory(id, Math.max(n * 100, fixture.host.available(id)))
      await input('textarea', fixture.snapshot())
      await page.text('.lab-snapshots', '导入独立快照')
      assert.equal((await snapshot()).research.catalog, undefined)
      await page.tap('[data-development-start="expand-body"]')
      await advance(60)
      await page.text('[data-development-project="0"]', '暂停'); await advance(60)
      assert.equal((await snapshot()).development.projects[0].progressMs, 60 * 60_000)
      await page.text('[data-development-project="0"]', '恢复'); await advance(180)
      await page.wait('document.querySelectorAll(".app-player-station-cell").length===16')
      const expanded = await snapshot()
      assert.equal(expanded.development.expanded, true)
      assert.deepEqual(JSON.parse(expanded.station).state.cells, fixture.station.cells)
      await page.tap('[data-development-start="power-upgrade-0"]'); await advance(60)
      await page.tap('[data-development-start="life-upgrade-1"]'); await advance(60)
      await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
      assert.deepEqual((await snapshot()).development.levels, { '0': 2, '1': 2 })
      for (const [kind, index, minutes] of [['manufacturing', 9, 90], ['training', 10, 90], ['warning', 11, 60]]) {
        await page.tap(cell(index)); await page.tap(`.app-player-station-wheel [data-facility="${kind}"]`)
        if (touch) await page.tap('.app-player-station-wheel-detail > button')
        await page.wait('!document.querySelector(".app-player-station-wheel")')
        await advance(60)
        if (minutes === 90) { await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟') }
        assert(JSON.parse((await snapshot()).station).state.cells.some(cell => cell.kind === kind && cell.cellIndex === index))
      }
      const people = 'section[aria-label="站内制造"] select[aria-label="经营派工居民"]'
      await select(people, 3)
      await page.number('input[aria-label="制造批数"]', 2)
      const before = await snapshot()
      await page.text('section[aria-label="站内制造"]', '安排制造')
      await page.text('.lab-toolbar', '+1 分钟')
      const made = await snapshot()
      assert.equal(made.manufacturing.runs[0].batchesDone, 2)
      for (const [id, n] of Object.entries(recipe.output)) assert.equal(made.inventory[id], before.inventory[id] + n * 2)
      await select('section[aria-label="培训中心课程"] select[aria-label="经营派工居民"]', 4)
      await page.text('section[aria-label="培训中心课程"]', '开课')
      await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).training.qualifications[4], 'engineer')
      await page.text('.lab-research-input', '模拟故障：地块 1')
      await page.tap('[data-development-start="repair-0"]')
      await page.text('.lab-toolbar', '+15 分钟')
      const repaired = await snapshot()
      assert.deepEqual(repaired.development.damaged, [])
      assert.equal(repaired.development.levels['0'], 2)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual(await snapshot(), repaired)
      await page.js('document.querySelector("section[aria-label=站内制造]").scrollIntoView({block:"start"})')
      const geometry = await page.js('({width:innerWidth,scroll:document.documentElement.scrollWidth,missing:document.body.innerText.includes("ui.playerStation."),cells:document.querySelectorAll(".app-player-station-cell").length})')
      assert.equal(geometry.scroll, width); assert.equal(geometry.missing, false)
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(OUTPUT, `operations-${width}.png`), Buffer.from(shot.data, 'base64'))
      rows.push({ width, geometry, expanded: true, upgrades: repaired.development.levels, manufactured: 2, academy: true, repaired: true })
      console.log(`PASS operations ${width}`)
    }
    assert.deepEqual(cdp.errors, [])
    await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify({ rows, errors: cdp.errors }, null, 2))
  } catch (error) {
    if (page) {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
      if (shot) await fs.writeFile(path.join(OUTPUT, 'failure.png'), Buffer.from(shot.data, 'base64'))
      console.error(await page.js('document.body.innerText.slice(-2000)').catch(() => ''))
    }
    throw error
  } finally {
    socket?.close(); await stopOwned(child)
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    await removeProfile(profile, 'whale-station-operations-')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
