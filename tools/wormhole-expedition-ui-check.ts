/**
 * 虫洞整备/地点物资/撤离真实操作读数。
 * 游戏版本v0.1.0 · 存档结构v31 · §20适配2026-10-06（改版UI待新构建实跑）。
 * 用法：主代理更新web构建后 npm run ui:whexpedition；--self-test仅工具夹具自检。
 * --quick 只查中文classic桌面/手机；--lowheight 查568×320；--legacy 查debug开但future/test关的旧入口；--dronefill 查四鹦鹉螺具名模板补齐。
 * 非legacy显式future=1、TEST=0，ready合成库存打rules=2；legacy删除库存标记。
 * 常驻扫描页ID映射信号空间，独立实验库存行与未来主面板保留原ID。
 * --viewport=568x320 --locale=en --layout=classic --case=ground：精确筛选，逗号可多选。
 * --from=en/classic/568x320/ground：按默认矩阵顺序从此行续跑；--report-tag=标记保留每轮报告，逐行原子落盘。
 * 模板管理/两栏布局专项见node tools/wormhole-expedition-template-ui.cjs，不重复十层/六事件矩阵。
 * 输入仅本批三份合成档；输出 tools/_ui-artifacts 下JSON/截图，自建隔离Chrome与随机端口。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, resolve, extname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { ANNOUNCEMENTS, buildSimContext } from '@whale/data'
import { loadSaveFile, addShipToFleet, adjustDroneLoad } from '@whale/core'

const root = process.cwd()
const templates = createRequire(import.meta.url)('./wormhole-expedition-template-ui.cjs')
const shared = createRequire(import.meta.url)('./wormhole-expedition-journey-shared.cjs')
const sleep = (n: number) => new Promise<void>((r) => setTimeout(r, n))
class Page {
  private connection: any
  constructor(readonly ws: WebSocket) {
    this.connection = new shared.CdpConnection(ws)
  }
  send(name: string, params: object = {}): Promise<any> {
    return this.connection.send(name, params)
  }
  async js<T = any>(source: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  async wait(source: string) {
    for (let n = 0; n < 100; n++) { if (await this.js(source)) return; await sleep(100) }
    throw new Error(`等待超时：${source}；${await this.js('document.body.innerText.slice(-2000)')}`)
  }
  async text(parent: string, text: string, touch: boolean) {
    await this.js(`(()=>{document.querySelector('[data-wh-ui-action]')?.removeAttribute('data-wh-ui-action');const el=[...document.querySelectorAll(${JSON.stringify(parent+' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('按钮不存在：'+${JSON.stringify(text)}+'；页面：'+document.body.innerText.slice(-2500));el.setAttribute('data-wh-ui-action','1')})()`)
    await this.tap('[data-wh-ui-action]', touch)
  }
  async tap(selector: string, touch: boolean) {
    const point = await this.js<{ x: number; y: number }>(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('元素不存在');el.scrollIntoView({block:'nearest',inline:'nearest'});let r=el.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),b=Math.min(innerHeight,r.bottom),rr=Math.min(innerWidth,r.right);for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(s.overflow+s.overflowX+s.overflowY)){l=Math.max(l,q.left);t=Math.max(t,q.top);rr=Math.min(rr,q.right);b=Math.min(b,q.bottom)}}if(rr-l<1||b-t<1)throw new Error('按钮不可达：'+el.textContent+' '+JSON.stringify(r));const x=(l+rr)/2,y=(t+b)/2,hit=document.elementFromPoint(x,y);if(!hit||!(el===hit||el.contains(hit)))throw new Error('按钮被遮挡：'+el.textContent+' '+hit?.className);return {x,y}})()`)
    if (touch) { await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await sleep(50); await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else { await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }) }
    await sleep(220)
  }
  async number(selector: string, value: number, touch: boolean) {
    if (selector.includes('data-wh-manifest-item')) {
      await templates.inputText({ touch, js: this.js.bind(this), send: this.send.bind(this), wait: this.wait.bind(this) }, selector, String(value))
    } else {
      await this.tap(selector, touch)
      assert(await this.js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`),'输入框未获焦点')
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await this.send('Input.insertText', { text: String(value) })
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
      await sleep(200)
    }
    assert.equal(Number(await this.js(`document.querySelector(${JSON.stringify(selector)}).value`)), value)
  }
  async shot(file: string) {
    const image = await this.send('Page.captureScreenshot', { format: 'png' })
    await fs.mkdir(join(root, 'tools/_ui-artifacts'), { recursive: true })
    await fs.writeFile(join(root, 'tools/_ui-artifacts', file), Buffer.from(image.data, 'base64'))
  }
}
async function main() {
  if (process.argv.includes('--self-test')) { shared.selfTest(); templates.selfTest(); console.log('工具/合成夹具自检通过；未运行UI。'); return }
  const arg = (name: string) => process.argv.find(value => value.startsWith('--'+name+'='))?.split('=').slice(1).join('=')
  const matches = (name: string, value: string) => !arg(name) || arg(name)!.split(',').includes(value)
  const tag = arg('report-tag') ?? new Date().toISOString().replace(/[:.]/g, '-')
  assert(/^[\w-]+$/.test(tag),'report-tag只接受字母数字下划线横线')
  let build: object | undefined
  let server: ReturnType<typeof createServer> | undefined
  let profile: string | undefined
  let chrome: ReturnType<typeof spawn> | undefined
  let spawnError: Error | undefined
  let ownedPidExited = false
  let ws: WebSocket | undefined
  let activePage: Page | undefined
  let activeCase: object | undefined
  let templatePage: any
  const rows: object[] = []
  const progress = async (success?: boolean) => templates.atomicJson(join(root,`tools/_ui-artifacts/whexpedition-ui-${tag}.json`),{success,rows,ownedPid:chrome?.pid,build,filtered:process.argv.slice(2)})
  try {
    build = await templates.assertFreshBuild(resolve(root, 'web/dist'))
    server = createServer(async (req, res) => {
    try {
      const p = resolve(root, 'web/dist', '.' + new URL(req.url ?? '/', 'http://local').pathname.replace(/\/$/, '/index.html'))
      assert(p.startsWith(resolve(root, 'web/dist') + sep))
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' } as Record<string, string>)[extname(p)] ?? 'application/octet-stream')
      res.end(await fs.readFile(p))
    } catch { res.statusCode = 404; res.end() }
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    profile = await fs.mkdtemp(join(tmpdir(), 'whale-expedition-ui-'))
    chrome = spawn(process.env.WH_JOURNEY_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir='+profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    chrome.once('error', error => { spawnError = error })
    console.log(`整备UI专项自有Chrome PID ${chrome.pid}`)
    let debug = ''
    for (let n = 0; n < 100; n++) {
      if (spawnError) throw spawnError
      assert.equal(chrome.exitCode, null, '自有Chrome提前退出')
      try { debug = await fs.readFile(join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, '浏览器未启动')
    const cdp = 'http://127.0.0.1:'+debug.split('\n')[0]
    const quick = process.argv.includes('--quick')
    const legacy = process.argv.includes('--legacy')
    const droneFill = process.argv.includes('--dronefill')
    const sizes = (process.argv.includes('--lowheight') ? [[568,320,true]] : quick || legacy ? [[1366,768,false],[390,844,true]] : [[1366,768,false],[1024,540,false],[390,844,true],[844,390,true],[320,568,true],[568,320,true]]).filter(([width,height])=>matches('viewport',`${width}x${height}`))
    const locales = (quick ? ['zh'] : ['zh','en']).filter(locale=>matches('locale',locale))
    const layouts = (quick ? ['classic'] : ['classic','modern']).filter(layout=>matches('layout',layout))
    const names = (legacy || droneFill ? ['ready'] : ['ready','ground','overload']).filter(name=>matches('case',name))
    assert(sizes.length&&locales.length&&layouts.length&&names.length,'筛选未命中矩阵')
    let suffixStarted = !arg('from')
    for (const locale of locales) for (const layout of layouts) for (const [width,height,mobile] of sizes) for (const name of names) {
      const key = `${locale}/${layout}/${width}x${height}/${name}`
      if (!suffixStarted && key===arg('from')) suffixStarted=true
      if (!suffixStarted) continue
      const target = await (await fetch(cdp+'/json/new?about:blank', { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string }
      ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise<void>((r,j) => { ws!.addEventListener('open', () => r(), { once: true }); ws!.addEventListener('error', () => j(new Error('cdp')), { once: true }) })
      const page = new Page(ws)
      activePage = page
      activeCase = { locale,layout,width,height,mobile,name,droneFill }
      templatePage = {
        touch: !!mobile, js: page.js.bind(page), send: page.send.bind(page), wait: page.wait.bind(page),
        tap: (selector: string) => page.tap(selector, !!mobile), text: (parent: string, text: string) => page.text(parent, text, !!mobile),
      }
      const errors: string[] = []
      ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params)) })
      await page.send('Runtime.enable'); await page.send('Page.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, mobile, deviceScaleFactor: 1, screenOrientation: { type: Number(width)<Number(height)?'portraitPrimary':'landscapePrimary', angle: Number(width)<Number(height)?0:90 } })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
      const save = JSON.parse(await fs.readFile(join(root, 'docs/test-saves', `test-save-whexpedition-${name}-20261004.json`), 'utf8'))
      if (legacy || name === 'ready') shared.syntheticStockRules(save.state, !legacy)
      const droneFleet: string[] = []
      if (droneFill) {
        save.state = loadSaveFile(JSON.stringify(save)).state
        const ctx = buildSimContext()
        for (let i = 0; i < 4; i++) droneFleet.push(addShipToFleet(save.state, 'sh-nautilus'))
        save.state.shipId = droneFleet[0]!
        save.state.warehouse.items['drone-scout'] = 100
        for (const uid of droneFleet) assert(adjustDroneLoad(save.state, ctx, 'drone-scout', 8, uid).ok)
      }
      save.savedAtWallMs = Date.now(); save.state.savedAtWallMs = save.savedAtWallMs
      const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();${shared.settingsScript(ANNOUNCEMENTS[0]!.id, JSON.stringify(save), { test: false, future: !legacy, locale, layout })}` })
      await page.send('Page.navigate', { url: 'http://127.0.0.1:'+port+'/' })
      await page.wait(`!!document.querySelector('.app-root')`); await sleep(700)
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
      await templates.installInputEvidence(templatePage)
      const t = shared.uiText(locale, legacy ? 'signal' : 'future')
      if (layout === 'modern' && !mobile && await page.js(`!!document.querySelector('.app-log-side:not(.is-collapsed)')`)) {
        await page.tap('.app-log-head-right button', false)
        await page.wait(`!!document.querySelector('.app-log-side.is-collapsed')`)
      }
      await page.text('.app-nav-side', t('ui.App.001'), !!mobile)
      await page.text('.app-subtabs', t('ui.MapPage.007'), !!mobile)
      if (legacy) {
        await page.text('.app-page-content', t('ui.WormholeScan.018'), !!mobile)
        await page.text('.app-wh-modal', t('ui.Expedition.308'), !!mobile)
        await page.wait(`!!document.querySelector('.app-wh-tabbar')`)
        await page.wait(`document.querySelector('.app-wh-extract')?.disabled===false`)
        assert.equal(await page.js(`!!document.querySelector('.app-wh-manifest,.app-wh-supply-summary')`),false,'普通入口误启用新版整备')
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplyVersion`),undefined)
        assert.notEqual(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.expeditionRules`),2)
        assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title').textContent.trim()`),t('ui.Expedition.005'))
        await page.text('.app-wh-modal .app-modal-head',t('ui.Wormhole.015'),!!mobile)
        await page.tap('.app-activitybar-item.is-wormhole',!!mobile)
        await page.wait(`document.querySelector('.app-wh-extract')?.disabled===false`)
        await page.tap('.app-wh-extract',!!mobile)
        await page.tap('.app-wh-extract',!!mobile)
        await page.wait(`!!document.querySelector('.app-wh-settle')`)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`),null)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.warehouse.items['ammo-kinetic-l']`),4000,'旧入口不应扣整备物资')
        assert.equal(errors.length,0,JSON.stringify(errors))
        rows.push({locale,layout,width,height,legacy:true})
        await progress()
        console.log(JSON.stringify(rows.at(-1)))
        ws.close(); ws=undefined; await fetch(cdp+'/json/close/'+target.id)
        continue
      }
      if (name === 'ready') {
        await shared.openStockPreparation(templatePage, t)
        await page.wait(`!!document.querySelector('.app-wh-modal')`)
        for (const uid of droneFleet.slice(1)) await page.tap(`[data-wh-pick="${uid}"]`, !!mobile)
        await page.text('.app-wh-modal', t('ui.Expedition.308'), !!mobile)
        await page.wait(`!!document.querySelector('.app-wh-manifest')`)
        assert.equal(await page.js(`!!document.querySelector('[data-wh-goal]')`),false,'整备不应残留目标选择器')
        assert.equal(await page.js(`document.querySelector('[data-wh-template-fill]').disabled`),true,'无模板时补齐须disabled')
        if (droneFill) {
          const field = '[data-wh-manifest-item="drone-scout"] input[type="number"]'
          const stock = await page.js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state;return {stock:s.warehouse.items['drone-scout'],fleet:${JSON.stringify(droneFleet)}.map(id=>s.fleet[id].droneLoad)}})()`)
          assert.equal(stock.stock,68)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),0)
          await page.number(field,32,!!mobile)
          const reserve = await templates.saveNamedTemplate(templatePage,'Drone reserve 32')
          await page.number(field,1,!!mobile)
          await templates.selectTemplate(templatePage,reserve.id)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),1,'选择模板不可执行')
          await page.tap('[data-wh-template-fill]', !!mobile)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),32)
          assert.equal(await page.js(`document.querySelector('[data-wh-deployed="drone-scout"] b').textContent`),'32')
          await page.number(field,0,!!mobile)
          const zero = await templates.saveNamedTemplate(templatePage,'Drone reserve zero')
          await page.number(field,8,!!mobile)
          await templates.selectTemplate(templatePage,zero.id)
          await page.tap('[data-wh-template-fill]', !!mobile)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),0,'明确0不能被补齐覆盖')
          await templates.selectTemplate(templatePage,reserve.id)
          await page.tap('[data-wh-template-fill]', !!mobile)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),32)
          await page.number(field,80,!!mobile)
          await templates.saveNamedTemplate(templatePage,'Drone shortage 80')
          await page.tap('[data-wh-template-fill]', !!mobile)
          assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),80,'缺货目标不得被降低')
          await page.tap('[data-wh-enter-prepared]', !!mobile)
          assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`),null)
          assert(await page.js(`document.querySelector('.app-wh-manifest-errors').textContent.includes(${JSON.stringify(t('ui.whExpedition.006').replace('{p1}','12'))})`))
          await page.number(field,32,!!mobile)
          await templates.selectTemplate(templatePage,reserve.id)
          await page.tap('[data-wh-template-fill]', !!mobile)
          assert.deepEqual(await page.js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state;return {stock:s.warehouse.items['drone-scout'],fleet:${JSON.stringify(droneFleet)}.map(id=>s.fleet[id].droneLoad)}})()`),stock,'补齐/模板不得改实物')
          await page.shot(`whexpedition-dronefill-${layout}-${locale}-${width}-${height}.png`)
          await page.tap('[data-wh-enter-prepared]', !!mobile)
          assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`),null,'补齐仍需最终核对')
          await page.tap('[data-wh-enter-prepared]', !!mobile)
          await page.wait(`!!document.querySelector('.app-wh-supply-summary')`)
          const loaded = await page.js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state;return {stock:s.warehouse.items['drone-scout'],reserve:s.wormhole.run.supplies.items['drone-scout'],fleet:${JSON.stringify(droneFleet)}.map(id=>s.fleet[id].droneLoad)}})()`)
          assert.deepEqual(loaded,{stock:36,reserve:32,fleet:stock.fleet})
        } else {
        await page.shot(`whexpedition-input-${layout}-${locale}-${width}-${height}.png`)
        await page.number('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]', 5000, !!mobile)
        await page.tap('[data-wh-enter-prepared]', !!mobile)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`), null, '缺额不得入场')
        assert.equal(await page.js(`Number(document.querySelector('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]').value)`), 5000, '拒绝入场不得修改目标')
        await page.number('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]', 25, !!mobile)
        await page.shot(`whexpedition-edit-${layout}-${locale}-${width}-${height}.png`)
        const saved = await templates.saveNamedTemplate(templatePage,'Ammo reserve 25')
        await page.number('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]', 1, !!mobile)
        await templates.selectTemplate(templatePage,saved.id)
        assert.equal(await page.js(`document.querySelector('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]').value`), '1','选择模板不可执行')
        await page.tap('[data-wh-template-fill]', !!mobile)
        assert.equal(await page.js(`document.querySelector('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]').value`), '25')
        await page.text('.app-wh-modal .app-modal-head', t('ui.Wormhole.015'), !!mobile)
        await shared.openStockPreparation(templatePage, t)
        await page.text('.app-wh-modal', t('ui.Expedition.308'), !!mobile)
        assert.equal(await page.js(`document.querySelector('[data-wh-manifest-item="ammo-kinetic-l"] input[type="number"]').value`), '25')
        await page.shot(`whexpedition-manifest-${layout}-${locale}-${width}-${height}.png`)
        await page.tap('[data-wh-enter-prepared]', !!mobile); await page.tap('[data-wh-enter-prepared]', !!mobile)
        await page.wait(`!!document.querySelector('.app-wh-supply-summary')`); await sleep(1100)
        const cargo = await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items['ammo-kinetic-l']`)
        assert.equal(cargo,25)
        }
      } else {
        await page.text('.app-page-content', t('ui.WormholeScan.015', 'history'), !!mobile)
        await page.wait(`!!document.querySelector('.app-wh-modal')`); await sleep(1100)
      }
      if (name === 'ground') {
        await page.tap('.app-wh-tab:nth-child(2)', !!mobile)
        await page.wait(`!!document.querySelector('.app-wh-ground-list')`)
        const before = await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items['ammo-kinetic-l']`)
        await page.text('.app-wh-ground-list', t('ui.whExpedition.024'), !!mobile)
        await sleep(500)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items['ammo-kinetic-l']`),before+100)
        await page.number('[data-wh-supply-item="ammo-kinetic-l"] input', 50, !!mobile)
        await page.tap('[data-wh-supply-item="ammo-kinetic-l"] button', !!mobile)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items['ammo-kinetic-l']`), before+50)
        await page.shot(`whexpedition-hold-${layout}-${locale}-${width}-${height}.png`)
        await page.tap('.app-wh-tab:nth-child(1)', !!mobile)
        const cargo = await page.js(`(()=>{const r=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run;return {pos:r.grid.pos,ground:r.groundCargo}})()`)
        const targetKey = await page.js(`(()=>{const g=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.grid;return g.cells.find(c=>c.place==='empty'&&c.key!==g.pos.q+','+g.pos.r&&c.key!==g.exit.q+','+g.exit.r&&Math.max(Math.abs(c.q-g.pos.q),Math.abs(c.r-g.pos.r),Math.abs(c.q+c.r-g.pos.q-g.pos.r))===1).key})()`)
        await page.tap(`[data-wh-cell="${targetKey}"]`, !!mobile)
        await page.wait(`document.querySelector('.app-wh-ask')?.textContent.includes(${JSON.stringify(t('ui.whExpedition.026'))})`)
        assert.deepEqual(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.grid.pos`), cargo.pos, '未确认不得移动')
        await page.text('.app-wh-ask',t('ui.whExpedition.026'),!!mobile)
        const [targetQ,targetR] = targetKey.split(',').map(Number)
        await page.wait(`(()=>{const p=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.grid.pos;return p.q===${targetQ}&&p.r===${targetR}})()`)
        assert.deepEqual(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.groundCargo`),cargo.ground,'地点货不得随行')
        await page.tap(`[data-wh-cell="${cargo.pos.q},${cargo.pos.r}"]`, !!mobile)
        await page.wait(`(()=>{const p=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.grid.pos;return p.q===${cargo.pos.q}&&p.r===${cargo.pos.r}})()`)
        assert.deepEqual(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.grid.pos`),cargo.pos,'返回原格未成功')
        const groundUnits = await page.js(`(()=>{const r=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run;return (r.groundCargo[${JSON.stringify(`${cargo.pos.q},${cargo.pos.r}`)}]?.placements??[]).filter(p=>p.itemId==='ammo-kinetic-l').reduce((n,p)=>n+(p.units??0),0)})()`)
        assert.equal(groundUnits,50,'返回前地点余货不再是50')
        await page.tap('.app-wh-tab:nth-child(2)', !!mobile)
        await page.wait(`!!document.querySelector('[data-wh-ground-item="ammo-kinetic-l"] button')`)
        await page.tap('[data-wh-ground-item="ammo-kinetic-l"] button', !!mobile)
        assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items['ammo-kinetic-l']`), before+100)
        await page.tap('.app-wh-tab:nth-child(1)', !!mobile)
      }
      const beforePause = await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items`)
      await page.text('.app-wh-modal .app-modal-head', t('ui.Wormhole.015'), !!mobile)
      if (name === 'ground') {
        await page.send('Page.reload')
        await page.wait(`!!document.querySelector('.app-root')`)
        await sleep(700)
      }
      // 活动窗口的“继续”也必须返回同一趟，而不是执行新装载。
      await page.tap('.app-activitybar-item.is-wormhole', !!mobile)
      await page.wait(`!!document.querySelector('.app-wh-modal')`)
      await page.wait(`document.querySelector('.app-wh-extract')?.disabled===false`)
      assert.deepEqual(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run.supplies.items`), beforePause)
      await page.tap('.app-wh-extract', !!mobile)
      await page.wait(`!!document.querySelector('.app-wh-extraction')`)
      assert.equal(await page.js(`document.activeElement===document.querySelector('.app-wh-extraction')`),true,'撤离确认未获得焦点')
      assert.equal(await page.js(`!!document.querySelector('.app-wh-tabbar')`), false, '撤离核对期间不应显示底层页签')
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8})
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers:8})
      assert.equal(await page.js(`document.activeElement===document.querySelector('[data-wh-extract-confirm]')`),name !== 'overload','反向Tab须留在清单内')
      const cargoBeforeReview = await page.js(`(()=>{const r=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run;return {supplies:r.supplies,hold:r.hold,ground:r.groundCargo}})()`)
      if (name === 'overload') {
        assert.equal(await page.js(`document.querySelector('[data-wh-extract-confirm]').disabled`),true)
        await page.number('.app-wh-extraction-selection input[type="number"]',500,!!mobile)
      }
      const measure = await page.js(`(()=>{const e=document.querySelector('.app-wh-extraction'),p=document.querySelector('.app-wh-modal'),r=p.getBoundingClientRect(),b=document.querySelector('[data-wh-extract-confirm]').getBoundingClientRect();return {window:{w:p.clientWidth,h:p.clientHeight},within:r.left>=-2&&r.top>=-2&&r.right<=innerWidth+2&&r.bottom<=innerHeight+2,button:{w:b.width,h:b.height},scroll:e.querySelector('.app-wh-extraction-scroll').clientHeight,rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
      assert(measure.within,'窗口出框：'+JSON.stringify(measure)); assert(measure.scroll>40,'内容区不可达：'+JSON.stringify(measure))
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true})
      await fs.writeFile(join(root,'tools/_ui-artifacts',`whexpedition-${name}-${layout}-${locale}-${width}-${height}.png`),Buffer.from(shot.data,'base64'))
      await page.text('.app-wh-extraction', t('ui.ActivityBar.004'), !!mobile)
      await page.wait(`document.activeElement===document.querySelector('.app-wh-extract')`)
      assert.equal(await page.js(`!!JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`),true)
      assert.deepEqual(await page.js(`(()=>{const r=JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run;return {supplies:r.supplies,hold:r.hold,ground:r.groundCargo}})()`),cargoBeforeReview,'取消核对不得修改货物')
      await page.tap('.app-wh-extract',!!mobile)
      if(name==='overload')await page.number('.app-wh-extraction-selection input[type="number"]',500,!!mobile)
      await page.tap('[data-wh-extract-confirm]', !!mobile)
      await page.wait(`!!document.querySelector('.app-wh-settle')`)
      assert.equal(await page.js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wormhole.run`),null)
      assert.equal(errors.length,0,JSON.stringify(errors))
      rows.push({locale,layout,width,height,name,droneFill,measure})
      await progress()
      console.log(JSON.stringify(rows.at(-1)))
      ws.close(); ws=undefined; await fetch(cdp+'/json/close/'+target.id)
    }
    assert(suffixStarted,'from未命中矩阵行')
    await progress(true)
    await templates.atomicJson(join(root,`tools/_ui-artifacts/whexpedition-${legacy ? 'legacy-' : droneFill ? 'dronefill-' : ''}ui-check.json`),{success:true,rows,ownedPid:chrome.pid,build})
    console.log(`真实操作通过：${rows.length}组；仅合成档，非观感验收。`)
  } catch (error: any) {
    const screenshot = `whexpedition-ui-${tag}-failure.png`
    await activePage?.shot(screenshot).catch(() => {})
    const evidence = activePage ? await templates.failureEvidence(activePage).catch(() => null) : null
    const failure = {success:false,ownedPid:chrome?.pid,build,rows,activeCase,stage:templatePage?.checkStage,steps:templatePage?.checkSteps?.slice(-60),failure:error.message,evidence,screenshot}
    await templates.atomicJson(join(root,`tools/_ui-artifacts/whexpedition-ui-${tag}-failure.json`),failure)
    await templates.atomicJson(join(root,`tools/_ui-artifacts/whexpedition-ui-${tag}.json`),failure)
    throw error
  } finally {
    ws?.close()
    try {
      await shared.stopOwned(chrome)
      ownedPidExited = !chrome || !Number.isInteger(chrome.pid) || chrome.exitCode !== null || chrome.signalCode !== null
    } finally {
      if (server) await new Promise<void>((r) => server!.close(() => r()))
      if (profile && ownedPidExited) await shared.removeProfile(profile,'whale-expedition-ui-')
      const file = join(root,`tools/_ui-artifacts/whexpedition-ui-${tag}.json`)
      const report = JSON.parse(await fs.readFile(file,'utf8'))
      await templates.atomicJson(file,{...report,ownedPidExited})
    }
  }
}
main().catch((e)=>{console.error(e);process.exitCode=1})
