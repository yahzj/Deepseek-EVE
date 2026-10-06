/** 虫洞§20模板与两栏布局专项，正式可复跑；游戏v0.1.0 / 档v31，2026-10-06。
 * 用法：主代理更新web构建后 node tools/wormhole-expedition-template-ui.cjs。
 * --quick：中文classic桌面/手机；--templates-only/--layout-only：只跑对应专项。
 * --viewport=1024x540 --locale=zh --layout=classic --report-tag=复跑标记：定点取证，保留每轮独立报告。
 * --first-save-only：只定位第一次具名保存，不代表完整模板专项通过。
 * --input-save-only：只测具名保存备用16后改0，不代表完整模板专项通过。
 * --aggregate=原报告.json --followups=补跑1.json,补跑2.json：只读本工具产物，写compact聚合，不启动浏览器。
 * --compact-report=报告.json：压缩已有成功行，独立失败诊断不删不改。
 * --self-test：仅工具/合成夹具自检；--check-build：只检查构建新鲜度，都不启动浏览器。
 * 输入仅journey合成fixture；输出tools/_ui-artifacts下JSON、截图及实际导出档。
 * 中英×双布局×桌面/低高度/手机横竖/窄窗；布局只测免费离开、待迎战，不跑十层或六事件矩阵。
 * 自建隐藏Chrome、随机端口/profile/PID；旧dist拒绝运行，不访问个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const {
  ROOT, OUTPUT, SAVE_KEY, sleep, dependencies, createFixture, settingsScript,
  CdpConnection, JourneyPage, staticServer, stopOwned, removeProfile, uiText, atomicJson, recordStep, openStockPreparation,
} = require('./wormhole-expedition-journey-shared.cjs')
const { reach, clickAt } = require('./wormhole-expedition-event-ui.cjs')

const OLD_KEY = 'whale-idle:wh-manifest-template'
const VIEWPORTS = [[1366, 768, false], [1024, 540, false], [390, 844, true], [844, 390, true], [320, 568, true], [568, 320, true], [740, 540, false]]
const AMMO = 'ammo-kinetic-l'
const DRONE = 'drone-assault'
const field = id => `[data-wh-manifest-item=${JSON.stringify(id)}] input[type=number]`
const control = (action, id) => `[data-wh-template-${action}${id === undefined ? '' : '=' + JSON.stringify(id)}]`

function compactResult(result) {
  if (!result) return undefined
  const { success, failure, stage, kind, scope, checks, selections, before, after, measured, fixedControls, evidence, screenshot, preparationScreenshot, exported, runtimeErrors, diagnostic } = result
  return {
    success, failure, stage, kind, scope, checks, selections, before, after, measured, fixedControls,
    trustedEvidence: result.trustedEvidence ?? (Array.isArray(evidence) ? evidence : undefined),
    screenshot, preparationScreenshot, exported, runtimeErrors,
    diagnostic: diagnostic ?? (!success && screenshot ? screenshot.replace(/\.png$/, '.json') : undefined),
  }
}

function compactReport(report) {
  return { ...report, rows: report.rows.map(row => ({ ...row, templates: compactResult(row.templates), layouts: row.layouts?.map(compactResult) })) }
}

function artifactPath(name) {
  assert(path.basename(name) === name && /^wormhole-expedition-template-ui-[\w-]+\.json$/.test(name), '仅允许读取本工具报告名')
  return path.join(OUTPUT, name)
}

function stage(page, label) { page.checkStage = label; recordStep(page, { stage: label, at: new Date().toISOString() }) }

async function compactState(page) {
  return page.js(`(()=>{const state=window.__whExpeditionTest?.snapshot(),run=state?.wormhole.run;return {gameMs:state?.gameMs,testFlag:localStorage.getItem('whale-idle:wh-expedition-test'),debugFlag:localStorage.getItem('whale-idle:debug'),activeElement:document.activeElement?.outerHTML.slice(0,400),manifest:!!document.querySelector('.app-wh-manifest'),run:run?{pos:run.grid?.pos,attending:run.attending,battle:run.battle?.wormhole,pendingNodeBattle:run.pendingNodeBattle}:null}})()`)
}

function observePage(page) {
  page.number = async (selector, value) => {
    await inputText(page, selector, String(value))
    assert.equal(Number(await page.js(`document.querySelector(${JSON.stringify(selector)}).value`)), value)
  }
  for (const method of ['tap','text','number','reload','command']) {
    const original = page[method].bind(page)
    page[method] = async (...args) => {
      const step = { method, args, stage: page.checkStage, at: new Date().toISOString(), before: await compactState(page) }
      recordStep(page, step)
      try { const result = await original(...args); step.after = await compactState(page); return result }
      catch (error) { step.failure = error.message; throw error }
    }
  }
  return page
}

async function installInputEvidence(page) {
  await page.js(`(()=>{
    window.__whSpecialInputs=[];
    for(const kind of ['touchstart','touchend','pointerdown','pointerup','click','keydown','beforeinput','input','change','focusin'])document.addEventListener(kind,event=>{
      const el=event.target,control=el.closest?.('button,input,select,[data-wh-cell]'),r=control?.getBoundingClientRect();
      const entry={at:Date.now(),kind:event.type,trusted:event.isTrusted,pointerType:event.pointerType,key:event.key,ctrl:event.ctrlKey,shift:event.shiftKey,inputType:event.inputType,value:control?.value,target:control?.outerHTML.slice(0,600),targetRect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};
      window.__whSpecialInputs.push(entry);if(window.__whSpecialInputs.length>500)window.__whSpecialInputs.shift();
    },true);
  })()`)
}

async function failureEvidence(page) {
  return page.js(`(()=>{
    const box=el=>{if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,className:String(el.className),rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left},clientWidth:el.clientWidth,clientHeight:el.clientHeight,offsetWidth:el.offsetWidth,offsetHeight:el.offsetHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,scrollLeft:el.scrollLeft,overflowX:s.overflowX,overflowY:s.overflowY,minHeight:s.minHeight,flex:s.flex,display:s.display,disabled:el.disabled,value:el.value}};
    const selectors=['.app-wh-modal','.app-wh-modal .app-modal-body','.app-wh-run','.app-wh-maprow','.app-wh-mapbox','.app-wh-zoom','.app-wh-manifest','.app-wh-manifest-scroll','.app-wh-template-editor','.app-wh-template-list','[data-wh-template-name]','[data-wh-template-confirm]','[data-wh-template-cancel]','.app-wh-ops-fixed','.app-wh-details','.app-wh-map-pane'];
    const name=document.querySelector('[data-wh-template-name]');
    const ancestors=[];for(let el=name?.parentElement;el;el=el.parentElement)ancestors.push(box(el));
    const fixedControls=[...document.querySelectorAll('.app-wh-ops-fixed button')].map((el,index)=>({selector:el.hasAttribute('data-wh-scan')?'[data-wh-scan]':el.classList.contains('app-wh-supply-summary')?'.app-wh-supply-summary':'.app-wh-ops-fixed button:nth-of-type('+ (index+1)+')',text:el.textContent.trim(),...box(el)}));
    const state=window.__whExpeditionTest?.snapshot(),run=state?.wormhole.run;
    return {elements:Object.fromEntries(selectors.map(selector=>[selector,box(document.querySelector(selector))])),fixedControls,activeElement:box(document.activeElement),nameAncestors:ancestors,inputs:window.__whSpecialInputs,viewport:{width:innerWidth,height:innerHeight},rootClass:document.querySelector('.app-root')?.className,testFlag:localStorage.getItem('whale-idle:wh-expedition-test'),debugFlag:localStorage.getItem('whale-idle:debug'),gameMs:state?.gameMs,run:run?{depth:run.depth,pos:run.grid?.pos,attending:run.attending,pendingNodeBattle:run.pendingNodeBattle,pendingEvent:run.pendingEvent,battle:run.battle?{startedAtGameMs:run.battle.startedAtGameMs,wormhole:run.battle.wormhole,foes:Object.values(run.battle.units).filter(unit=>unit.side==='foe').map(unit=>({tag:unit.tag,foeShipId:unit.foeShipId}))}:null}:null,bodyTail:document.body.innerText.slice(-1600)};
  })()`)
}

async function filesUnder(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(file))
    else if (entry.isFile()) result.push(file)
  }
  return result
}

async function assertFreshBuild(dist, native = false) {
  const sources = []
  const directories = ['packages/core/src', 'packages/data/src', 'packages/ui/src', 'apps/desktop/src/renderer/src', 'web/src']
  if (native) directories.push('apps/desktop/src/main', 'apps/desktop/src/preload')
  for (const directory of directories) {
    const absolute = path.join(ROOT, directory)
    try { sources.push(...(await filesUnder(absolute)).filter(file => /\.(tsx?|css|json)$/.test(file))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const assets = (await filesUnder(dist)).filter(file => /\.(js|css)$/.test(file))
  assert(assets.length, '没有构建产物，请等待主代理build；本工具不自行构建')
  assets.push(path.join(dist, 'index.html'))
  if (native) assets.push(path.join(ROOT, 'apps/desktop/out/main/index.js'), path.join(ROOT, 'apps/desktop/out/preload/index.js'))
  const sourceTimes = await Promise.all(sources.map(async file => ({ file, mtime: (await fs.stat(file)).mtimeMs })))
  const newest = sourceTimes.sort((a, b) => b.mtime - a.mtime)[0]
  const oldest = Math.min(...await Promise.all(assets.map(async file => (await fs.stat(file)).mtimeMs)))
  assert(newest && oldest >= newest.mtime, `构建早于源码，拒绝用旧dist作新结论：${newest?.file}；源码${newest ? new Date(newest.mtime).toISOString() : 'missing'}；最早产物${new Date(oldest).toISOString()}`)
  const content = (await Promise.all(assets.filter(file => file.endsWith('.js')).map(file => fs.readFile(file, 'utf8')))).join('\n')
  for (const marker of ['data-wh-template-select', 'data-wh-template-fill', 'wormholePreparationTemplates', 'whale-idle:future-wormhole', 'ui.signalSpace.056']) assert(content.includes(marker), `构建缺少§20/§21接口：${marker}`)
  return { directory: dist, oldestAssetAt: new Date(oldest).toISOString(), newestSource: newest.file, newestSourceAt: new Date(newest.mtime).toISOString() }
}

async function inputText(page, selector, text) {
  const measured = await reach(page, selector)
  assert.equal(measured.disabled, false, '输入框disabled')
  const textPoint = await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el.type!=='number')return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;const xLocal=parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft)+Math.max(2,ctx.measureText(el.value||'0').width/2),yLocal=el.offsetHeight/2;let x=r.left+xLocal,y=r.top+yLocal;if(document.querySelector('.app-root').classList.contains('is-mobile-rot')){x=r.right-yLocal*r.width/el.offsetHeight;y=r.top+xLocal*r.height/el.offsetWidth}const hit=document.elementFromPoint(x,y);return hit===el?{x,y}:null})()`)
  await clickAt(page, textPoint ?? measured.point, page.touch)
  await sleep(300)
  recordStep(page, { method: 'inputText', selector, text, stage: page.checkStage, measured, textPoint })
  const focused = await page.js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)
  if (!focused) {
    const error = new Error(`输入未获焦：${page.checkStage ?? 'inputText'}；${selector}`)
    error.evidence = { inputGeometry: measured, textPoint, ...(await failureEvidence(page)) }
    throw error
  }
  const valueState = () => page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const drafts=Object.keys(localStorage).filter(key=>key.startsWith('whale-idle:wh-manifest:')).slice(0,8).map(key=>({key,bytes:localStorage.getItem(key)?.length}));return {value:el?.value,valueAsNumber:el?.valueAsNumber,selectionStart:el?.selectionStart,selectionEnd:el?.selectionEnd,selectionDirection:el?.selectionDirection,active:document.activeElement===el,selection:window.getSelection()?.toString(),drafts}})()`)
  const selectionBefore = await valueState()
  assert(selectionBefore.value.length <= 128, '输入过长，拒绝无限键盘清空')
  const fullySelected = selectionBefore.value !== '' && (selectionBefore.selection === selectionBefore.value || selectionBefore.selectionStart === 0 && selectionBefore.selectionEnd === selectionBefore.value.length)
  const clearing = []
  for (let attempt = 0; (!fullySelected || !String(text)) && attempt <= selectionBefore.value.length + 2; attempt++) {
    const current = await valueState()
    assert(current.active, '键盘清空期间输入失焦')
    if (current.value === '') break
    for (const [key, code, command] of [['Backspace',8,'deleteBackward'],['Delete',46,'deleteForward']]) {
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, commands: [command] })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
    }
    clearing.push(await valueState())
    if (clearing.length > 4) clearing.shift()
  }
  const cleared = await valueState()
  recordStep(page, { method: 'inputText:clear-or-selection', selector, before: selectionBefore, fullySelected, clearing, cleared })
  assert(fullySelected && String(text) || cleared.value === '', '真实键盘未清空且未全选，禁止盲插目标')
  if (String(text)) await page.send('Input.insertText', { text: String(text) })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
  recordStep(page, { method: 'inputText:result', selector, text, before: selectionBefore, cleared, final: await valueState() })
  const numeric = await page.js(`document.querySelector(${JSON.stringify(selector)}).type==='number'`)
  await page.wait(numeric ? `Number(document.querySelector(${JSON.stringify(selector)})?.value)===${Number(text)}` : `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(String(text))}`)
}

async function manifest(page) {
  return page.js(`Object.fromEntries([...document.querySelectorAll('[data-wh-manifest-item]')].map(el=>[el.dataset.whManifestItem,Number(el.querySelector('input[type=number]').value)]))`)
}

async function savedTemplates(page) {
  return page.js(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).state.wormholePreparationTemplates??[]`)
}

async function saveNamedTemplate(page, name, readTemplates = () => savedTemplates(page)) {
  stage(page, `saveNamedTemplate(${name}):open-editor`)
  const before = await readTemplates()
  const quantities = await manifest(page)
  await page.tap(control('save'))
  await page.wait(`!!document.querySelector('[data-wh-template-name]')`)
  assert.deepEqual(await readTemplates(), before, '打开保存编辑器即改档')
  stage(page, `saveNamedTemplate(${name}):input-name`)
  await inputText(page, control('name'), name)
  if (page.preparationCapture) {
    const capture = page.preparationCapture
    delete page.preparationCapture
    await capture()
  }
  stage(page, `saveNamedTemplate(${name}):confirm-save`)
  await page.tap(control('confirm'))
  await page.wait(`!document.querySelector('[data-wh-template-name]')`)
  let templates
  for (let i = 0; i < 100; i++) {
    templates = await readTemplates()
    if (templates.length === before.length + 1 && templates.some(t => t.name === name)) break
    await sleep(50)
  }
  const template = templates.find(t => t.name === name)
  assert(template && templates.length === before.length + 1, 'async保存未落入角色存档')
  assert.equal(await page.js(`document.querySelector('[data-wh-template-select]').value`), template.id, '保存成功未选中新ID')
  assert.deepEqual(await manifest(page), quantities, '保存模板自动apply了清单')
  return template
}

function keyboardSelection(current, wanted) {
  return { key: wanted < current ? 'ArrowUp' : 'ArrowDown', code: wanted < current ? 'ArrowUp' : 'ArrowDown', steps: Math.abs(wanted - current) }
}

async function selectTemplate(page, id) {
  const before = await manifest(page)
  const selection = await page.js(`(()=>{const el=document.querySelector('[data-wh-template-select]'),opts=[...el.options];return {current:el.selectedIndex,wanted:opts.findIndex(o=>o.value===${JSON.stringify(id)}),label:opts.find(o=>o.value===${JSON.stringify(id)})?.textContent.trim(),rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
  assert(selection.wanted >= 0, `模板选项不存在：${id}`)
  await page.js(`(()=>{window.__whTemplateAbort?.abort();window.__whTemplateAbort=new AbortController();window.__whTemplateInputs=[];for(const kind of ['touchstart','touchend','pointerdown','pointerup','click','keydown','change'])document.addEventListener(kind,event=>{const el=event.target;const relevant=el.closest?.('[data-wh-template-select],.app-mob-sel-opt');if(relevant)window.__whTemplateInputs.push({kind:event.type,trusted:event.isTrusted,pointerType:event.pointerType,select:el.matches?.('[data-wh-template-select]')===true,option:!!el.closest?.('.app-mob-sel-opt')})},{capture:true,signal:window.__whTemplateAbort.signal})})()`)
  // 只用CDP输入选择；App自身对select的change转发是被测业务，不由工具伪造。
  if (page.touch && selection.rotated) {
    await page.tap(control('select'))
    await page.wait(`!!document.querySelector('.app-mob-sel-mask')`)
    assert.deepEqual(await manifest(page), before, '打开手机选择器改变清单')
    await page.text('.app-mob-sel', selection.label)
    await page.wait(`!document.querySelector('.app-mob-sel-mask')`)
  } else {
    await page.tap(control('select'))
    // 原生弹层不是DOM；Escape收起弹层后通过真实键盘改变已获焦select。
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    assert(await page.js(`document.activeElement===document.querySelector('[data-wh-template-select]')`), '真实select点击后未获焦')
    const command = keyboardSelection(selection.current, selection.wanted)
    for (let i = 0; i < command.steps; i++) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: command.key, code: command.code })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: command.key, code: command.code })
    }
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
  }
  await page.wait(`document.querySelector('[data-wh-template-select]').value===${JSON.stringify(id)}`)
  assert.deepEqual(await manifest(page), before, '只选择模板却执行了apply')
  const evidence = await page.js('window.__whTemplateInputs')
  await page.js('window.__whTemplateAbort?.abort()')
  if (page.touch) assert(evidence.some(e => e.trusted && e.kind === 'touchstart' && e.select), '没有触摸真实select')
  if (page.touch && selection.rotated) assert(evidence.some(e => e.trusted && e.kind === 'click' && e.option), '手机自绘选项没有可信点击')
  else if (selection.current !== selection.wanted) assert(evidence.some(e => e.trusted && e.kind === 'change' && e.select), '原生选择没有可信change')
  return { id, rotated: selection.rotated, evidence }
}

function preparationLedger(state, fleet) {
  return { warehouse: state.warehouse.items, stock: state.wormholeStock, fleet: fleet.map(id => [id, state.fleet[id]]), run: state.wormhole.run }
}

function makeTemplateFixture(input) {
  const { core } = dependencies()
  const state = core.loadSaveFile(input.initialSave).state
  delete state.wormholePreparationTemplates
  state.fleet[input.made.fleet[0]].cargo = { [AMMO]: 40, 'repairkit-dc': 3 }
  state.warehouse.items[AMMO] = 100
  state.warehouse.items['repairkit-mil'] = 20
  state.warehouse.items['repairkit-dc'] = 1_000_000
  return state
}

async function dismissOverlays(page) {
  if (await page.js('!!document.querySelector(".app-pro-mode-card:not(.is-iron)")')) await page.tap('.app-pro-mode-card:not(.is-iron)')
  let quiet = 0
  for (let n = 0; n < 60 && quiet < 10; n++) {
    const close = await page.js(`(()=>{for(const selector of ['.app-comm-pop .app-comms-eave-extra button','.app-comm-mask .app-comm-foot button','.app-modal-mask .app-comms-eave-extra button'])if(document.querySelector(selector))return selector;return null})()`)
    if (close) {
      await page.tap(close)
      quiet = 0
    } else {
      quiet++
      await sleep(100)
    }
  }
  assert(quiet >= 10, '启动通讯弹层未稳定关闭')
  if (await page.js('!!document.querySelector(".app-log-side:not(.is-collapsed) .app-log-head-right button")')) await page.tap('.app-log-head-right button')
}

async function openPreparation(page, input, text) {
  await dismissOverlays(page)
  await page.text('.app-nav-side', text('ui.App.001'))
  await page.text('.app-subtabs', text('ui.MapPage.007'))
  await openStockPreparation(page, text)
  await page.wait('!!document.querySelector("[data-wh-pick]")')
  const picked = await page.js('[...document.querySelectorAll("[data-wh-pick].is-picked")].map(el=>el.dataset.whPick)')
  for (const id of picked.filter(id => !input.made.fleet.includes(id))) await page.tap(`[data-wh-pick=${JSON.stringify(id)}]`)
  for (const id of input.made.fleet.filter(id => !picked.includes(id))) await page.tap(`[data-wh-pick=${JSON.stringify(id)}]`)
  await page.text('.app-wh-modal', text('ui.Expedition.308'))
  await page.wait('!!document.querySelector(".app-wh-manifest")')
  assert.equal(await page.js('!!document.querySelector("[data-wh-goal]")'), false, '整备目标选择器残留')
}

async function exportThroughUI(page, text, destination, nativeExport) {
  const { core } = dependencies()
  stage(page, 'exportThroughUI:close-wormhole')
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  stage(page, 'exportThroughUI:open-settings')
  await page.text('.app-header', text('ui.App.010'))
  stage(page, 'exportThroughUI:open-save-manager')
  await page.text('.app-settings-modal', text('ui.App.065'))
  if (!nativeExport) await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: destination })
  stage(page, 'exportThroughUI:export-current')
  await page.text('.app-save-actions', text('ui.SaveManager.016'))
  let exported
  for (let i = 0; i < 100; i++) {
    const candidates = nativeExport ? [nativeExport] : (await fs.readdir(destination)).filter(file => file.endsWith('.json')).map(file => path.join(destination, file))
    if (candidates.length) {
      try { exported = await fs.readFile(candidates[0], 'utf8'); core.loadSaveFile(exported); break } catch {}
    }
    await sleep(100)
  }
  assert(exported, '真实导出未产生完整JSON')
  const expected = (await page.snapshot()).wormholePreparationTemplates
  assert.deepEqual(core.loadSaveFile(exported).state.wormholePreparationTemplates, expected, '导出丢模板/0目标')
  assert.deepEqual(core.loadSaveFile(core.serializeSaveFile(core.loadSaveFile(exported).state, 0)).state.wormholePreparationTemplates, expected, '导出往返丢模板')
  await fs.mkdir(OUTPUT, { recursive: true })
  const artifact = path.join(OUTPUT, path.basename(destination) + '-export.json')
  await fs.writeFile(artifact, exported, 'utf8')
  await page.text('.app-modal-head', text('ui.App.086'))
  return artifact
}

async function templateChecks(page, input, options) {
  const { core, data } = dependencies()
  const text = uiText(options.locale, 'future')
  const report = { selections: [], checks: [] }
  const preparationScreenshot = `wormhole-expedition-preparation-${options.label}.png`
  page.preparationCapture = async () => {
    const wasExpanded = await page.js('document.querySelector("[data-wh-template-manage]").getAttribute("aria-expanded")==="true"')
    if (!wasExpanded) await page.tap(control('manage'))
    await reach(page, control('confirm'))
    await reach(page, control('name'))
    await page.screenshot(preparationScreenshot)
    report.preparationScreenshot = preparationScreenshot
    if (!wasExpanded) await page.tap(control('manage'))
  }
  stage(page, 'templateChecks:openPreparation')
  await openPreparation(page, input, text)
  const baseline = preparationLedger(await page.snapshot(), input.made.fleet)
  const draft = await manifest(page)
  assert.equal(draft[DRONE], 0, '无模板自动生成备用')
  assert.equal(await page.js('document.querySelector("[data-wh-template-fill]").disabled'), true)
  assert.deepEqual(await savedTemplates(page), [], '旧localStorage模板自动进入角色')
  assert.equal(await page.js('document.querySelector("[data-wh-template-fill]").textContent.trim()'), text('ui.whExpedition.011'))
  await page.number(field(AMMO), 45)
  await page.number(field(DRONE), 16)
  await page.number(field('repairkit-mil'), 0)
  const first = await saveNamedTemplate(page, 'UI Template A')
  if (options.inputSaveOnly) {
    stage(page, 'input-save-only:drone16-to-zero')
    await page.number(field(DRONE), 0)
    assert.equal((await manifest(page))[DRONE], 0)
    assert.equal((await savedTemplates(page))[0].targets[DRONE], 16, '修改清单覆盖了已保存模板')
    return { scope: 'input-save-only-not-full-template-check', checks: ['named-save16', 'edit16-to-zero', 'saved-template-unchanged'], steps: page.checkSteps, evidence: await failureEvidence(page) }
  }
  if (options.firstSaveOnly) return { scope: 'first-save-only-not-full-template-check', preparationScreenshot: report.preparationScreenshot, steps: page.checkSteps, evidence: await failureEvidence(page) }
  assert.equal(first.targets['repairkit-mil'], 0, '保存漏明确0')
  await page.number(field(AMMO), 70)
  await page.number(field(DRONE), 0)
  const second = await saveNamedTemplate(page, 'UI Template B')
  assert.equal(second.targets[DRONE], 0)
  const named = await savedTemplates(page)
  for (const name of ['', first.name]) {
    await page.tap(control('save'))
    await inputText(page, control('name'), name)
    await page.tap(control('confirm'))
    await page.wait(`document.querySelector('[data-wh-template-confirm]')?.disabled===false`)
    assert.deepEqual(await savedTemplates(page), named, '空名/同名保存修改了模板')
    assert((await page.js('document.querySelector(".app-wh-manifest-errors").innerText')).includes(text(name ? 'ui.whExpedition.123' : 'ui.whExpedition.122')), '空名/同名拒因未显示')
    await page.tap(control('cancel'))
  }
  await page.number(field(AMMO), 80)
  report.selections.push(await selectTemplate(page, first.id))
  await page.tap(control('fill'))
  assert.equal((await manifest(page))[AMMO], 45)
  assert.equal((await manifest(page))[DRONE], 16)
  report.selections.push(await selectTemplate(page, second.id))
  await page.tap(control('fill'))
  assert.equal((await manifest(page))[DRONE], 0, '0目标被一套备用覆盖')
  report.checks.push('two-named-templates', 'selection-only', 'explicit-zero', 'empty-duplicate-name-refused')

  await page.tap(control('manage'))
  const beforeCancel = await savedTemplates(page)
  for (const action of ['rename', 'overwrite', 'delete']) {
    await page.tap(control(action, first.id))
    if (action === 'rename') await inputText(page, control('name'), 'Canceled name')
    assert.deepEqual(await savedTemplates(page), beforeCancel, `${action}未确认即改档`)
    await page.tap(control('cancel'))
    assert.deepEqual(await savedTemplates(page), beforeCancel, `${action}取消改档`)
  }
  await page.tap(control('rename', first.id))
  await inputText(page, control('name'), 'UI Template A renamed')
  await page.tap(control('confirm'))
  await page.wait('!document.querySelector("[data-wh-template-confirm]")')
  assert.equal((await savedTemplates(page)).find(t => t.id === first.id).name, 'UI Template A renamed')
  await page.number(field(AMMO), 60)
  await page.tap(control('overwrite', first.id))
  assert.equal((await savedTemplates(page)).find(t => t.id === first.id).targets[AMMO], 45)
  await page.tap(control('confirm'))
  await page.wait('!document.querySelector("[data-wh-template-confirm]")')
  assert.equal((await savedTemplates(page)).find(t => t.id === first.id).targets[AMMO], 60)
  await page.tap(control('delete', second.id))
  assert.equal((await savedTemplates(page)).length, 2)
  await page.tap(control('confirm'))
  await page.wait('!document.querySelector("[data-wh-template-confirm]")')
  assert.equal((await savedTemplates(page)).length, 1)
  assert.equal(await page.js('document.querySelector("[data-wh-template-fill]").disabled'), true)
  report.checks.push('rename-overwrite-delete-cancel', 'confirmed-overwrite-delete')

  const unload = '[data-wh-manifest-item="repairkit-dc"] input[type=checkbox]'
  await page.tap(unload)
  await page.tap(control('import'))
  await inputText(page, control('name'), 'Legacy manual import')
  await page.tap(control('cancel'))
  assert.equal((await savedTemplates(page)).length, 1)
  await page.tap(control('import'))
  await inputText(page, control('name'), 'Legacy manual import')
  await page.tap(control('confirm'))
  await page.wait('!document.querySelector("[data-wh-template-confirm]")')
  const imported = (await savedTemplates(page)).find(t => t.name === 'Legacy manual import')
  assert(imported)
  assert.equal(imported.targets[AMMO], 5)
  await page.tap(control('fill'))
  assert.equal((await manifest(page))[AMMO], 40, '低模板目标暗删已有舰货')
  assert.equal((await manifest(page))['repairkit-dc'], 0, '补齐取消了卸港选择')
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(unload)}).checked`), true)
  assert((await page.js('document.querySelector(".app-wh-manifest-warnings").innerText')).includes(text('ui.whExpedition.131').replace('{p1}', '35')), '已有货超目标未显示超额')
  report.checks.push('legacy-manual-only', 'onboard-excess-retained', 'unload-retained')
  await page.tap(unload)
  await page.number(field(AMMO), 201)
  const shortage = await saveNamedTemplate(page, 'Shortage')
  await page.number(field(AMMO), 45)
  report.selections.push(await selectTemplate(page, shortage.id))
  await page.tap(control('fill'))
  assert.equal((await manifest(page))[AMMO], 201, '缺货目标被降低')
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(field(AMMO))}).getAttribute('aria-invalid')`), 'true')
  const missing = core.wormholePreparationPlan(await page.snapshot(), input.ctx, input.made.fleet, { targets: await manifest(page), unload: [] }).shortage[AMMO]
  assert.equal(missing, 61)
  assert((await page.js('document.querySelector(".app-wh-manifest-errors").innerText')).includes(text('ui.whExpedition.006').replace('{p1}', String(missing))))
  await page.tap('[data-wh-enter-prepared]')
  assert.equal((await page.snapshot()).wormhole.run, null)
  await page.number(field(AMMO), 45)
  await page.number(field('repairkit-dc'), 1_000_000)
  const overload = await saveNamedTemplate(page, 'Over capacity')
  await page.number(field('repairkit-dc'), 3)
  report.selections.push(await selectTemplate(page, overload.id))
  await page.tap(control('fill'))
  assert.equal((await manifest(page))['repairkit-dc'], 1_000_000, '超容模板被裁减')
  const capacity = core.wormholePreparationPlan(await page.snapshot(), input.ctx, input.made.fleet, { targets: await manifest(page), unload: [] })
  assert(capacity.cells > capacity.capacity)
  assert.equal(Object.keys(capacity.shortage).length, 0, '超容夹具意外缺货')
  assert((await page.js('document.querySelector(".app-wh-manifest-errors").innerText')).includes(text('ui.whExpedition.017')))
  await page.tap('[data-wh-enter-prepared]')
  assert.equal((await page.snapshot()).wormhole.run, null)
  report.checks.push('shortage-retained', 'overcapacity-retained')

  report.selections.push(await selectTemplate(page, first.id))
  await page.tap(control('fill'))
  for (let n = (await savedTemplates(page)).length; n < core.WORMHOLE_TEMPLATE_MAX; n++) await saveNamedTemplate(page, `Limit ${n + 1}`)
  assert.equal((await savedTemplates(page)).length, 10)
  assert.equal(await page.js('document.querySelector("[data-wh-template-save]").disabled'), true)
  assert.equal(await page.js('document.querySelector("[data-wh-template-import]").disabled'), true)
  assert.deepEqual(preparationLedger(await page.snapshot(), input.made.fleet), baseline, '模板操作预扣/改变编队实物')
  const expected = await savedTemplates(page)
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.reload()
  stage(page, 'templateChecks:reopenPreparation-after-reload')
  assert.deepEqual((await page.snapshot()).wormholePreparationTemplates, expected, '重载丢模板')
  await openPreparation(page, input, text)
  report.selections.push(await selectTemplate(page, first.id))
  await page.tap(control('fill'))
  assert.equal((await manifest(page))[AMMO], 60)
  stage(page, 'templateChecks:entry-first-confirm')
  await page.tap('[data-wh-enter-prepared]')
  assert.deepEqual(preparationLedger(await page.snapshot(), input.made.fleet), baseline, '第一确认即扣货')
  stage(page, 'templateChecks:entry-second-confirm')
  await page.tap('[data-wh-enter-prepared]')
  await page.wait('window.__whExpeditionTest.snapshot().wormhole.run?.supplyVersion===1')
  const entered = await page.snapshot()
  stage(page, 'templateChecks:entered-persist')
  assert.equal(entered.wormhole.run.supplies.carried[AMMO], 60)
  assert.equal(entered.warehouse.items[AMMO], baseline.warehouse[AMMO] - 20, '已有40舰货重复扣母港')
  assert.deepEqual(entered.wormholePreparationTemplates, expected)
  await page.command('persist')
  await page.wait('!!document.querySelector(".app-wh-supply-summary")')
  const screenshot = `wormhole-expedition-template-${options.label}.png`
  await page.screenshot(screenshot)
  report.exported = await exportThroughUI(page, text, options.downloads, options.nativeExport)
  stage(page, 'templateChecks:reload-after-export')
  await page.reload()
  assert.deepEqual((await page.snapshot()).wormholePreparationTemplates, expected, '入洞暂停重载丢模板')
  await page.tap('.app-activitybar-item.is-wormhole')
  await page.wait('!!document.querySelector(".app-wh-supply-summary")')
  assert.equal((await page.snapshot()).wormhole.run.supplies.carried[AMMO], 60, '恢复重新装载')
  report.checks.push('ten-template-limit', 'no-predebit', 'double-confirmation', 'reload-export-roundtrip', 'resume-no-refill')
  report.screenshot = screenshot
  return report
}

function fightTarget(state) {
  const { grid } = dependencies()
  const run = state.wormhole.run
  return run.grid.cells.find(cell => grid.hexDistance(cell, run.grid.pos) === 1 && cell.key !== `${run.grid.exit.q},${run.grid.exit.r}`)
}

function makeLayoutFixture(input, kind) {
  const { core, grid } = dependencies()
  const state = structuredClone(input.made.state)
  const run = state.wormhole.run
  const cell = grid.gridCellAt(run.grid, run.grid.pos)
  delete cell.foe; delete cell.elite; delete cell.combatCleared; delete cell.eventResolved
  run.turnsLeft = kind === 'free-leave' ? 0 : 8
  if (kind === 'free-leave') {
    cell.place = 'empty'; cell.eventKey = 'maintenance'
    cell.event = { supply: { 'repairkit-mil': 20, [DRONE]: 4 }, containerId: 'box-relic-a', identity: 'ambush' }
    run.pendingEvent = { key: 'maintenance', cellKey: cell.key }
  } else {
    cell.place = 'empty'; delete cell.eventKey; delete cell.event
    delete run.pendingEvent
    // 待迎战必须由真实UI移动产生；旧清洗器不保留人工置入的pendingNodeBattle。
    const target = fightTarget(state)
    assert(target, '没有相邻合成战斗地点')
    target.place = 'ship'
    for (const key of ['foe', 'elite', 'combatCleared', 'eventKey', 'event', 'nebula']) delete target[key]
    for (const key of ['scanned', 'visited', 'activated']) run.grid[key] = run.grid[key].filter(key => key !== target.key)
  }
  state.modeChosen = true; state.onboarding.step = 99
  return core.loadSaveFile(core.serializeSaveFile(state, Date.now())).state
}

async function layoutGeometry(page) {
  return page.js(`(()=>{
    const modal=document.querySelector('.app-wh-modal'),explore=document.querySelector('.app-wh-explore'),map=document.querySelector('.app-wh-map-pane'),ops=document.querySelector('.app-wh-ops'),fixed=document.querySelector('.app-wh-ops-fixed'),details=document.querySelector('.app-wh-details');
    const box=el=>{if(!el)throw Error('§20布局挂载点缺失');const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,logicalWidth:el.clientWidth,logicalHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollWidth:el.scrollWidth,scrollTop:el.scrollTop,overflowY:getComputedStyle(el).overflowY}};
    const ancestors=[];for(let el=details;el;el=el.parentElement)ancestors.push({tag:el.tagName,className:String(el.className),...box(el)});
    return {modal:box(modal),explore:box(explore),map:box(map),mapbox:box(document.querySelector('.app-wh-mapbox')),zoom:box(document.querySelector('.app-wh-zoom')),body:box(modal.querySelector('.app-modal-body')),run:box(document.querySelector('.app-wh-run')),ops:box(ops),fixed:box(fixed),details:box(details),ancestors,rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot'),columns:map.offsetLeft+map.offsetWidth<=ops.offsetLeft+2,viewport:{width:innerWidth,height:innerHeight},bodyOverflow:document.documentElement.scrollHeight>innerHeight+2||document.documentElement.scrollWidth>innerWidth+2};
  })()`)
}

function stableLayout(before, after) {
  for (const selector of ['map', 'fixed', 'modal']) {
    for (const axis of ['left', 'top', 'width', 'height']) assert(Math.abs(before[selector][axis] - after[selector][axis]) < 2, `详情滚动推动${selector}.${axis}`)
  }
}

async function revealMapTarget(page, key) {
  const selector = `[data-wh-cell=${JSON.stringify(key)}]`
  const inspect = () => page.js(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)}),map=document.querySelector('.app-wh-mapbox');
    if(!el||!map)throw Error('地图目标未渲染');const r=el.getBoundingClientRect(),m=map.getBoundingClientRect();
    const l=Math.max(r.left,m.left,0),t=Math.max(r.top,m.top,0),rr=Math.min(r.right,m.right,innerWidth),b=Math.min(r.bottom,m.bottom,innerHeight);
    const x=(l+rr)/2,y=(t+b)/2,hit=document.elementFromPoint(x,y);
    return {target:{x:r.x,y:r.y,width:r.width,height:r.height},map:{x:m.x,y:m.y,width:m.width,height:m.height},visible:rr-l>4&&b-t>4&&!!hit&&(el===hit||el.contains(hit)),zoom:document.querySelector('.app-wh-zoom-val')?.textContent};
  })()`)
  const ledger = (await page.snapshot()).wormhole.run
  const steps = []
  const initial = await inspect()
  recordStep(page, { method: 'revealMapTarget:initial', key, geometry: initial })
  assert(initial.map.width > 4 && initial.map.height > 4, '地图框零高/零宽，拒绝用缩放或拖图掩盖布局错误')
  if (initial.visible) return
  const fit = '.app-wh-zoom-btn.is-text'
  if (await page.js(`document.querySelector(${JSON.stringify(fit)})?.disabled===false`)) {
    await page.tap(fit)
    await sleep(350)
    steps.push({ action: 'fit', geometry: await inspect() })
  }
  const minus = '.app-wh-zoom button:nth-of-type(2)'
  for (let index = 0; index < 10 && !(await inspect()).visible && await page.js(`document.querySelector(${JSON.stringify(minus)})?.disabled===false`); index++) {
    await page.tap(minus)
    await sleep(350)
    steps.push({ action: 'zoom-out', geometry: await inspect() })
  }
  recordStep(page, { method: 'revealMapTarget', key, steps, final: await inspect() })
  const after = (await page.snapshot()).wormhole.run
  assert.deepEqual(after.grid.pos, ledger.grid.pos, '缩放误移动了舰队')
  assert.equal(after.turnsLeft, ledger.turnsLeft, '缩放消耗回合')
  assert(!after.battle, '缩放误发起战斗')
  assert((await inspect()).visible, '真实适应/缩放后目标仍不可达')
}

async function layoutChecks(page, kind, options) {
  stage(page, `layoutChecks(${kind}):open-wormhole`)
  await dismissOverlays(page)
  await page.tap('.app-activitybar-item.is-wormhole')
  await page.wait('!!document.querySelector(".app-wh-ops-fixed")')
  if (kind === 'must-fight') {
    const target = fightTarget(await page.snapshot())
    await revealMapTarget(page, target.key)
    await page.tap(`[data-wh-cell=${JSON.stringify(target.key)}]`)
    await page.wait('!!document.querySelector(".app-wh-ops-fixed .app-wh-ask button.is-warn")')
    await reach(page, '.app-wh-ops-fixed .app-wh-ask button.is-warn')
    await page.tap('.app-wh-ops-fixed .app-wh-ask button.is-warn')
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.pendingNodeBattle===true')
  }
  assert.equal(await page.js('!!document.querySelector("[data-wh-goal]")'), false, '洞内目标选择器残留')
  const before = await layoutGeometry(page)
  page.layoutReadings = { before }
  const expectedColumns = options.mobile && options.width < options.height || options.width > 880
  if (expectedColumns) assert(before.columns, '足宽/旋转窗口不是左地图右操作区')
  assert(before.map.logicalHeight > 40 && before.fixed.logicalHeight > 30, '地图/固定动作区被压空')
  assert(!before.bodyOverflow, '一级页面发生滚动')
  for (const axis of ['left', 'top']) assert(before.modal[axis] >= -2, '窗口越出物理视口')
  assert(before.modal.right <= options.width + 2 && before.modal.bottom <= options.height + 2, '窗口越出物理视口')
  const snapshot = await page.snapshot()
  const button = kind === 'free-leave' ? '[data-wh-event-action="bypass"]' : '.app-wh-ops-fixed .app-wh-extract-ask button.is-danger'
  const measured = await reach(page, button)
  assert.equal(measured.disabled, false, '免费离开/必须迎战被禁用')
  const after = await layoutGeometry(page)
  page.layoutReadings.after = after
  stableLayout(before, after)
  stage(page, `layoutChecks(${kind}):fixedControls-height`)
  const fixedControls = (await failureEvidence(page)).fixedControls
  assert(fixedControls.every(el => el.scrollWidth <= el.clientWidth + 2), '固定动作按钮文字横向溢出')
  assert(fixedControls.every(el => el.offsetHeight >= 30), '固定动作按钮过度缩小')
  await reach(page, '[data-wh-scan]')
  stableLayout(before, await layoutGeometry(page))
  await reach(page, button)
  await page.js(`(()=>{window.__whLayoutInputs=[];for(const kind of ['touchstart','touchend','click'])document.addEventListener(kind,event=>{const target=event.target.closest?.(${JSON.stringify(button)});if(target)window.__whLayoutInputs.push({kind:event.type,trusted:event.isTrusted})},{capture:true,once:true})})()`)
  const screenshot = `wormhole-expedition-layout-${kind}-${options.label}.png`
  await page.screenshot(screenshot)
  await clickAt(page, (await reach(page, button)).point, options.mobile)
  if (kind === 'free-leave') {
    await page.wait('window.__whExpeditionTest.snapshot().wormhole.run.pendingEvent===undefined')
    const final = await page.snapshot()
    for (const property of ['turnsLeft', 'patrolActionSeq', 'supplies']) assert.deepEqual(final.wormhole.run[property], snapshot.wormhole.run[property], `免费离开改变${property}`)
    assert.deepEqual(final.warehouse.items, snapshot.warehouse.items)
    assert(!final.wormhole.run.battle)
  } else {
    await page.wait('!!window.__whExpeditionTest.snapshot().wormhole.run.battle')
    assert(Object.values((await page.snapshot()).wormhole.run.battle.units).some(unit => unit.side === 'foe'), '迎战没有创建真实敌人')
  }
  const evidence = await page.js('window.__whLayoutInputs')
  assert(evidence.some(e => e.kind === 'click' && e.trusted), '关键动作缺少可信click')
  if (options.mobile) assert(evidence.some(e => e.kind === 'touchstart' && e.trusted), '关键动作缺少真触控')
  return { kind, before, after, measured, fixedControls, evidence, screenshot, scope: 'synthetic-layout-branch-not-journey-or-event-matrix' }
}

async function withPage(cdp, url, input, state, options, action) {
  const { core } = dependencies()
  const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let page
  try {
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP连接失败')), { once: true }) })
    const connection = new CdpConnection(socket)
    page = observePage(new JourneyPage(connection.send.bind(connection), { touch: options.mobile }))
    page.runtimeErrors = connection.errors
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, screenWidth: options.width, screenHeight: options.height, mobile: options.mobile, deviceScaleFactor: 1, screenOrientation: { type: options.width < options.height ? 'portraitPrimary' : 'landscapePrimary', angle: options.width < options.height ? 0 : 90 } })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: options.mobile, maxTouchPoints: 5 })
    const old = { picked: input.made.fleet, request: { targets: { [AMMO]: 5, [DRONE]: 0, 'repairkit-dc': 10 }, unload: [] } }
    const source = `localStorage.clear();${settingsScript(input.announcement, core.serializeSaveFile(state, Date.now()))};localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem(${JSON.stringify(OLD_KEY)},${JSON.stringify(JSON.stringify(old))});`
    const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source })
    await page.send('Page.navigate', { url })
    await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    await installInputEvidence(page)
    await sleep(350)
    const result = await action(page)
    assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
    return compactResult({ success: true, ...result, runtimeErrors: connection.errors })
  } catch (error) {
    const screenshot = `wormhole-expedition-special-${options.label}-failure.png`
    await page?.screenshot(screenshot).catch(() => {})
    const evidence = error.evidence ?? (page ? await failureEvidence(page).catch(() => null) : null)
    const result = { success: false, failure: error instanceof Error ? error.message : String(error), stack: error.stack, stage: page?.checkStage, steps: page?.checkSteps, geometry: page?.layoutReadings, runtimeErrors: page?.runtimeErrors ?? [], screenshot, evidence }
    await fs.mkdir(OUTPUT, { recursive: true })
    await atomicJson(path.join(OUTPUT, `wormhole-expedition-special-${options.label}-failure.json`), result)
    return compactResult(result)
  } finally {
    socket.close()
    await fetch(`${cdp}/json/close/${target.id}`).catch(() => {})
  }
}


function selfTest() {
  const { core } = dependencies()
  const input = createFixture()
  const state = makeTemplateFixture(input)
  assert.equal(state.wormhole.run, null)
  assert.deepEqual(state.wormholePreparationTemplates ?? [], [])
  const before = structuredClone(preparationLedger(state, input.made.fleet))
  assert(core.wormholeSavePreparationTemplate(state, 'A', { [AMMO]: 5, [DRONE]: 0, 'repairkit-dc': 10 }).ok)
  const template = state.wormholePreparationTemplates[0]
  const plan = core.wormholeTemplateFillPlan(state, input.ctx, input.made.fleet, { targets: {}, unload: ['repairkit-dc'] }, template)
  assert.equal(plan.request.targets[AMMO], 40)
  assert.equal(plan.request.targets[DRONE], 0)
  assert.equal(plan.request.targets['repairkit-dc'], 0)
  assert.equal(plan.excess[AMMO], 35)
  assert.deepEqual(preparationLedger(state, input.made.fleet), before)
  assert.equal(core.wormholePreparationPlan(state, input.ctx, input.made.fleet, { targets: { [AMMO]: 201 }, unload: [] }).shortage[AMMO], 61)
  const overload = core.wormholePreparationPlan(state, input.ctx, input.made.fleet, { targets: { 'repairkit-dc': 1_000_000 }, unload: [] })
  assert(overload.cells > overload.capacity && Object.keys(overload.shortage).length === 0)
  for (const kind of ['free-leave', 'must-fight']) {
    const branch = makeLayoutFixture(input, kind)
    assert(branch.wormhole.run)
    if (kind === 'free-leave') assert(core.wormholeEventView(branch, input.ctx).choices.find(c => c.action === 'bypass').plan.ok)
    else {
      const target = fightTarget(branch)
      assert.equal(target.place, 'ship')
      assert(!branch.wormhole.run.grid.scanned.includes(target.key))
    }
  }
  assert.deepEqual(keyboardSelection(2, 0), { key: 'ArrowUp', code: 'ArrowUp', steps: 2 })
  assert.deepEqual(keyboardSelection(0, 2), { key: 'ArrowDown', code: 'ArrowDown', steps: 2 })
  const geometry = { map: { left: 0, top: 0, width: 300, height: 200 }, fixed: { left: 300, top: 0, width: 100, height: 60 }, modal: { left: 0, top: 0, width: 400, height: 300 } }
  stableLayout(geometry, structuredClone(geometry))
  assert.throws(() => stableLayout(geometry, { ...geometry, map: { ...geometry.map, width: 320 } }))
}

async function aggregateReports(originalName, followupNames) {
  const read = async name => {
    return { name, report: JSON.parse(await fs.readFile(artifactPath(name), 'utf8')) }
  }
  const original = await read(originalName)
  const key = row => `${row.locale}/${row.layout}/${row.width}x${row.height}`
  const compact = compactResult
  const rows = original.report.rows.map(row => ({
    locale: row.locale, layout: row.layout, width: row.width, height: row.height, mobile: row.mobile,
    templates: compact(row.templates), layouts: row.layouts?.map(compact),
    templateSource: original.name, layoutSources: row.layouts?.map(() => original.name),
    original: { success: row.success, templates: compact(row.templates), layouts: row.layouts?.map(compact) },
  }))
  const sources = [{ name: original.name, build: original.report.build, scope: 'original-complete-matrix' }]
  for (const name of followupNames) {
    const followup = await read(name)
    sources.push({ name, build: followup.report.build, scope: 'actual-followup-rows-only' })
    for (const updated of followup.report.rows) {
      const row = rows.find(row => key(row) === key(updated))
      assert(row, `补跑组不在原矩阵：${key(updated)}`)
      if (updated.templates) {
        assert(updated.templates.checks?.includes('resume-no-refill') || !updated.templates.success, '短输入/截图专项不能替代完整模板测试')
        row.templates = compact(updated.templates)
        row.templateSource = name
      }
      if (updated.layouts) {
        assert.equal(updated.layouts.length, 2, '布局补跑必须保留两个分支')
        row.layouts = updated.layouts.map(compact)
        row.layoutSources = updated.layouts.map(() => name)
      }
    }
  }
  for (const row of rows) row.success = row.templates?.success === true && row.layouts?.length === 2 && row.layouts.every(branch => branch.success)
  const report = {
    scope: 'synthetic-template-layout-aggregate-not-full-new-build-rerun-or-visual-acceptance', sources,
    preparationScreenshots: (await fs.readdir(OUTPUT)).filter(name => /^wormhole-expedition-preparation-.*-final-preparation-(desktop|mobile)\.png$/.test(name)),
    followupChangeScope: { reportedBy: 'main-agent-user-instructions', changes: ['虫洞弹窗背景overflow:clip', '极矮窄窗标题单行/说明省略并保留悬停全文/按钮不缩'], noFullNewBuildMatrixClaim: true },
    originalFailures: rows.filter(row => !row.original.success).map(row => ({ key: key(row), ...row.original })), rows,
    summary: { groups: rows.length, passed: rows.filter(row => row.success).length, templatesPassed: rows.filter(row => row.templates?.success).length, layoutBranchesPassed: rows.flatMap(row => row.layouts ?? []).filter(branch => branch.success).length, whollyOriginalRows: rows.filter(row => row.templateSource === original.name && row.layoutSources?.every(source => source === original.name)).length, followupRows: rows.filter(row => row.layoutSources?.some(source => source !== original.name) || row.templateSource !== original.name).length },
  }
  await atomicJson(path.join(OUTPUT, 'wormhole-expedition-template-ui-aggregate.json'), report)
  console.log(JSON.stringify(report.summary))
  assert(report.summary.passed === report.summary.groups, '聚合仍有未通过分支，原始失败已保留')
}

async function main() {
  const arg = name => process.argv.find(value => value.startsWith('--'+name+'='))?.split('=').slice(1).join('=')
  if (arg('compact-report')) {
    const file = artifactPath(arg('compact-report'))
    const report = compactReport(JSON.parse(await fs.readFile(file, 'utf8')))
    await atomicJson(file, report)
    console.log(JSON.stringify({ file, bytes: (await fs.stat(file)).size, groups: report.rows.length }))
    return
  }
  if (arg('aggregate')) { await aggregateReports(arg('aggregate'), (arg('followups') ?? '').split(',').filter(Boolean)); return }
  if (process.argv.includes('--self-test')) { selfTest(); console.log('模板专项工具/夹具自检通过；未启动浏览器，不是UI结论。'); return }
  const dist = path.join(ROOT, 'web/dist')
  const prefix = 'whale-whexpedition-template-ui-'
  const rows = []
  const tag = arg('report-tag') ?? new Date().toISOString().replace(/[:.]/g, '-')
  assert(/^[\w-]+$/.test(tag), 'report-tag只接受字母数字下划线横线')
  const report = { scope: 'templates-and-layout-only-not-visual-acceptance', startedFromSyntheticSave: true, success: false, rows }
  const persist = async () => {
    await atomicJson(path.join(OUTPUT, 'wormhole-expedition-template-ui.json'), report)
    await atomicJson(path.join(OUTPUT, `wormhole-expedition-template-ui-${tag}.json`), report)
  }
  let profile
  let server
  let chrome
  let spawnError
  try {
    report.build = await assertFreshBuild(dist)
    if (process.argv.includes('--check-build')) { console.log(JSON.stringify(report.build)); return }
    const input = createFixture()
    const viewports = (process.argv.includes('--quick') ? [VIEWPORTS[0], VIEWPORTS[2]] : VIEWPORTS).filter(([width,height]) => !arg('viewport') || `${width}x${height}` === arg('viewport'))
    const locales = (process.argv.includes('--quick') ? ['zh'] : ['zh','en']).filter(locale => !arg('locale') || locale === arg('locale'))
    const layouts = (process.argv.includes('--quick') ? ['classic'] : ['classic','modern']).filter(layout => !arg('layout') || layout === arg('layout'))
    assert(viewports.length && locales.length && layouts.length, '过滤参数未选中任何矩阵行')
    assert(!(process.argv.includes('--templates-only') && process.argv.includes('--layout-only')), '两个only参数互斥')
    profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const hosted = await staticServer(dist)
    server = hosted.server
    const url = hosted.url
    chrome = spawn(process.env.WH_JOURNEY_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    report.ownedPid = chrome.pid
    chrome.once('error', error => { spawnError = error })
    console.log(`模板/布局专项自有Chrome PID ${chrome.pid}`)
    let debug
    for (let n = 0; n < 100; n++) {
      if (spawnError) throw spawnError
      if (chrome.exitCode !== null) throw new Error('自有Chrome提前退出')
      try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, '自有Chrome调试端口未就绪')
    const cdp = `http://127.0.0.1:${debug.split('\n')[0]}`
    for (const locale of locales) for (const layout of layouts) for (const [width, height, mobile] of viewports) {
      const row = { locale, layout, width, height, mobile }
      const downloads = path.join(profile, `${locale}-${layout}-${width}-${height}`)
      await fs.mkdir(downloads, { recursive: true })
      const options = { ...row, downloads, firstSaveOnly: process.argv.includes('--first-save-only'), inputSaveOnly: process.argv.includes('--input-save-only'), label: `${locale}-${layout}-${width}-${height}-${tag}` }
      if (!process.argv.includes('--layout-only')) row.templates = await withPage(cdp, url, input, makeTemplateFixture(input), options, page => templateChecks(page, input, options))
      if (!process.argv.includes('--templates-only')) {
        row.layouts = []
        for (const kind of ['free-leave', 'must-fight']) row.layouts.push(await withPage(cdp, url, input, makeLayoutFixture(input, kind), { ...options, label: options.label + '-' + kind }, page => layoutChecks(page, kind, options)))
      }
      row.success = (!row.templates || row.templates.success) && (!row.layouts || row.layouts.every(branch => branch.success))
      rows.push(row)
      await persist()
      console.log(JSON.stringify({ ...row, templates: row.templates && { success: row.templates.success, failure: row.templates.failure }, layouts: row.layouts?.map(branch => ({ success: branch.success, failure: branch.failure })) }))
    }
    assert(rows.every(row => row.success), `模板/布局专项失败：${rows.filter(row => !row.success).length}/${rows.length}`)
    report.success = true
    console.log(`模板/布局专项通过${rows.length}组；仅合成档几何/操作读数，不是观感验收。`)
  } catch (error) {
    report.failure = error.message
    throw error
  } finally {
    try {
      await stopOwned(chrome)
      report.ownedPidExited = !chrome || !Number.isInteger(chrome.pid) || chrome.exitCode !== null || chrome.signalCode !== null
    } catch (error) { report.success = false; report.cleanupFailure = error.message; throw error }
    finally {
      if (server) await new Promise(resolve => server.close(resolve))
      if (profile && report.ownedPidExited) await removeProfile(profile, prefix)
      if (!process.argv.includes('--check-build') || report.failure) await persist()
    }
  }
}

module.exports = { assertFreshBuild, inputText, manifest, savedTemplates, saveNamedTemplate, selectTemplate, templateChecks, keyboardSelection, layoutGeometry, stableLayout, failureEvidence, installInputEvidence, atomicJson, selfTest, dismissOverlays, openPreparation, withPage }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
