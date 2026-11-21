/** 第二阶段实际控件旅程；独立合成快照/临时Chrome，不操作个人档。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { CdpConnection, JourneyPage, staticServer, stopOwned, removeProfile, sleep } = require('../wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const { stageTwoFixture } = require('./stageTwoFixture.ts')
const { stageTwoChoiceFixture } = require('./stageTwoChoiceFixture.ts')
const OUTPUT = path.resolve(__dirname, '../_ui-artifacts/second-stage')
async function main() {
  await fs.mkdir(OUTPUT, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-second-stage-'))
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
    async function snapshot() { await page.text('.lab-snapshots', '导出'); return JSON.parse(await page.js('document.querySelector("textarea").value')) }
    async function shot(name) {
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(OUTPUT, name), Buffer.from(image.data, 'base64'))
    }
    for (const [width, height] of [[1366, 900], [390, 844]]) {
      const touch = width < 500; page.touch = touch
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch })
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait('!!document.querySelector("textarea")')
      await input('textarea', stageTwoFixture().snapshot()); await page.text('.lab-snapshots', '导入独立快照')
      await input('input[aria-label="团队呼号"]', '先锋舰员队')
      await select('select[aria-label="舰员目标舰船"]', 2)
      await page.text('section[aria-label="舰员团队与培养"]', '组建团队')
      await page.wait('!!document.querySelector("[data-crew-team]")')
      let saved = await snapshot()
      assert.deepEqual(saved.crew.teams[0].members, [3, 4, 5])
      await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).crew.teams[0].activity, 'idle')
      await page.text('[data-crew-team]', '安排模拟训练')
      await page.text('.lab-toolbar', '+15 分钟')
      await page.text('[data-crew-team]', '暂停培养')
      const paused = await snapshot(); await page.text('.lab-toolbar', '+15 分钟')
      assert.equal((await snapshot()).crew.teams[0].progressMs, paused.crew.teams[0].progressMs)
      await page.text('.lab-snapshots', '导入独立快照')
      saved = await snapshot(); assert.equal(saved.crew.teams[0].paused, true)
      await page.text('[data-crew-team]', '恢复培养'); await page.text('.lab-toolbar', '+60 分钟')
      saved = await snapshot(); assert(saved.crew.teams[0].growth > 0)
      await page.js('document.querySelector("[data-crew-team]").scrollIntoView({block:"start"})')
      await shot(`crew-${width}.png`)
      const learning = await page.js('[...document.querySelectorAll("[data-crew-team] button")].find(button=>button.textContent.trim()==="学习"&&!button.disabled)?.outerHTML')
      if (learning) await page.text('[data-crew-team]', '学习')
      await page.text('[data-crew-team]', '转为待命')
      await page.tap('input[aria-label="部署 先锋舰员队"]')
      await page.text('section[aria-label="外派与区域安全"]', '安排补给护航')
      await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
      saved = await snapshot(); assert.equal(saved.security.mission, undefined)
      assert(saved.security.reports.some(report => report.kind === 'escort' && report.outcome === 'victory'))
      for (let index = 0; index < 3; index++) {
        await select('select[aria-label="清剿来源"]', 0)
        // 已清除项禁用，原生select的Home会跳到剩余可选来源。
        await page.text('section[aria-label="外派与区域安全"]', '清剿来源')
        await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
        saved = await snapshot()
        assert.equal(saved.security.sources.filter(source => source.cleared).length, index + 1)
        assert.equal(saved.security.mission, undefined)
      }
      await page.text('section[aria-label="外派与区域安全"]', '预留守备编队')
      await page.text('.lab-toolbar', '+15 分钟'); await page.text('.lab-toolbar', '+15 分钟')
      await page.text('section[aria-label="第二阶段发展目标"]', '确认建立自主据点')
      saved = await snapshot(); assert.equal(saved.campaign.independent, true)
      assert.equal(saved.campaign.achieved.length, 8)
      await page.text('.lab-snapshots', '导入独立快照')
      assert.equal((await snapshot()).campaign.independent, true)
      await page.js('document.querySelector("section[aria-label=第二阶段发展目标]").scrollIntoView({block:"start"})')
      const geometry = await page.js('({width:innerWidth,scroll:document.documentElement.scrollWidth,unresolved:/crew\\.[a-z-]+\\.(name|description)/.test(document.body.innerText),goals:document.querySelectorAll("[data-stage-goal][data-achieved=true]").length})')
      assert.equal(geometry.scroll, width); assert.equal(geometry.unresolved, false); assert.equal(geometry.goals, 8)
      await shot(`complete-${width}.png`)
      const choiceFixture = stageTwoChoiceFixture()
      await input('textarea', choiceFixture.snapshot()); await page.text('.lab-snapshots', '导入独立快照')
      await page.wait('!!document.querySelector("[data-crew-choice]")')
      const pending = (await snapshot()).crew.teams[0].pending
      await page.text('.lab-snapshots', '导入独立快照')
      assert.deepEqual((await snapshot()).crew.teams[0].pending, pending)
      await page.js('document.querySelector("[data-crew-choice]").scrollIntoView({block:"center"})')
      await shot(`choice-${width}.png`)
      await page.tap('[data-crew-choice] button')
      const replied = await snapshot(), chosen = pending.options[0], team = replied.crew.teams[0]
      assert.equal(team.pending, undefined)
      assert((chosen.kind === 'skill' ? team.opportunities : team.traits).includes(chosen.id))
      rows.push({ width, growth: saved.crew.teams[0].growth, sourcesCleared: 3, escort: true, guardMinutes: saved.guardServiceMs / 60_000, independent: true, geometry })
      console.log(`PASS second stage ${width}`)
    }
    assert.deepEqual(cdp.errors, [])
    await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify({ rows, errors: cdp.errors }, null, 2))
  } catch (error) {
    if (page) {
      console.error(await page.js('document.body.innerText.slice(-2500)').catch(() => ''))
      const image = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
      if (image) await fs.writeFile(path.join(OUTPUT, 'failure.png'), Buffer.from(image.data, 'base64'))
    }
    throw error
  } finally {
    socket?.close(); await stopOwned(child)
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    await removeProfile(profile, 'whale-second-stage-')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
