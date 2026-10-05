/** 逐炮齐射真实网页构建检查，独立Edge/随机端口/合成战斗档，不访问个人档。
 * 用法：先npm run build --prefix web，再npx tsx tools/per-gun-browser-check.ts。
 * 检查双布局与手机旋转、弹道DOM确实生成，实际引擎落盘显示逐炮同轮事件与部分命中。
 * 输出tools/_ui-artifacts/per-gun-browser/*.png与readings.json，不替代船长观感验收。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05 · 最后跑过2026-10-05。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { ANNOUNCEMENTS } from '@whale/data'
import { perGunTestSave } from './per-gun-test-fixture'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let ws: WebSocket | undefined, seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
function send(method: string, params: object = {}): Promise<any> {
  const id = ++seq
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })) })
}
async function js(expression: string) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
async function until(expression: string) {
  for (let i = 0; i < 100; i++) { if (await js(expression)) return; await sleep(100) }
  throw new Error('等待超时：' + expression + '\n' + await js('document.body.innerText.slice(0,1000)'))
}
async function main() {
  const dist = resolve('web/dist'), out = resolve('tools/_ui-artifacts/per-gun-browser')
  await fs.mkdir(out, { recursive: true })
  const server = createServer(async (req,res) => {
    try {
      const file = resolve(dist, '.' + new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/,'/index.html'))
      assert(file.startsWith(dist+sep))
      const types: Record<string,string> = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.jpg':'image/jpeg' }
      res.setHeader('Content-Type',types[extname(file)] ?? 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.statusCode=404;res.end() }
  })
  await new Promise<void>((r,j) => { server.once('error',j);server.listen(0,'127.0.0.1',r) })
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/`
  const profile = await fs.mkdtemp(join(tmpdir(),'whale-pergun-'))
  const child = spawn(process.env.WHALE_EDGE_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
    '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'})
  try {
    let port=''
    for(let i=0;i<100;i++) { try {port=(await fs.readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]!}catch{} if(port)break;await sleep(100) }
    assert(port&&child.exitCode===null)
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
    ws=new WebSocket(pages.find((p)=>p.type==='page').webSocketDebuggerUrl)
    await new Promise<void>((r,j)=>{ws!.addEventListener('open',()=>r(),{once:true});ws!.addEventListener('error',()=>j(new Error('CDP连接失败')),{once:true})})
    ws.addEventListener('message',(ev)=>{const m=JSON.parse(String(ev.data)),w=pending.get(m.id);if(!w)return;pending.delete(m.id);if(m.error)w.reject(new Error(JSON.stringify(m.error)));else w.resolve(m.result)})
    await send('Page.enable');await send('Page.navigate',{url});await until('document.readyState==="complete"')
    const readings: object[]=[]
    for(const layout of ['classic','modern']) for(const mobile of [false,true]) {
      const width=mobile?390:1366,height=mobile?844:768
      await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile,screenOrientation:{type:mobile?'portraitPrimary':'landscapePrimary',angle:mobile?0:90}})
      await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5})
      const save=perGunTestSave()
      const inject=await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();localStorage.setItem('whale:idle:save',${JSON.stringify(save)});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(layout==='classic'?'zh':'en')});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});`})
      await send('Page.reload');await sleep(600);await until('!!document.querySelector(".app-root")')
      await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:inject.identifier})
      if(await js('!!document.querySelector(".app-battle-float")'))await js('document.querySelector(".app-battle-float").click()')
      await until('!!document.querySelector(".app-battle-screen:not(.is-report)")')
      await js(`window.__boltMax=0;window.__bolts=new MutationObserver(()=>window.__boltMax=Math.max(window.__boltMax,document.querySelectorAll('.app-bts-bolt').length));window.__bolts.observe(document.body,{subtree:true,childList:true});true`)
      await sleep(6000)
      assert(await js('window.__boltMax>1'),'没有多炮弹道DOM')
      await js(`window.dispatchEvent(new Event('pagehide'));true`)
      await sleep(300)
      const r=await js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state,b=s.expedition.battle;return {boltMax:window.__boltMax,rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot'),stats:b?.stats,fx:b?.fx??[],screen:document.querySelector('.app-battle-screen').getBoundingClientRect().toJSON()}})()`)
      assert(r.stats.meShots>0&&r.stats.foeShots>0,'双方未真正开火')
      if(mobile)assert(r.rotated,'手机旋转未生效')
      const groups=new Map<string,any[]>()
      for(const event of r.fx.filter((e:any)=>!e.web&&!e.blink&&!e.droneDown)) {
        const key=`${event.side}:${event.tag}:${event.atMs}`
        const list=groups.get(key)??[];list.push(event);groups.set(key,list)
      }
      assert([...groups.values()].some((g)=>g.length>=3),'引擎落盘未保留同轮多炮')
      const shot=await send('Page.captureScreenshot',{format:'png'})
      await fs.writeFile(join(out,`${layout}-${mobile?'portrait':'desktop'}.png`),Buffer.from(shot.data,'base64'))
      readings.push({layout,mobile,boltMax:r.boltMax,rotated:r.rotated,stats:r.stats,sameCycleMaximum:Math.max(...[...groups.values()].map(g=>g.length)),screen:r.screen})
      console.log(layout+'/'+(mobile?'portrait':'desktop')+'通过')
    }
    await fs.writeFile(join(out,'readings.json'),JSON.stringify(readings,null,2),'utf8')
    console.log(JSON.stringify({ok:true,edgePid:child.pid,target:dist,out,cases:readings.length}))
  } finally {
    if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({id:++seq,method:'Browser.close'}));ws.close()}else child.kill()
    await new Promise<void>(r=>server.close(()=>r()));await sleep(400)
    assert(resolve(profile).startsWith(resolve(tmpdir())+sep)&&profile.includes('whale-pergun-'))
    await fs.rm(profile,{recursive:true,force:true}).catch(()=>console.log('独立配置待清理：'+profile))
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
