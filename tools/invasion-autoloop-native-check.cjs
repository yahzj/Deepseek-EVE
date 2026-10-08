/** 入侵循环原生接线及完整旅程；先build，再node tools/invasion-autoloop-native-check.cjs [--journey]。
 * 隐藏Electron、隔离合成档、随机端口，覆盖新旧界面和中英文的冷却条、跳转、停止及真实保存。
 * --journey用鼠标开启原版C族连战、虚拟时间加速及返航关环；可用--case=classic-route筛选。
 * 旅程截图仅取证操作/读数，不代替观感验收；不读个人档，只清自建临时目录和PID。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, stopOwned, removeProfile, createFixture, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const JOURNEY = process.argv.includes('--journey')

function journeyFixture(scenario) {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const { buildSimContext } = require('../packages/data/src/index.ts')
  const { alienFixture } = require('./alien-invasion-fixture.ts')
  const ctx = buildSimContext(), input = createFixture()
  const { state } = alienFixture(ctx, 'heavy', 611)
  const uid = core.addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  for (const id of ['mod-wh-c-missile', 'mod-wh-c-missile', 'mod-wh-c-missile', 'mod-wh-c-missile', 'mod-pd-e-3',
    'mod-cpu-3', 'mod-cpu-3', 'mod-armor-plate-2', 'mod-shieldchg-3', 'mod-shieldchg-2', 'mod-shield-ext-3', 'mod-shield-ext-3', 'mod-gyro-3']) {
    core.addModule(state, id)
    const installed = core.fitModule(state, id, ctx)
    assert(installed.ok, `测试配装非法:${id}:${installed.error}`)
  }
  const unlocked = core.loadSaveFile(input.initialSave).state
  state.onboarding = unlocked.onboarding
  state.importantTasks = unlocked.importantTasks
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true, atGameMs: 0 }
  state.completedBounties = unlocked.completedBounties
  state.modeChosen = true
  state.debugQuick = false
  const now = Date.now(), systems = ['galaxy-redring', 'galaxy-grave', 'galaxy-kor']
  state.savedAtWallMs = now
  state.weekendEvent = { seq: 901, family: 'C', startedAtWallMs: now, coreId: systems[2], peripheryIds: systems.slice(0, 2),
    contributed: scenario === 'from-zero' ? {} : Object.fromEntries(systems.map(id => [id, .95])) }
  for (const id of systems) core.setDesirePrefOf(state, id, 6000)
  const plan = core.autoLoopInvasionPlanOf(state, ctx, now, systems[0])
  assert.equal(plan.status, 'ready')
  state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + core.bountyCooldownMsFor(state, ctx) + 12_000
  return { save: core.serializeSaveFile(state, now), announcement: input.announcement, uid, systems }
}

function fixture() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const input = createFixture(), state = core.loadSaveFile(input.initialSave).state
  const now = Date.now()
  state.debugQuick = false
  state.weekendEvent = { seq: 901, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {}, autoLoopGalaxyId: 'galaxy-redring' }
  const plan = core.autoLoopInvasionPlanOf(state, input.ctx, now)
  assert.equal(plan.status, 'ready')
  state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + core.bountyCooldownMsFor(state, input.ctx) + 300_000
  return { save: core.serializeSaveFile(state, now), announcement: input.announcement }
}

async function parent() {
  const prefix = 'whale-invasion-autoloop-', reports = []
  const cases = JOURNEY
    ? ['classic', 'modern'].flatMap(layout => ['route', 'return-stop', 'from-zero'].map(scenario => ({ layout, locale: 'zh', scenario })))
    : ['classic', 'modern'].flatMap(layout => ['zh', 'en'].map(locale => ({ layout, locale, scenario: 'cooldown' })))
  for (const { layout, locale, scenario } of cases) {
    const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
    if (selected && selected !== `${layout}-${scenario}`) continue
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const input = JOURNEY ? journeyFixture(scenario) : fixture()
    let child, server, timer
    try {
      const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: settingsScript(input.announcement, undefined, { debug: true, test: !JOURNEY, layout, locale }) })
      server = served.server
      await fs.writeFile(path.join(profile, 'save.json'), input.save, 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url, INVASION_UI_SCENARIO: scenario, INVASION_UI_LAYOUT: layout }
      delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
      require('tsx/cjs')
      const load = async () => require('../packages/core/src/save.ts').loadSaveFile(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
      let saved
      for (let launch = 0; launch < 2; launch++) {
        child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env: { ...env, INVASION_UI_RESUME: String(launch) }, windowsHide: true, stdio: 'inherit' })
        console.log(`入侵循环原生检查 ${layout}/${locale}/${scenario}，启动${launch + 1}，自建PID=${child.pid}`)
        timer = setTimeout(() => child.kill(), JOURNEY ? 600_000 : 90_000)
        const [code] = await once(child, 'exit')
        clearTimeout(timer)
        assert.equal(code, 0)
        saved = JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8'))
        if (saved.status !== 'checkpoint') break
        const restored = await load(), before = saved.checkpoint[0]
        assert.deepEqual({ target: restored.weekendEvent.autoLoopGalaxyId, actual: restored.expedition.foeGalaxyId,
          finish: restored.expedition.finishAtGameMs, draws: restored.weekendEvent.assaultDraws }, before)
        assert.equal(launch, 0, '客户端不得重复停在检查点')
      }
      assert.notEqual(saved.status, 'checkpoint', '第二次启动未完成旅程')
      const restored = await load()
      assert.equal(restored.weekendEvent.autoLoopGalaxyId, undefined)
      reports.push({ layout, locale, scenario, ...saved })
      const out = path.join(ROOT, 'tools/_ui-artifacts/invasion-autoloop-20261008')
      await fs.mkdir(out, { recursive: true })
      await fs.writeFile(path.join(out, `journey-${layout}-${scenario}.json`), JSON.stringify(reports.at(-1), null, 2), 'utf8')
    } finally {
      clearTimeout(timer); await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, prefix)
    }
  }
  assert(reports.length > 0, '没有匹配的验收场景，请检查--case')
  const out = path.join(ROOT, 'tools/_ui-artifacts/invasion-autoloop-20261008')
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, JOURNEY ? 'journey-report.json' : 'report.json'), JSON.stringify(reports, null, 2), 'utf8')
  console.log(`${reports.length}组原生${JOURNEY ? '完整路线及返航关环' : '冷却接线'}通过`)
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768); win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`原生请求超时:${method}`)), 20_000)
    win.webContents.debugger.sendCommand(method, params).then(resolve, reject).finally(() => clearTimeout(timer))
  }))
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  if (process.env.INVASION_UI_SCENARIO !== 'cooldown') {
    try { await runJourney(page, win, errors) } catch (error) {
      const out = path.join(ROOT, 'tools/_ui-artifacts/invasion-autoloop-20261008')
      await fs.mkdir(out, { recursive: true })
      const image = await win.webContents.capturePage(undefined, { stayHidden: true })
      await fs.writeFile(path.join(out, 'journey-failure.png'), image.toPNG())
      await fs.writeFile(path.join(out, 'journey-failure.json'), JSON.stringify({ error: String(error), state: await page.js('window.__whalePlanetaryTest?.snapshot()'),
        dom: await page.js('document.body.innerText.slice(-4000)') }, null, 2), 'utf8')
      throw error
    }
    win.destroy(); app.quit()
    return
  }
  await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-activitybar-item.is-invasion-loop")')
  const readings = await page.js(`(()=>{const e=document.querySelector('.app-activitybar-item.is-invasion-loop');const fill=e.querySelector('.app-activitybar-fill');return {text:e.textContent,progress:fill?.style.width,remaining:e.querySelector('.app-activitybar-time')?.textContent}})()`)
  assert(readings.progress && readings.remaining, '未渲染冷却条和剩余时间')
  assert(!/\{p\d+\}|ui\.invasionLoop/.test(readings.text), '有漏出的文案id或参数')
  await page.js(`document.querySelector('.app-activitybar-item.is-invasion-loop').click()`)
  await page.wait('!!document.querySelector(".app-map-viewbar")')
  await page.js(`document.querySelector('.app-activitybar-item.is-invasion-loop button').click()`)
  await page.wait('!document.querySelector(".app-activitybar-item.is-invasion-loop")')
  const state = await page.snapshot()
  assert.equal(state.weekendEvent.autoLoopGalaxyId, undefined)
  assert.equal(state.expedition.active, false)
  await page.command('persist')
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ ...readings, stopped: true, errors: 0 }), 'utf8')
  win.destroy(); app.quit()
}

async function runJourney(page, win, errors) {
  await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  const snapshot = () => page.js('window.__whalePlanetaryTest.snapshot()')
  const scenario = process.env.INVASION_UI_SCENARIO
  const resume = process.env.INVASION_UI_RESUME === '1'
    ? JSON.parse(await fs.readFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), 'utf8')) : null
  const steps = resume?.steps ?? [], targets = resume?.targets ?? [], checkpoint = resume?.checkpoint ?? []
  let reloaded = !!resume
  async function advance(ms) {
    const done = new Promise(resolve => {
      const listener = (_event, method) => {
        if (method === 'Emulation.virtualTimeBudgetExpired') { win.webContents.debugger.removeListener('message', listener); resolve() }
      }
      win.webContents.debugger.on('message', listener)
    })
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms, maxVirtualTimeTaskStarvationCount: 100 })
    await done
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
    const state = await snapshot()
    const ev = state.weekendEvent, exp = state.expedition
    const last = steps.at(-1)
    const current = { ms: state.gameMs, draws: ev.assaultDraws ?? 0, target: ev.autoLoopGalaxyId ?? null,
      actual: exp.foeGalaxyId ?? null, phase: exp.active ? exp.phase : 'idle', progress: ev.contributed,
      battle: exp.battle ? { ended: exp.battle.ended, age: exp.battle.lastTickGameMs - exp.battle.startedAtGameMs } : null }
    if (!last || last.draws !== current.draws || last.phase !== current.phase || last.target !== current.target) {
      steps.push(current)
      console.log(JSON.stringify({ scenario, ...current }))
    }
    if (current.draws > (last?.draws ?? 0)) targets.push(current.actual)
    assert.equal(state.encounter.active, false, '不得自动发起旗舰/遭遇战')
    return state
  }
  // 通讯遮罩是玩家必须经过的真实入口，逐个点击关闭。
  await sleep(900)
  for (let n = 0; n < 20; n++) {
    const close = await page.js('!!document.querySelector(".app-comms-eave-extra button")')
    if (!close) break
    await page.tap('.app-comms-eave-extra button')
    await sleep(350)
  }
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
  const t = id => data.L10N[id].zh
  await page.text('.app-nav-side', t('ui.App.001'))
  let cooldown = resume?.cooldown
  if (!resume) {
    await page.text('.app-subtabs', t('ui.MapPage.004'))
    if (process.env.INVASION_UI_LAYOUT === 'modern') await page.tap('.app-log-head-right button')
    await page.js(`(()=>{const card=[...document.querySelectorAll('.app-ano-card')].find(e=>e.textContent.includes('红环航道'));if(!card)throw Error('外围入侵卡未找到');const button=[...card.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t('ui.weekend.106'))});if(!button)throw Error('重复出击按钮缺失');button.setAttribute('data-invasion-live-start','1')})()`)
    await page.tap('[data-invasion-live-start]')
    assert.equal((await snapshot()).weekendEvent.autoLoopGalaxyId, 'galaxy-redring')
  } else {
    const state = await snapshot(), before = checkpoint[0]
    assert.deepEqual({ target: state.weekendEvent.autoLoopGalaxyId, actual: state.expedition.foeGalaxyId,
      finish: state.expedition.finishAtGameMs, draws: state.weekendEvent.assaultDraws }, before, '再次启动丢失目标或行程')
    console.log(JSON.stringify({ scenario, reopened: before }))
  }
  await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
  const core = require('../packages/core/src/index.ts')
  const initial = await snapshot(), ctx = data.buildSimContext()
  const out = path.join(ROOT, 'tools/_ui-artifacts/invasion-autoloop-20261008')
  await fs.mkdir(out, { recursive: true })
  if (!resume) {
    const plan = core.autoLoopInvasionPlanOf(initial, ctx, await page.js('Date.now()'))
    assert.equal(plan.status, 'ready')
    await advance(Math.max(1000, plan.remainingMs - core.bountyCooldownMsFor(initial, ctx) / 2))
    cooldown = await page.js(`(()=>{const e=document.querySelector('.app-activitybar-item.is-invasion-loop');return e?{text:e.textContent,percent:e.querySelector('.app-activitybar-fill')?.style.width}:null})()`)
    assert(cooldown && parseFloat(cooldown.percent) > 0 && parseFloat(cooldown.percent) < 100, '真实冷却条未推进')
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    await fs.writeFile(path.join(out, `journey-${process.env.INVASION_UI_LAYOUT}-${scenario}-cooldown.png`), image.toPNG())
    await page.tap('.app-activitybar-item.is-invasion-loop')
    assert(await page.js('!!document.querySelector(".app-map-viewbar")'), '活动行未跳星图')
  }
  let state
  for (let n = 0; n < (scenario === 'from-zero' ? 1400 : 160); n++) {
    state = await advance(30_000)
    if (scenario !== 'return-stop' && !reloaded && state.expedition.active && state.expedition.phase === 'back') {
      const before = { target: state.weekendEvent.autoLoopGalaxyId, actual: state.expedition.foeGalaxyId,
        finish: state.expedition.finishAtGameMs, draws: state.weekendEvent.assaultDraws }
      await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1 })
      console.log(JSON.stringify({ scenario, stage: 'checkpoint-save' }))
      await page.js('window.__whalePlanetaryTest.persist()')
      checkpoint.push(before)
      assert.equal(errors.length, 0)
      await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ status: 'checkpoint', cooldown, targets, steps, checkpoint }), 'utf8')
      console.log(JSON.stringify({ scenario, closedAt: before }))
      return
    }
    if (scenario === 'return-stop' && state.expedition.active && state.expedition.phase === 'back') {
      const finish = state.expedition.finishAtGameMs
      const from = state.gameMs
      await page.tap('.app-activitybar-item.is-expedition button')
      const stopped = await snapshot()
      assert.equal(stopped.weekendEvent.autoLoopGalaxyId, undefined)
      assert.equal(stopped.expedition.active, true)
      assert.equal(stopped.expedition.finishAtGameMs, finish)
      state = await advance(Math.max(1000, finish - from + 1000))
      assert.equal(state.expedition.active, false)
      assert.equal(state.weekendEvent.assaultDraws, 1)
      break
    }
    if (scenario !== 'return-stop' && !state.weekendEvent.autoLoopGalaxyId) {
      const distinct = targets.filter((id, index) => index === 0 || targets[index - 1] !== id)
      assert.deepEqual(distinct, ['galaxy-redring', 'galaxy-grave', 'galaxy-kor'])
      const core = require('../packages/core/src/index.ts')
      const now = await page.js('Date.now()')
      assert(['galaxy-redring', 'galaxy-grave', 'galaxy-kor'].every(id => core.weekendProgressAt(state, state.weekendEvent, id, now) === 1), '未完成实际收复')
      assert.equal(state.expedition.active, false)
      break
    }
  }
  assert(state && !state.weekendEvent.autoLoopGalaxyId, '旅程未结束')
  assert.equal(state.fleet[state.shipId].durability, 1, '连续清剿出现结构损伤')
  const finalImage = await win.webContents.capturePage(undefined, { stayHidden: true })
  await fs.writeFile(path.join(out, `journey-${process.env.INVASION_UI_LAYOUT}-${scenario}-finished.png`), finalImage.toPNG())
  await page.js('window.__whalePlanetaryTest.persist()')
  await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1 })
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ cooldown, targets, steps, checkpoint, final: {
    draws: state.weekendEvent.assaultDraws, contributed: state.weekendEvent.contributed, loop: state.weekendEvent.autoLoopGalaxyId ?? null,
    expeditionActive: state.expedition.active, encounterActive: state.encounter.active, hull: state.fleet[state.shipId].durability,
  }, stopped: true, errors: 0 }), 'utf8')
}

(process.argv.includes('--child') ? child() : parent()).catch(error => {
  console.error(error)
  if (process.argv.includes('--child')) require('electron').app.exit(1)
  else process.exitCode = 1
})
