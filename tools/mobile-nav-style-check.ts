/** 手机导航样式回归：真实生成CSS + 外壳结构夹具，比较计算尺寸并记录触摸滚动。
 * 用法：npx tsx tools/mobile-nav-style-check.ts。独立无头Edge/临时浏览器配置，不加载个人档。
 * 输出tools/_ui-artifacts/mobile-nav-style/*.png与读数；不替代完整游戏或真机观感验收。
 */
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strict as assert } from 'node:assert'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const root = process.cwd()
const profile = mkdtempSync(join(tmpdir(), 'whale-nav-'))
const out = join(root, 'tools/_ui-artifacts/mobile-nav-style')
mkdirSync(out, { recursive: true })
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
let ws: WebSocket | undefined
let seq = 0
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>()
function send(method: string, params: object = {}): Promise<any> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws!.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression: string): Promise<any> {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
async function main() {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await pause(100)
  assert(existsSync(portFile), '独立浏览器未启动')
  const port = readFileSync(portFile, 'utf8').split('\n')[0]!
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
  ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { ws!.addEventListener('open', () => resolve()); ws!.addEventListener('error', () => reject(new Error('CDP连接失败'))) })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)), waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)))
    else waiter.resolve(msg.result)
  })
  await send('Page.enable')
  const tokens = readFileSync(join(root, 'packages/ui/src/index.css'), 'utf8')
  const readings: object[] = []
  for (const layout of ['classic','modern']) {
    const css = readFileSync(join(root, `apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`), 'utf8')
    // 夹具保留导航滚动区、底部开关、现代左列及150px活动栏，制造足够多的导航/作业条目。
    const buttonRows = Array.from({ length: 12 }, (_, i) => `<button class="app-nav-item${i === 0 ? ' is-featured' : ''}"><span class="app-nav-icon">+</span><span class="app-nav-label">${['出港','舰船','装配','物品','市场','工业','技能','任务中心','通讯'][i % 9]}</span></button>`)
    const buttons = buttonRows.join('')
    const modernNav = `<nav class="app-nav-side"><div class="app-nav-group is-left">${buttonRows.slice(1,7).join('')}</div>${buttonRows[0]}<div class="app-nav-group is-right">${buttonRows.slice(7).join('')}</div></nav>`
    const classic = `<nav id="classic-navigation" class="app-nav-side"><div class="app-classic-nav-scroll">${buttons}</div><div class="app-classic-nav-footer"><button class="app-classic-nav-toggle">+</button></div></nav><main class="app-page-main"><section>主窗口</section></main>`
    const modern = `<div class="app-left-col"><div class="app-shipwin">舰船</div><section class="app-activitybar">${Array.from({ length: 25 }, (_, i) => `<div style="flex:0 0 44px">作业${i}</div>`).join('')}</section></div><div class="app-workspace-body"><main class="app-page-main">主窗口</main></div>`
    let desktop: any
    for (const mode of ['desktop','landscape','portrait']) {
      const mobile = mode !== 'desktop', rotated = mode === 'portrait'
      const w = rotated ? 390 : mobile ? 844 : 1366, h = rotated ? 844 : mobile ? 390 : 768
      const logicalH = rotated ? 1200 * 390 / 844 : h
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
      const html = `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}\n${css}</style></head><body><div class="app-root is-layout-${layout}${mobile ? ' is-mobile-layout' : ''}${rotated ? ' is-mobile-rot' : ''}" style="--mob-w:1200px;--mob-h:${logicalH}px;--mob-scale:${844 / 1200};--mob-y:844px"><header class="app-header">测试外壳</header><div class="app-workspace">${layout === 'classic' ? classic : modern}</div>${layout === 'modern' ? modernNav : ''}</div></body></html>`
      const { frameTree } = await send('Page.getFrameTree')
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
      await pause(200)
      const r = await evaluate(`(() => {
        const side=document.querySelector('${layout === 'classic' ? '#classic-navigation' : '.app-left-col'}'), main=document.querySelector('main'), scroll=document.querySelector('${layout === 'classic' ? '.app-classic-nav-scroll' : '.app-activitybar'}');
        const nav=document.querySelector('.app-nav-item'), style=getComputedStyle(nav);
        return {sideWidth:side.offsetWidth, sideRight:side.offsetLeft+side.offsetWidth,mainLeft:main.offsetLeft+${layout === 'modern' ? 'main.parentElement.offsetLeft' : '0'},navWidth:nav.offsetWidth,font:style.fontSize,direction:style.flexDirection,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,overflow:getComputedStyle(scroll).overflowY};
      })()`)
      if (!mobile) desktop = r
      else {
        assert.equal(r.sideWidth, desktop.sideWidth, `${layout}/${mode}左栏宽度不同`)
        assert.equal(r.navWidth, desktop.navWidth, `${layout}/${mode}导航项宽度不同`)
        assert.equal(r.font, desktop.font)
        assert.equal(r.direction, desktop.direction)
        const geometry = await evaluate(`(() => {const s=document.querySelector('${layout === 'classic' ? '#classic-navigation' : '.app-left-col'}'),m=document.querySelector('main');return ${rotated ? 's.getBoundingClientRect().top>=m.getBoundingClientRect().bottom-1' : 's.getBoundingClientRect().right<=m.getBoundingClientRect().left+1'};})()`)
        assert(geometry, `${layout}/${mode}左栏与主区相交`)
        const rect = await evaluate(`(() => {const r=document.querySelector('${layout === 'classic' ? '.app-classic-nav-scroll' : '.app-activitybar'}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`)
        r.hit = await evaluate(`document.elementFromPoint(${rect.x},${rect.y})?.className`)
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] })
        for (let i = 1; i <= 8; i++) {
          await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x - (rotated ? i * 8 : 0), y: rect.y - (!rotated ? i * 8 : 0) }] })
          await pause(25)
        }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await pause(300)
        r.scrolled = await evaluate(`document.querySelector('${layout === 'classic' ? '.app-classic-nav-scroll' : '.app-activitybar'}').scrollTop`)
        if (!rotated) assert(r.scrolled > 0, `${layout}/${mode}触摸未滚动`)
        // 旋转层的原生手势只记录，不以程序设置scrollTop替代触摸成功结论。
        const reachable = await evaluate(`(() => {const s=document.querySelector('${layout === 'classic' ? '.app-classic-nav-scroll' : '.app-activitybar'}');s.scrollTop=s.scrollHeight;return s.scrollTop>0;})()`)
        assert(reachable, `${layout}/${mode}滚动区域无法到达末项`)
        r.lastReachable = reachable
      }
      readings.push({ layout, mode, ...r })
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(out, `${layout}-${mode}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
  console.log(JSON.stringify(readings, null, 2))
  writeFileSync(join(out, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8')
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }))
    ws.close()
  } else edge.kill()
})
