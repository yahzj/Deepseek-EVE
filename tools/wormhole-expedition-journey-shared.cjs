/** 浏览器/原生共用的虫洞UI旅程。只读取合成fixture，不读个人档。
 * 游戏v0.1.0 / 档v31；2026-10-06。
 * 入口见wormhole-expedition-journey-ui.cjs、wormhole-expedition-journey-native.cjs。
 * 输入fixture.before，入场/路线/守卫/撤离均点实际UI；API仅快照、逐拍步进、存盘。
 * 输出tools/_ui-artifacts下状态读数和截图；路线仅用revealOf投影，未知格不读place/exit。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createServer } = require('node:http')
const { once } = require('node:events')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'tools', '_ui-artifacts')
const TEST_KEY = 'whale-idle:wh-expedition-test'
const FUTURE_KEY = 'whale-idle:future-wormhole'
const SAVE_KEY = 'whale:idle:save'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function dependencies() {
  require('tsx/cjs')
  return {
    core: require('../packages/core/src/index.ts'),
    data: require('../packages/data/src/index.ts'),
    grid: require('../packages/core/src/wormholeGrid.ts'),
    fixture: require('./wormhole-expedition-fixture.ts'),
  }
}

function uiText(locale = 'zh', domain = 'future') {
  const { core, data } = dependencies()
  assert(['zh', 'en'].includes(locale))
  return (id, context = domain) => {
    assert(['signal', 'future', 'history'].includes(context), `未知文案上下文:${context}`)
    // 扫描与科技常驻页走全局tr；只有未来主面板及历史记录保留原ID。
    const global = /^ui\.(MapPage|MatterTechTab|WormholeScan)\./.test(id)
    const key = context === 'signal' || context === 'future' && global ? core.signalSpaceTextId(id) : id
    assert(data.L10N[key]?.[locale], `缺少现有译文:${key}:${locale}`)
    return data.L10N[key][locale]
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

function recordStep(page, step) {
  const steps = page.checkSteps ??= []
  steps.push(step)
  if (steps.length > 60) steps.shift()
}

function syntheticStockRules(state, future) {
  assert.equal(typeof future, 'boolean')
  assert(Array.isArray(state.wormholeStock), '合成夹具没有坐标库存')
  for (const stock of state.wormholeStock) {
    if (future) stock.expeditionRules = 2
    else delete stock.expeditionRules
  }
  return state
}

async function openStockPreparation(page, text, domain = 'future') {
  assert(['signal', 'future'].includes(domain))
  const context = domain === 'future' ? 'history' : 'signal'
  const name = text('ui.Expedition.005', context)
  const label = text('ui.WormholeScan.018', context)
  const rows = domain === 'future' ? '.app-page-content [data-future-wormhole-stock] .app-inv-row' : '.app-page-content .app-inv-row'
  // 名称按库存域定位；扫描页有旧列表与独立实验列表，不能只点全页第一个同名按钮。
  await page.wait(`!![...document.querySelectorAll(${JSON.stringify(rows)})].find(row=>row.querySelector('.app-inv-name')?.textContent.trim()===${JSON.stringify(name)}&&[...row.querySelectorAll('button')].some(button=>button.textContent.trim()===${JSON.stringify(label)}))`)
  await page.js(`(()=>{document.querySelector('[data-wh-tool-stock-entry]')?.removeAttribute('data-wh-tool-stock-entry');const row=[...document.querySelectorAll(${JSON.stringify(rows)})].find(row=>row.querySelector('.app-inv-name')?.textContent.trim()===${JSON.stringify(name)}&&[...row.querySelectorAll('button')].some(button=>button.textContent.trim()===${JSON.stringify(label)}));if(!row)throw Error('对应库存入口没有渲染');const button=[...row.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});button.setAttribute('data-wh-tool-stock-entry','1')})()`)
  await page.tap('[data-wh-tool-stock-entry]')
}

function createFixture() {
  const { fixture, core, data } = dependencies()
  const made = fixture.makeExpeditionFixture('A', 19, 'drones')
  assert.equal(made.before.wormhole.run, null, '必须从fixture.before整备入场')
  assert.equal(made.before.wormholeStock.find(stock => stock.id === 'journey')?.depth, 1)
  const ctx = data.buildSimContext()
  const before = structuredClone(made.before)
  const completed = [...ctx.anomalies.values()].filter(card => !card.hidden && card.standingGain > 0)
  for (const card of completed) {
    if (before.completedBounties.includes(card.id)) continue
    before.completedBounties.push(card.id)
    core.noteStandingEarned(before, core.DSI_FACTION_ID, card.standingGain)
  }
  core.repairStandingFromBountyProgress(before, ctx)
  before.onboarding = { ...before.onboarding, step: 99 }
  before.modeChosen = true
  assert(core.wormholeScanUnlocked(before), '合成悬赏首胜前提未满足入场声望')
  return {
    made,
    ctx,
    initialSave: core.serializeSaveFile(before, Date.now()),
    configuration: {
      family: 'A', seed: 19, kind: 'drones', fleet: made.fleet, definitions: made.definitions,
      manifest: made.manifest, skills: made.skills, research: made.research,
      baseline: false,
      syntheticEntryPrerequisites: { completedBounties: completed.map(card => card.id), standing: core.wormholeScanStanding(before), mode: 'standard' },
    },
    announcement: data.ANNOUNCEMENTS[0]?.id ?? '',
    text: uiText('zh', 'future'),
  }
}

function settingsScript(announcement, initialSave, options = {}) {
  const entries = {
    'whale-idle:debug': options.debug === false ? '0' : '1',
    [TEST_KEY]: options.test === false ? '0' : '1',
    [FUTURE_KEY]: options.future === true ? '1' : '0',
    'whale-idle:layout-set': '1', 'whale-idle:layout': options.layout ?? 'classic',
    'whale-idle:locale': options.locale ?? 'zh', 'whale-idle:announce-seen': announcement,
  }
  if (initialSave !== undefined) entries[SAVE_KEY] = initialSave
  return `(()=>{${Object.entries(entries).map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`).join('')}})()`
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.errors = []
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params)
        if (this.errors.length > 20) this.errors.shift()
      }
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('自建CDP连接已关闭'))
      }
      this.pending.clear()
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP请求超时:${method}`))
      }, 45_000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

class JourneyPage {
  constructor(send, options = {}) { this.send = send; this.touch = options.touch === true }
  async js(source) {
    const result = await this.send('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  async wait(source, timeout = 20_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await this.js(source)) return
      await sleep(100)
    }
    throw new Error(`等待超时:${source}\n${await this.js('document.body.innerText.slice(-2500)')}`)
  }
  async snapshot() {
    return this.js(`(()=>{const api=window.__whExpeditionTest;if(!api)throw Error('本机测试API未就绪');return api.snapshot()})()`)
  }
  async command(name, args) {
    assert(['step', 'persist'].includes(name), '旅程驱动不得用API代替UI操作')
    return this.js(`window.__whExpeditionTest.command(${JSON.stringify(name)},${JSON.stringify(args ?? [])})`)
  }
  async tap(selector, options = {}) {
    const end = Date.now() + (options.timeout ?? 20_000)
    let point
    let reason = ''
    while (Date.now() < end) {
      const result = await this.js(`(()=>{
        const el=document.querySelector(${JSON.stringify(selector)});
        if(!el)return {reason:'missing'};
        if(el.disabled||el.closest('button:disabled')||el.getAttribute('aria-disabled')==='true')return {reason:'disabled'};
        el.scrollIntoView({block:'nearest',inline:'nearest'});
        const rect=el.getBoundingClientRect();let l=Math.max(0,rect.left),t=Math.max(0,rect.top),r=Math.min(innerWidth,rect.right),b=Math.min(innerHeight,rect.bottom);
        for(let parent=el.parentElement;parent;parent=parent.parentElement){
          const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
          if(/hidden|auto|scroll|clip/.test(style.overflow+style.overflowX+style.overflowY)){l=Math.max(l,box.left);t=Math.max(t,box.top);r=Math.min(r,box.right);b=Math.min(b,box.bottom)}
        }
        if(r-l<1||b-t<1)return {reason:'clipped',rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
        const candidates=[[(l+r)/2,(t+b)/2],[l+(r-l)*.35,t+(b-t)*.35],[l+(r-l)*.65,t+(b-t)*.65]];
        for(const [x,y] of candidates){const hit=document.elementFromPoint(x,y);if(hit&&(hit===el||el.contains(hit)))return {point:{x,y}}}
        return {reason:'occluded'};
      })()`)
      if (result.point) { point = result.point; break }
      reason = JSON.stringify(result)
      await sleep(100)
    }
    assert(point, `UI控件不可达:${selector}:${reason}`)
    if (this.touch) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await sleep(60)
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    }
    await sleep(120)
  }
  async text(parent, label) {
    await this.wait(`!![...document.querySelectorAll(${JSON.stringify(parent + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(label)})`)
    await this.js(`(()=>{document.querySelector('[data-wh-journey-action]')?.removeAttribute('data-wh-journey-action');const el=[...document.querySelectorAll(${JSON.stringify(parent + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('按钮不存在:'+${JSON.stringify(label)});el.setAttribute('data-wh-journey-action','1')})()`)
    await this.tap('[data-wh-journey-action]')
  }
  async number(selector, value) {
    await this.tap(selector)
    assert(await this.js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), '输入框没有获焦')
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await this.send('Input.insertText', { text: String(value) })
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
    assert.equal(await this.js(`Number(document.querySelector(${JSON.stringify(selector)}).value)`), value)
  }
  async screenshot(file) {
    const image = await this.send('Page.captureScreenshot', { format: 'png' })
    await fs.mkdir(OUTPUT, { recursive: true })
    await fs.writeFile(path.join(OUTPUT, file), Buffer.from(image.data, 'base64'))
  }
  async reload() {
    await this.send('Page.reload', { ignoreCache: true })
    await this.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
    await sleep(400)
  }
}

function projection(state) {
  const { grid: gridHelpers } = dependencies()
  const run = state.wormhole.run
  if (!run?.grid) return null
  const grid = run.grid
  const cells = grid.cells.map(cell => {
    const visible = gridHelpers.revealOf(grid, { q: cell.q, r: cell.r })
    const info = visible.kind === 'foe' ? visible.under : visible
    return {
      key: cell.key, q: cell.q, r: cell.r, visible, info,
      visited: grid.visited.includes(cell.key), scanned: grid.scanned.includes(cell.key),
      activated: grid.activated.includes(cell.key),
    }
  })
  const here = cells.find(cell => cell.q === grid.pos.q && cell.r === grid.pos.r)
  assert(here?.visited, '当前位置必须已到达')
  return { cells, here, exit: grid.exitKnown ? { ...grid.exit } : undefined }
}

function layerRecord(state, ctx, stage) {
  const { core } = dependencies()
  const run = state.wormhole.run
  assert(run, '缺少在途远征')
  const usage = core.wormholeHoldUsage(state, ctx)
  return {
    depth: run.depth, stage, gameMs: state.gameMs, turnsLeft: run.turnsLeft,
    fleet: run.fleet.map(id => ({
      id, armorPct: state.fleet[id]?.armorPct ?? 1, durability: state.fleet[id]?.durability ?? 0,
      drones: { ...state.fleet[id]?.droneLoad },
    })),
    supplies: structuredClone(run.supplies),
    hold: { used: usage.used, capacity: usage.capacity },
    alert: run.alertLevel ?? 0, patrols: structuredClone(run.patrols ?? []),
    guardCleared: run.bossCleared ?? 0,
    progress: structuredClone(run.expeditionProgress),
  }
}

function checkpointState(state) {
  const run = state.wormhole.run
  return {
    depth: run.depth, family: run.family, seed: run.seed, rules: run.expeditionRules, supplyVersion: run.supplyVersion,
    turns: [run.turnsTotal, run.turnsLeft, run.turnsSpent ?? null],
    supplies: run.supplies, guard: run.bossCleared ?? 0, guardSupportDisabled: run.guardSupportDisabled ?? false,
    nextBattleRangeMul: run.nextBattleRangeMul ?? null, alert: run.alertLevel ?? 0,
    patrolActionSeq: run.patrolActionSeq ?? 0, patrols: run.patrols ?? [], patrolsSpawned: run.patrolsSpawned ?? 0,
    progress: run.expeditionProgress, goal: run.expeditionGoal,
    grid: run.grid, ground: run.groundCargo ?? {}, hold: run.hold, bag: run.bag,
    pendingNodeBattle: run.pendingNodeBattle ?? false, pendingRuinsBattle: run.pendingRuinsBattle ?? false,
    pendingEvent: run.pendingEvent ?? null,
    fleet: run.fleet.map(id => [id, state.fleet[id]]),
  }
}

async function dismissReport(page) {
  for (let n = 0; n < 80; n++) {
    if (await page.js('!!document.querySelector(".app-bts-report-card button")')) {
      await page.tap('.app-bts-report-card button')
      return
    }
    if (await page.js('!!document.querySelector(".app-wh-modal")')) return
    await sleep(100)
  }
  throw new Error('真实战斗结算后未返回虫洞UI')
}

async function dismissComms(page) {
  for (let index = 0; index < 20; index++) {
    if (!await page.js('!!document.querySelector(".app-modal-mask .app-comms-eave-extra button")')) return
    await page.tap('.app-modal-mask .app-comms-eave-extra button')
  }
  throw new Error('通讯UI连续弹层未结束')
}

async function visibleConfirmation(page) {
  const selector = '.app-wh-ask button.is-warn'
  if (await page.js(`!!document.querySelector(${JSON.stringify(selector)})`)) await page.tap(selector)
}

async function runJourney(page, input, options) {
  const { made, ctx, text } = input
  const { core } = dependencies()
  const report = {
    target: options.target, configuration: input.configuration, ownedPid: options.pid,
    startedAt: new Date().toISOString(), routeDisclosure: 'core.revealOf only; exit gated by exitKnown',
    layers: [], checkpoints: [], actions: [], battles: [], screenshots: [],
    reachedDepth: 0, guardClearedDepth: 0, extracted: false, success: false,
  }
  const prefix = `wormhole-expedition-journey-${options.target}`
  const entered = new Set()
  const checkpointed = new Set()
  const guards = new Set()
  const ignoredEvents = new Set()
  let warehouseAtEntry
  let battleStart
  let lastState
  const shot = async label => {
    const file = `${prefix}-${label}.png`
    await page.screenshot(file)
    report.screenshots.push(file)
  }
  const inspect = async () => {
    const state = await page.snapshot()
    lastState = state
    if (state.wormhole.run) {
      const run = state.wormhole.run
      assert.equal(run.expeditionRules, 2, '本工具只验新规则')
      assert.equal(run.supplyVersion, 1, '有限供货版本锁丢失')
      assert.equal(run.family, 'A', '本趟族锁改变')
      if (warehouseAtEntry) assert.deepEqual(state.warehouse.items, warehouseAtEntry, '在途中母港物资发生供货/入账')
      report.reachedDepth = Math.max(report.reachedDepth, run.depth)
      report.guardClearedDepth = Math.max(report.guardClearedDepth, run.bossCleared ?? 0)
    }
    return state
  }
  const checkpoint = async depth => {
    await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
    await page.wait('!document.querySelector(".app-wh-modal")')
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.attending === false')
    await page.command('persist')
    const paused = await inspect()
    const before = checkpointState(paused)
    await page.command('step', [1000])
    assert.deepEqual(checkpointState(await inspect()), before, '暂停期间远征账发生变化')
    await page.command('persist')
    await options.verifySaved(paused)
    await page.reload()
    await dismissComms(page)
    const loaded = await inspect()
    assert.equal(loaded.wormhole.run.attending, false, '重载抹去暂停状态')
    // 清洗允许删空字段，但游戏内容账应逐值守恒。
    assert.deepEqual(core.loadSaveFile(core.serializeSaveFile(loaded, 0)).state.wormhole.run,
      core.loadSaveFile(core.serializeSaveFile(paused, 0)).state.wormhole.run, '重载改变远征随档账')
    await page.tap('.app-activitybar-item.is-wormhole')
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.attending === true && !!document.querySelector(".app-wh-modal")')
    const resumed = await inspect()
    assert.deepEqual(checkpointState(resumed), checkpointState(loaded), 'UI继续重新装载/补血或改变巡逻账')
    await shot(`depth-${depth}-resumed`)
    report.checkpoints.push({ depth, pausedThroughUI: true, reloaded: true, resumedThroughUI: true, supplyRetained: true, patrolRetained: true })
  }
  try {
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
    await sleep(400)
    // 合成档第一次进入隔离浏览器时可能先弹本机模式选择；只选普通模式，不改变存档内容。
    if (await page.js('!!document.querySelector(".app-pro-mode-card:not(.is-iron)")')) {
      await page.tap('.app-pro-mode-card:not(.is-iron)')
      await page.wait('!document.querySelector(".app-pro-mode-card")')
    }
    await dismissComms(page)
    assert.equal((await page.snapshot()).wormhole.run, null, '不得用已在途fixture替代UI入场')
    const unlocked = await page.snapshot()
    assert(core.wormholeScanUnlocked(unlocked), 'fixture.before未满足扫描虫洞UI入口的协会累计声望40门槛')
    await page.text('.app-nav-side', text('ui.App.001'))
    await page.text('.app-subtabs', text('ui.MapPage.007'))
    await openStockPreparation(page, text)
    await page.wait('!!document.querySelector("[data-wh-pick]")')
    const picked = await page.js('[...document.querySelectorAll("[data-wh-pick].is-picked")].map(el=>el.dataset.whPick)')
    for (const id of picked.filter(id => !made.fleet.includes(id))) await page.tap(`[data-wh-pick=${JSON.stringify(id)}]`)
    for (const id of made.fleet.filter(id => !picked.includes(id))) await page.tap(`[data-wh-pick=${JSON.stringify(id)}]`)
    assert.deepEqual((await page.js('[...document.querySelectorAll("[data-wh-pick].is-picked")].map(el=>el.dataset.whPick)')).sort(), [...made.fleet].sort())
    await page.text('.app-wh-modal', text('ui.Expedition.308'))
    await page.wait('!!document.querySelector(".app-wh-manifest")')
    for (const [id, amount] of Object.entries(made.manifest)) await page.number(`[data-wh-manifest-item=${JSON.stringify(id)}] input[type=number]`, amount)
    assert.equal(await page.js('!!document.querySelector("[data-wh-goal]")'), false, '整备不应残留无玩法差异的目标选择器')
    await shot('preparation')
    await page.tap('[data-wh-enter-prepared]')
    assert.equal((await page.snapshot()).wormhole.run, null, '最终核对前不应扣物资/入场')
    await page.tap('[data-wh-enter-prepared]')
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run?.expeditionRules === 2')
    const first = await inspect()
    assert.equal(first.wormhole.run.depth, 1)
    assert.equal(first.wormhole.run.seed, 19, '固定样本种子被墙钟替换')
    assert.deepEqual(first.wormhole.run.fleet, made.fleet)
    assert.deepEqual(first.wormhole.run.supplies.carried, made.manifest)
    await page.wait('!!document.querySelector("[data-wh-scan]")')
    assert.equal(await page.js('!!document.querySelector("[data-wh-goal]")'), false, '洞内不应残留目标选择器')
    warehouseAtEntry = structuredClone(first.warehouse.items)
    report.entryThroughUI = true
    report.routeBattleEntryExtractionThroughUI = true
    report.noAddedSupplies = true
    report.preconditionStanding = core.wormholeScanStanding(first)
    report.initialSupplies = structuredClone(first.wormhole.run.supplies)
    for (let action = 0; action < 500; action++) {
      const state = await inspect()
      const run = state.wormhole.run
      if (!run) {
        report.extracted = state.wormhole.lastSettle?.kind === 'extract'
        if (!report.extracted) throw new Error('真实战斗全损，未达到验收目标')
        break
      }
      if (!entered.has(run.depth)) {
        assert.equal(run.depth, entered.size + 1, '层深不连续，疑似跳层')
        entered.add(run.depth)
        report.layers.push(layerRecord(state, ctx, 'entry'))
        console.log(JSON.stringify({ target: options.target, stage: 'entry', depth: run.depth, turns: run.turnsLeft }))
      }
      if (!run.battle && [3, 7, 10].includes(run.depth) && !checkpointed.has(run.depth)) {
        checkpointed.add(run.depth)
        await checkpoint(run.depth)
        continue
      }
      if (run.battle) {
        const start = run.battle.startedAtGameMs
        const spec = run.battle.wormhole
        const foes = Object.values(run.battle.units).filter(unit => unit.side === 'foe')
        assert(foes.length > 0, '不得空敌代替真实战斗')
        if (battleStart !== start) {
          battleStart = start
          report.battles.push({ depth: run.depth, spec, enemies: foes.map(unit => ({ id: unit.foeShipId, hp: unit.hpMax ?? unit.hp })), startedAt: start })
          await shot(`depth-${run.depth}-battle-${report.battles.length}`)
        }
        const began = state.gameMs
        for (let ticks = 0; ticks < 1000; ticks++) {
          const result = await page.command('step', [10_000])
          assert(result?.ok !== false, `真实步进失败:${JSON.stringify(result)}`)
          const next = await inspect()
          if (!next.wormhole.run?.battle) break
          const live = next.wormhole.run.battle
          const battleRow = report.battles.at(-1)
          battleRow.maxMeShots = Math.max(battleRow.maxMeShots ?? 0, live.stats.meShots)
          battleRow.maxFoeShots = Math.max(battleRow.maxFoeShots ?? 0, live.stats.foeShots)
          assert(next.gameMs - began <= 900_000, '真实战斗超时')
          if (ticks === 999) throw new Error('真实战斗步进未收口')
        }
        const after = await inspect()
        const row = report.battles.at(-1)
        row.report = after.battleReport
        assert.equal(after.battleReport?.battleStartedAtGameMs, start, '真实战斗战报与本场起手时刻不匹配')
        assert.equal(after.battleReport?.outcome, 'win', '真实战斗结算缺少胜利战报')
        row.settledAt = after.gameMs
        assert(after.battleReport?.outcome !== 'lose', '真实战斗失败')
        await dismissReport(page)
        if (after.wormhole.run && spec.kind === 'boss') {
          assert.equal(after.wormhole.run.bossCleared, run.depth, '守卫战未真实清门')
          guards.add(run.depth)
          report.layers.push(layerRecord(after, ctx, 'guard-after'))
        }
        continue
      }
      await page.wait('!!document.querySelector(".app-wh-modal")')
      if (run.pendingNodeBattle || run.pendingRuinsBattle) {
        await page.tap('.app-wh-extract-ask button.is-danger')
        report.actions.push({ depth: run.depth, action: 'confirm-battle' })
        continue
      }
      const view = projection(state)
      assert(view, '新趟地图丢失')
      if (view.here.visible.kind === 'foe') {
        throw new Error('当前格必须迎战但UI没有确认按钮')
      }
      if (run.pendingEvent && !ignoredEvents.has(`${run.depth}:${run.pendingEvent.cellKey}`)) {
        const key = run.pendingEvent.key
        const available = await page.js('[...document.querySelectorAll("[data-wh-event-action]")].filter(el=>!el.disabled).map(el=>el.dataset.whEventAction)')
        // 本条深潜验收不取途中补给包；只有UI真实调查，出发清单整趟有限。
        const preferences = key === 'maintenance' || key === 'transport' ? ['bypass']
          : key === 'controller' || key === 'relay' ? ['investigate', 'bypass']
          : key === 'storm' ? ['wait', 'bypass'] : ['verify', 'reject']
        const choice = preferences.find(value => available.includes(value))
        assert(choice, `已到达事件没有可达选项:${key}:${available.join(',')}`)
        await page.tap(`[data-wh-event-action=${JSON.stringify(choice)}]`)
        if (choice === 'bypass' || choice === 'reject') ignoredEvents.add(`${run.depth}:${run.pendingEvent.cellKey}`)
        report.actions.push({ depth: run.depth, action: 'event', key, choice })
        continue
      }
      assert(run.turnsLeft > 0, '真实路线回合耗尽')
      assert(run.fleet.every(id => (state.fleet[id]?.durability ?? 0) >= .35), '真实路线生存警戒，不能强补血继续')
      if (view.exit && view.here.q === view.exit.q && view.here.r === view.exit.r) {
        if ((run.bossCleared ?? 0) < run.depth) {
          report.layers.push(layerRecord(state, ctx, 'guard-before'))
          const guardSelector = await page.js('!!document.querySelector("[data-wh-guard]")')
            ? '[data-wh-guard]'
            : `.app-wh-work[title=${JSON.stringify(text('ui.Wormhole.149'))}]`
          await page.tap(guardSelector)
          report.actions.push({ depth: run.depth, action: 'guard' })
        } else if (run.depth === 10) {
          assert.deepEqual([...guards], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '十层守卫没有逐层获胜记录')
          report.layers.push(layerRecord(state, ctx, 'exit'))
          await page.tap('.app-wh-extract')
          await page.wait('!!document.querySelector("[data-wh-extract-confirm]")')
          await shot('extraction-review')
          await page.tap('[data-wh-extract-confirm]')
          await page.wait('!window.__whExpeditionTest.snapshot().wormhole.run && !!document.querySelector(".app-wh-settle")')
          await page.command('persist')
          const final = await inspect()
          report.settlement = final.wormhole.lastSettle
          report.extracted = final.wormhole.lastSettle?.kind === 'extract'
          await options.verifySaved(final)
          await shot('settlement')
          break
        } else {
          await page.tap('[data-wh-descend]')
          if (await page.js('!!document.querySelector(".app-wh-ask button.is-warn")')) {
            await page.text('.app-wh-ask', text('ui.whExpedition.029'))
          }
          await page.wait(`window.__whExpeditionTest.snapshot().wormhole.run.depth === ${run.depth + 1}`)
          report.actions.push({ depth: run.depth, action: 'descend' })
        }
        continue
      }
      let target = view.exit
        ? view.cells.find(cell => cell.q === view.exit.q && cell.r === view.exit.r)
        : view.cells.find(cell => ['signal', 'known'].includes(cell.info.kind) && cell.info.signal === 'beacon' && !cell.activated)
      if (!target) {
        await page.wait('(()=>{const el=document.querySelector("[data-wh-scan]");return !!el&&!el.disabled})()')
        const canScan = await page.js('(()=>{const el=document.querySelector("[data-wh-scan]");return !!el&&!el.disabled})()')
        if (canScan) {
          const beforeScanned = [...run.grid.scanned]
          await page.tap('[data-wh-scan]')
          const next = await inspect()
          const grid = next.wormhole.run?.grid
          report.actions.push({ depth: run.depth, action: 'scan' })
          if (grid && (grid.scanned.length > beforeScanned.length || JSON.stringify(grid.dispersed) !== JSON.stringify(run.grid.dispersed))) continue
        }
        target = view.cells.filter(cell => cell.key !== view.here.key && cell.info.kind === 'unknown')
          .sort((a, b) => dependencies().grid.hexDistance(a, view.here) - dependencies().grid.hexDistance(b, view.here) || a.key.localeCompare(b.key))[0]
      }
      assert(target && target.key !== view.here.key, '仅用已揭露信息选路陷入死锁')
      report.actions.push({ depth: run.depth, action: 'travel', target: target.key, disclosure: target.info })
      await page.tap(`.app-wh-map [data-wh-cell=${JSON.stringify(target.key)}]`)
      await visibleConfirmation(page)
      await page.wait(`(()=>{const r=window.__whExpeditionTest.snapshot().wormhole.run;return !r||r.battle||r.grid.pos.q!==${view.here.q}||r.grid.pos.r!==${view.here.r}})()`)
    }
    const final = await inspect()
    assert.equal(final.wormhole.run, null, '旅程未真正撤离')
    assert.equal(final.wormhole.lastSettle?.kind, 'extract')
    assert.equal(final.wormhole.lastSettle?.depth, 10)
    assert.deepEqual(report.checkpoints.map(row => row.depth), [3, 7, 10])
    report.guardClearedDepth = Math.max(report.guardClearedDepth, ...guards)
    assert.equal(report.guardClearedDepth, 10)
    report.finalWarehouse = final.warehouse.items
    report.success = true
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error)
    report.failureState = lastState ? {
      gameMs: lastState.gameMs, run: lastState.wormhole.run, fleet: lastState.fleet,
      warehouse: lastState.warehouse.items, settlement: lastState.wormhole.lastSettle,
    } : undefined
    await shot('failure').catch(() => {})
  } finally {
    report.finishedAt = new Date().toISOString()
    report.runtimeErrors = options.errors ?? []
    if (report.runtimeErrors.length) { report.success = false; report.failure ??= '页面运行期异常' }
    await atomicJson(path.join(OUTPUT, `${prefix}.json`), report)
  }
  assert(report.success, `旅程未通过:${report.failure}`)
  console.log(JSON.stringify({ target: report.target, reachedDepth: report.reachedDepth, guardClearedDepth: report.guardClearedDepth, extracted: report.extracted, battles: report.battles.length, checkpoints: report.checkpoints.map(row => row.depth), saved: true }))
  return report
}

async function staticServer(directory, options = {}) {
  const root = path.resolve(directory)
  await fs.access(path.join(root, 'index.html'))
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      if (pathname === '/__wh_journey_init' && options.initialize) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(`<!doctype html><meta charset="utf-8"><script>${options.initialize};location.replace('/')</script>`)
        return
      }
      const file = path.resolve(root, '.' + pathname.replace(/\/$/, '/index.html'))
      assert(file.startsWith(root + path.sep), '静态请求越出构建目录')
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.statusCode = 404; res.end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}/${options.initialize ? '__wh_journey_init' : ''}` }
}

async function stopOwned(child) {
  if (!child || !Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').catch(() => {})
  child.kill()
  await Promise.race([exited, sleep(5000)])
  assert(child.exitCode !== null || child.signalCode !== null, `自建PID ${child.pid}尚未退出`)
}

async function removeProfile(profile, prefix) {
  const temporary = path.resolve(require('node:os').tmpdir()) + path.sep
  assert(path.resolve(profile).startsWith(temporary) && path.basename(profile).startsWith(prefix), '隔离目录越界，拒绝递归清理')
  for (let retry = 0; retry < 10; retry++) {
    try { await fs.rm(profile, { recursive: true, force: true }); return }
    catch { await sleep(300) }
  }
  console.warn(`隔离目录待清理:${profile}`)
}

function selfTest() {
  const { core, data } = dependencies()
  const old = { wormholeStock: [{ id: 'old', seed: 19 }, { id: 'experiment', seed: 29, expeditionRules: 2 }] }
  const beforeStock = structuredClone(old)
  const legacy = syntheticStockRules(structuredClone(old), false)
  assert(legacy.wormholeStock.every(stock => !Object.hasOwn(stock, 'expeditionRules')))
  const future = syntheticStockRules(structuredClone(old), true)
  assert(future.wormholeStock.every(stock => stock.expeditionRules === 2))
  assert.deepEqual(old, beforeStock, '工具夹具改写输入来源')
  for (const locale of ['zh', 'en']) {
    const text = uiText(locale)
    for (const id of ['ui.MapPage.007', 'ui.MatterTechTab.001', 'ui.WormholeScan.015']) {
      assert.notEqual(core.signalSpaceTextId(id), id)
      assert.equal(text(id), data.L10N[core.signalSpaceTextId(id)][locale])
    }
    for (const id of ['ui.Expedition.005', 'ui.Expedition.308', 'ui.Wormhole.015']) {
      assert.equal(text(id), data.L10N[id][locale])
      assert.equal(text(id, 'signal'), data.L10N[core.signalSpaceTextId(id)][locale])
      assert.equal(text(id, 'history'), data.L10N[id][locale])
    }
  }
  const storage = new Map()
  const localStorage = { setItem: (key, value) => storage.set(key, value) }
  const runScript = options => new Function('localStorage', settingsScript('synthetic', undefined, options))(localStorage)
  runScript({ test: false })
  assert.equal(storage.get('whale-idle:debug'), '1')
  assert.equal(storage.get(TEST_KEY), '0')
  assert.equal(storage.get(FUTURE_KEY), '0')
  runScript({ test: false, future: true })
  assert.equal(storage.get(FUTURE_KEY), '1')
  runScript({})
  assert.equal(storage.get(TEST_KEY), '1')
  const page = {}
  for (let index = 0; index < 100; index++) recordStep(page, { index })
  assert.equal(page.checkSteps.length, 60)
  assert.equal(page.checkSteps[0].index, 40)
  const unknown = { key: '1,0', q: 1, r: 0 }
  for (const field of ['place', 'elite', 'eventKey', 'event', 'nebula', 'piles']) {
    Object.defineProperty(unknown, field, { get() { throw new Error(`读取未知格真相:${field}`) } })
  }
  const grid = {
    pos: { q: 0, r: 0 }, cells: [{ key: '0,0', q: 0, r: 0, place: 'empty' }, unknown],
    visited: ['0,0'], scanned: ['0,0'], activated: [], exitKnown: false,
  }
  Object.defineProperty(grid, 'exit', { get() { throw new Error('出口未知时读取坐标') } })
  const view = projection({ wormhole: { run: { grid } } })
  assert.deepEqual(view.cells[1].info, { kind: 'unknown' })
  assert.equal(view.exit, undefined)
  assert.equal(view.here.info.place, 'empty')
  console.log('纯工具信息隔离自检通过：未知格无place/事件/库存读取，隐藏出口未读取。')
}

module.exports = { ROOT, OUTPUT, TEST_KEY, FUTURE_KEY, SAVE_KEY, sleep, dependencies, uiText, atomicJson, recordStep, syntheticStockRules, openStockPreparation, createFixture, settingsScript, CdpConnection, JourneyPage, runJourney, staticServer, stopOwned, removeProfile, checkpointState, projection, selfTest }
if (require.main === module && process.argv.includes('--self-test')) selfTest()
