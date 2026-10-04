/**
 * 手机页面/弹层几何与主控动画窗口回归，使用合成解锁档，不读个人档。
 * 用法：npm run build --prefix web 后 npm run ui:mobile-pages。
 * 自建只读服务 4294 / 独占 CDP 9438，隔离 Edge；端口占用则停止，不连接用户浏览器。
 * 测 10 个一级页与设置/存档管理/手册，2 语言 × 2 布局 × 4 尺寸 = 208 组。
 * 另测 4 种真实开工作业 × 2 布局的最小化/还原/切导航，不把无新动画视作缺陷。
 * 日志长内容/焦点/偏好、桌面对照、页面放大/方向、出售守账与装配/技能/虫洞操作分别断言。
 * 输出 tools/_ui-artifacts/mobile-page-audit-20261004.json；几何是诊断，失败入口/协议/窗口契约非零。
 * 有裁切不等于已完全不可达，需要核查内滚与旋转轴；诊断不是观感或全弹层验收。
 * --quick 仅跑中文双布局 390竖屏/568横屏，完整验收不使用该选项。
 * --actions-only 仅调试操作弹层，不能替代完整页面、桌面与活动回归。
 * 单独操作报告输出 mobile-actions-audit-20261004.json，快速报告为 mobile-quick-audit-20261004.json，不覆盖完整页面报告。
 * --sidebars-only 测旧版图标栏、桌面日志逐帧宽度与焦点、偏好隔离和活动还原，输出 classic-sidebars-audit-20261004.json。
 * --nav-footer-only 测底部开关与上方内滚的短窗口/大字号几何，输出 classic-nav-footer-audit-20261004.json。
 * 版本自检：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-04 · 最后跑过 2026-10-04。
 */
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { resolve, join, sep, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { createInitialState, serializeSaveFile, FIRST_TASKS, startMining, startSalvageOp, startHauling, wormholeScanStart, wormholeEnter, addLog } from '@whale/core'
import { buildSimContext, ANNOUNCEMENTS, L10N, localizeCtx } from '@whale/data'
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
  async tap(selector: string, touch = true): Promise<void> {
    await this.js(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('触控目标不存在或禁用：'+${JSON.stringify(selector)}+' '+document.querySelector('.app-fit-modal')?.textContent.slice(0,500));e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
    await sleep(150)
    const point = await this.js<{ x: number; y: number; label: string }>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) throw new Error('触控目标不存在或禁用：' + ${JSON.stringify(selector)});
      const r = element.getBoundingClientRect();
      const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
      for(const fy of [0.5,0.25,0.75,0.1,0.9])for(const fx of [0.5,0.25,0.75,0.1,0.9]){
        const x=left+(right-left)*fx,y=top+(bottom-top)*fy,hit=document.elementFromPoint(x,y);
        if(right>left&&bottom>top&&hit&&(hit===element||element.contains(hit)))return {x,y,label:element.textContent.trim()};
      }
      throw new Error('触控目标无可见区域：'+${JSON.stringify(selector)}+' '+JSON.stringify({rect:r.toJSON(),ancestors:(()=>{const rows=[];let p=element.parentElement;while(p){const q=p.getBoundingClientRect(),s=getComputedStyle(p);rows.push({name:p.className,rect:q.toJSON(),overflow:s.overflow});p=p.parentElement}return rows})()}));
    })()`)
    const hitResult = await this.js<{ok:boolean;hit:string;root:string;size:number[]}>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const hit = document.elementFromPoint(${point.x}, ${point.y});
      return {ok:!!hit && (hit === element || element.contains(hit)),hit:hit?.outerHTML.slice(0,250)??'none',
        root:document.querySelector('.app-root')?.className,size:[innerWidth,innerHeight],
        navBox:(()=>{const n=element.closest('.app-nav-side');const r=n?.getBoundingClientRect();return {top:r?.top,bottom:r?.bottom,scrollTop:n?.scrollTop}})(),
        ancestors:(()=>{const rows=[];let p=element;while(p){const r=p.getBoundingClientRect(),s=getComputedStyle(p);rows.push({name:p.className,y:r.y,h:r.height,ch:p.clientHeight,sh:p.scrollHeight,top:p.scrollTop,overflow:s.overflow});p=p.parentElement}return rows})()};
    })()`)
    assert(hitResult.ok, '触控目标被遮挡：' + selector + ' ' + JSON.stringify({point,...hitResult}))
    if (touch) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] })
      await sleep(60)
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x:point.x,y:point.y,button:'left',clickCount:1 })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x:point.x,y:point.y,button:'left',clickCount:1 })
    }
    await sleep(200)
  }
  async wait(expression: string): Promise<void> {
    for (let i=0;i<100;i++) { if (await this.js<boolean>(expression)) return; await sleep(100) }
    throw new Error('页面等待超时：'+expression+' '+JSON.stringify(await this.js(`({page:document.querySelector('.app-page-content')?.dataset.page,root:document.querySelector('.app-root')?.className,modals:[...document.querySelectorAll('.app-modal-mask,.app-fit-overlay,.app-mkt-confirm-mask')].map(e=>e.textContent.slice(0,160)),text:document.querySelector('.app-page-content')?.textContent.slice(0,350)})`)))
  }
  async tapText(parent: string, text: string): Promise<void> {
    await this.js(`(()=>{
      document.querySelector('[data-audit-action]')?.removeAttribute('data-audit-action');
      const element=[...document.querySelectorAll(${JSON.stringify(parent+' button')})].find(b=>b.textContent.trim()===${JSON.stringify(text)});
      if(!element)throw new Error('操作按钮不存在：'+${JSON.stringify(text)});
      element.setAttribute('data-audit-action','target');
    })()`)
    await this.tap('[data-audit-action="target"]')
    if(parent==='.app-nav-side'){
      const ids=['ui.App.001','ui.App.002','ui.App.003','ui.App.004','ui.App.005','ui.App.006','ui.App.007','ui.App.008','ui.App.119','ui.App.009'];
      const keys=['map','ship','fit','items','market','industry','skills','task','achieve','comms'];
      const index=ids.findIndex(id=>L10N[id]!.zh===text||L10N[id]!.en===text);assert(index>=0);
      await this.wait(`document.querySelector('.app-page-content')?.dataset.page===${JSON.stringify(keys[index])}`);
    }
  }
  async checkModal(selector: string): Promise<object> {
    const result=await this.js<{within:boolean;w:number;h:number;scroll:boolean}>(`(()=>{
      const element=document.querySelector(${JSON.stringify(selector)}), r=element.getBoundingClientRect();
      const root=document.querySelector('.app-root').getBoundingClientRect();
      return {within:r.left>=root.left-2&&r.top>=root.top-2&&r.right<=root.right+2&&r.bottom<=root.bottom+2,
        w:element.clientWidth,h:element.clientHeight,scroll:element.scrollHeight>element.clientHeight};
    })()`)
    assert(result.within,'操作弹层超出可见范围：'+selector+' '+JSON.stringify(result))
    return result
  }
}
const measure = `(()=>{
 const root=document.querySelector('.app-root'), main=document.querySelector('.app-page-main');
 const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cw:e.clientWidth,ch:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight}};
 const cropped=[],rotated=root?.classList.contains('is-mobile-rot');
 const modalMask=[...document.querySelectorAll('.app-modal-mask,.app-ann-mask')].filter(e=>e.getBoundingClientRect().width>0).at(-1);
 for(const b of (modalMask||document).querySelectorAll('button,input,select')){
  if(b.closest('.app-log-side.is-collapsed'))continue;
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
   usableMain:box(document.querySelector('.app-workspace-body')||main),
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
  for(let i=0;i<240;i++)addLog(state,'system',L10N['core.state.025']!.zh,'core.state.025');
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});localStorage.setItem('whale-idle:log-prefs',JSON.stringify({collapsed:false,filter:'all'}));`});
  for(const task of FIRST_TASKS)state.importantTasks[task.id]={done:true};
  for(const [id] of ctx.galaxies)state.exploredGalaxies.push(id)
  for(const [id] of ctx.commsMessages){(state.commsDelivered??={})[id]=1;(state.commsRead??={})[id]=true}
  state.commsPopups=[];state.wallet.isk=1000000000;
  const saleItemId='ore-veldspar';assert(ctx.items.has(saleItemId),'测试原矿须存在于真实目录');
  state.warehouse.items[saleItemId]=10000;
  for(const [id,mod] of ctx.modules) if(!mod.unreleased) state.moduleBay[id]=2;
  const rows=[]
  const quick = process.argv.includes('--quick')
  const actionsOnly = process.argv.includes('--actions-only')
  const navFooterOnly = process.argv.includes('--nav-footer-only')
  const sidebarsOnly = process.argv.includes('--sidebars-only') || navFooterOnly
  const drawerChecks: object[] = []
  for(const locale of (actionsOnly || sidebarsOnly ? [] : quick ? ['zh'] : ['zh','en']))for(const layout of ['classic','modern'])for(const [width,height] of (quick ? [[390,844],[568,320]] : [[390,844],[844,390],[320,568],[568,320]])){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}})
   const injection=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(ANNOUNCEMENTS[0]!.id)});localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:log-prefs',JSON.stringify({collapsed:false,filter:'all'}))`}) as {result:{identifier:string}}
   await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'})
   for(let i=0;i<100;i++){if(await page.js<boolean>(`!!document.querySelector('.app-root')`))break;await sleep(100)}
   await sleep(700)
   const navNames=['出港','舰船','装配','物品','市场','工业','技能','任务','成就','通讯'];
   const navIds=['ui.App.001','ui.App.002','ui.App.003','ui.App.004','ui.App.005','ui.App.006','ui.App.007','ui.App.008','ui.App.119','ui.App.009'];
   const pageKeys=['map','ship','fit','items','market','industry','skills','task','achieve','comms'];
   for(let index=0;index<navNames.length;index++){
   const label=L10N[navIds[index]!]![locale as 'zh'|'en'];
   const selector = await page.js<string>(`(()=>{const buttons=[...document.querySelectorAll('.app-nav-item')];const index=buttons.findIndex(b=>[...b.children].some(x=>x.textContent.trim()===${JSON.stringify(label)}));if(index<0)throw new Error('导航不存在');buttons[index].setAttribute('data-mobile-audit-nav','target');return '[data-mobile-audit-nav="target"]'})()`)
   await page.tap(selector)
   await page.js(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-mobile-audit-nav')`)
   assert.equal(await page.js(`document.querySelector('.app-page-content')?.dataset.page`), pageKeys[index], '真实触控未切到目标页')
    await sleep(250);rows.push({locale,layout,width,height,view:navNames[index],reading:await page.js(measure)})
    if(locale==='zh'&&width===568&&pageKeys[index]==='ship'){
      const shot=await page.send('Page.captureScreenshot',{format:'png'}) as {result:{data:string}};
      await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});
      await fs.writeFile(join(root,'tools/_ui-artifacts',`mobile-shell-${layout}-568-ship.png`),Buffer.from(shot.result.data,'base64'));
    }
   }
   const pref = await page.js<string>(`localStorage.getItem('whale-idle:log-prefs')`)
   const before = await page.js<{w:number;h:number}>(`(()=>{const r=(document.querySelector('.app-workspace-body')||document.querySelector('.app-page-main')).getBoundingClientRect();return {w:r.width,h:r.height}})()`)
   assert.equal(await page.js(`!!document.querySelector('.app-log-dock.is-open')`), false, '手机日志不应默认展开')
   await page.tap('.app-mobile-log-toggle')
   assert.equal(await page.js(`!!document.querySelector('.app-log-dock.is-open')`), true, '日志按钮未打开抽屉')
   const after = await page.js<{w:number;h:number}>(`(()=>{const r=(document.querySelector('.app-workspace-body')||document.querySelector('.app-page-main')).getBoundingClientRect();return {w:r.width,h:r.height}})()`)
   assert(Math.abs(before.w-after.w)<1 && Math.abs(before.h-after.h)<1, '抽屉挤压主区')
   await page.tap('.app-log-head-right button')
   assert.equal(await page.js(`!!document.querySelector('.app-log-dock.is-open')`), false, '抽屉关闭失败')
   assert(await page.js(`document.activeElement===document.querySelector('.app-mobile-log-toggle')`),'关闭抽屉未返回入口焦点')
   await page.tap('.app-mobile-log-toggle')
   assert(await page.js(`document.activeElement===document.querySelector('.app-log-side')`),'抽屉打开未获得焦点')
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
   await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
   assert(await page.js(`document.querySelector('.app-log-side').contains(document.activeElement)`),'Tab 焦点逃出抽屉')
   await page.tap('.app-log-filter:nth-child(2)')
   assert(await page.js(`!document.querySelector('.app-log-filter:nth-child(2)').classList.contains('is-off')`),'日志筛选未激活')
   await page.tap('.app-log-filter:first-child')
   await page.js(`(()=>{const body=document.querySelector('.app-log-side .wui-panel-body');body.scrollTop=body.scrollHeight})()`)
   assert(await page.js(`document.querySelector('.app-log-side .wui-panel-body').scrollTop>0`),'长日志不能内部滚动')
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
   await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
   await page.wait(`!document.querySelector('.app-log-dock.is-open')`)
   await page.tap('.app-mobile-log-toggle');await page.tap('.app-mobile-log-mask')
   assert(!await page.js(`!!document.querySelector('.app-log-dock.is-open')`),'遮罩未关闭抽屉')
   assert.equal(await page.js(`localStorage.getItem('whale-idle:log-prefs')`), pref, '手机抽屉污染桌面偏好')
   drawerChecks.push({ locale,layout,width,height,defaultClosed:true,noLayoutShift:true,touchToggle:true,focusReturn:true,tabContained:true,filter:true,escape:true,backdrop:true,desktopPreferenceUnchanged:true })
   for(const nav of (locale==='zh'?['设置','存档管理','手册']:['Settings','Save management','Handbook'])){
    await page.tapText(nav==='存档管理'||nav==='Save management'?'.app-settings-modal':'.app-header-right',nav)
    await sleep(250);rows.push({locale,layout,width,height,view:nav,reading:await page.js(measure)})
    if(nav==='设置'||nav==='Settings')await page.tap('.app-settings-foot button.is-primary')
    else if(nav==='手册'||nav==='Handbook')await page.tapText('.app-hand-modal .app-modal-head',L10N['ui.App.086']![locale as 'zh'|'en'])
    else await page.tapText('.app-modal .app-modal-head',L10N['ui.App.086']![locale as 'zh'|'en'])
    if(nav==='设置'||nav==='Settings') { await page.tapText('.app-header-right',nav);await sleep(100) }
   }
   // 同一静止视口下不能持续改变旋转层缩放。
   const scales:string[]=[];for(let i=0;i<4;i++){scales.push(await page.js<string>(`document.querySelector('.app-root').style.getPropertyValue('--mob-scale')`));await sleep(50)}
   assert(scales.every(v=>v===scales[0]), '静止视口缩放不稳定')
   await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.result.identifier})
   console.log('页面与日志完成：'+JSON.stringify({locale,layout,width,height}));
  }
  const desktopChecks: object[]=[];
  for(const layout of (actionsOnly||sidebarsOnly?[]:['classic','modern']))for(const collapsed of [false,true]){
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,screenWidth:1280,screenHeight:800,deviceScaleFactor:1,mobile:false,screenOrientation:{type:'landscapePrimary',angle:90}});
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');localStorage.setItem('whale-idle:log-prefs',${JSON.stringify(JSON.stringify({collapsed,filter:'all'}))});`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-root')`);await sleep(300);
    const desktop=await page.js(measure);
    assert(!await page.js(`document.querySelector('.app-root').classList.contains('is-mobile-layout')`),'桌面误用手机外壳');
    assert(!await page.js(`!!document.querySelector('.app-mobile-log-toggle')`),'桌面多出手机日志入口');
    assert.equal(await page.js(`document.querySelector('.app-log-side').classList.contains('is-collapsed')`),collapsed);
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width:568,height:320,screenWidth:568,screenHeight:320,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'landscapePrimary',angle:90}});
    await page.wait(`!!document.querySelector('.app-mobile-log-toggle')`);await page.tap('.app-mobile-log-toggle');
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,screenWidth:1280,screenHeight:800,deviceScaleFactor:1,mobile:false,screenOrientation:{type:'landscapePrimary',angle:90}});
    await page.wait(`!document.querySelector('.app-mobile-log-toggle')`);
    assert.equal(await page.js(`document.querySelector('.app-log-side').classList.contains('is-collapsed')`),collapsed,'手机打开日志覆盖了桌面偏好');
    await sleep(350);
    const returned=await page.js<{usableMain:{cw:number;ch:number}}>(measure),before=desktop as {usableMain:{cw:number;ch:number}};
    assert(Math.abs(returned.usableMain.cw-before.usableMain.cw)<1&&Math.abs(returned.usableMain.ch-before.usableMain.ch)<1,'切回桌面后主区尺寸未还原：'+JSON.stringify({layout,collapsed,before,returned}));
    desktopChecks.push({layout,collapsed,desktop,mobileToDesktop:true});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
    console.log('桌面对照完成：'+JSON.stringify({layout,collapsed}));
  }
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const viewportChecks: object[]=[];
  for(const layout of (actionsOnly||sidebarsOnly?[]:['classic','modern'])){
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');`}) as {result:{identifier:string}};
    const metrics={width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0}};
    await page.send('Emulation.setDeviceMetricsOverride',metrics);
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`document.querySelector('.app-root')?.classList.contains('is-mobile-rot')`);await sleep(300);
    const readScale=`(()=>{const r=document.querySelector('.app-root');return [r.style.getPropertyValue('--mob-scale'),r.style.getPropertyValue('--mob-h')]})()`;
    const before=await page.js(readScale);
    await page.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await sleep(350);
    assert((await page.js<number>('visualViewport.scale'))>1.05,'浏览器未进入页面放大态');
    assert.deepEqual(await page.js(readScale),before,'页面放大导致旋转层二次缩小');
    await page.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await sleep(350);
    await page.send('Emulation.setDeviceMetricsOverride',{...metrics,height:300});await sleep(350);
    assert(await page.js(`document.querySelector('.app-root').classList.contains('is-mobile-rot')`),'模拟键盘缩高改变物理方向判据');
    await page.send('Emulation.setDeviceMetricsOverride',{...metrics,width:844,height:390,screenWidth:844,screenHeight:390,screenOrientation:{type:'landscapePrimary',angle:90}});await sleep(350);
    assert(await page.js(`document.querySelector('.app-root').classList.contains('is-mobile-layout')&&!document.querySelector('.app-root').classList.contains('is-mobile-rot')`),'转横屏外壳状态错误');
    await page.send('Emulation.setDeviceMetricsOverride',metrics);await sleep(350);
    assert.deepEqual(await page.js(readScale),before,'转回竖屏尺寸未恢复');
    viewportChecks.push({layout,pageZoomFrozen:true,simulatedKeyboardKeepsOrientation:true,rotationRestored:true});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
  }
  const windows=[];
  for(const layout of (actionsOnly||sidebarsOnly?[]:['classic','modern']))for(const kind of ['mine','salvage','haul','scan']){
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
   await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0}});
   const injection=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');`}) as {result:{identifier:string}};
   await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
   for(let i=0;i<100;i++){if(await page.js(`!!document.querySelector('.app-winbox.is-activity')`))break;await sleep(100)}
   assert(await page.js(`!!document.querySelector('.app-winbox.is-activity')`),'活动窗口未打开：'+kind);
   await page.tap('.app-winbox-head button');
   assert(!await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   await page.tap('.app-shipwin-wrap.is-restore');
   await sleep(150);assert(await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   await page.tapText('.app-nav-side',L10N['ui.App.002']!.zh);
   assert(!await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
   assert(!await page.js(`document.querySelector('.app-page-content')?.classList.contains('is-win-hidden')`));
   windows.push({layout,kind,minimize:true,restore:true,navigationHides:true});
   await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.result.identifier});
  }
  const modalChecks: object[]=[];
  for(const locale of (sidebarsOnly?[]:quick?['zh']:['zh','en']))for(const layout of ['classic','modern'])for(const [width,height] of (quick?[[568,320]]:[[320,568],[568,320]])){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:view:items','grid');`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-root')`);await sleep(250);
    const t=(id:string)=>L10N[id]![locale as 'zh'|'en'];
    // 装配换装：关闭键和候选滚动区必须真实可达。
    await page.tapText('.app-nav-side',t('ui.App.003'));
    await page.wait(`!!document.querySelector('.app-fit-slot-icon.is-empty')`);
    await page.tap('.app-fit-slot-icon.is-empty');await page.wait(`!!document.querySelector('.app-fit-modal')`);
    const fitting=await page.checkModal('.app-fit-modal');
    assert(await page.js(`(()=>{const grid=document.querySelector('.app-fit-pickgrid');return grid.scrollHeight>grid.clientHeight})()`),'合成候选不足以验证滚动');
    await page.js(`(()=>{const grid=document.querySelector('.app-fit-pickgrid');grid.scrollTop=grid.scrollHeight})()`);
    assert(await page.js(`document.querySelector('.app-fit-pickgrid').scrollTop>0`),'装配候选滚动失效');
    await page.tap('.app-fit-modal-head button');assert(!await page.js(`!!document.querySelector('.app-fit-modal')`));
    // 物品图标详情 → 数量出售：触摸输入与确认，真实引擎库存应减少。
    await page.tapText('.app-nav-side',t('ui.App.004'));
    await page.wait(`!!document.querySelector('.app-hand-cell')`);
    const saleItemName=localizeCtx(ctx,locale as 'zh'|'en').items.get(saleItemId)!.name;
    await page.js(`(()=>{const cell=[...document.querySelectorAll('.app-hand-cell')].find(c=>c.querySelector('.app-hand-cell-name')?.textContent===${JSON.stringify(saleItemName)});if(!cell)throw new Error('测试物品不存在');cell.setAttribute('data-audit-item','ore')})()`);
    await page.tap('[data-audit-item="ore"]');await page.wait(`!!document.querySelector('.app-fit-modal.is-narrow')`);
    const item=await page.checkModal('.app-fit-modal');
    await page.tapText('.app-itempick-actions',t('ui.CargoPage.038'));
    await page.wait(`!!document.querySelector('.app-sellqty-row input')`);
    const quantity=await page.checkModal('.app-fit-modal');await page.tap('.app-sellqty-row input');
    await page.send('Input.insertText',{text:'1'});
    assert.equal(await page.js(`document.querySelector('.app-sellqty-row input').value`),'1','触控输入数量未更新');
    await page.tap('.app-itempick-actions button.is-primary');await page.wait(`!document.querySelector('.app-sellqty-row')`);
    await page.wait(`JSON.parse(localStorage.getItem('whale:idle:save')).state.warehouse.items[${JSON.stringify(saleItemId)}]===9999`);
    const afterSale=await page.js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state;return {qty:s.warehouse.items[${JSON.stringify(saleItemId)}],isk:s.wallet.isk}})()`);
    // 市场搜索定位同一货物，出售全部先取消，不应改账。
    await page.tapText('.app-nav-side',t('ui.App.005'));
    await page.wait(`!!document.querySelector('.app-mkt-search-input')`);await page.tap('.app-mkt-search-input');
    await page.send('Input.insertText',{text:saleItemName});await page.wait(`!!document.querySelector('.app-mkt-row-click')`);
    await page.tap('.app-mkt-row-click .app-inv-name');await page.wait(`!!document.querySelector('.app-mkt-detail-modal')`);
    const market=await page.checkModal('.app-mkt-detail-modal');
    await page.tap('.app-mkt-side.is-sell');await page.tap('.app-mkt-actions .is-sellall');await page.wait(`!!document.querySelector('.app-mkt-confirm')`);
    const confirmation=await page.checkModal('.app-mkt-confirm');await page.tap('.app-mkt-confirm-btns button');
    assert(!await page.js(`!!document.querySelector('.app-mkt-confirm')`));
    assert.deepEqual(await page.js(`(()=>{const s=JSON.parse(localStorage.getItem('whale:idle:save')).state;return {qty:s.warehouse.items[${JSON.stringify(saleItemId)}],isk:s.wallet.isk}})()`),afterSale,'取消交易改动账目');
    await page.tap('.app-mkt-detail-modal .app-modal-head button');
    // 技能列表详情。
    await page.tapText('.app-nav-side',t('ui.App.007'));
    await page.wait(`!!document.querySelector('.app-hand-viewbtn')`);
    await page.tapText('.app-hand-viewbar',locale==='zh'?'列表':'List');
    await page.wait(`!!document.querySelector('.app-skill-row .app-linklike')`);await page.tap('.app-skill-row .app-linklike');
    await page.wait(`!!document.querySelector('.app-skilltree-modal')`);const skill=await page.checkModal('.app-skilltree-modal');
    await page.tap('.app-skilltree-modal .app-modal-head button');
    modalChecks.push({locale,layout,width,height,fitting,item,quantity,market,confirmation,skill,touchConfirmed:true});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
    console.log('操作弹层完成：'+JSON.stringify({locale,layout,width,height}));
  }
  const wormholeChecks: object[]=[];
  for(const layout of (sidebarsOnly?[]:['classic','modern']))for(const [width,height] of [[320,568],[568,320]]){
    const s=structuredClone(state);s.standings.dsi=100;(s.standingsEarned??={}).dsi=100;
    const entered=wormholeEnter(s,ctx,[s.shipId,'sh-falconet'],20261004);assert(entered.ok,JSON.stringify(entered));
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-root')`);await sleep(250);
    await page.js(`(()=>{const row=[...document.querySelectorAll('.app-activitybar-item')].find(r=>r.classList.contains('is-wormhole')||r.textContent.includes('虫洞探索'));if(!row)throw new Error('虫洞活动入口不存在');row.setAttribute('data-audit-wh','entry')})()`);
    await page.tap('[data-audit-wh="entry"]');await page.wait(`!!document.querySelector('.app-wh-modal')`);
    const wh=await page.checkModal('.app-wh-modal');
    await page.tap('.app-wh-tabbar button:nth-child(2)');
    await page.tapText('.app-wh-modal > .app-modal-head',L10N['ui.Wormhole.015']!.zh);
    wormholeChecks.push({layout,width,height,...wh,closeReachable:true});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
  }
  const fitExtras: object[]=[];
  for(const layout of (sidebarsOnly?[]:['classic','modern']))for(const [width,height] of [[320,568],[568,320]]){
    const s=structuredClone(state);s.shipId='sh-falconet';assert(s.fleet[s.shipId]);
    const droneHull=[...ctx.ships.values()].find(ship=>!ship.unreleased&&(ship.droneBayM3??0)>0)!;assert(droneHull);
    s.fleet[s.shipId]!.defId=droneHull.id;
    for(const [id,item] of ctx.items)if(item.kind==='drone'&&!item.unreleased)s.warehouse.items[id]=10;
    s.fitPresets={[s.fleet[s.shipId]!.defId??s.shipId]:Array.from({length:10},(_,i)=>({name:'audit-'+i,fitted:{high:['mod-turret-kin-1'],mid:[],low:[]}}))};
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))});localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:locale','zh');`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-root')`);await sleep(250);
    await page.tapText('.app-nav-side',L10N['ui.App.003']!.zh);
    await page.tap('.app-fit-preset-bar button.is-primary');await page.wait(`!!document.querySelector('.app-fit-preset-modal')`);
    const preset=await page.checkModal('.app-fit-preset-modal');
    await page.tap('.app-fit-preset-item:last-child .app-fit-preset-row button');
    await page.tap('.app-fit-preset-modal .app-fit-modal-head button');
    await page.tap('.app-fit-drone-add');await page.wait(`!!document.querySelector('.app-fit-drone-modal')`);
    const drone=await page.checkModal('.app-fit-drone-modal');
    await page.tap('.app-fit-drone-qty .app-btn');await page.wait(`!document.querySelector('.app-fit-drone-modal')`);
    await page.wait(`Object.values(JSON.parse(localStorage.getItem('whale:idle:save')).state.fleet['sh-falconet'].droneLoad??{}).some(n=>n>0)`);
    fitExtras.push({layout,width,height,preset,drone,closeAndLoadReachable:true});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
  }
  const sidebarChecks: object[]=[];
  if(sidebarsOnly&&!navFooterOnly)for(const locale of ['zh','en'])for(const [width,height,mobile] of [[1280,800,false],[1024,768,false],[390,844,true],[568,320,true]] as const){
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});
    const s=structuredClone(state);s.fleet[s.shipId]!.fitted.high=['mod-miner-1'];
    const unreadId=[...ctx.commsMessages.keys()][0]!;s.commsRead![unreadId]=false;
    const belt=[...ctx.belts.values()].find(b=>b.galaxyId==='galaxy-hub')!;assert(startMining(s,belt.id,ctx).ok);
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))});localStorage.setItem('whale-idle:layout','classic');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.removeItem('whale-idle:classic-nav-prefs');`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-classic-nav-toggle')`);await sleep(350);
    assert(!await page.js(`document.querySelector('.app-nav-side').classList.contains('is-compact')`));
    await page.tap('.app-classic-nav-toggle',mobile);
    const nav=await page.js<{width:number;labelsHidden:boolean}>(`(()=>{const n=document.querySelector('.app-nav-side');return {width:n.offsetWidth,labelsHidden:[...n.querySelectorAll('.app-nav-label')].every(e=>getComputedStyle(e).display==='none')}})()`);
    assert.equal(nav.width,56);assert(nav.labelsHidden);
    assert(await page.js(`!!document.querySelector('.app-nav-item[data-nav-page="comms"] .app-nav-badge')`),'收窄丢失未读徽标');
    await page.tap('.app-winbox-head button',mobile);await page.wait(`!!document.querySelector('.app-classic-restore')`);
    await page.tap('.app-classic-restore',mobile);assert(await page.js(`!!document.querySelector('.app-winbox.is-activity')`));
    for(const key of ['map','ship','fit','items','market','industry','skills','task','achieve','comms']){
      const selector=`.app-nav-item[data-nav-page="${key}"]`;
      assert(await page.js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});return !!b.getAttribute('aria-label')&&!!(b.getAttribute('title')||b.getAttribute('data-tip-native'))})()`),'图标名称或悬停缺失：'+key);
      await page.tap(selector,mobile);await page.wait(`document.querySelector('.app-page-content')?.dataset.page===${JSON.stringify(key)}`);
      assert(await page.js(`document.querySelector(${JSON.stringify(selector)}).classList.contains('is-active')`));
    }
    const pref=await page.js<string>(`localStorage.getItem('whale-idle:classic-nav-prefs')`);
    assert.deepEqual(JSON.parse(pref),{desktop:!mobile,mobile});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
    const carry=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(s,Date.now()))})`}) as {result:{identifier:string}};
    await page.send('Page.reload');await page.wait(`!!document.querySelector('.app-nav-side.is-compact')`);
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:carry.result.identifier});
    const nextMobile=!mobile;
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:nextMobile,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width:nextMobile?568:1280,height:nextMobile?320:800,screenWidth:nextMobile?568:1280,screenHeight:nextMobile?320:800,deviceScaleFactor:1,mobile:nextMobile,screenOrientation:{type:'landscapePrimary',angle:90}});
    await sleep(400);assert(!await page.js(`document.querySelector('.app-nav-side').classList.contains('is-compact')`),'设备偏好串用');
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});await sleep(400);
    assert(await page.js(`!!document.querySelector('.app-nav-side.is-compact')`));
    if(!mobile){
      await page.js(`(()=>{const body=document.querySelector('.app-log-side .wui-panel-body');body.scrollTop=123;window.auditScroll=body.scrollTop;document.querySelector('.app-log-head-right button').focus();window.auditPanel=document.querySelector('.app-log-side .wui-panel');window.auditFrames=[];document.querySelector('.app-log-head-right button').addEventListener('click',()=>{const begin=performance.now();const sample=()=>{const e=document.querySelector('.app-log-side'),p=e.querySelector('.wui-panel'),line=e.querySelector('.wui-log-item');window.auditFrames.push({side:e.clientWidth,panel:p.clientWidth,lineHeight:line.clientHeight,main:document.querySelector('.app-page-main').clientWidth,opacity:parseFloat(getComputedStyle(e).opacity),closed:e.classList.contains('is-collapsed')});if(performance.now()-begin<300)requestAnimationFrame(sample)};requestAnimationFrame(sample)},{once:true})})()`);
      assert((await page.js<number>('window.auditScroll'))>0,'必须用真实长日志验证滚动保留');
      await page.tap('.app-log-head-right button',false);await page.wait(`!!document.querySelector('.app-log-side.is-collapsed')`);await sleep(120);
      const frames=await page.js<Array<{side:number;panel:number;lineHeight:number;main:number;opacity:number;closed:boolean}>>('window.auditFrames');
      assert(frames.length>5);assert(frames.every(f=>f.panel===frames[0]!.panel),'日志正文被压缩');
      assert(frames.every(f=>f.lineHeight===frames[0]!.lineHeight),'日志文字行高发生重排');
      assert.equal(new Set(frames.map(f=>f.main)).size,2,'主区应只在开/关两个宽度间切换');
      assert(frames.every(f=>f.side===320||f.side===0),'日志占位连续变化');assert(frames.some(f=>f.opacity>0&&f.opacity<1),'没有淡出中间帧');
      assert(await page.js(`document.querySelector('.app-log-side').inert&&document.activeElement===document.querySelector('.app-log-handle')`),'隐藏日志未退出焦点');
      await page.tap('.app-log-handle',false);await sleep(200);
      assert(await page.js(`window.auditPanel===document.querySelector('.app-log-side .wui-panel')&&window.auditScroll===document.querySelector('.app-log-side .wui-panel-body').scrollTop`),'日志组件或滚动位置重置');
      await page.tap('.app-log-filter:nth-child(2)',false);await page.tap('.app-log-head-right button',false);
      await page.wait(`!!document.querySelector('.app-log-side.is-collapsed')`);await page.tap('.app-log-handle',false);
      assert(await page.js(`!document.querySelector('.app-log-filter:nth-child(2)').classList.contains('is-off')`),'收起重置日志筛选');
      await page.tap('.app-log-filter:first-child',false);
      await page.js(`document.querySelector('.app-classic-nav-toggle').focus()`);
      assert(await page.js(`document.activeElement===document.querySelector('.app-classic-nav-toggle')`),'导航开关未获得键盘焦点');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await page.wait(`!document.querySelector('.app-nav-side.is-compact')`);
      assert.equal(await page.js(`getComputedStyle(document.querySelector('.app-nav-item')).transitionProperty`),'color, background-color, border-color','展开继承尺寸动画');
      await page.tap('.app-classic-nav-toggle',false);
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(100);
      await page.tap('.app-log-head-right button',false);assert(await page.js(`document.querySelector('.app-log-side').classList.contains('is-collapsed')`));
      assert.equal(await page.js(`getComputedStyle(document.querySelector('.app-log-side')).transitionDuration`),'0s');
      await page.tap('.app-log-handle',false);await page.send('Emulation.setEmulatedMedia',{features:[]});
      await page.js(`document.body.classList.add('no-fx')`);await sleep(100);
      await page.tap('.app-log-head-right button',false);assert(await page.js(`document.querySelector('.app-log-side').classList.contains('is-collapsed')`));
      assert.equal(await page.js(`getComputedStyle(document.querySelector('.app-log-side')).transitionDuration`),'0s');
      await page.tap('.app-log-handle',false);await page.js(`document.body.classList.remove('no-fx')`);
      sidebarChecks.push({locale,width,height,mobile,nav,preferencesSeparate:true,restore:true,navigation:true,keyboardToggle:true,filterKept:true,frames,scrollKept:true,hiddenInert:true,reducedMotion:true,noFx:true});
    }else sidebarChecks.push({locale,width,height,mobile,nav,preferencesSeparate:true,restore:true,navigation:true});
    const shot=await page.send('Page.captureScreenshot',{format:'png'}) as {result:{data:string}};
    await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});await fs.writeFile(join(root,'tools/_ui-artifacts',`classic-sidebar-${locale}-${width}.png`),Buffer.from(shot.result.data,'base64'));
    console.log('旧版侧栏完成：'+JSON.stringify({locale,width,height,mobile}));
  }
  const footerChecks: object[]=[];
  if(navFooterOnly)for(const locale of ['zh','en'])for(const [width,height,mobile,fontScale] of [[390,844,true,1],[320,568,true,1.25],[568,320,true,1.25],[1280,800,false,1],[1024,600,false,1],[1024,400,false,1],[800,300,false,1],[1024,400,false,1.25]] as const){
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile,screenOrientation:{type:width<height?'portraitPrimary':'landscapePrimary',angle:width<height?0:90}});
    const seed=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('whale:idle:save',${JSON.stringify(serializeSaveFile(state,Date.now()))});localStorage.setItem('whale-idle:layout','classic');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.removeItem('whale-idle:classic-nav-prefs');localStorage.setItem('whale-idle:ui-fs',${JSON.stringify(String(fontScale))});`}) as {result:{identifier:string}};
    await page.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await page.wait(`!!document.querySelector('.app-classic-nav-scroll')`);await sleep(300);
    await page.js(`document.documentElement.style.setProperty('--ui-fs',${JSON.stringify(String(fontScale))})`);
    if(fontScale>1)await page.js(`(()=>{for(const b of document.querySelectorAll('#classic-navigation .app-nav-item'))b.style.fontSize=(parseFloat(getComputedStyle(b).fontSize)*${fontScale})+'px'})()`);
    if(height===800){
      const before=await page.js<{height:number;padding:number;ship:number}>(`(()=>{const n=document.querySelector('#classic-navigation');return {height:n.clientHeight,padding:parseFloat(getComputedStyle(n.querySelector('[data-nav-page="ship"]')).paddingTop),ship:n.querySelector('.app-shipwin').clientHeight}})()`);
      await page.js(`document.querySelector('.app-header').style.minHeight='280px'`);await sleep(100);
      const squeezed=await page.js<{height:number;padding:number;ship:number}>(`(()=>{const n=document.querySelector('#classic-navigation');return {height:n.clientHeight,padding:parseFloat(getComputedStyle(n.querySelector('[data-nav-page="ship"]')).paddingTop),ship:n.querySelector('.app-shipwin').clientHeight}})()`);
      assert(squeezed.height<before.height&&squeezed.padding<before.padding,'导航没有按实际剩余高度收紧留白');assert.equal(squeezed.ship,before.ship,'顶部占高变化压扁了舰船预览');
      await page.js(`document.querySelector('.app-header').style.removeProperty('min-height')`);await sleep(100);
    }
    const checks=[];
    for(const compact of [false,true]){
      if(compact)await page.tap('.app-classic-nav-toggle',mobile);
      await page.js(`(()=>{const s=document.querySelector('.app-classic-nav-scroll');s.scrollTop=0;document.querySelector('.app-nav-item[data-nav-page="ship"]').scrollIntoView({block:'nearest',behavior:'instant'})})()`);await sleep(100);
      const initial=await page.js<{footer:number[];toggle:number[];item:number[];scroll:number[];shipH:number;navH:number;itemH:number;font:number;iconH:number}>(`(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
        const n=document.querySelector('#classic-navigation'),s=n.querySelector('.app-classic-nav-scroll'),b=n.querySelector('[data-nav-page="ship"]');
        return {footer:box(n.querySelector('.app-classic-nav-footer')),toggle:box(n.querySelector('.app-classic-nav-toggle')),item:box(b),scroll:box(s),navH:n.clientHeight,shipH:n.querySelector('.app-shipwin').clientHeight,itemH:b.offsetHeight,font:parseFloat(getComputedStyle(b).fontSize),iconH:b.querySelector('.app-nav-icon').offsetHeight};
      })()`);
      // 几何以屏幕矩形验证等宽；旋转后宽对应物理高度，逻辑按钮仍以offsetHeight判不变形。
      const axis=width<height?1:0,extent=axis+2;
      assert(Math.abs(initial.toggle[axis]!-initial.item[axis]!)<2&&Math.abs(initial.toggle[extent]!-initial.item[extent]!)<2,'开关与导航项未对齐：'+JSON.stringify({locale,width,height,compact,initial}));
      assert(initial.itemH>=44||(!mobile&&!compact&&initial.itemH>=initial.iconH+10),'导航项被压扁');
      if(fontScale>1&&!compact)assert(initial.font>=(mobile?15:18),'导航字体放大未实际生效');
      if(compact)assert.equal(initial.itemH,44);
      if(!compact)assert(initial.shipH>0,'展开舰船预览消失');
      if(!compact){
        const cropped=await page.js(`(()=>{return [...document.querySelectorAll('#classic-navigation .app-nav-item')].flatMap(b=>{const e=b.querySelector('.app-nav-label'),r=e.getBoundingClientRect(),q=b.getBoundingClientRect();return e.offsetHeight<=b.clientHeight&&e.scrollWidth<=e.clientWidth+1&&r.left>=q.left-1&&r.right<=q.right+1&&r.top>=q.top-1&&r.bottom<=q.bottom+1?[]:[{label:e.textContent,rect:r.toJSON(),button:q.toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}]})})()`);
        assert.deepEqual(cropped,[],'展开导航有名称被裁切：'+JSON.stringify({locale,width,height,fontScale,cropped}));
      }
      await page.js(`(()=>{const s=document.querySelector('.app-classic-nav-scroll');s.scrollTop=s.scrollHeight})()`);await sleep(100);
      const after=await page.js<{footer:number[];navScroll:number;scrollTop:number;scrollable:boolean;lastVisible:boolean;footerFits:boolean;toggleH:number;heldFocus:boolean}>(`(()=>{
        const n=document.querySelector('#classic-navigation'),s=n.querySelector('.app-classic-nav-scroll'),footer=n.querySelector('.app-classic-nav-footer'),button=n.querySelector('.app-classic-nav-toggle'),last=n.querySelector('[data-nav-page="comms"]');
        last.focus();const f=footer.getBoundingClientRect(),r=last.getBoundingClientRect(),q=s.getBoundingClientRect(),b=button.getBoundingClientRect(),v=n.getBoundingClientRect();
        return {footer:[f.x,f.y,f.width,f.height],navScroll:n.scrollTop,scrollTop:s.scrollTop,scrollable:s.scrollHeight>s.clientHeight,lastVisible:r.left>=q.left-1&&r.right<=q.right+1&&r.top>=q.top-1&&r.bottom<=q.bottom+1,footerFits:b.left>=v.left&&b.right<=v.right+1&&b.top>=v.top&&b.bottom<=v.bottom+1,toggleH:button.offsetHeight,heldFocus:document.activeElement===last};
      })()`);
      assert.deepEqual(after.footer,initial.footer,'滚动移动了底部控制区');assert.equal(after.navScroll,0,'外层导航仍在滚动');assert(after.lastVisible&&after.heldFocus,'末项焦点被底栏遮挡：'+JSON.stringify({locale,width,height,compact,after}));
      assert(after.footerFits);assert.equal(after.toggleH,44);
      if(height<=400&&!mobile)assert(after.scrollable&&after.scrollTop>0,'短窗口必须内滚，不能压扁按钮');
      if(!compact)assert(await page.js(`(()=>{const e=document.querySelector('[data-nav-page="comms"] .app-nav-label'),b=e.closest('button');return e.offsetHeight<=b.clientHeight&&e.scrollWidth<=e.clientWidth+1})()`),'放大后的导航文字被裁切');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert(await page.js(`document.activeElement===document.querySelector('.app-classic-nav-toggle')`),'末项Tab没有到达底部开关');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
      assert(await page.js(`document.activeElement===document.querySelector('[data-nav-page="comms"]')`),'反向Tab没有回到末项');
      await page.tap('.app-nav-item[data-nav-page="comms"]',mobile);await page.wait(`document.querySelector('.app-page-content')?.dataset.page==='comms'`);
      checks.push({compact,initial,after});
      if(!compact){
        const shot=await page.send('Page.captureScreenshot',{format:'png'}) as {result:{data:string}};await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});await fs.writeFile(join(root,'tools/_ui-artifacts',`classic-nav-footer-expanded-${locale}-${width}-${height}-${fontScale}.png`),Buffer.from(shot.result.data,'base64'));
      }
    }
    // 底部开关本身不随内部滚动丢失，连续两次切换后状态应稳定。
    await page.tap('.app-classic-nav-toggle',mobile);await page.tap('.app-classic-nav-toggle',mobile);assert(await page.js(`!!document.querySelector('#classic-navigation.is-compact')`));
    const shot=await page.send('Page.captureScreenshot',{format:'png'}) as {result:{data:string}};await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});await fs.writeFile(join(root,'tools/_ui-artifacts',`classic-nav-footer-${locale}-${width}-${height}-${fontScale}.png`),Buffer.from(shot.result.data,'base64'));
    footerChecks.push({locale,width,height,mobile,fontScale,checks});await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.result.identifier});
    console.log('底部开关完成：'+JSON.stringify({locale,width,height,mobile,fontScale}));
  }
  const out=join(root,navFooterOnly?'tools/_ui-artifacts/classic-nav-footer-audit-20261004.json':sidebarsOnly?'tools/_ui-artifacts/classic-sidebars-audit-20261004.json':`tools/_ui-artifacts/mobile-${actionsOnly?'actions':quick?'quick':'page'}-audit-20261004.json`);await fs.mkdir(join(root,'tools/_ui-artifacts'),{recursive:true});await fs.writeFile(out,JSON.stringify({rows,windows,drawerChecks,desktopChecks,viewportChecks,modalChecks,wormholeChecks,fitExtras,sidebarChecks,footerChecks},null,2),'utf8')
  const narrow=rows.filter(r=>r.width===568 && r.layout==='classic' && r.view==='舰船');
  for (const row of narrow) {
    const reading = row.reading as {usableMain?:{cw:number}; count:number}
    assert((reading.usableMain?.cw??0)>=350, '手机主区仍被挤占：'+JSON.stringify(row));
    assert.equal(reading.count,0,'舰船页仍有不可滚动裁切');
  }
  console.log(JSON.stringify({edgePid:child.pid,output:out,samples:rows.length,windows,drawerChecks,desktopChecks,viewportChecks,modalChecks,wormholeChecks,fitExtras,sidebarChecks,footerChecks},null,2))
 }finally{ws?.close();child.kill();await new Promise<void>(r=>server.close(()=>r()));assert(resolve(profile).startsWith(resolve(tmpdir())+sep) && profile.includes('whale-mobile-audit-'));await sleep(200);await fs.rm(profile,{recursive:true,force:true}).catch(()=>console.log('隔离配置待清理：'+profile))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
