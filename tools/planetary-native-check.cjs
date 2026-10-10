/** 完整星球原生操作：先npm run build，再node tools/planetary-native-check.cjs。
 * 隐藏Electron、随机本机端口、隔离用户目录；操作与几何读数，不是观感结论。
 * v0.1.0 / 存档v31，2026-10-10补地表图标/状态/固定操作区与64px几何。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { injectPlanetaryRuntimeTestState } = require('./planetary-runtime-fixture.ts')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..')
const PREFIX = 'whale-planetary-native-'
const OUTPUT = path.join(ROOT, 'tools/_ui-artifacts/planetary')

async function parent() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const renderer = path.join(ROOT, 'apps/desktop/out/renderer')
  const server = http.createServer((req, res) => {
    const file = path.resolve(renderer, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    if (!file.startsWith(renderer + path.sep) && file !== renderer) { res.writeHead(403); res.end(); return }
    const target = file === renderer ? path.join(renderer, 'index.html') : file
    try {
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png' }
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream')
      res.end(fs.readFileSync(target))
    } catch { res.writeHead(404); res.end() }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/index.html`
  const reports = []
  try {
    for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mobile of [false, true]) {
      const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
      if (selected && selected !== `${layout}-${locale}-${mobile ? 'mobile' : 'desktop'}`) continue
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
      try {
        const state = core.createInitialState({ seed: 7, nowWallMs: Date.now() })
        injectPlanetaryRuntimeTestState(state)
        fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
        const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url,
          PLANET_UI_CASE: JSON.stringify({ layout, locale, mobile }) }
        delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', error = ''
        child.stdout.on('data', b => { output += b; process.stdout.write(b) }); child.stderr.on('data', b => { error += b; process.stderr.write(b) })
        const timer = setTimeout(() => child.kill(), 150_000)
        const [code] = await once(child, 'exit'); clearTimeout(timer)
        assert.equal(code, 0, error)
        const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
        assert.equal(saved.planetary.planets['planet-prototype-medium'].colony.awake, 4)
        assert.equal(saved.importantTasks['human-home'].done, true)
        reports.push({ layout, locale, mobile, home: true, saved: true })
      } finally {
        const resolved = path.resolve(profile)
        assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
        fs.rmSync(resolved, { recursive: true, force: true })
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'readings.json'), JSON.stringify(reports, null, 2), 'utf8')
    console.log(`星球原生验收通过：${reports.length}组。`)
  } finally { server.close(); await once(server, 'close') }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], options = JSON.parse(process.env.PLANET_UI_CASE)
  win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: options.mobile })
  const errors = []
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  const config = `localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:debug','1');localStorage.setItem('whale-idle:planetary-test','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)});`
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: config })
  if (options.mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 640, screenWidth: 390, screenHeight: 640, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await page.send('Page.reload')
  await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  console.log('阶段：渲染与实验API就绪')
  const text = key => data.L10N[core.PLANET_TEXT_IDS[key]][options.locale]
  const snap = () => page.js('window.__whalePlanetaryTest.snapshot()')
  const step = async ms => { assert(await page.js(`window.__whalePlanetaryTest.step(${ms})`)) }
  const select = async (selector, value) => page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('select missing');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  const input = async (selector, value) => page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  const open = async () => {
    await page.js('window.dispatchEvent(new Event("whale-planetary-open"));true')
    await page.wait('!!document.querySelector(".app-stellar-modal")')
    await page.text('.app-stellar-footer', data.L10N['ui.stellar.038'][options.locale])
    await page.wait('!!document.querySelector(".app-planet-modal")')
  }
  await open()
  console.log('阶段：打开星球')
  let state = await snap()
  const source = Object.values(state.planetary.planets).find(p => p.traitIds.includes('old-dome') || p.traitIds.includes('underground-ruins'))
  await select('.app-planet-picker select', source.id)
  await page.text('.app-planet-tabs', text('population'))
  await page.text('.app-planet-population', text('discoverHumans'))
  state = await snap(); assert(state.planetary.humans)
  console.log('阶段：人类发现')
  await select('.app-planet-picker select', 'planet-prototype-medium')
  const uid = Object.keys(state.fleet).find(id => id.startsWith('sh-manatee'))
  await select('.app-planet-population select', uid)
  await input('.app-planet-population input[data-planet-input="delivery-humans"]', 4)
  await page.tap('.app-planet-population [data-delivery-submit]')
  assert.equal((await snap()).planetary.deliveries[0].humans, 4)
  console.log('阶段：派运')
  await step(3600000)
  await input('.app-planet-population [data-planet-input="population"]', 1)
  await page.text('.app-planet-population', text('wake'))
  await input('.app-planet-population [data-planet-input="population"]', 3)
  await page.text('.app-planet-population', text('wake'))
  assert.equal((await snap()).planetary.planets['planet-prototype-medium'].colony.awake, 4)
  console.log('阶段：唤醒')
  await page.text('.app-planet-tabs', text('projects'))
  const p = (await snap()).planetary.planets['planet-prototype-medium']
  const project = [...data.buildPlanetCatalog().projects.values()].find(pr => pr.fromTraitId && p.traitIds.includes(pr.fromTraitId))
  await page.tap(`[data-project-id="${project.id}"] button`)
  await step(project.bill.durationMs)
  assert((await snap()).importantTasks['human-home'].done)
  console.log('阶段：家园改造')
  await page.text('.app-planet-tabs', text('surface'))
  await select('.app-planet-picker select', 'planet-prototype-large')
  const large = (await snap()).planetary.planets['planet-prototype-large']
  const empty = large.cells.find(c => !c.obstacle && !c.building)
  await page.tap(`[data-planet-cell="${empty.index}"]`)
  await select('.app-planet-detail select', 'power')
  await page.text('.app-planet-detail', text('build'))
  assert((await snap()).planetary.planets[large.id].colony.jobs.length > 0)
  await page.tap(`.app-planet-detail .app-planet-jobs button[aria-label=${JSON.stringify(text('pause'))}]`)
  assert((await snap()).planetary.planets[large.id].colony.jobs[0].paused)
  await page.tap(`.app-planet-detail .app-planet-jobs button[aria-label=${JSON.stringify(text('resume'))}]`)
  await page.tap(`.app-planet-detail .app-planet-jobs button[aria-label=${JSON.stringify(text('cancel'))}]`)
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building, undefined)
  await page.text('.app-planet-detail', text('build'))
  await step(300000)
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building.status, 'ready')
  const blocked = large.cells.find(c => c.obstacle)
  await page.tap(`[data-planet-cell="${blocked.index}"]`)
  await page.text('.app-planet-detail', text('clear'))
  await step(120000)
  console.log('阶段：施工与清障')
  assert.equal((await snap()).planetary.planets[large.id].cells[blocked.index].obstacle, undefined)
  await page.tap('[data-planet-cell="35"]')
  await page.wait('document.querySelector(".app-planet-detail-scroll").scrollTop===0')
  const geometry = await page.js(`(()=>{const m=document.querySelector('.app-planet-modal'),g=document.querySelector('.app-planet-grid'),tile=g.querySelector('button'),scroll=document.querySelector('.app-planet-grid-scroll'),d=document.querySelector('.app-planet-detail'),commands=document.querySelector('.app-planet-detail-commands'),body=document.querySelector('.app-planet-body'),legend=document.querySelector('.app-planet-grid-legend');const y=e=>{let n=0;for(let p=e;p;p=p.offsetParent)n+=p.offsetTop;return n};const b=m.getBoundingClientRect();return {modalWidth:b.width,modalHeight:b.height,tiles:g.querySelectorAll('button').length,tileWidth:tile.offsetWidth,tileHeight:tile.offsetHeight,gap:parseFloat(getComputedStyle(g).gap),gridWidth:g.offsetWidth,detail:d.offsetWidth,bodyOverflow:m.scrollWidth>m.clientWidth+1,verticalOverflow:m.scrollHeight>m.clientHeight+1,lastReachable:scroll.scrollHeight>=y(g)+g.offsetHeight-y(scroll)-2,commandsFixed:y(commands)+commands.offsetHeight<=y(d)+d.offsetHeight+2,legendInside:y(legend)+legend.offsetHeight<=y(body)+body.offsetHeight+2,arts:document.querySelectorAll('.app-planet-tile-art').length,resources:document.querySelectorAll('[data-planet-resource]').length}})()`)
  const geometryShot=await page.send('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(OUTPUT,`${options.layout}-${options.locale}-${options.mobile?'mobile':'desktop'}-surface.png`),Buffer.from(geometryShot.data,'base64'))
  assert.equal(geometry.tiles, 36); assert(geometry.detail >= 280); assert(!geometry.bodyOverflow&&!geometry.verticalOverflow)
  assert.equal(geometry.tileWidth,64);assert.equal(geometry.tileHeight,64);assert.equal(geometry.gap,8)
  assert(geometry.lastReachable&&geometry.commandsFixed&&geometry.legendInside,JSON.stringify(geometry));assert.equal(geometry.arts,36)
  await page.js('window.__whalePlanetaryTest.persist()')
  await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest')
  assert.equal((await snap()).planetary.planets['planet-prototype-medium'].colony.awake, 4)
  await open()
  await select('.app-planet-picker select', 'planet-prototype-large')
  await page.text('.app-planet-tabs', text('surface'))
  console.log('阶段：重载通过')
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUTPUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}.png`), Buffer.from(shot.data, 'base64'))
  for(const theme of ['deepspace','daylight']){
    await page.js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);await sleep(100)
    const readable=await page.js(`(()=>{const m=document.querySelector('.app-planet-modal'),body=document.querySelector('.app-planet-body'),tile=document.querySelector('[data-planet-cell]'),label=document.querySelector('.app-planet-detail-heading');return {overflow:m.scrollWidth>m.clientWidth+1||m.scrollHeight>m.clientHeight+1,bodyHeight:body.clientHeight,tile:tile.offsetWidth,text:getComputedStyle(label).color}})()`)
    assert(!readable.overflow&&readable.bodyHeight>80&&readable.tile===64,JSON.stringify(readable))
    const image=await page.send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(OUTPUT,`${options.layout}-${options.locale}-${options.mobile?'mobile':'desktop'}-${theme}.png`),Buffer.from(image.data,'base64'))
  }
  await page.js('delete document.documentElement.dataset.theme;true')
  const ts=require('typescript'),{runInNewContext}=require('node:vm'),{jsx,jsxs}=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server')
  const scope={exports:{},require:name=>name==='react/jsx-runtime'?{jsx,jsxs}:name==='./itemSubs'?{wreckTierOf:()=> 'ordinary'}:name==='./tones'?{ICO_TONES:{},NAV_TONES:{},SCALARS:{},TONES:{}}:(()=>{throw Error(name)})()}
  runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,'apps/desktop/src/renderer/src/ui/Glyphs.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,scope)
  const keys=['base','cryo','power','water','nutrition','housing','farm','mine','rare-extractor','industry','research','maintenance','logistics','empty','rough','ice','corrosion','rubble','food']
  const glyphs=keys.map(key=>({key,svg:renderToStaticMarkup(scope.exports.Glyph({name:key==='rare-extractor'?'planet-rare':'planet-'+key,size:64})).replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"')}))
  const atlas=await page.js(`(async()=>{const rows=${JSON.stringify(glyphs)},canvas=document.createElement('canvas');canvas.width=1200;canvas.height=560;const ctx=canvas.getContext('2d');ctx.fillStyle='#09111b';ctx.fillRect(0,0,1200,280);ctx.fillStyle='#eef2f5';ctx.fillRect(0,280,1200,280);const pixels=[];for(let theme=0;theme<2;theme++)for(let index=0;index<rows.length;index++){const row=rows[index],x=index%10*120,y=theme*280+Math.floor(index/10)*132,svg=row.svg.replace('<svg','<svg color="'+(theme?'#31465a':'#dce8f1')+'"');const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();ctx.drawImage(image,x+28,y+20,64,64);ctx.drawImage(image,x+80,y+72,32,32);ctx.fillStyle=theme?'#31465a':'#dce8f1';ctx.font='12px sans-serif';ctx.fillText(row.key,x+8,y+122);const p=ctx.getImageData(x+28,y+20,64,64).data;const bg=theme?[238,242,245]:[9,17,27];let n=0;for(let i=0;i<p.length;i+=4)if(p[i]!==bg[0]||p[i+1]!==bg[1]||p[i+2]!==bg[2])n++;pixels.push({key:row.key,theme,painted:n})}return {image:canvas.toDataURL('image/png'),pixels}})()`)
  assert(atlas.pixels.every(row=>row.painted>50),JSON.stringify(atlas.pixels))
  fs.writeFileSync(path.join(OUTPUT,'glyphs.png'),Buffer.from(atlas.image.split(',')[1],'base64'))
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ ...options, ok: true, geometry, pid: process.pid }))
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
