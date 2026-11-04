/** 设置内切换英文后的真实桌面界面巡检。
 * 用法：先 npm run build，再 node tools/l10n-en-native-check.cjs。
 * 使用全新合成档、隐藏Electron、独立临时userData；不读取个人档、不修改主树。
 * 覆盖经典/现代布局：中文启动，真实点击设置里的 English，再逐页导航并扫描可见中文/未解析文案。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, staticServer, settingsScript, JourneyPage, stopOwned, removeProfile, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')

const OUT = path.join(ROOT, 'tools/_ui-artifacts/l10n-en-native-20261018')
const PREFIX = 'whale-l10n-en-'

function deps() {
  require('tsx/cjs')
  return { core: require('../packages/core/src/index.ts'), data: require('../packages/data/src/index.ts') }
}

function visibleTextScript() {
  return `(()=>{const findings=[];const cjk=/[\\u3400-\\u4dbf\\u4e00-\\u9fff]/,ids=/\\b(?:ui|core|mod|item|ship|ano|bp|matter)\\.[A-Za-z0-9_-]+\\.\\d{3}\\b/,slots=/\\{(?:p\\d+|ship|ammo|source|details|name|need|can|missing)\\}/;
    const seen=new Set();const add=(e,text,kind)=>{text=text.trim();if(!text||text==='中文'||!(cjk.test(text)||ids.test(text)||slots.test(text)))return;const selector=e.tagName.toLowerCase()+'.'+String(e.className?.baseVal??e.className).trim().replace(/\\s+/g,'.');const key=kind+text+selector;if(!seen.has(key)){seen.add(key);findings.push({text,selector,kind})}};
    const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('script,style,[hidden],.is-hidden')};
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode,e=n.parentElement;if(e&&shown(e))add(e,n.textContent??'','text')}
    for(const e of document.querySelectorAll('[title],[data-tip],[aria-label],[placeholder]'))if(shown(e))for(const a of ['title','data-tip','aria-label','placeholder']){const v=e.getAttribute(a);if(v)add(e,v,a)}
    return {findings,text:document.body.innerText.slice(0,3000)}})()`
}

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const { core, data } = deps()
  const ctx = data.buildSimContext()
  const selectedLayout = process.argv.find(arg => arg.startsWith('--layout='))?.slice(9)
  for (const layout of ['classic', 'modern']) {
    if (selectedLayout && layout !== selectedLayout) continue
    const state = core.createInitialState({ nowWallMs: Date.now(), seed: 88, name: 'Locale Test Pilot' })
    state.modeChosen = true
    state.onboarding.step = 99
    state.debugQuick = false
    state.logs = []
    state.commsPopups = []
    for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100
    state.standingsEarned = { dsi: 100 }
    for (const item of ctx.items.values()) state.warehouse.items[item.id] = 5
    for (const mod of ctx.modules.values()) state.moduleBay[mod.id] = 2
    for (const def of ctx.stations.values()) if (def.galaxyId !== 'galaxy-vault') state.stationSites[def.id] = { stage: def.tiers.length, delivered: {} }
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
    let server, child, timer
    try {
      await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now() + 3600000), 'utf8')
      const hosted = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), {
        initialize: settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { layout, locale: 'zh' })
          .replace('localStorage.setItem("whale-idle:locale","zh");',
            'if(!localStorage.getItem("whale-idle:locale"))localStorage.setItem("whale-idle:locale","zh");'),
      })
      server = hosted.server
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: hosted.url, WH_L10N_LAYOUT: layout }
      delete env.ELECTRON_RUN_AS_NODE
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, stdio: 'inherit' })
      console.log(`英文实机巡检 ${layout} PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 420000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
    } finally {
      clearTimeout(timer)
      await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, PREFIX)
    }
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768)
  win.webContents.setBackgroundThrottling(false)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const { data } = deps()
  const zh = id => data.L10N[id].zh
  const en = id => data.L10N[id].en
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Page.enable'); await page.send('Runtime.enable')
  await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  await sleep(300)
  await dismissOverlays(page)
  const readings = []
  const check = async label => {
    await sleep(150)
    // 隐藏窗口首张抓图可能仍是上一帧；先触发抓帧，再等待绘制提交后取证。
    await win.webContents.capturePage(undefined, { stayHidden: true })
    await page.js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await sleep(100)
    const reading = await page.js(visibleTextScript())
    readings.push({ label, ...reading })
    console.log(`${process.env.WH_L10N_LAYOUT}/${label}：疑似遗漏${reading.findings.length}处`)
    if (reading.findings.length) console.log(JSON.stringify(reading.findings.slice(0,10)))
    await fs.writeFile(path.join(OUT, `${process.env.WH_L10N_LAYOUT}-${readings.length}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  }
  const nav = async id => {
    await page.js(`(()=>{document.querySelector('[data-l10n-nav]')?.removeAttribute('data-l10n-nav');const b=[...document.querySelectorAll('.app-nav-side button')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(en(id))}));if(!b)throw Error('导航缺失:'+${JSON.stringify(en(id))});b.setAttribute('data-l10n-nav','1')})()`)
    await page.tap('[data-l10n-nav]')
  }
  const pages = ['ui.App.001', 'ui.App.002', 'ui.App.003', 'ui.App.004', 'ui.App.005', 'ui.App.006', 'ui.App.007', 'ui.App.008', 'ui.App.119', 'ui.App.009']
  const subTabs = async (phase, id) => {
    if (!['ui.App.001','ui.App.002','ui.App.004','ui.App.006','ui.App.008'].includes(id)) return
    const selectors = id === 'ui.App.008' ? ['.app-task-tabs > button[role=tab]'] : [
      '.app-page-content > .page-stack > .app-subtabs > button[role=tab]',
      '.app-page-content .app-subtabs:first-of-type > button[role=tab]',
    ]
    const tabSelector = await page.js(`(${JSON.stringify(selectors)}).find(s=>document.querySelectorAll(s).length>0)??null`)
    assert.ok(tabSelector, `${id}应存在子页签`)
    const count = await page.js(`document.querySelectorAll(${JSON.stringify(tabSelector)}).length`)
    for (let index = 0; index < count; index++) {
      const label = await page.js(`(()=>{const b=document.querySelectorAll(${JSON.stringify(tabSelector)})[${index}];if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return null;b.setAttribute('data-l10n-tab','1');return b.textContent.trim()})()`)
      if (!label) continue
      await page.tap('[data-l10n-tab]')
      await page.js(`document.querySelector('[data-l10n-tab]')?.removeAttribute('data-l10n-tab')`)
      await check(`${phase}/${id}/tab-${index}:${label}`)
    }
  }
  const handbook = async phase => {
    await page.text('.app-header', en('ui.App.028'))
    await page.wait('!!document.querySelector(".app-hand-modal")')
    const count = await page.js('document.querySelectorAll(".app-hand-nav button").length')
    for (let i = 0; i < count; i++) {
      await page.js(`document.querySelectorAll('.app-hand-nav button')[${i}].setAttribute('data-l10n-hand','1')`)
      await page.tap('[data-l10n-hand]')
      await page.js(`document.querySelector('[data-l10n-hand]').removeAttribute('data-l10n-hand')`)
      await check(`${phase}/handbook-${i}`)
    }
    await page.text('.app-hand-modal .app-modal-head', en('ui.App.086'))
    await page.wait('!document.querySelector(".app-hand-modal")')
  }

  // 真实打开设置并点击 English，不通过 localStorage 直接切换。
  await page.text('.app-header', zh('ui.App.010'))
  await page.wait('!!document.querySelector(".app-settings-modal")')
  await page.js(`(()=>{const b=[...document.querySelectorAll('.app-settings-modal button')].find(b=>b.textContent.trim()==='English');if(!b)throw Error('English设置按钮缺失');b.setAttribute('data-l10n-english','1')})()`)
  await page.tap('[data-l10n-english]')
  await page.wait(`localStorage.getItem('whale-idle:locale')==='en'`)
  await page.wait(`document.querySelector('.app-settings-modal')?.textContent.includes(${JSON.stringify(en('ui.App.010'))})`)
  await check('settings-English')
  await page.text('.app-settings-foot', en('ui.App.024'))
  await page.wait('!document.querySelector(".app-settings-modal")')

  for (const id of pages) {
    await nav(id)
    await check(`hot/${id}`)
    await subTabs('hot', id)
  }
  await handbook('hot')
  await page.js('window.__whalePlanetaryTest.persist()')
  await page.reload()
  await page.wait('document.documentElement.dataset.locale==="en"')
  await dismissOverlays(page)
  for (const id of pages) {
    await nav(id)
    await check(`cold/${id}`)
    await subTabs('cold', id)
  }
  await handbook('cold')
  const report = { layout: process.env.WH_L10N_LAYOUT, pid: process.pid, settingsClicked: true, locale: await page.js("localStorage.getItem('whale-idle:locale')"), reloadRetained: true, readings, errors }
  report.localizationComplete = !readings.some(r => r.findings.length)
  await fs.writeFile(path.join(OUT, `${process.env.WH_L10N_LAYOUT}.json`), JSON.stringify(report, null, 2), 'utf8')
  await fs.writeFile(path.join(OUT, `${process.env.WH_L10N_LAYOUT}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  console.log(`${process.env.WH_L10N_LAYOUT}：设置真实切换English及重载、${readings.length}处巡检已落盘；本地化完整=${report.localizationComplete}`)
  assert.equal(errors.length, 0, '出现运行异常，报告已落盘')
  assert.equal(report.localizationComplete, true, '仍有本地化遗漏，报告已落盘')
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
