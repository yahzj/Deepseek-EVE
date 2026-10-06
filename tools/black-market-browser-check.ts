/** 黑市真实构建浏览器回归。用法：npm run build --prefix web；npx tsx tools/black-market-browser-check.ts。
 * 自建随机端口只读服务、独立无头Edge临时配置、全新合成档，不访问个人档。
 * 检查两版/双语/默认与小桌面/手机横竖屏九宫格、SVG监视器、交易和减少动效；包含真实候选最高报价及最长名称。
 * 输出tools/_ui-artifacts/black-market截图和readings.json；不代替真机观感验收。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-06。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { blackMarketCandidateGoods, BLACK_MARKET_MAX_MULTIPLIER, goodName, loadSaveFile, serializeSaveFile } from '@whale/core'
import { ANNOUNCEMENTS, buildSimContext, L10N } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const root = resolve(process.cwd()), dist = resolve(root, 'web/dist'), out = resolve(root, 'tools/_ui-artifacts/black-market')
let ws: WebSocket | undefined, seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
function send(method: string, params: object = {}): Promise<any> {
  const id = ++seq
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })) })
}
async function js<T = any>(expression: string): Promise<T> {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
async function until(expression: string) {
  for (let i = 0; i < 100; i++) { if (await js(expression)) return; await sleep(100) }
  throw new Error('等待超时：' + expression + '\n' + await js(`JSON.stringify({text:document.body.innerText.slice(0,1200),state:JSON.parse(localStorage.getItem('whale:idle:save'))?.state.standingsEarned,entry:document.querySelector('.app-bm-entry')?.outerHTML})`))
}
async function click(selector: string) {
  assert(await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)return false;b.click();return true})()`), selector)
}
async function point(selector: string, action: 'hover' | 'tap') {
  const position = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (action === 'hover') await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
  else {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [position] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function dismissNotice() {
  for (let i = 0; i < 6; i++) {
    await js(`(()=>{const b=[...document.querySelectorAll('.app-modal-head button')].find(x=>x.textContent.includes('关闭')||x.textContent.includes('Close'))??document.querySelector('.app-comm-pop .app-comms-eave-extra button');if(b)b.click();return true})()`)
    await sleep(120)
  }
}
async function main() {
  await fs.mkdir(out, { recursive: true })
  const server = createServer(async (req, res) => {
    try {
      const file = resolve(dist, '.' + new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '/index.html'))
      assert(file.startsWith(dist + sep))
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.statusCode = 404; res.end() }
  })
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r) })
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const profile = await fs.mkdtemp(join(tmpdir(), 'whale-blackmarket-'))
  const child = spawn(process.env.WHALE_EDGE_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let launchError: Error | undefined
  child.on('error', (e) => { launchError = e })
  try {
    let port = ''
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError
      try { port = (await fs.readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]! } catch {}
      if (port) break
      await sleep(100)
    }
    assert(port && child.exitCode === null, '独立浏览器未启动')
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
    ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl)
    await new Promise<void>((r, j) => { ws!.addEventListener('open', () => r(), { once: true }); ws!.addEventListener('error', () => j(new Error('CDP连接失败')), { once: true }) })
    ws.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data)), waiter = pending.get(m.id)
      if (!waiter) return
      pending.delete(m.id)
      if (m.error) waiter.reject(new Error(JSON.stringify(m.error)))
      else waiter.resolve(m.result)
    })
    await send('Page.enable')
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await send('Page.navigate', { url })
    await until('document.readyState === "complete"')
    const readings: any[] = []
    const fixtureNow = Date.now()
    for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mode of ['desktop', 'compact', 'minimum', 'landscape', 'portrait']) {
      const mobile = mode === 'portrait' || mode === 'landscape'
      const width = mode === 'portrait' ? 390 : mode === 'landscape' ? 844 : mode === 'compact' ? 1366 : mode === 'minimum' ? 1024 : 1540
      const height = mode === 'portrait' ? 844 : mode === 'landscape' ? 390 : mode === 'compact' ? 768 : mode === 'minimum' ? 700 : 940
      await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile,
        screenOrientation: { type: mode === 'portrait' ? 'portraitPrimary' : 'landscapePrimary', angle: mode === 'portrait' ? 0 : 90 } })
      await send('Emulation.setUserAgentOverride', { userAgent: !mobile
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
      const ctx = buildSimContext(locale as 'zh' | 'en')
      const candidates = blackMarketCandidateGoods(ctx)
      const highest = [...candidates].sort((a, b) => b.basePrice - a.basePrice)[0]!
      const longest = [...candidates].filter(g => g.kind !== 'aicore')
        .sort((a, b) => goodName(ctx, b.key).length - goodName(ctx, a.key).length)
      const fixture = loadSaveFile(blackMarketTestSave(fixtureNow)).state
      const original = ctx.marketGoods.get(fixture.blackMarket!.offers[0]!.goodKey)!
      const stressGoods = [...new Map([ctx.marketGoods.get('blackbox-h')!, original, highest, ...longest].map(g => [g.key, g])).values()].slice(0, 9)
      fixture.blackMarket!.offers = stressGoods.map(g => ({ goodKey: g.key, basePrice: g.basePrice,
        multiplier: BLACK_MARKET_MAX_MULTIPLIER, price: g.basePrice * BLACK_MARKET_MAX_MULTIPLIER, sold: false }))
      // 固定商品抽样与日板时间，但本轮保存时刻保持当前，避免后面的用例触发离线简报。
      fixture.savedAtWallMs = Date.now()
      const save = serializeSaveFile(fixture, fixture.savedAtWallMs)
      // 新文档启动前注入，避免旧引擎的pagehide保存覆写合成档。
      const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();localStorage.setItem('whale:idle:save',${JSON.stringify(save)});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});` })
      await send('Page.reload')
      await sleep(700)
      await until('!!document.querySelector(".app-root")')
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
      await until(`!!document.querySelector('[data-nav-page="market"]')||[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(locale === 'zh' ? '市场' : 'Market')})`)
      assert(await js(`(()=>{const b=document.querySelector('[data-nav-page="market"]')??[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(locale === 'zh' ? '市场' : 'Market')});if(!b)return false;b.click();return true})()`), '市场入口')
      await until('!!document.querySelector(".app-mkt-tabs .app-bm-entry")')
      await js(`(()=>{const el=document.querySelector('.app-mkt-search-input');if(!el)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'zzz-market-preserved');el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await click('.app-mkt-tabs .app-bm-entry')
      await until('document.querySelectorAll(".app-bm-card").length === 9')
      await sleep(250)
      await dismissNotice()
      const logOverlay = await js(`(()=>{const a=document.querySelector('.app-bm-monitor-art').getBoundingClientRect(),log=document.querySelector('.app-log-side'),b=log.getBoundingClientRect();return getComputedStyle(log).display!=='none'&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)})()`)
      // 新版展开日志按已确认外壳规则覆盖主区；收起后再验证监视器无遮挡。
      if (layout === 'modern' && !mobile) {
        const overlayShot = await send('Page.captureScreenshot', { format: 'png' })
        await fs.writeFile(join(out, `${layout}-${locale}-${mode}-log-open.png`), Buffer.from(overlayShot.data, 'base64'))
        await click('.app-log-head-right button')
        await until('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
        await sleep(250)
      }
      const r = await js(`(()=>{
        const page=document.querySelector('.app-bm-page'),stock=document.querySelector('.app-bm-stock'),merchant=document.querySelector('.app-bm-merchant'),portrait=document.querySelector('.app-bm-monitor');
        const root=document.querySelector('.app-root'),transform=getComputedStyle(root).transform;
        const inverse=new DOMMatrix(transform==='none'?undefined:transform).inverse();
        const rect=e=>{const r=e.getBoundingClientRect(),points=[[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(inverse));const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}};
        const overlaps=[...document.querySelectorAll('.app-bm-select')].filter(el=>el.scrollHeight>el.clientHeight).length;
        const outside=[...document.querySelectorAll('.app-bm-card')].filter(card=>card.scrollHeight>card.clientHeight).length;
        const speech=document.querySelector('.app-bm-speech'),monitor=document.querySelector('.app-bm-monitor-art');
        const m=rect(monitor),s=rect(speech),left=rect(stock),right=rect(merchant),p=rect(page);
        const priceOverflow=[...document.querySelectorAll('.app-bm-price-amount')].filter(e=>e.scrollWidth>e.clientWidth).length;
        const childOverlap=[...document.querySelectorAll('.app-bm-card')].filter(card=>{const children=[...card.children].map(rect);return children.some((c,i)=>i>0&&children[i-1].y+children[i-1].h>c.y+0.75)}).length;
        return {page:p,stock:left,merchant:right,stockWidth:stock.clientWidth,merchantWidth:merchant.clientWidth,portrait:rect(portrait),monitorInside:m.y+m.h<=s.y+1,leftRight:left.x+left.w<=right.x+1,sectionsInside:right.x+right.w<=p.x+p.w+1&&right.y+right.h<=p.y+p.h+1,pageOverflow:page.scrollWidth-page.clientWidth,stockOverflow:stock.scrollWidth-stock.clientWidth,overlaps,outside,priceOverflow,childOverlap,rotated:root.classList.contains('is-mobile-rot'),scrollHeight:stock.scrollHeight,clientHeight:stock.clientHeight};})()`)
      if (r.outside || r.overlaps || r.priceOverflow) {
        console.log(JSON.stringify({ layout, locale, mode, ...r, cards: await js(`[...document.querySelectorAll('.app-bm-card')].map(e=>({height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,name:e.querySelector('.app-bm-name').textContent,children:[...e.children].map(c=>({height:c.offsetHeight,scroll:c.scrollHeight}))}))`) }))
        const failedShot = await send('Page.captureScreenshot', { format: 'png' })
        await fs.writeFile(join(out, 'failed.png'), Buffer.from(failedShot.data, 'base64'))
      }
      assert.equal(r.pageOverflow, 0, `${layout}/${locale}/${mode}页面横向溢出`)
      assert.equal(r.stockOverflow, 0, '商品栏横向溢出')
      if (!r.monitorInside || !r.leftRight || !r.sectionsInside) console.log(JSON.stringify({ layout, locale, mode, ...r }))
      assert(r.monitorInside, '监视器碰到对白')
      assert(r.leftRight && r.sectionsInside, '左商品/右监视器位置或页面边界错误')
      assert.equal(r.overlaps, 0, '卡片文字重叠')
      assert.equal(r.childOverlap, 0, '卡片信息行互相重叠')
      assert.equal(r.priceOverflow, 0, '商品售价溢出')
      assert.equal(r.outside, 0, '卡片内容伸出边框')
      assert(await js(`!document.querySelector('.app-bm-card [title],.app-bm-card [data-tip],.app-bm-card-base,.app-bm-premium')`), '卡片仍有独立简易提示或基准价/倍率')
      const referenceLabel = L10N['ui.shipInfo.086']![locale as 'zh' | 'en']
      const checkPrivatePrice = async (selector: string) => assert(!String(await js(`document.querySelector(${JSON.stringify(selector)})?.textContent`)).includes(referenceLabel), '黑市详情泄露参考价')
      let hoverText = ''
      if (!mobile) {
        for (const selector of ['.app-bm-card-identity', '.app-bm-name', '.app-bm-note', '.app-bm-price']) {
          await dismissNotice()
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
          await sleep(100)
          await point(selector, 'hover')
          await until('!!document.querySelector(".app-tip .app-info-table")')
          const text = await js('document.querySelector(".app-tip").textContent')
          if (hoverText) assert.equal(text, hoverText, '卡内不同区域悬停内容不一致')
          hoverText = text
          await checkPrivatePrice('.app-tip')
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      }
      await dismissNotice()
      if (mobile) await point('.app-bm-detail-button', 'tap')
      else {
        await js(`document.querySelector('.app-bm-detail-button').focus()`)
        assert(await js('document.activeElement===document.querySelector(".app-bm-detail-button")'), '详情按钮未取得焦点')
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      }
      await sleep(100)
      if (!await js('!!document.querySelector(".app-bm-detail")')) console.log(JSON.stringify({ layout, locale, mode,
        active: await js('document.activeElement.outerHTML'), focus: await js('document.hasFocus()'), modal: await js('document.querySelector(".app-modal-mask,.app-ann-mask")?.outerHTML?.slice(0,200)') }))
      await until('!!document.querySelector(".app-bm-detail")')
      await checkPrivatePrice('.app-bm-detail')
      assert(await js('!!document.querySelector(".app-bm-detail .app-info-table")'), '主动详情未复用参数表')
      if (hoverText) assert.equal(await js('document.querySelector(".app-bm-detail .app-ship-hover-title").textContent'), goodName(ctx, stressGoods[0]!.key))
      assert(await js('document.activeElement===document.querySelector(".app-bm-detail-head button")'), '主动详情焦点未进入')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await until('!document.querySelector(".app-bm-detail")')
      assert(await js('document.activeElement===document.querySelector(".app-bm-detail-button")'), '主动详情关闭后焦点未返回')
      const monitorUncovered = await js(`(()=>{const monitor=document.querySelector('.app-bm-monitor'),r=document.querySelector('.app-bm-monitor-art').getBoundingClientRect();return [0.1,0.5,0.9].every(x=>[0.1,0.5,0.9].every(y=>monitor.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y))))})()`)
      if (!monitorUncovered) console.log(JSON.stringify({ layout, locale, mode, hits: await js(`(()=>{const r=document.querySelector('.app-bm-monitor-art').getBoundingClientRect();return [0.1,0.5,0.9].flatMap(x=>[0.1,0.5,0.9].map(y=>({x:r.left+r.width*x,y:r.top+r.height*y,hit:document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)?.outerHTML.slice(0,400)})))})()`) }))
      assert(monitorUncovered, '监视器被外部界面遮挡')
      const highestAt = stressGoods.findIndex(g => g.key === highest.key)
      assert.equal(await js(`document.querySelectorAll('.app-bm-price-amount')[${highestAt}].textContent`),
        (highest.basePrice * BLACK_MARKET_MAX_MULTIPLIER).toLocaleString('zh-CN'), '最高报价未完整展示')
      await click(`.app-bm-cardflow > :nth-child(${highestAt + 1}) .app-bm-detail-button`)
      await until('!!document.querySelector(".app-bm-detail")')
      const detailGeometry = await js(`(()=>{const e=document.querySelector('.app-bm-detail'),b=e.getBoundingClientRect(),body=e.querySelector('.app-bm-detail-body');body.scrollTop=1e6;const close=e.querySelector('button'),c=close.getBoundingClientRect(),hit=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);return {inside:b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,horizontal:e.scrollWidth-e.clientWidth,bodyHorizontal:body.scrollWidth-body.clientWidth,lastReachable:body.scrollTop+body.clientHeight>=body.scrollHeight-1,closeReachable:close===hit||close.contains(hit)}})()`)
      assert(detailGeometry.inside && detailGeometry.lastReachable && detailGeometry.closeReachable, '长详情或关闭按钮不可达')
      assert.equal(detailGeometry.horizontal, 0, '详情横向溢出')
      assert.equal(detailGeometry.bodyHorizontal, 0, '详情正文横向溢出')
      await checkPrivatePrice('.app-bm-detail')
      await point('.app-bm-detail-head button', mobile ? 'tap' : 'hover')
      if (mobile) await until('!document.querySelector(".app-bm-detail")')
      else { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await until('!document.querySelector(".app-bm-detail")') }
      await js(`document.querySelector('.app-bm-stock').scrollTop=0;true`)
      const longestAt = stressGoods.findIndex(g => g.key === longest[0]!.key)
      assert(longestAt >= 0, '最长商品名未进入边界夹具')
      await click(`.app-bm-cardflow > :nth-child(${longestAt + 1}) .app-bm-select`)
      assert.equal(await js('document.querySelector(".app-bm-picked").textContent'), goodName(ctx, longest[0]!.key), '选中后未显示完整名称')
      assert(await js('document.querySelector(".app-bm-monitor").classList.contains("is-pitch")'), '选货后对白姿态未改变')
      if ((mode === 'desktop' || mode === 'compact') && r.scrollHeight > r.clientHeight + 1) console.log(JSON.stringify({ layout, locale, mode, ...r, cards: await js(`[...document.querySelectorAll('.app-bm-card')].map(e=>({h:e.clientHeight,sh:e.scrollHeight,w:e.clientWidth}))`) }))
      if (mode === 'desktop' || mode === 'compact') assert(r.scrollHeight<=r.clientHeight+1, `${layout}/${locale}/${mode}九件未同屏`)
      if (mode === 'portrait') assert(r.rotated, '真实手机竖屏未旋转')
      assert(await js(`Math.abs(document.querySelector('.app-bm-stock').offsetWidth-document.querySelector('.app-bm-merchant').offsetWidth)<=1`), '左右非等宽')
      const signal = await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform')
      await sleep(250)
      assert.notEqual(await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform'), signal, '信号带未移动')
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(100)
      const staticFrame = await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform')
      await sleep(500)
      assert.equal(await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform'), staticFrame, '减少动效未停帧')
      assert(await js(`[...document.querySelectorAll('.app-bm-monitor *')].every(e=>getComputedStyle(e).animationName==='none')`), '减少动效仍有动画')
      await send('Emulation.setEmulatedMedia', { features: [] })
      await js(`document.body.classList.add('no-fx')`)
      await sleep(100)
      const noFxFrame = await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform')
      await sleep(500)
      assert.equal(await js('getComputedStyle(document.querySelector(".app-bm-signal-band")).transform'), noFxFrame, '设置关闭动效未停帧')
      assert(await js(`[...document.querySelectorAll('.app-bm-monitor *')].every(e=>getComputedStyle(e).animationName==='none')`), '关闭特效仍有动画')
      await js(`document.body.classList.remove('no-fx')`)
      await click('.app-bm-select')
      assert(await js('document.querySelector(".app-bm-monitor").classList.contains("is-pitch")'), '选货后未切换商人姿态')
      // 先取消再购买，验证精确报价、焦点循环、原交易实际落盘与售罄。
      await click('.app-bm-buy')
      await until('!!document.querySelector(".app-bm-confirm")')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
      assert(await js('document.activeElement === document.querySelectorAll(".app-bm-confirm-actions button")[1]'), '确认弹层焦点')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await until('!document.querySelector(".app-bm-confirm")')
      const before = await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state`)
      await click('.app-bm-buy')
      await click('.app-bm-confirm-actions button:last-child')
      await until('!!document.querySelector(".app-bm-card.is-sold")')
      await until(`JSON.parse(localStorage.getItem('whale:idle:save')).state.blackMarket.offers[0].sold`)
      const after = await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state`)
      assert.equal(before.wallet.isk - after.wallet.isk, before.blackMarket.offers[0].price)
      await dismissNotice()
      await js(`document.querySelector('.app-bm-page')?.scrollTo(0,0);true`)
      const backHit = await js(`(()=>{const e=document.querySelector('.app-bm-head > button'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(Math.max(1,r.left+r.width/2),Math.max(1,r.top+r.height/2));return {ok:r.bottom>0&&r.right>0&&(e===hit||e.contains(hit)),hit:hit?.outerHTML?.slice(0,600),button:{x:r.x,y:r.y,w:r.width,h:r.height}}})()`)
      if (!backHit.ok) console.log(JSON.stringify({ layout,locale,mode,...r,backHit }))
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(join(out, `${layout}-${locale}-${mode}.png`), Buffer.from(shot.data, 'base64'))
      assert(backHit.ok, '返回入口被其他弹层遮挡')
      await js(`document.querySelector('.app-bm-stock').scrollTop=1e6`)
      r.lastReachable = await js(`(()=>{const s=document.querySelector('.app-bm-stock'),last=document.querySelector('.app-bm-card:last-child');const children=document.querySelectorAll('.app-bm-card');const e=children[children.length-1];return s.scrollTop+s.clientHeight>=s.scrollHeight-1&&!!e})()`)
      assert(r.lastReachable, '末项不可达')
      await click('.app-bm-head > button')
      await until('!!document.querySelector(".app-mkt-search-input")')
      assert.equal(await js('document.querySelector(".app-mkt-search-input").value'), 'zzz-market-preserved', '返回丢搜索')
      await click('.app-mkt-tabs .app-bm-entry')
      await until('!!document.querySelector(".app-bm-card.is-sold")')
      await js(`document.querySelector('.app-bm-merchant').scrollTop=1e6`)
      assert(await js(`(()=>{const e=document.querySelector('.app-bm-merchant');return e.scrollTop+e.clientHeight>=e.scrollHeight-1})()`), '右栏对白末项不可达')
      await send('Page.reload')
      await until('!!document.querySelector(".app-root")')
      assert(await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.blackMarket.offers[0].sold`), '刷新售罄恢复')
      readings.push({ layout, locale, mode, ...r, highestPrice: highest.basePrice * BLACK_MARKET_MAX_MULTIPLIER,
        longestName: goodName(ctx, longest[0]!.key), animation: true, reducedMotion: true, noFx: true,
        purchased: true, savedSold: true, returnedSearch: true, merchantLastReachable: true, logOverlay, monitorUncovered,
        richHover: mobile ? '主动详情' : '四处一致', detailInput: mobile ? '触控' : '键盘', noReferencePrice: true })
      console.log(`${layout}/${locale}/${mode}通过`)
    }
    await fs.writeFile(join(out, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8')
    console.log(JSON.stringify({ ok: true, target: dist, edgePid: child.pid, cases: readings.length, out }))
  } finally {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); ws.close() }
    else child.kill()
    await new Promise<void>((r) => server.close(() => r()))
    await sleep(400)
    assert(resolve(profile).startsWith(resolve(tmpdir()) + sep) && profile.includes('whale-blackmarket-'))
    await fs.rm(profile, { recursive: true, force: true }).catch(() => console.log('独立配置待清理：' + profile))
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
