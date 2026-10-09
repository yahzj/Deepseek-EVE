/** 动态星系与战损原生验收，先build再node tools/stellar-native-check.cjs。
 * v0.1.0/存档v31，合成档、隐藏Electron、随机端口；2026-10-09补确认主题、焦点与地表返回取证。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { injectStellarSearchTestState, injectStellarReadyTestState } = require('./stellar-search-fixture.ts')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-stellar-native-'
const OUT = path.join(ROOT, 'tools/_ui-artifacts/stellar')
const dynamicOnly = process.argv.includes('--dynamic-only')
async function parent() {
  fs.mkdirSync(OUT, { recursive: true })
  const directory = path.join(ROOT, 'apps/desktop/out/renderer')
  const server = http.createServer((req, res) => {
    const target = path.resolve(directory, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!target.startsWith(directory + path.sep)) { res.writeHead(403); res.end(); return }
    try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(target)] || 'application/octet-stream'); res.end(fs.readFileSync(target)) }
    catch { res.writeHead(404); res.end() }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/index.html`, reports = []
  try {
    for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mobile of [false, true]) {
      const wantedLocale = process.argv.find(a => a.startsWith('--locale='))?.slice(9)
      if (wantedLocale && wantedLocale !== locale) continue
      const selected = process.argv.find(a => a.startsWith('--case='))?.slice(7)
      if (selected && selected !== `${layout}-${locale}-${mobile ? 'mobile' : 'desktop'}`) continue
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
      try {
        const state = core.createInitialState({ seed: 7, nowWallMs: Date.now() });
        if (dynamicOnly) {
          injectStellarReadyTestState(state)
          const generated = core.generateStellarSystem(3)
          state.planetary.stellar.systems = { [generated.system.id]: generated.system }
          for (const planet of generated.planets) { state.planetary.planets[planet.id] = planet; core.surveyPlanet(state, data.buildPlanetCatalog(), planet.id, 3) }
        }
        else if (process.argv.includes('--scene-only')) injectStellarReadyTestState(state)
        else injectStellarSearchTestState(state)
        fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
        const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url, STELLAR_UI_CASE: JSON.stringify({ layout, locale, mobile, dynamicOnly, noGpu: process.argv.includes('--no-gpu'), sceneOnly: process.argv.includes('--scene-only'), stellarOnly: process.argv.includes('--stellar-only'), kind: process.argv.find(arg => arg.startsWith('--kind='))?.slice(7) }) }
        delete env.ELECTRON_RUN_AS_NODE
        const p = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let errors = ''; p.stdout.on('data', b => process.stdout.write(b)); p.stderr.on('data', b => { errors += b; process.stderr.write(b) })
        const timer = setTimeout(() => p.kill(), process.argv.includes('--scene-only') ? 360000 : 180000), [status] = await once(p, 'exit'); clearTimeout(timer)
        assert.equal(status, 0, errors)
        const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
        if (!process.argv.includes('--scene-only') && !dynamicOnly) assert.equal(saved.planetary.stellar.systems['system-v1-7'].seed, 7)
        assert(saved.fleet[state.shipId].damagePlugs.length === 3)
        reports.push({ layout, locale, mobile, ok: true })
      } finally {
        const checked = path.resolve(profile); assert(checked.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(checked).startsWith(PREFIX))
        try { fs.rmSync(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) }
        catch (error) { console.warn('自建临时目录清理失败，保留：' + checked + '；' + error.message) }
      }
    }
    fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(reports, null, 2), 'utf8')
    console.log(JSON.stringify({ ok: true, cases: reports.length }))
  } finally { server.close(); await once(server, 'close') }
}
async function child() {
  const { app, BrowserWindow } = require('electron'), profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}; require(path.join(ROOT, 'apps/desktop/out/main/index.js')); await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], options = JSON.parse(process.env.STELLAR_UI_CASE)
  win.webContents.setBackgroundThrottling(false)
  win.setContentSize(1366, 768); win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((m, p = {}) => win.webContents.debugger.sendCommand(m, p), { touch: options.mobile })
  const tap = page.tap.bind(page)
  page.tap = async (selector, config) => {
    try {
      // 只撤回合成档新到达的通讯，不改玩家默认设置或绕过目标控件。
      const notice = await page.js(`(()=>{for(const old of document.querySelectorAll('[data-stellar-smoke-dismiss]'))old.removeAttribute('data-stellar-smoke-dismiss');const el=[...document.querySelectorAll('.app-ann-mask button')].find(button=>button.textContent.trim()===${JSON.stringify(data.L10N['ui.App.100'][options.locale])});if(!el)return false;const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!el.contains(hit))return false;el.setAttribute('data-stellar-smoke-dismiss','1');return true})()`)
      if (notice) await tap('[data-stellar-smoke-dismiss]')
      return await tap(selector, config)
    } catch (error) {
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-failure.png`), Buffer.from(image.data, 'base64'))
      console.error(JSON.stringify(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {};const b=e.getBoundingClientRect();return {rect:{x:b.x,y:b.y,w:b.width,h:b.height},hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,500)}})()`)))
      throw error
    }
  }
  const errors = []; win.webContents.debugger.on('message', (_e, m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  const init = `localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:debug','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})`
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init })
  if (options.dynamicOnly) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__stellarGlCanvases=[];const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(${!!options.noGpu}&&type==='webgl')return null;const value=original.call(this,type,...args);if(type==='webgl'&&value&&!window.__stellarGlCanvases.includes(this))window.__stellarGlCanvases.push(this);return value}` })
  if (options.mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 740, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  await sleep(options.stellarOnly ? 6000 : 700)
  const t = id => data.L10N[id][options.locale], snap = () => page.js('window.__whalePlanetaryTest.snapshot()')
  const navigate = async (key, id) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (options.layout === 'classic') await page.tap(`[data-nav-page="${key}"]`)
      else await page.text('.app-nav-side', t(id))
      await sleep(200)
      if (await page.js(`document.querySelector('[data-page]')?.getAttribute('data-page')===${JSON.stringify(key)}`)) return
    }
    throw new Error('原生导航事件未送达：' + key)
  }
  const step = ms => page.js(`window.__whalePlanetaryTest.step(${ms})`)
  const closeDamage = async () => { await page.tap('.app-ship-damage-modal .app-modal-head button'); await page.wait('!document.querySelector(".app-ship-damage-modal")') }
  const openStellar = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.text('.app-nav-side', t('ui.stellar.054')); await sleep(200)
      if (await page.js('!!document.querySelector(".app-stellar-modal")')) return
    }
    throw new Error('原生星系入口事件未送达')
  }
  async function sceneReadings() {
    await page.wait('document.querySelector(".app-stellar-scene")?.dataset.sceneReady==="true"')
    await page.wait('["loaded","none","dynamic"].includes(document.querySelector(".app-stellar-scene")?.dataset.starReady)')
    const images = await page.js(`Promise.all([...document.querySelectorAll('[data-stellar-asset]')].map(async el=>{const image=new Image();image.src=el.getAttribute('href');await image.decode();return {kind:el.getAttribute('data-stellar-asset'),width:image.naturalWidth}}))`)
    assert(images.length > 0 && images.every(row => row.width > 0))
    const readings = await page.js(`(()=>{const c=document.querySelector('.app-stellar-scene'),svg=document.querySelector('.app-stellar-map-svg'),box=svg.viewBox.baseVal,m=svg.getCTM(),s=Math.min(c.clientWidth/box.width,c.clientHeight/box.height),x=(c.clientWidth-box.width*s)/2-box.x*s,y=(c.clientHeight-box.height*s)/2-box.y*s,p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<p.length;i+=64)colors.add(p[i]+','+p[i+1]+','+p[i+2]);return {colors:colors.size,scaleDelta:Math.abs(m.a-s),xDelta:Math.abs(m.e-x),yDelta:Math.abs(m.f-y),width:c.width,height:c.height}})()`)
    assert(readings.colors > 8 && readings.width > 200 && readings.height > 100, JSON.stringify(readings))
    assert(readings.scaleDelta < .01 && readings.xDelta < 1 && readings.yDelta < 1, JSON.stringify(readings))
    return readings
  }
  if (options.dynamicOnly) {
    await openStellar()
    if (options.noGpu) {
      await page.wait('document.querySelector(".app-stellar-motion-layer")?.dataset.renderMode==="static"')
      assert(await page.js('document.querySelector("[data-motion-pause]").disabled && !!document.querySelector("[data-motion-fallback]")'))
      const time = await page.js('document.querySelector(".app-stellar-motion-layer").dataset.motionMs')
      await sleep(500); assert.equal(await page.js('document.querySelector(".app-stellar-motion-layer").dataset.motionMs'), time)
      await page.tap('[data-stellar-body="system-v1-3-p3"]')
      await page.wait('!!document.querySelector(".app-stellar-dynamic-preview .app-stellar-planet-preview")')
      assert.equal(errors.length, 0, JSON.stringify(errors))
      console.log(JSON.stringify({ ...options, ok:true, fallback:true })); app.exit(0); return
    }
    await page.wait('document.querySelector(".app-stellar-motion-layer")?.dataset.renderMode==="dynamic"')
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    const before = await snap()
    const phase = () => page.js('Number(document.querySelector(".app-stellar-motion-layer").dataset.motionMs)')
    const transform = () => page.js('document.querySelector("[data-stellar-body=system-v1-3-p1]").getAttribute("transform")')
    const firstTime = await phase(), firstPosition = await transform()
    await sleep(1500)
    assert(await phase() > firstTime); assert.notEqual(await transform(), firstPosition)
    await page.tap('[data-stellar-body="system-v1-3-p3"]')
    await page.wait('!!document.querySelector("[data-dynamic-preview]")')
    if (!options.mobile) {
      const hover = await phase(); await sleep(250); assert.equal(await phase(), hover)
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    await page.js('document.querySelector("[data-motion-pause]").click();true')
    await page.wait('!!document.querySelector("[data-motion-pause] .lucide-play")')
    const paused = await phase(), position = await transform()
    await sleep(500); assert.equal(await phase(), paused); assert.equal(await transform(), position)
    assert.equal(await page.js('Number(document.querySelector("[data-dynamic-preview]").dataset.motionMs)'), paused)
    await page.tap(`.app-stellar-map-tool[aria-label=${JSON.stringify(t('ui.stellar.050'))}]`)
    const immediateView = await page.js(`(()=>{const b=document.querySelector('.app-stellar-map-svg').viewBox.baseVal,z=1000/b.width,key=[z,b.x+b.width/2-500,b.y+b.height/2-350].join(',');return {key,motion:document.querySelector('.app-stellar-motion-layer').dataset.renderedView,background:document.querySelector('.app-stellar-scene').dataset.renderedView}})()`)
    for (const id of ['motion','background']) {
      const actual = immediateView[id].split(',').map(Number), expected = immediateView.key.split(',').map(Number)
      assert(actual.every((value,index)=>Math.abs(value-expected[index])<.01),JSON.stringify(immediateView))
    }
    const dragPoint = await page.js(`(()=>{const e=document.querySelector('.app-stellar-map-svg'),b=e.getBoundingClientRect();return {x:b.x+b.width*.7,y:b.y+b.height*.35}})()`)
    const dragReadings=[]
    if(options.mobile) await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dragPoint]})
    else await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...dragPoint,button:'left',clickCount:1})
    for (const offset of [12,24,36]) {
      const point={x:dragPoint.x+offset,y:dragPoint.y+offset*.3}
      if(options.mobile) await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]})
      else await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,buttons:1})
      const reading=await page.js(`new Promise(resolve=>requestAnimationFrame(()=>{const e=document.querySelector('.app-stellar-map-svg'),b=e.viewBox.baseVal,z=1000/b.width,expected=[z,b.x+b.width/2-500,b.y+b.height/2-350],value=document.querySelector('.app-stellar-motion-layer').dataset.renderedView.split(',').map(Number);resolve({delta:Math.max(...value.map((n,i)=>Math.abs(n-expected[i]))),view:expected})}))`)
      assert(reading.delta<.01,JSON.stringify(reading));dragReadings.push(reading)
    }
    if(options.mobile) await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    else await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragPoint.x+36,y:dragPoint.y+10.8,button:'left',clickCount:1})
    assert.equal(await phase(), paused)
    await page.tap(`.app-stellar-map-tool[aria-label=${JSON.stringify(t('ui.stellar.052'))}]`)
    const shape = await page.js(`(()=>{const c=document.querySelector('.app-stellar-motion-layer'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<p.length;i+=4)if(p[i])n++;return {painted:n,width:c.width,height:c.height}})()`)
    assert(shape.painted > 100, JSON.stringify(shape))
    // 隔离像素读数使用同一真实shader函数，不加入生产测试接口。
    const ts = require('typescript'), shaderSource = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/stellarPlanetShader.ts'), 'utf8')
    const shaderCode = ts.transpileModule(shaderSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const pixel = await page.js(`(()=>{const exports={};${shaderCode};const c=document.createElement('canvas');c.width=128;c.height=128;const render=exports.createStellarPlanetRenderer(c);if(!render)throw Error('WebGL unavailable');const gl=c.getContext('webgl');function image(light,time){render.draw(light,time,3,true);const p=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}function sides(p){let left=0,right=0,n=0;for(let y=32;y<96;y++)for(let x=20;x<50;x++){const a=(y*128+x)*4,b=(y*128+127-x)*4;left+=p[a]+p[a+1]+p[a+2];right+=p[b]+p[b+1]+p[b+2];n++}return {left:left/n,right:right/n}}const a=image([-1,0,.35],0),b=image([1,0,.35],0),d=image([-1,0,.35],10000);let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==d[i]||a[i+1]!==d[i+1])changed++;const result={leftLight:sides(a),rightLight:sides(b),rotated:sides(d),changed};render.dispose();return result})()`)
    assert(pixel.leftLight.left > pixel.leftLight.right * 1.5, JSON.stringify(pixel))
    assert(pixel.rightLight.right > pixel.rightLight.left * 1.5, JSON.stringify(pixel))
    assert(pixel.rotated.left > pixel.rotated.right * 1.5 && pixel.changed > 500, JSON.stringify(pixel))
    const fullPixel = await page.js(`(()=>{const exports={};${shaderCode};const c=document.createElement('canvas');c.width=128;c.height=128;const renderer=exports.createStellarPlanetRenderer(c),gl=c.getContext('webgl');function read(){const p=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}function stats(p){let sum=0,n=0;for(let i=0;i<p.length;i+=4)if(p[i+3]){sum+=p[i]+p[i+1]+p[i+2];n++}return {painted:n,brightness:sum/Math.max(1,n)}}const light=strength=>({directions:[[-1,0,.35]],strengths:[strength],tint:[1,1,1],ambient:.14});const materials=[];for(const kind of ['rocky','ocean','desert','ice','lava','temperate','gas']){renderer.drawPlanet(light(.8),0,17,kind);const a=read();renderer.drawPlanet(light(.8),10000,17,kind);const b=read();let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1])changed++;materials.push({kind,...stats(a),changed})}renderer.drawPlanet(light(.8),0,17,'rocky');const near=stats(read());renderer.drawPlanet(light(.18),0,17,'rocky');const far=stats(read());renderer.drawPlanet({directions:[],strengths:[],tint:[1,1,1],ambient:.09},0,17,'rocky');const rogue=stats(read());const stars=[];for(const kind of ['yellow','red','blue','white','neutron','black-hole']){renderer.drawStar(0,13,kind);const a=read();renderer.drawStar(15000,13,kind);const b=read();let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1])changed++;stars.push({kind,...stats(a),changed})}renderer.dispose();return {materials,stars,near,far,rogue,error:gl.getError()}})()`)
    assert(fullPixel.error===0 && fullPixel.materials.every(row=>row.painted>500&&row.changed>50),JSON.stringify(fullPixel))
    assert(fullPixel.stars.every(row=>row.painted>500&&row.changed>50),JSON.stringify(fullPixel))
    assert(fullPixel.near.brightness>fullPixel.far.brightness*1.4 && fullPixel.far.brightness>fullPixel.rogue.brightness,JSON.stringify(fullPixel))
    for (const theme of ['deepspace','daylight']) {
      await page.js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`); await sleep(100)
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-dynamic-${theme}.png`), Buffer.from(image.data,'base64'))
    }
    await page.send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion',value:'reduce' }] })
    await page.js('document.querySelector("[data-motion-pause]").click();true'); await sleep(100)
    const reduced = await phase(); await sleep(500); assert.equal(await phase(), reduced)
    await page.send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion',value:'no-preference' }] })
    await page.wait('Number(document.querySelector(".app-stellar-motion-layer").dataset.motionMs)>'+reduced)
    await page.js('document.querySelector("[data-motion-pause]").click();true'); await sleep(100)
    const mapGpu = await page.js('window.__stellarGlCanvases.findIndex(c=>!c.isConnected)')
    assert(mapGpu >= 0)
    await page.js(`window.__stellarLost=window.__stellarGlCanvases[${mapGpu}].getContext('webgl').getExtension('WEBGL_lose_context');window.__stellarLost.loseContext();true`)
    await page.wait('document.querySelector(".app-stellar-motion-layer").dataset.renderMode==="static" && document.querySelector("[data-motion-pause]").disabled')
    await page.js('window.__stellarLost.restoreContext();true')
    await page.wait('document.querySelector(".app-stellar-motion-layer").dataset.renderMode==="dynamic" && !document.querySelector("[data-motion-pause]").disabled')
    const returningPhase = await phase()
    await page.tap('[data-open-surface]'); await page.wait('!!document.querySelector(".app-planet-modal")')
    await page.tap('.app-planet-close'); await page.wait('!!document.querySelector(".app-stellar-modal")')
    await page.wait('document.querySelector(".app-stellar-motion-layer")?.dataset.motionMs!==undefined')
    assert.equal(await phase(), returningPhase)
    await page.js('window.__whalePlanetaryTest.persist();true'); await sleep(150)
    assert.deepEqual((await snap()).planetary.stellar.systems, before.planetary.stellar.systems)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ ...options, ok:true, pixel, fullPixel, immediateView, dragReadings, shape, time:await phase() })); app.exit(0); return
  }
  if (options.sceneOnly) {
    await openStellar()
    const assetFiles = fs.readdirSync(path.join(ROOT, 'apps/desktop/out/renderer/assets')).filter(file => /^(rocky|desert|ice|ocean|lava|temperate|gas|star-yellow|star-red|star-blue|star-white|black-hole)-.*\.png$/.test(file))
    assert.equal(assetFiles.length, 12)
    const decoded = await page.js(`Promise.all(${JSON.stringify(assetFiles)}.map(async file=>{const image=new Image();image.src=new URL('assets/'+file,location.href).href;await image.decode();return image.naturalWidth}))`)
    assert(decoded.every(width => width > 0))
    const wantedKind = options.kind
    const systems = Object.values((await snap()).planetary.stellar.systems).filter(system => !wantedKind || system.kind === wantedKind)
    for (const system of systems) {
      // 合成目录切换使用原生选择控件事件；地图选中和手势仍走真实点击。
      await page.js(`(()=>{const s=document.querySelector('[data-system-select]');s.value=${JSON.stringify(system.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await page.wait(`document.querySelector('[data-stellar-system]')?.getAttribute('data-stellar-system')===${JSON.stringify(system.id)}`)
      await page.wait('document.querySelector(".app-stellar-motion-layer")?.dataset.renderMode==="dynamic"')
      if (await page.js('!!document.querySelector("[data-motion-pause] .lucide-pause")')) await page.js('document.querySelector("[data-motion-pause]").click();true')
      await page.tap(`[data-stellar-body="${system.bodies[0].planetId}"]`)
      const readings = await sceneReadings()
      const sceneBrightness=await page.js(`(()=>{const c=document.querySelector('.app-stellar-scene'),p=c.getContext('2d').getImageData(0,0,40,40).data;let sum=0;for(let i=0;i<p.length;i+=4)sum+=p[i]+p[i+1]+p[i+2];return sum/(p.length/4)})()`)
      if(system.kind==='binary'){
        const original=await page.js('document.querySelector(".app-stellar-motion-layer").dataset.starPositions')
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1})
        await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
        await page.js('document.querySelector("[data-motion-pause]").click();true')
        await page.wait(`document.querySelector('.app-stellar-motion-layer').dataset.starPositions!==${JSON.stringify(original)}`)
        await page.js('document.querySelector("[data-motion-pause]").click();true')
        const moved=await page.js('JSON.parse(document.querySelector(".app-stellar-motion-layer").dataset.starPositions)')
        assert(Math.abs(Math.hypot(moved[0][0]-moved[1][0],moved[0][1]-moved[1][1])-50)<.01,JSON.stringify(moved))
      }
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      for (const theme of ['deepspace', 'daylight']) {
        await page.js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`); await sleep(150)
        await sceneReadings()
        const image = await page.send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-${system.kind}-${theme}.png`), Buffer.from(image.data, 'base64'))
      }
      await page.js('delete document.documentElement.dataset.theme;true')
      await page.tap(`.app-stellar-map-tool[aria-label=${JSON.stringify(t('ui.stellar.050'))}]`); await sleep(150); await sceneReadings()
      await page.tap(`.app-stellar-map-tool[aria-label=${JSON.stringify(t('ui.stellar.052'))}]`)
      console.log(JSON.stringify({ ...options, kind: system.kind, ok: true, sceneBrightness, readings }))
    }
    assert.equal(errors.length, 0, JSON.stringify(errors)); app.exit(0); return
  }
  if (!options.stellarOnly) {
  if (options.layout === 'modern' && !options.mobile) await page.tap('.app-log-head-right button')
  await navigate('ship', 'ui.App.002')
  await page.wait('!!document.querySelector(".app-ship-plug-summary [data-damage-kind]")')
  assert.equal(await page.js('document.querySelectorAll(".app-ship-plug-summary [data-damage-kind]").length'), 3)
  await page.tap('.app-ship-plug-summary [data-damage-kind="speed"]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  await navigate('fit', 'ui.App.003'); await page.wait('!!document.querySelector(".app-fit-plugslots [data-damage-kind]")')
  assert.equal(await page.js('document.querySelectorAll(".app-fit-plugslots [data-damage-kind]").length'), 3)
  await page.tap('.app-fit-plugslots [data-damage-kind="range"]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  await navigate('comms', 'ui.App.009'); await page.text('.app-comms-body .app-tasktabs', t('ui.WreckLog.001'))
  await page.wait('!!document.querySelector(".app-wreck-fit [data-damage-kind]")')
  await page.tap('.app-wreck-fit [data-damage-kind]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  console.log('战损三界面同区与触屏详情通过')
  }
  const underlyingPage = await page.js('document.querySelector(".app-nav-item.is-active")?.textContent')
  await openStellar()
  assert.equal(await page.js('document.querySelector(".app-nav-item.is-active")?.textContent'), underlyingPage)
  await page.tap('[data-probe-manufacture]'); await page.wait('!!document.querySelector("[data-probe-production]")'); await step(3600000)
  assert.equal((await snap()).warehouse.items['deep-space-probe'], 1)
  await page.text('.app-stellar-modes', t('ui.stellar.007'))
  await page.tap('[data-system-seed]')
  await page.send('Input.insertText', { text: '7' })
  await step(1000)
  assert(await page.js(`document.activeElement===document.querySelector('[data-system-seed]') && document.activeElement.value==='7'`))
  await page.tap('[data-search-launch]'); assert.equal((await snap()).warehouse.items['deep-space-probe'], 0)
  await page.tap(`.app-stellar-taskdock button[aria-label=${JSON.stringify(t('ui.stellar.010'))}]`)
  const pausedAt = (await snap()).planetary.stellar.search.progressMs
  await step(60000)
  assert.equal((await snap()).planetary.stellar.search.progressMs, pausedAt)
  await page.tap(`.app-stellar-taskdock button[aria-label=${JSON.stringify(t('ui.stellar.012'))}]`)
  await page.wait('!!document.querySelector(".app-stellar-confirm")')
  for (const theme of ['deepspace', 'daylight', 'contrast', 'warm', 'night', 'cb']) {
    await page.js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`)
    const colors = await page.js(`(()=>{const mask=getComputedStyle(document.querySelector('.app-stellar-confirm')),panel=getComputedStyle(document.querySelector('.app-stellar-confirm > div'));return {mask:mask.backgroundColor,panel:panel.backgroundColor,focus:document.activeElement.closest('.app-stellar-confirm')!==null}})()`)
    assert.notEqual(colors.panel, 'rgba(0, 0, 0, 0)'); assert.notEqual(colors.mask, 'rgba(0, 0, 0, 0)'); assert(colors.focus, JSON.stringify(colors))
  }
  await page.js('delete document.documentElement.dataset.theme;true')
  const confirmationImage = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-confirm.png`), Buffer.from(confirmationImage.data, 'base64'))
  await page.js('document.querySelector("[data-system-select]").focus();true')
  assert(await page.js('!!document.activeElement.closest(".app-stellar-confirm")'))
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert(await page.js('!!document.activeElement.closest(".app-stellar-confirm")'))
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.wait('!document.querySelector(".app-stellar-confirm") && !!document.querySelector(".app-stellar-modal")')
  assert.equal((await snap()).planetary.stellar.search.progressMs, pausedAt)
  assert(await page.js(`document.activeElement===document.querySelector('.app-stellar-taskdock button[aria-label=${JSON.stringify(t('ui.stellar.012'))}]')`))
  await page.tap(`.app-stellar-taskdock button[aria-label=${JSON.stringify(t('ui.stellar.011'))}]`); await step(6 * 3600000)
  await page.wait('!!document.querySelector("[data-stellar-body]")')
  const s = (await snap()).planetary.stellar.systems['system-v1-7']
  const body = s.bodies.find(b => b.kind !== 'gas')
  await page.tap(`[data-stellar-body="${body.planetId}"]`)
  const before = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")')
  await page.tap(`.app-stellar-map-tool[title=${JSON.stringify(t('ui.stellar.050'))}]`)
  const zoomed = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'); assert.notEqual(zoomed, before)
  const center = await page.js(`(()=>{const b=document.querySelector('.app-stellar-map-svg').getBoundingClientRect();return {x:b.x+b.width*.5,y:b.y+b.height*.5,w:b.width,h:b.height}})()`)
  const selection = await page.js('document.querySelector("[data-stellar-body].is-selected").getAttribute("data-stellar-body")')
  if (options.mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x, y: center.y }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + 24, y: center.y + 20 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x + 40, y: center.y + 30, buttons: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x + 40, y: center.y + 30, button: 'left', clickCount: 1 })
  }
  await sleep(100)
  const dragged = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")')
  assert.notEqual(dragged, zoomed)
  assert.equal(await page.js('document.querySelector("[data-stellar-body].is-selected").getAttribute("data-stellar-body")'), selection)
  if (options.mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: center.x, y: center.y - 35 }, { id: 2, x: center.x, y: center.y + 35 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: center.x, y: center.y - 65 }, { id: 2, x: center.x, y: center.y + 65 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: center.x, y: center.y - 65 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: -100 })
  await sleep(100)
  const scaled = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'); assert.notEqual(scaled, dragged)
  await page.tap(`.app-stellar-map-tool[title=${JSON.stringify(t('ui.stellar.052'))}]`)
  assert.equal(await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'), before)
  console.log('缩放、拖动、拖后不误选与全图恢复通过')
  await page.text('.app-stellar-sidebar', t('ui.stellar.022'))
  await sceneReadings()
  const selectedImage = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-selected.png`), Buffer.from(selectedImage.data, 'base64'))
  const targetGeometry = await page.js(`(()=>{const e=document.querySelector('.app-stellar-modal'),workspace=document.querySelector('.app-stellar-workspace'),map=document.querySelector('.app-stellar-mapcolumn'),dock=document.querySelector('.app-stellar-taskdock'),footer=document.querySelector('.app-stellar-footer');return {verticalOverflow:e.scrollHeight>e.clientHeight+1,mapHeight:map.offsetHeight,dockOverlap:workspace.offsetTop+workspace.offsetHeight>dock.offsetTop+1,footerOutside:footer.offsetTop+footer.offsetHeight>e.clientHeight+1}})()`)
  assert(!targetGeometry.verticalOverflow && !targetGeometry.dockOverlap && !targetGeometry.footerOutside, JSON.stringify(targetGeometry))
  assert(targetGeometry.mapHeight >= 180)
  await page.tap('[data-open-surface]'); await page.wait('!!document.querySelector(".app-planet-modal")')
  assert.equal(await page.js('document.querySelectorAll("[data-planet-cell]").length'), (await snap()).planetary.planets[body.planetId].size ** 2)
  await page.tap('.app-planet-close'); await page.wait('!!document.querySelector(".app-stellar-modal")')
  assert(await page.js('document.activeElement===document.querySelector("[data-open-surface]")'))
  assert.equal(await page.js('document.querySelector("[data-stellar-body].is-selected").getAttribute("data-stellar-body")'), selection)
  assert.equal(await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'), before)
  await page.tap(`.app-stellar-systemtools button[aria-label=${JSON.stringify(t('ui.stellar.019'))}]`)
  await page.wait('!!document.querySelector(".app-stellar-confirm")')
  assert.equal(await page.js('document.querySelector(".app-stellar-confirm p").textContent'), '7')
  await page.text('.app-stellar-confirm', t('ui.beacon.008'))
  await page.wait('!document.querySelector(".app-stellar-confirm")')
  assert((await snap()).planetary.stellar.systems['system-v1-7'])
  await page.js('window.__whalePlanetaryTest.persist()'); await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest')
  assert.equal((await snap()).planetary.stellar.systems['system-v1-7'].seed, 7)
  await openStellar()
  const geometry = await page.js(`(()=>{const e=document.querySelector('.app-stellar-modal'),s=document.querySelector('.app-stellar-sidebar'),m=document.querySelector('.app-stellar-mapcolumn');return {overflow:e.scrollWidth>e.clientWidth+1,side:s.offsetWidth,width:e.offsetWidth,map:m.offsetWidth,root:document.querySelector('.app-root').offsetWidth,bodies:document.querySelectorAll('[data-stellar-body]').length}})()`)
  assert(!geometry.overflow); assert(geometry.side >= 280); assert(geometry.width >= geometry.root * .85); assert(geometry.map >= 500)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  const image = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}.png`), Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ ...options, pid: process.pid, ok: true, geometry })); app.exit(0)
}
if (process.argv.includes('--child')) child().catch(e => { console.error(e); require('electron').app.exit(1) })
else parent().catch(e => { console.error(e); process.exitCode = 1 })
