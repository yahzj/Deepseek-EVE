/** 完整星球原生操作：先npm run build，再node tools/planetary-native-check.cjs。
 * 隐藏Electron、随机本机端口、隔离用户目录；操作与几何读数，不是观感结论。
 * v0.1.0 / 存档v31，2026-10-11补轮盘分页/确认/迁拆、标签、空地与64px几何。
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
  const reports = [], surfaceOnly = process.argv.includes('--surface-only')
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
          PLANET_UI_CASE: JSON.stringify({ layout, locale, mobile, surfaceOnly }) }
        delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', error = ''
        child.stdout.on('data', b => { output += b; process.stdout.write(b) }); child.stderr.on('data', b => { error += b; process.stderr.write(b) })
        const timer = setTimeout(() => child.kill(), mobile ? 300_000 : 150_000)
        const [code] = await once(child, 'exit'); clearTimeout(timer)
        assert.equal(code, 0, error)
        const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
        if (!surfaceOnly) {
          assert.equal(saved.planetary.planets['planet-prototype-medium'].colony.awake, 4)
          assert.equal(saved.importantTasks['human-home'].done, true)
        }
        reports.push({ layout, locale, mobile, home: !surfaceOnly, saved: true, surfaceOnly })
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
  const key = async (name, modifiers=0) => {
    await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:name,code:name,modifiers,windowsVirtualKeyCode:name==='Escape'?27:name==='Tab'?9:name==='Enter'?13:undefined})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,modifiers});await sleep(100)
  }
  const escapeWheel = async () => {
    await page.wait('!!document.querySelector(".app-planet-wheel-dialog")')
    await key('Escape')
    await page.wait('!!document.querySelector(".app-planet-modal")&&!document.querySelector(".app-planet-wheel-dialog")')
  }
  const screenshot = async suffix => {
    const image=await page.send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(OUTPUT,`${options.layout}-${options.locale}-${options.mobile?'mobile':'desktop'}-${suffix}.png`),Buffer.from(image.data,'base64'))
  }
  const wheelGeometry = async () => {
    const reading=await page.js(`(()=>{const m=document.querySelector('.app-planet-wheel-mask'),d=document.querySelector('.app-planet-wheel-dialog'),buttons=[...d.querySelectorAll('button')],rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom}};return {inside:d.offsetLeft-180>=0&&d.offsetLeft+180<=m.clientWidth&&d.offsetTop-180>=0&&d.offsetTop+180<=m.clientHeight,count:d.querySelectorAll('[data-wheel-item]').length,rects:buttons.map(rect),focus:d.contains(document.activeElement),textFits:buttons.every(b=>[...b.querySelectorAll('span')].every(s=>s.scrollHeight<=s.clientHeight+1&&s.scrollWidth<=s.clientWidth+1))}})()`)
    assert(reading.inside&&reading.focus&&reading.textFits,JSON.stringify(reading))
    assert(reading.count<=7)
    for(let i=0;i<reading.rects.length;i++)for(let j=i+1;j<reading.rects.length;j++){
      const a=reading.rects[i],b=reading.rects[j]
      assert(Math.min(a.right,b.right)-Math.max(a.left,b.left)<1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1,`轮盘控件重叠:${i},${j}`)
    }
    return reading
  }
  const open = async () => {
    await page.js('window.dispatchEvent(new Event("whale-planetary-open"));true')
    await page.wait('!!document.querySelector(".app-stellar-modal")')
    await page.text('.app-stellar-footer', data.L10N['ui.stellar.038'][options.locale])
    await page.wait('!!document.querySelector(".app-planet-modal")')
  }
  const tapCell = async (index, item) => {
    await page.tap(`[data-planet-cell="${index}"]`)
    if (item) await page.wait(`!!document.querySelector('[data-wheel-item="${item}"]')`)
    if (item) await page.tap(`[data-wheel-item="${item}"]`)
  }
  await open()
  console.log('阶段：打开星球')
  let state = await snap()
  if (!options.surfaceOnly) {
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
  }
  await select('.app-planet-picker select', 'planet-prototype-large')
  const large = (await snap()).planetary.planets['planet-prototype-large']
  const empty = large.cells.find(c => !c.obstacle && !c.building)
  const beforeBuild=structuredClone(large.colony)
  await page.tap(`[data-planet-cell="${empty.index}"]`)
  await wheelGeometry();await screenshot('wheel-build-1')
  const firstPage=await page.js(`[...document.querySelectorAll('[data-wheel-item]')].map(e=>e.dataset.wheelItem)`)
  assert.equal(firstPage.length,7)
  await page.tap('[data-wheel-page="next"]');await wheelGeometry();await screenshot('wheel-build-2')
  const secondPage=await page.js(`[...document.querySelectorAll('[data-wheel-item]')].map(e=>e.dataset.wheelItem)`)
  assert.equal(new Set([...firstPage,...secondPage]).size,13)
  console.log('阶段：轮盘分页与边界通过')
  await key('Tab');assert(await page.js(`document.querySelector('.app-planet-wheel-dialog').contains(document.activeElement)`))
  await page.tap('[data-wheel-page="previous"]')
  await page.tap('[data-wheel-item="power"]')
  assert.equal((await snap()).planetary.planets[large.id].colony.credits,beforeBuild.credits)
  assert.deepEqual((await snap()).planetary.planets[large.id].colony.items,beforeBuild.items)
  await screenshot('wheel-build-confirm');await key('Escape')
  assert(await page.js(`!!document.querySelector('.app-planet-modal')&&!document.querySelector('.app-planet-wheel-dialog')&&document.activeElement.dataset.planetCell==='${empty.index}'`))
  await tapCell(empty.index,'power');await page.tap('[data-wheel-confirm="build"]')
  assert((await snap()).planetary.planets[large.id].colony.jobs.length > 0)
  await tapCell(empty.index,'pause')
  assert((await snap()).planetary.planets[large.id].colony.jobs[0].paused)
  await tapCell(empty.index,'pause')
  await tapCell(empty.index,'cancel')
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building, undefined)
  await tapCell(empty.index,'power');await page.tap('[data-wheel-confirm="build"]')
  await step(300000)
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building.status, 'ready')
  console.log('阶段：建造、暂停、取消与完成通过')
  await tapCell(empty.index,'toggle')
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building.enabled,false)
  await tapCell(empty.index,'toggle')
  const target=(await snap()).planetary.planets[large.id].cells.find(c=>!c.building&&!c.obstacle&&c.index!==empty.index)
  await tapCell(empty.index,'move')
  await page.tap(`[data-planet-cell="${target.index}"]`);await page.wait('!!document.querySelector("[data-wheel-confirm=move]")')
  const beforeMove=(await snap()).planetary.planets[large.id].colony.credits
  await screenshot('wheel-move-confirm')
  await page.tap('[data-wheel-confirm="move"]')
  assert((await snap()).planetary.planets[large.id].colony.credits<beforeMove)
  await step(60000)
  assert.equal((await snap()).planetary.planets[large.id].cells[target.index].building.id,'power')
  assert.equal((await snap()).planetary.planets[large.id].cells[empty.index].building,undefined)
  console.log('阶段：迁移通过')
  await tapCell(target.index,'demolish')
  assert.equal((await snap()).planetary.planets[large.id].cells[target.index].building.id,'power')
  await escapeWheel();assert.equal((await snap()).planetary.planets[large.id].cells[target.index].building.id,'power')
  await tapCell(target.index,'demolish');await page.wait('!!document.querySelector("[data-wheel-confirm=demolish]")');await page.tap('[data-wheel-confirm="demolish"]')
  assert.equal((await snap()).planetary.planets[large.id].cells[target.index].building,undefined)
  console.log('阶段：拆除通过')
  const base=large.cells.find(c=>c.building?.id==='base')
  await tapCell(base.index)
  assert(await page.js(`document.querySelector('[data-wheel-item="move"]').getAttribute('aria-disabled')==='true'&&document.querySelector('[data-wheel-item="demolish"]').getAttribute('aria-disabled')==='true'`));await escapeWheel()
  const blocked = large.cells.find(c => c.obstacle)
  await tapCell(blocked.index,'clear')
  await step(120000)
  console.log('阶段：施工与清障')
  assert.equal((await snap()).planetary.planets[large.id].cells[blocked.index].obstacle, undefined)
  for(const index of [0,5,30,35]){await page.tap(`[data-planet-cell="${index}"]`);await wheelGeometry();await key('Escape')}
  const trait=await page.js(`document.querySelector('[data-planet-trait]').dataset.planetTrait`)
  await page.tap(`[data-planet-trait="${trait}"]`)
  assert(await page.js(`!!document.querySelector('[data-planet-trait-details="${trait}"]')`));await screenshot('trait-details')
  await page.tap('.app-planet-trait-expanded button')
  await page.js(`document.querySelector('[data-planet-trait="${trait}"]').focus();true`);await key('Enter')
  await page.wait(`!!document.querySelector('[data-planet-trait-details="${trait}"]')`)
  await page.tap('.app-planet-trait-expanded button')
  if(!options.mobile){
    const point=await page.js(`(()=>{const b=document.querySelector('[data-planet-trait="${trait}"]').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`)
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(650)
    assert(await page.js(`!!document.querySelector('.app-tip')`));await screenshot('trait-hover')
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await sleep(100)
  }
  await page.js(`document.querySelector('[data-planet-cell="35"]').focus();true`)
  await key('ArrowLeft');await key('ArrowRight')
  await page.wait('document.querySelector(".app-planet-detail-scroll").scrollTop===0')
  const geometry = await page.js(`(()=>{const m=document.querySelector('.app-planet-modal'),g=document.querySelector('.app-planet-grid'),tile=g.querySelector('button'),scroll=document.querySelector('.app-planet-grid-scroll'),d=document.querySelector('.app-planet-detail'),commands=document.querySelector('.app-planet-detail-commands'),body=document.querySelector('.app-planet-body'),legend=document.querySelector('.app-planet-grid-legend');const y=e=>{let n=0;for(let p=e;p;p=p.offsetParent)n+=p.offsetTop;return n};const b=m.getBoundingClientRect();return {modalWidth:b.width,modalHeight:b.height,tiles:g.querySelectorAll('button').length,tileWidth:tile.offsetWidth,tileHeight:tile.offsetHeight,gap:parseFloat(getComputedStyle(g).gap),gridWidth:g.offsetWidth,detail:d.offsetWidth,bodyOverflow:m.scrollWidth>m.clientWidth+1,verticalOverflow:m.scrollHeight>m.clientHeight+1,lastReachable:scroll.scrollHeight>=y(g)+g.offsetHeight-y(scroll)-2,commandsFixed:y(commands)+commands.offsetHeight<=y(d)+d.offsetHeight+2,legendInside:y(legend)+legend.offsetHeight<=y(body)+body.offsetHeight+2,arts:document.querySelectorAll('.app-planet-tile-art').length,resources:document.querySelectorAll('[data-planet-resource]').length}})()`)
  const geometryShot=await page.send('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(OUTPUT,`${options.layout}-${options.locale}-${options.mobile?'mobile':'desktop'}-surface.png`),Buffer.from(geometryShot.data,'base64'))
  assert.equal(geometry.tiles, 36); assert(geometry.detail >= 280); assert(!geometry.bodyOverflow&&!geometry.verticalOverflow)
  assert.equal(geometry.tileWidth,64);assert.equal(geometry.tileHeight,64);assert.equal(geometry.gap,8)
  const nonBlank=(await snap()).planetary.planets[large.id].cells.filter(c=>c.building||c.obstacle||c.deposit).length
  assert(geometry.lastReachable&&geometry.commandsFixed&&geometry.legendInside,JSON.stringify(geometry));assert.equal(geometry.arts,nonBlank)
  assert(await page.js(`(()=>{const tiles=[...document.querySelectorAll('.is-plain')];return tiles.length>0&&tiles.every(e=>!e.querySelector('.app-planet-tile-art,.app-planet-tile-index,.app-planet-tile-mark')&&(e.matches(':focus-visible,:hover')||getComputedStyle(e.querySelector('.app-planet-empty-plus')).opacity==='0'))})()`))
  await page.js('window.__whalePlanetaryTest.persist()')
  await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest')
  if (!options.surfaceOnly) assert.equal((await snap()).planetary.planets['planet-prototype-medium'].colony.awake, 4)
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
