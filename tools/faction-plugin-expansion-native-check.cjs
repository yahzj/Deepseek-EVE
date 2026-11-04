/** 五件新势力插件原生富卡检查。先构建，再运行：
 * node tools/faction-plugin-expansion-native-check.cjs
 * 独立初始档、正式安装、隐藏Electron、中文桌面/英文手机、真实IPC保存重载。
 * 输出完整视口截图与文字/几何报告；只验证内容和可达性，不作观感验收，不读取个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'tools', '_ui-artifacts', 'faction-plugin-expansion-20261104')
const PREFIX = 'whale-faction-plugin-expansion-'
const MARKER = '.faction-plugin-expansion-owner'
const IDS = ['plug-pirate-damage-management', 'plug-alien-nanobiomass', 'plug-gravekeeper-charge',
  'plug-titan-drone-command', 'plug-deadarmy-reinforced-hull']
const cleanText = text => String(text).replace(/\s+/g, ' ').trim()
const textOf = (id, locale, params = {}) => {
  assert(data.L10N[id], `缺少文案定义:${id}`)
  return data.l10nEntryText(data.L10N[id], locale).replace(/\{(\w+)\}/g, (slot, key) => String(params[key] ?? slot))
}
const pct = value => `${Math.round(value * 100)}%`

function checkProfile(profile, token) {
  assert(profile && path.isAbsolute(profile), '必须明确指定临时profile绝对路径')
  const target = path.resolve(profile)
  const temp = fs.realpathSync(os.tmpdir())
  const resolved = fs.realpathSync(target)
  assert.equal(path.dirname(resolved).toLowerCase(), temp.toLowerCase(), 'profile必须直接位于临时目录')
  assert(path.basename(resolved).startsWith(PREFIX), 'profile前缀不属于本工具')
  assert(!fs.lstatSync(target).isSymbolicLink(), '不得清理链接目录')
  assert.equal(fs.readFileSync(path.join(resolved, MARKER), 'utf8'), token, 'profile所有权标记不匹配')
  return resolved
}

function fixture() {
  const ctx = data.buildSimContext()
  const state = core.createInitialState({ name: '新势力插件富卡检查', nowWallMs: Date.now(), seed: 20261104 })
  state.modeChosen = true
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  for (const id of ctx.commsMessages.keys()) {
    state.commsDelivered[id] = 0
    state.commsRead[id] = true
  }
  state.commsPopups = []
  const uid = core.addShipToFleet(state, 'sh-wh-e-frigate')
  state.shipId = uid
  state.fleet[uid].customName = '五件新插件检查舰'
  assert.equal(ctx.ships.get('sh-wh-e-frigate').tier, 1)
  assert.equal(core.plugSlotsOf(state, ctx, uid), 5)
  for (const id of IDS) {
    assert.equal(ctx.modules.get(id).cpuUse, 0, `${id}应不占CPU`)
    state.moduleBay[id] = 1
    const result = core.installPlug(state, ctx, id, uid)
    assert(result.ok, `正式安装被拒:${id}:${JSON.stringify(result)}`)
    assert.equal(state.moduleBay[id] ?? 0, 0)
  }
  assert.deepEqual(state.fleet[uid].plugs, IDS)
  return state
}

function runChild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [__filename, '--child'], {
      cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', timedOut = false
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 110000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut, pid: child.pid })
    })
  })
}

async function parent() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    const token = randomUUID()
    fs.writeFileSync(path.join(profile, MARKER), token, 'utf8')
    let childConfirmedExited = false
    try {
      const state = fixture()
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile,
        FACTION_PLUGIN_EXPANSION_LOCALE: locale, FACTION_PLUGIN_EXPANSION_TOKEN: token }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const result = await runChild(env)
      childConfirmedExited = result.signal === null && !result.timedOut
      if (result.stdout) console.log(result.stdout.trim())
      assert(!result.timedOut, `本人Electron进程超时，保留profile供排查:${profile}`)
      assert.equal(result.code, 0, result.stderr || `Electron失败:${JSON.stringify(result)}`)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.equal(saved.shipId, state.shipId)
      assert.deepEqual(saved.fleet[state.shipId].plugs, IDS)
    } finally {
      // 先确认子进程退出，再重新解析绝对路径与所有权；异常退出不猜测进程树状态。
      if (childConfirmedExited) fs.rmSync(checkProfile(profile, token), { recursive: true, force: true })
      else console.error(`未确认Electron正常退出，保留本人临时profile:${profile}`)
    }
  }
}

function expectedRows(mod, locale) {
  const tr = (id, params) => textOf(id, locale, params)
  const rows = [[tr('ui.shipInfo.076'), tr('ui.factionPlug.007')]]
  if (mod.damageManagement) {
    rows.push([tr('ui.factionPlug.009'), tr('ui.factionPlug.010', { p1: pct(mod.damageManagement.penaltyReductionPct) })])
    rows.push([tr('ui.factionPlug.011'), tr('ui.factionPlug.012', {
      p1: pct(mod.damageManagement.hullResistPerKind), p2: mod.damageManagement.maxKinds,
    })])
  }
  if (mod.armorCapacityPenaltyPct !== undefined) rows.push([tr('ui.shipInfo.016'), `-${pct(mod.armorCapacityPenaltyPct)}`])
  if (mod.armorRegenPerSec !== undefined) rows.push([tr('ui.factionPlug.014'), tr('ui.factionPlug.015', {
    p1: `${(mod.armorRegenPerSec * 100).toFixed(1)}%`,
  })])
  if (mod.chargedWeapons) {
    rows.push([tr('ui.factionPlug.016'), `×${mod.chargedWeapons.damageMul}`])
    rows.push([tr('ui.factionPlug.018'), `×${mod.chargedWeapons.reloadMul}`])
    rows.push([tr('ui.factionPlug.020'), tr('ui.factionPlug.021', { p1: pct(mod.chargedWeapons.falloffReductionPct) })])
  }
  if (mod.droneCommand) {
    rows.push([tr('ui.factionPlug.022'), tr('ui.factionPlug.023', { p1: pct(mod.droneCommand.sharePct) })])
    rows.push([tr('ui.factionPlug.024'), tr('ui.factionPlug.025', { p1: pct(mod.droneCommand.targetWeightPerM3) })])
  }
  if (mod.hullCapacityBonusPct !== undefined) rows.push([tr('ui.shipInfo.066'), `+${pct(mod.hullCapacityBonusPct)}`])
  if (mod.recoveryDamageImmune) rows.push([tr('ui.factionPlug.027'), tr('ui.factionPlug.028')])
  return rows
}

async function child() {
  const profile = checkProfile(process.env.WHALE_PERF_USERDATA, process.env.FACTION_PLUGIN_EXPANSION_TOKEN)
  const locale = process.env.FACTION_PLUGIN_EXPANSION_LOCALE
  assert(['zh', 'en'].includes(locale), '未知检查语言')
  const mobile = locale === 'en'
  const { app, BrowserWindow, ipcMain } = require('electron')
  BrowserWindow.prototype.show = function () {}
  let saves = 0, loads = 0
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => originalHandle(channel, async (...args) => {
    const result = await listener(...args)
    if (channel === 'save:save' && result === true) saves++
    if (channel === 'save:load') loads++
    return result
  })
  const guard = setTimeout(() => { console.error('原生富卡检查超时'); app.exit(1) }, 95000)
  try {
    require(path.join(ROOT, 'apps', 'desktop', 'out', 'main', 'index.js'))
    await app.whenReady()
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile))
    const win = BrowserWindow.getAllWindows()[0]
    assert(win, '隐藏窗口未创建')
    win.setContentSize(1366, 768)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params)
    })
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    const settings = {
      'whale-idle:locale': locale, 'whale-idle:layout': mobile ? 'modern' : 'classic',
      'whale-idle:layout-set': '1', 'whale-idle:announce-seen': data.ANNOUNCEMENTS[0].id,
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: Object.entries(settings).map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)})`).join(';'),
    })
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, screenWidth: 390, screenHeight: 740,
        screenOrientation: { type: 'portraitPrimary', angle: 0 }, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    const openFitting = async () => {
      await page.wait('!!document.querySelector(".app-root")')
      if (mobile) await page.text('.app-nav-side', textOf('ui.App.003', locale))
      else await page.tap('[data-nav-page="fit"]')
      await page.wait('document.querySelectorAll(".app-fit-plugslots .is-filled").length===5')
      const names = await page.js('Array.from(document.querySelectorAll(".app-fit-plugslots .is-filled .app-fit-slot-icon-name"),e=>e.textContent)')
      assert.deepEqual(names, IDS.map(id => ctx.modules.get(id).name), '显示的五件插件应与安装顺序相同')
    }
    const ctx = data.buildSimContext(locale)
    await page.send('Page.reload', { ignoreCache: true })
    await openFitting()
    assert.equal(win.isVisible(), false, '检查窗口应始终隐藏')
    const report = { locale, mobile, layout: mobile ? 'modern' : 'classic', pid: process.pid, cards: [], ipc: {} }
    for (const id of IDS) {
      const mod = ctx.modules.get(id)
      const point = await page.js(`(()=>{
        const el=[...document.querySelectorAll('.app-fit-plugslots .is-filled')].find(e=>e.querySelector('.app-fit-slot-icon-name')?.textContent===${JSON.stringify(mod.name)});
        if(!el)throw Error('找不到已安装插件');
        el.scrollIntoView({block:'nearest',inline:'nearest'});
        const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;
        const hit=document.elementFromPoint(x,y);
        if(x<0||y<0||x>innerWidth||y>innerHeight||!hit||!el.contains(hit))throw Error('插件悬停位置不可达');
        return{x,y};
      })()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await page.wait(`document.querySelector('.app-tip .app-ship-hover-title')?.textContent===${JSON.stringify(mod.name)}`)
      await sleep(100)
      const card = await page.js(`(()=>{
        const tip=document.querySelector('.app-tip'),r=tip.getBoundingClientRect();
        const rect=box=>({left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height});
        const textRects=[],walker=document.createTreeWalker(tip,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){if(!walker.currentNode.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(walker.currentNode);for(const box of range.getClientRects())textRects.push(rect(box));}
        return{text:tip.textContent,title:tip.querySelector('.app-ship-hover-title').textContent,
          rows:[...tip.querySelectorAll('.app-info-row')].map(e=>({key:e.querySelector('.app-info-key')?.textContent,value:e.querySelector('.app-info-val')?.textContent})),
          rect:rect(r),viewport:{width:innerWidth,height:innerHeight},textRects,
          clientWidth:tip.clientWidth,scrollWidth:tip.scrollWidth,clientHeight:tip.clientHeight,scrollHeight:tip.scrollHeight};
      })()`)
      assert.equal(card.title, mod.name)
      assert(cleanText(card.text).includes(cleanText(mod.description)), `${id}说明没有完整回退`)
      assert(!/(?:ui|mod|bp)\.[A-Za-z][\w.]*\.\d{3}|\b(?:plug|bp-plug|bp-once-plug)-[a-z-]+|\{[^{}]+\}|undefined|NaN|TODO|占位/.test(card.text), `${id}有内部id或占位符`)
      for (const [key, value] of expectedRows(mod, locale)) {
        assert(card.rows.some(row => cleanText(row.key) === cleanText(key) && cleanText(row.value) === cleanText(value)), `${id}缺少参数:${key}:${value}`)
      }
      if (id === 'plug-alien-nanobiomass') {
        const regen = card.rows.find(row => cleanText(row.key) === cleanText(textOf('ui.factionPlug.014', locale)))
        assert(regen && /(?:^|[^\d.])0\.6%(?!\d)/.test(regen.value), '装甲自愈必须显示0.6%，不可四舍五入为0%或1%')
      }
      const { rect, viewport } = card
      assert(rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1,
        `${id}富卡超出屏幕:${JSON.stringify({ rect, viewport })}`)
      assert(card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1, `${id}富卡内容被裁切`)
      assert(card.textRects.every(box => box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1), `${id}文字超出富卡`)
      // 保存整个视口，不裁取文字片段；内容判断使用上面的完整富卡与参数表。
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      const screenshot = path.join(OUTPUT, `${locale}-${report.layout}-${id}.png`)
      fs.writeFileSync(screenshot, Buffer.from(image.data, 'base64'))
      report.cards.push({ id, ...card, screenshot })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      await sleep(100)
    }
    const savesBefore = saves
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    for (let attempt = 0; attempt < 100 && saves <= savesBefore; attempt++) await sleep(100)
    assert(saves > savesBefore, 'pagehide未触发成功的save:save IPC')
    const readSaved = () => core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    const saved = readSaved()
    assert.deepEqual(saved.fleet[saved.shipId].plugs, IDS)
    const loadsBefore = loads
    await page.send('Page.reload', { ignoreCache: true })
    await openFitting()
    assert(loads > loadsBefore, 'reload未通过save:load IPC读取临时档')
    assert.deepEqual(readSaved().fleet[saved.shipId].plugs, IDS)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    report.ipc = { savesBefore, savesAfter: saves, loadsBefore, loadsAfter: loads, retainedPlugs: IDS }
    report.runtimeErrors = errors
    fs.writeFileSync(path.join(OUTPUT, `${locale}-${report.layout}-report.json`), JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify({ locale, mobile, richCards: report.cards.length, pagehideSaved: true, reloadRetainedPlugs: 5, runtimeErrors: 0 }))
    clearTimeout(guard)
    app.exit(0)
  } catch (error) {
    clearTimeout(guard)
    console.error(error)
    app.exit(1)
  }
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
