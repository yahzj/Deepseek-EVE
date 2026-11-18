/** 主代理更新web产物后 node tools/fleet-presets-browser-check.cjs；本工具不执行构建。
 * 优先web/dist，兼容旧desktop产物；WH_FLEET_PRESETS_DIST可指定产物绝对/仓库相对目录。
 * PowerShell示例：$env:WH_FLEET_PRESETS_DIST='H:\大鲸鱼\Deepseek-EVE-d2\web\dist'
 * --self-test仅检查静态服务与合成夹具；--battle-only只复查战斗控件；WH_FLEET_PRESETS_CHROME指定Chrome。
 * 自有无头Chrome、全新合成档，验证双布局×1366/390的预设、距离、非法输入、重载和几何。
 * 输出tools/_ui-artifacts/fleet-presets；不读个人档，不等同桌面观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { SAVE_KEY, sleep, settingsScript, CdpConnection, JourneyPage, stopOwned, removeProfile } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { blackMarketTestSave } = require('./black-market-test-fixture.ts')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tools/_ui-artifacts/fleet-presets')
const current = '.app-fleet-range-current-row'
const listRows = '.app-fleet-presets-list > .app-fleet-preset-row'
const presetRow = name => `${listRows}[data-fleet-preset-name=${JSON.stringify(name)}]`

function artifactDirectory() {
  if (process.env.WH_FLEET_PRESETS_DIST) return path.resolve(root, process.env.WH_FLEET_PRESETS_DIST)
  return [path.join(root, 'web/dist'), path.join(root, 'apps/desktop/out/renderer')]
    .find(directory => fs.existsSync(path.join(directory, 'index.html')))
}

async function hostArtifacts(directory) {
  assert(directory && fs.existsSync(path.join(directory, 'index.html')), '缺少构建产物；请更新web/dist或设置WH_FLEET_PRESETS_DIST')
  const base = path.resolve(directory)
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      // web产物带GitHub Pages前缀，桌面产物从根路径取资源。
      const relative = pathname.replace(/^\/Deepseek-EVE(?=\/|$)/, '').replace(/^\/+/, '') || 'index.html'
      const file = path.resolve(base, relative)
      assert(file.startsWith(base + path.sep), '静态请求越界')
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' })[path.extname(file)] ?? 'application/octet-stream')
      response.end(fs.readFileSync(file))
    } catch { response.statusCode = 404; response.end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

function syntheticState() {
  const state = core.loadSaveFile(blackMarketTestSave()).state
  state.fleet = {}
  const ids = Array.from({ length: 3 }, () => core.addShipToFleet(state, 'sh-shrike'))
  state.shipId = ids[0]
  state.onboarding.step = 99
  state.preparationSquads = { combat: [ids[0], ids[2], ids[1]] }
  state.fleetPresets = []
  delete state.fleetRange
  for (const skill of core.COMMAND_SKILLS) state.skills.trained[skill.id] = 5
  return state
}

async function main() {
  const directory = artifactDirectory()
  if (process.argv.includes('--self-test')) {
    const state = syntheticState()
    assert.equal(core.combatRosterOf(state).length, 3)
    const normalized = core.loadSaveFile(core.serializeSaveFile(state)).state
    assert.equal((normalized.fleetPresets ?? []).length, 0)
    const hosted = await hostArtifacts(directory)
    try { assert.equal((await fetch(`${hosted.url}/Deepseek-EVE/index.html`)).status, 200) }
    finally { await new Promise(resolve => hosted.server.close(resolve)) }
    console.log('工具与全新合成夹具自检通过；未启动浏览器。')
    return
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-fleet-presets-'))
  let child, hosted, socket, timer, initialization, page, targetCase
  const readings = []
  try {
    hosted = await hostArtifacts(directory)
    console.log('artifact directory', directory, 'index modified', fs.statSync(path.join(directory, 'index.html')).mtime.toISOString())
    child = spawn(process.env.WH_FLEET_PRESETS_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    child.on('error', error => console.error('自有Chrome启动失败', error.message))
    assert(Number.isInteger(child.pid), '没有创建自有Chrome进程')
    console.log('owned Chrome PID', child.pid)
    timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill() }, 240000)
    let debug
    for (let i = 0; i < 100; i++) { try { debug = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    fs.mkdirSync(output, { recursive: true })
    const navigate = async () => {
      await page.wait('!!document.querySelector(".app-root")')
      await dismissOverlays(page)
      await page.js(`(document.querySelector('[data-nav-page="ship"]')??[...document.querySelectorAll('.app-nav-item')].find(b=>b.textContent.trim()==='舰船')).click()`)
      await page.wait('!!document.querySelector(".app-fleet-presets")')
    }
    const fill = async (selector, value) => page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('缺少输入框');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const click = async (label, scope = '.app-fleet-presets') => page.tap(`${scope} button[aria-label=${JSON.stringify(label)}]`)
    const saved = async () => JSON.parse(await page.js(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`)).state
    const savedWhen = async predicate => page.wait(`(()=>{const state=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})??'null')?.state;return !!state&&(${predicate})})()`)
    const markRows = async () => page.js(`document.querySelectorAll(${JSON.stringify(listRows)}).forEach(row=>row.dataset.fleetPresetName=row.querySelector('.app-fleet-preset-detail strong').textContent)`)
    const rowCount = count => page.wait(`document.querySelectorAll('.app-fleet-presets-list .app-fleet-preset-detail').length===${count}`)
    const rangeMode = async (scope, mode) => page.text(`${scope} .app-fleet-range-mode`, mode)
    const rangeSave = async scope => page.tap(`${scope} .app-fleet-range button[type=submit]`)
    const setDistance = async (scope, distance) => {
      await rangeMode(scope, '手动')
      await page.number(`${scope} input[type=number]`, distance)
      await rangeSave(scope)
      await page.wait('document.querySelector(".app-toast")?.textContent.includes("距离设置已保存")')
    }
    const reload = async () => {
      await page.send('Page.reload')
      await navigate()
      await page.tap('.app-fleet-presets-toolbar button')
      await rowCount(2)
      await markRows()
    }
    for (const layout of process.argv.includes('--battle-only') ? [] : ['classic', 'modern']) for (const [width, height] of [[1366, 768], [390, 844]]) {
      targetCase = `${layout}-${width}`
      const state = syntheticState()
      const minM = data.buildSimContext().balance.battle.minDistanceM
      const manualM = Math.max(6400, minM + 1000)
      const otherM = manualM + 1200
      page.touch = width < 500
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 500 })
      if (initialization) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialization })
      initialization = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(state), { layout, debug: false, test: false }) })).identifier
      await page.send('Page.navigate', { url: hosted.url }); await navigate()
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialization }); initialization = null
      assert(await page.js(`document.querySelector('${current} input[type=number]').disabled`), '当前默认应为自动')
      await fill('.app-fleet-presets-toolbar input', 'Alpha'); await click('保存当前编队')
      await rowCount(1)
      await click('重命名预设', '.app-fleet-preset-actions')
      await fill('.app-fleet-presets-toolbar input', 'Beta'); await click('重命名预设', '.app-fleet-presets-toolbar')
      await page.wait('document.querySelector(".app-fleet-preset-detail strong")?.textContent==="Beta"')
      await markRows()
      await savedWhen('state.fleetPresets?.[0]?.name==="Beta"')
      const beforeInvalid = (await saved()).fleetRange
      await rangeMode(current, '手动')
      for (const invalid of ['', minM - 1, minM + 0.5]) {
        await fill(`${current} input[type=number]`, invalid)
        await rangeSave(current)
        await page.wait(`document.querySelector('${current} [role=alert]')?.textContent.includes('整数')`)
        assert(await page.js(`document.querySelector('${current} input[type=number]').getAttribute('aria-invalid')==='true'`))
        assert.deepEqual((await saved()).fleetRange, beforeInvalid, '非法数字不得写入偏好')
      }
      await setDistance(current, otherM)
      await savedWhen(`state.fleetRange?.desireM===${otherM}&&!state.fleetRange.presetId`)
      await setDistance(presetRow('Beta'), manualM)
      await savedWhen(`state.fleetPresets?.[0]?.range?.desireM===${manualM}`)
      await click('套用编队', presetRow('Beta'))
      await page.wait(`Number(document.querySelector('${current} input[type=number]').value)===${manualM}`)
      assert(await page.js(`document.querySelector('${current} strong').textContent.includes('Beta')`))
      await setDistance(current, otherM)
      await savedWhen(`!state.fleetRange?.presetId&&state.fleetRange?.desireM===${otherM}&&state.fleetPresets?.[0]?.range?.desireM===${manualM}`)
      await click('套用编队', presetRow('Beta'))
      await savedWhen(`state.fleetRange?.presetId===state.fleetPresets?.[0]?.id&&state.fleetRange?.desireM===${manualM}`)
      await fill('.app-fleet-presets-toolbar input', 'Gamma'); await click('保存当前编队')
      await rowCount(2)
      await markRows()
      await setDistance(presetRow('Gamma'), otherM)
      await click('套用编队', presetRow('Gamma'))
      await page.wait(`Number(document.querySelector('${current} input[type=number]').value)===${otherM}`)
      await click('套用编队', presetRow('Beta'))
      await savedWhen(`state.fleetRange?.desireM===${manualM}`)
      await reload()
      assert.equal(Number(await page.js(`document.querySelector('${current} input[type=number]').value`)), manualM)
      assert.equal(Number(await page.js(`document.querySelector(${JSON.stringify(presetRow('Gamma') + ' input[type=number]')}).value`)), otherM)
      const reloaded = await saved()
      assert.deepEqual(reloaded.fleetPresets[0].shipIds, reloaded.fleetPresets[1].shipIds, '同船不同预设夹具')
      await rangeMode(presetRow('Beta'), '自动')
      await rangeSave(presetRow('Beta'))
      await savedWhen('state.fleetPresets?.[0]?.range?.desireM===undefined')
      await click('套用编队', presetRow('Beta'))
      await page.wait(`document.querySelector('${current} input[type=number]').disabled`)
      await savedWhen('state.fleetRange?.desireM===undefined')
      await reload()
      assert(await page.js(`document.querySelector('${current} input[type=number]').disabled`), '自动档须跨重载保留')
      await setDistance(presetRow('Beta'), manualM)
      await click('套用编队', presetRow('Beta')); await click('用当前编队覆盖', presetRow('Beta'))
      await page.tap('.app-fleet-preset-confirm button')
      await page.wait('!document.querySelector(".app-fleet-preset-confirm")')
      const geometry = await page.js(`(()=>{const el=document.querySelector('.app-fleet-presets'),r=el.getBoundingClientRect(),controls=[...el.querySelectorAll('button,input')].filter(c=>c.getClientRects().length);return {width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,rows:document.querySelectorAll('.app-ship-card').length,controlOverflow:controls.filter(c=>{const b=c.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1}).map(c=>c.outerHTML.slice(0,180)),labels:[...el.querySelectorAll('.app-fleet-range')].map(f=>f.textContent),rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
      assert(geometry.scrollWidth <= geometry.clientWidth + 1 && geometry.controlOverflow.length === 0, JSON.stringify(geometry))
      assert(geometry.rows >= 3, JSON.stringify(geometry))
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${width}.png`), Buffer.from(image.data, 'base64'))
      for (const [name, remaining] of [['Beta', 1], ['Gamma', 0]]) {
        await markRows()
        await click('删除预设', presetRow(name))
        assert.equal(await page.js(`document.querySelectorAll('${listRows}').length`), remaining + 1)
        await page.tap('.app-fleet-preset-confirm button')
        await rowCount(remaining)
      }
      for (let index = 0; index < core.FLEET_PRESET_MAX; index++) {
        await fill('.app-fleet-presets-toolbar input', `preset-${index + 1}`); await click('保存当前编队')
        await rowCount(index + 1)
      }
      assert(await page.js(`document.querySelector('.app-fleet-presets button[aria-label="保存当前编队"]').disabled`))
      const full = await page.js(`(()=>{const el=document.querySelector('.app-fleet-presets-list');el.scrollTop=el.scrollHeight;const r=el.getBoundingClientRect(),b=el.lastElementChild.querySelector('button').getBoundingClientRect();return {client:el.clientHeight,scroll:el.scrollHeight,lastReachable:b.top>=r.top&&b.bottom<=r.bottom+1}})()`)
      assert(full.scroll > full.client && full.lastReachable, JSON.stringify(full))
      const fullImage = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${width}-full.png`), Buffer.from(fullImage.data, 'base64'))
      readings.push({ layout, viewportWidth: width, viewportHeight: height, manualM, otherM, invalidNumbers: 3, manualAndAutoReload: true, sameShipsDifferentRanges: true, full, ...geometry }); console.log(JSON.stringify(readings.at(-1)))
    }
    for (const layout of ['classic', 'modern']) for (const [width, height] of [[1366, 768], [390, 844]]) {
      targetCase = `battle-${layout}-${width}`
      const state = syntheticState(), ctx = data.buildSimContext()
      assert(core.setFleetRange(state, ctx, 1800).ok)
      assert(core.saveFleetPreset(state, ctx, '出发预设').ok)
      const battle = core.startFleetBattleFor(state, ctx, core.combatRosterOf(state), 'ano-training')
      assert(battle?.rangeMemory?.fleetPresetId)
      battle.myDesireM = 1700
      state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle }
      page.touch = width < 500
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 500 })
      initialization = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(state), { layout, test: true }) })).identifier
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait('!!document.querySelector(".app-bts-fleet-range-save button")')
      await page.wait(`document.querySelector('.app-root')?.classList.contains('is-layout-${layout}') && document.fonts.status==='loaded'`)
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialization }); initialization = null
      const button = '.app-bts-fleet-range-save button'
      assert.equal(await page.js(`document.querySelector('${button}').disabled`), false)
      await page.tap(button)
      await savedWhen('state.fleetPresets?.[0]?.range?.desireM===1700')
      const measureControls = `(()=>{const el=document.querySelector('.app-battle-controls .app-bts-dock'),r=el.getBoundingClientRect();const controls=[...el.querySelectorAll('button,.app-bts-note,.app-bts-ruler')].map(b=>{const p=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const text=range.getBoundingClientRect();return {className:b.className,text:b.textContent,client:b.clientWidth,scroll:b.scrollWidth,left:p.left,right:p.right,top:p.top,bottom:p.bottom,textLeft:text.left,textRight:text.right,contentOverflow:b.tagName==='BUTTON'?text.left<p.left-1||text.right>p.right+1:b.scrollWidth>b.clientWidth+1}});return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:controls.filter(b=>b.contentOverflow||b.left< -1||b.right>innerWidth+1||b.top< -1||b.bottom>innerHeight+1)}})()`
      const geometry = await page.js(measureControls)
      assert.equal(geometry.overflow.length, 0, JSON.stringify(geometry))
      await page.js(`(()=>{const b=document.querySelector('${button}');b.dataset.probeStyle=b.getAttribute('style')??'';b.style.cssText+=';width:20px;max-width:20px;flex:none;white-space:nowrap;overflow:visible'})()`)
      assert((await page.js(measureControls)).overflow.some(row => row.contentOverflow), '故意压窄按钮后必须能检出文字溢出')
      await page.js(`(()=>{const b=document.querySelector('${button}');b.setAttribute('style',b.dataset.probeStyle);delete b.dataset.probeStyle})()`)
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${targetCase}.png`), Buffer.from(image.data, 'base64'))
      readings.push({ targetCase, saveBattlePreset: true, geometry }); console.log(JSON.stringify(readings.at(-1)))
    }
    assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
    fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify({ artifactDirectory: directory, readings }, null, 2))
  } catch (error) {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ targetCase, artifactDirectory: directory, error: String(error), readings }, null, 2))
    if (page) {
      try { const image = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64')) } catch {}
    }
    throw error
  } finally {
    clearTimeout(timer); socket?.close()
    await stopOwned(child)
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    await removeProfile(profile, 'whale-fleet-presets-')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
