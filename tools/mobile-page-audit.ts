/**
 * 手机页面/弹层几何与主控动画窗口回归，使用合成解锁档，不读个人档。
 * 用法：npm run build --prefix web 后 npm run ui:mobile-pages。
 * 自建只读服务 4294 / 独占 CDP 9438，隔离 Edge；端口占用则停止，不连接用户浏览器。
 * 测 10 个一级页与设置/存档管理/手册，2 语言 × 2 布局 × 4 尺寸 = 208 组。
 * 另测 4 种真实开工作业 × 2 布局的最小化/还原/切导航，不把无新动画视作缺陷。
 * 输出 tools/_ui-artifacts/mobile-page-audit-20261004.json；几何是诊断，失败入口/协议/窗口契约非零。
 * 有裁切不等于已完全不可达，需要核查内滚与旋转轴；诊断不是观感或全弹层验收。
 * 版本自检：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-04 · 最后跑过 2026-10-04。
 */
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { resolve, join, sep, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { createInitialState, serializeSaveFile, FIRST_TASKS, startMining, startSalvageOp, startHauling, wormholeScanStart } from '@whale/core'
import { buildSimContext, ANNOUNCEMENTS, L10N } from '@whale/data'
const root = resolve(process.cwd()), port = 4294, cdp = 'http://127.0.0.1:9438'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
class Page {
  seq = 0
  pending = new Map<number, (v: Record<string, unknown>) => void>()
  constructor(readonly ws: WebSocket) { ws.addEventListener('message', (e) => { const v = JSON.parse(String(e.data)); this.pending.get(v.id)?.(v); this.pending.delete(v.id) }) }
  send(method: string, params: object = {}): Promise<Record<string, unknown>> {
    const id = ++this.seq
    return new Promise((r, j) => {
      const timer = setTimeout(() => { this.pending.delete(id); j(new Error('CDP 超时：' + method)) }, 15000)
      this.pending.set(id, (v) => {
        clearTimeout(timer)
        if (v.error) j(new Error(JSON.stringify(v.error)))
        else r(v)
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async js<T>(expression: string): Promise<T> { const v=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}) as { error?:unknown;result?:{exceptionDetails?:unknown;result?:{value?:T}} };if(v.error||v.result?.exceptionDetails)throw new Error(JSON.stringify(v));return v.result?.result?.value as T }
}
const measure = `(()=>{
 const root=document.querySelector('.app-root'), main=document.querySelector('.app-page-main');
 const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cw:e.clientWidth,ch:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight}};
 const cropped=[],rotated=root?.classList.contains('is-mobile-rot');
 const modalMask=[...document.querySelectorAll('.app-modal-mask,.app-ann-mask')].filter(e=>e.getBoundingClientRect().width>0).at(-1);
 for(const b of (modalMask||document).querySelectorAll('button,input,select')){
  const r=b.getBoundingClientRect();if(r.width<1||r.height<1||getComputedStyle(b).visibility==='hidden')continue;
  let p=b.parentElement;
  while(p&&p!==root){const s=getComputedStyle(p),q=p.getBoundingClientRect();
   const beyondX=rotated?(r.top<q.top-2||r.bottom>q.bottom+2):(r.left<q.left-2||r.right>q.right+2);
   const beyondY=rotated?(r.left<q.left-2||r.right>q.right+2):(r.top<q.top-2||r.bottom>q.bottom+2);
   if(((s.overflowX==='hidden'||s.overflowX==='clip')&&beyondX)||((s.overflowY==='hidden'||s.overflowY==='clip')&&beyondY)){
    cropped.push({label:b.textContent.trim().slice(0,28)||b.getAttribute('aria-label')||b.tagName,parent:p.className,box:box(b),parentBox:box(p),overflow:[s.overflowX,s.overflowY]});break}
   if(s.overflowX==='auto'||s.overflowY==='auto'||s.overflow==='scroll')break;
   p=p.parentElement}
 }
 return {viewport:[innerWidth,innerHeight],rotated:root?.classList.contains('is-mobile-rot'),root:box(root),main:box(main),
   page:box(document.querySelector('.app-page-content')),modal:box(document.querySelector('.app-modal,.app-hand-modal')),
   scale:root?.style.getPropertyValue('--mob-scale'),height:root?.style.getPropertyValue('--mob-h'),cropped:cropped.slice(0,30),count:cropped.length}
})()`
async function main() {
 const reserve=createServer();await new Promise<void>((r,j)=>{reserve.once('error',j);reserve.listen(9438,'127.0.0.1',r)});await new Promise<void>(r=>reserve.close(()=>r()));
 const server=createServer(async(req,res)=>{try{const p=resolve(root,'web/dist','.'+new URL(req.url??'/','http://127.0.0.1').pathname.replace(/\/$/,'/index.html'));assert(p.startsWith(resolve(root,'web/dist')+sep));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg'} as Record<string,string>)[extname(p)]??'application/octet-stream');res.end(await fs.readFile(p))}catch{res.statusCode=404;res.end()}})
 await new Promise<void>((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r)})
 const profile=await fs.mkdtemp(join(tmpdir(),'whale-mobile-audit-'))
 const child=spawn(process.env.WHALE_EDGE_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9438','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'})
 let launchError: Error | null = null
 child.on('error', (err) => { launchError = err })
 let ws:WebSocket|undefined
 try{
  for(let i=0;i<60;i++){try{if((await fetch(cdp+'/json/version')).ok)break}catch{}await sleep(100)}
  if (launchError) throw launchError
  assert(child.exitCode === null, '本工具浏览器未存活')
  const target=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json() as {webSocketDebuggerUrl:string}
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise<void>((r,j)=>{ws!.addEventListener('open',()=>r(),{once:true});ws!.addEventListener('error',()=>j(new Error('cdp')),{once:true})})
  const page=new Page(ws);await page.send('Page.enable');await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
  const state=createInitialState({nowWallMs:Date.now(),seed:7}),ctx=buildSimContext();state.modeChosen=true;
  for(const task of FIRST_TASKS)state.importantTasks[task.id]={done:true};
  for(const [id] of ctx.galaxies)state.exploredGalaxies.push(id)
  for(const [id] of ctx.commsMessages){(state.commsDelivered??={})[id]=1;(state.commsRead??={})[id]=true}
  state.commsPopups=[];state.wallet.isk=1000000000;
  const rows=[]
  for(const locale of ['zh','en'])for(const layout of ['classic','modern'])for(const [width,height] of [[390,844],[844,390],[320,568],[568,320]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}})
   const injection=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)})`}) as {result:{identifier:string}}
   await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'})
   for(let i=0;i<100;i++){if(await page.js<boolean>(`!!document.querySelector('.app-root')`))break;await sleep(100)}
   await sleep(700)
   const navNames=['出港','舰船','装配','物品','市场','工业','技能','任务','成就','通讯'];
   const navIds=['ui.App.001','ui.App.002','ui.App.003','ui.App.004','ui.App.005','ui.App.006','ui.App.007','ui.App.008','ui.App.119','ui.App.009'];
   for(let index=0;index<navNames.length;index++){
   const label=L10N[navIds[index]!]![locale as 'zh'|'en'];
   assert(await page.js(`(()=>{const b=[...document.querySelectorAll('.app-nav-item')].find(b=>[...b.children].some(x=>x.textContent.trim()===${JSON.stringify(label)}));if(b)b.click();return !!b})()`), '导航不存在：'+label)
    await sleep(250);rows.push({locale,layout,width,height,view:navNames[index],reading:await page.js(measure)})
   }
   for(const nav of (locale==='zh'?['设置','存档管理','手册']:['Settings','Save management','Handbook'])){
    assert(await page.js(`(()=>{const label=${JSON.stringify(nav)};const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(b)b.click();return !!b})()`), '弹层按钮不存在：'+nav)
    await sleep(250);rows.push({locale,layout,width,height,view:nav,reading:await page.js(measure)})
    if(nav==='设置'||nav==='Settings')await page.js(`document.querySelector('.app-settings-foot button.is-primary')?.click()`)
    else await page.js(`document.querySelector('.app-modal-mask')?.click()`)
    if(nav==='设置'||nav==='Settings') { await page.js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(nav)});b?.click()})()`);await sleep(100) }
   }
   // 同一静止视口下不能持续改变旋转层缩放。
   const scales:string[]=[];for(let i=0;i<4;i++){scales.push(await page.js<string>(`document.querySelector('.app-root').style.getPropertyValue('--mob-scale')`));await sleep(50)}
   assert(scales.every(v=>v===scales[0]), '静止视口缩放不稳定')
   await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.result.identifier})
  }
  const windows=[];
  for(const layout of ['classic','modern'])for(const kind of ['mine','salvage','haul','scan']){
   const s=structuredClone(state);s.debugQuick=false;
   s.skills.trained['ai-expert']=5;s.standings.dsi=100;(s.standingsEarned??={}).dsi=100;
   for(const [id,site] of ctx.stations)s.stationSites[id]={stage:site.tiers.length,delivered:{}};
   s.fleet[s.shipId]!.fitted.high=['mod-miner-1','mod-salvager-1'];
   const belt=[...ctx.belts.values()].find(b=>b.galaxyId==='galaxy-hub')!;
   const gal=[...ctx.galaxies.values()].find(g=>g.id!=='galaxy-hub')!;
   s.galaxyWrecks[gal.id]={density:100,rare:0};
   let command;
   if(kind==='mine')command=startMining(s,belt.id,ctx);
   else if(kind==='salvage')command=startSalvageOp(s,gal.id,ctx);
   else if(kind==='haul')command=startHauling(s,[...ctx.stations.keys()][0]!,[...ctx.stations.keys()][1]!,ctx);
   else command=wormholeScanStart(s,ctx);
   assert(command.ok, '合成活动开工失败：'+kind+' '+JSON.stringify(command));
   await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0}});
   const injection=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');`}) as {result:{identifier:string}};
   await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
   for(let i=0;i<100;i++){if(await page.js(`!!document.querySelector('.app-winbox.is-activity')`))break;await sleep(100)}
   assert(await page.js(`!!document.querySelector('.app-winbox.is-activity')`),'活动窗口未打开：'+kind);
   assert(await page.js(`(()=>{document.querySelector('.app-winbox-head button').click();return true})()`));await sleep(150);
   assert(!await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   assert(await page.js(`(()=>{const b=document.querySelector('.app-shipwin-wrap.is-restore');if(!b)return false;b.click();return true})()`),'还原入口不存在');
   await sleep(150);assert(await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   await page.js(`document.querySelectorAll('.app-nav-item')[1]?.click()`);await sleep(150);
   assert(!await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   assert(!await page.js(`document.querySelector('.app-page-content')?.classList.contains('is-win-hidden')`));
   windows.push({layout,kind,minimize:true,restore:true,navigationHides:true});
   await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.result.identifier});
  }
  const out=join(root,'tools/_ui-artifacts/mobile-page-audit-20261004.json');await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});await fs.writeFile(out,JSON.stringify(rows,null,2),'utf8')
  console.log(JSON.stringify({edgePid:child.pid,output:out,samples:rows.length,windows},null,2))
 }finally{ws?.close();child.kill();await new Promise<void>(r=>server.close(()=>r()));assert(resolve(profile).startsWith(resolve(tmpdir())+sep) && profile.includes('whale-mobile-audit-'));await sleep(200);await fs.rm(profile,{recursive:true,force:true}).catch(()=>console.log('隔离配置待清理：'+profile))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
