/** 黑市真实构建浏览器回归。用法：npm run build --prefix web；npx tsx tools/black-market-browser-check.ts。
 * 自建随机端口只读服务、独立无头Edge临时配置、全新合成档，不访问个人档。
 * 检查两版/双语/桌面/手机横竖屏几何与交易、返回、售罄落盘、ASCII帧和减少动效。
 * 输出tools/_ui-artifacts/black-market截图和readings.json；不代替真机观感验收。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { ANNOUNCEMENTS } from '@whale/data'
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
    await send('Page.navigate', { url })
    await until('document.readyState === "complete"')
    const readings: any[] = []
    for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mode of ['desktop', 'landscape', 'portrait']) {
      const width = mode === 'portrait' ? 390 : mode === 'landscape' ? 844 : 1600
      const height = mode === 'portrait' ? 844 : mode === 'landscape' ? 390 : 900
      await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: mode !== 'desktop',
        screenOrientation: { type: mode === 'portrait' ? 'portraitPrimary' : 'landscapePrimary', angle: mode === 'portrait' ? 0 : 90 } })
      await send('Emulation.setUserAgentOverride', { userAgent: mode === 'desktop'
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      await send('Emulation.setTouchEmulationEnabled', { enabled: mode !== 'desktop', maxTouchPoints: 5 })
      const save = blackMarketTestSave()
      // 新文档启动前注入，避免旧引擎的pagehide保存覆写合成档。
      const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();localStorage.setItem('whale:idle:save',${JSON.stringify(save)});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});` })
      await send('Page.reload')
      await sleep(700)
      await until('!!document.querySelector(".app-root")')
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
      await until(`!!document.querySelector('[data-nav-page="market"]')||[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(locale === 'zh' ? '市场' : 'Market')})`)
      assert(await js(`(()=>{const b=document.querySelector('[data-nav-page="market"]')??[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(locale === 'zh' ? '市场' : 'Market')});if(!b)return false;b.click();return true})()`), '市场入口')
      await until('!!document.querySelector(".app-bm-entry button")')
      await js(`(()=>{const el=document.querySelector('.app-mkt-search-input');if(!el)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'zzz-market-preserved');el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await click('.app-bm-entry button')
      await until('document.querySelectorAll(".app-bm-card").length === 9')
      await sleep(250)
      const r = await js(`(()=>{
        const page=document.querySelector('.app-bm-page'),stock=document.querySelector('.app-bm-stock'),merchant=document.querySelector('.app-bm-merchant'),pre=document.querySelector('.app-bm-portrait pre');
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
        const overlaps=[...document.querySelectorAll('.app-bm-select')].filter(el=>el.scrollHeight>el.clientHeight).length;
        const preInside=pre.offsetHeight<=document.querySelector('.app-bm-portrait').clientHeight;
        const outside=[...document.querySelectorAll('.app-bm-card')].filter(card=>card.scrollHeight>card.clientHeight).length;
        return {page:rect(page),stock:rect(stock),merchant:rect(merchant),stockWidth:stock.clientWidth,merchantWidth:merchant.clientWidth,portrait:rect(pre),preInside,pageOverflow:page.scrollWidth-page.clientWidth,stockOverflow:stock.scrollWidth-stock.clientWidth,preOverflow:pre.scrollWidth-pre.clientWidth,overlaps,outside,rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot'),rows:pre.textContent.split('\\n').length,cols:[...new Set(pre.textContent.split('\\n').map(l=>l.length))],scrollHeight:stock.scrollHeight,clientHeight:stock.clientHeight};})()`)
      if (r.outside || r.overlaps) {
        console.log(JSON.stringify({ layout, locale, mode, ...r, cards: await js(`[...document.querySelectorAll('.app-bm-card')].map(e=>({height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,name:e.querySelector('.app-bm-name').textContent,children:[...e.children].map(c=>({height:c.offsetHeight,scroll:c.scrollHeight}))}))`) }))
        const failedShot = await send('Page.captureScreenshot', { format: 'png' })
        await fs.writeFile(join(out, 'failed.png'), Buffer.from(failedShot.data, 'base64'))
      }
      assert.equal(r.pageOverflow, 0, `${layout}/${locale}/${mode}页面横向溢出`)
      assert.equal(r.stockOverflow, 0, '商品栏横向溢出')
      assert.equal(r.preOverflow, 0, 'ASCII列溢出')
      assert(r.preInside, 'ASCII立绘碰到对白')
      assert.equal(r.overlaps, 0, '卡片文字重叠')
      assert.equal(r.outside, 0, '卡片内容伸出边框')
      if (mode === 'portrait') assert(r.rotated, '真实手机竖屏未旋转')
      assert(await js(`Math.abs(document.querySelector('.app-bm-stock').offsetWidth-document.querySelector('.app-bm-merchant').offsetWidth)<=1`), '左右非等宽')
      assert.equal(r.rows, 17); assert.deepEqual(r.cols, [36])
      const frame = await js('document.querySelector(".app-bm-portrait pre").textContent')
      await until(`document.querySelector('.app-bm-portrait pre').textContent!==${JSON.stringify(frame)}`)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(100)
      const staticFrame = await js('document.querySelector(".app-bm-portrait pre").textContent')
      await sleep(500)
      assert.equal(await js('document.querySelector(".app-bm-portrait pre").textContent'), staticFrame, '减少动效未停帧')
      await send('Emulation.setEmulatedMedia', { features: [] })
      await js(`document.body.classList.add('no-fx')`)
      await sleep(100)
      const noFxFrame = await js('document.querySelector(".app-bm-portrait pre").textContent')
      await sleep(500)
      assert.equal(await js('document.querySelector(".app-bm-portrait pre").textContent'), noFxFrame, '设置关闭动效未停帧')
      await js(`document.body.classList.remove('no-fx')`)
      const oldSpeech = await js('document.querySelector(".app-bm-speech").textContent')
      await click('.app-bm-select')
      assert.notEqual(await js('document.querySelector(".app-bm-speech").textContent'), oldSpeech)
      // 先取消再购买，验证精确报价、焦点循环、原交易实际落盘与售罄。
      await click('.app-bm-card > .app-btn')
      await until('!!document.querySelector(".app-bm-confirm")')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
      assert(await js('document.activeElement === document.querySelectorAll(".app-bm-confirm-actions button")[1]'), '确认弹层焦点')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await until('!document.querySelector(".app-bm-confirm")')
      const before = await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state`)
      await click('.app-bm-card > .app-btn')
      await click('.app-bm-confirm-actions button:last-child')
      await until('!!document.querySelector(".app-bm-card.is-sold")')
      await until(`JSON.parse(localStorage.getItem('whale:idle:save')).state.blackMarket.offers[0].sold`)
      const after = await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state`)
      assert.equal(before.wallet.isk - after.wallet.isk, before.blackMarket.offers[0].price)
      assert(await js(`(()=>{const e=document.querySelector('.app-bm-head > button'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e===hit||e.contains(hit)})()`), '返回入口被其他弹层遮挡')
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(join(out, `${layout}-${locale}-${mode}.png`), Buffer.from(shot.data, 'base64'))
      await js(`document.querySelector('.app-bm-stock').scrollTop=1e6`)
      r.lastReachable = await js(`(()=>{const s=document.querySelector('.app-bm-stock'),last=document.querySelector('.app-bm-card:last-child');const children=document.querySelectorAll('.app-bm-card');const e=children[children.length-1];return s.scrollTop+s.clientHeight>=s.scrollHeight-1&&!!e})()`)
      assert(r.lastReachable, '末项不可达')
      await click('.app-bm-head > button')
      await until('!!document.querySelector(".app-mkt-search-input")')
      assert.equal(await js('document.querySelector(".app-mkt-search-input").value'), 'zzz-market-preserved', '返回丢搜索')
      await click('.app-bm-entry button')
      await until('!!document.querySelector(".app-bm-card.is-sold")')
      await js(`document.querySelector('.app-bm-merchant').scrollTop=1e6`)
      assert(await js(`(()=>{const e=document.querySelector('.app-bm-merchant');return e.scrollTop+e.clientHeight>=e.scrollHeight-1})()`), '右栏对白末项不可达')
      await send('Page.reload')
      await until('!!document.querySelector(".app-root")')
      assert(await js(`JSON.parse(localStorage.getItem('whale:idle:save')).state.blackMarket.offers[0].sold`), '刷新售罄恢复')
      readings.push({ layout, locale, mode, ...r, animation: true, reducedMotion: true, noFx: true, purchased: true, savedSold: true, returnedSearch: true, merchantLastReachable: true })
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
