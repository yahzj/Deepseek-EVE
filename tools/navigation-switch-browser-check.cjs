/** 导航切换耗时检查：先构建桌面产物，再运行 node tools/navigation-switch-browser-check.cjs。
 * 独立无头 Chrome 和全新合成档，比较真实挂载与完全可见耗时，不读取个人档。
 * --assert 检查正常切换不从透明淡入；输出 tools/_ui-artifacts/nav-switch/readings.json。
 * 浏览器渲染读数不等同于桌面实机性能或观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { sleep, settingsScript, staticServer, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const root = path.resolve(__dirname, '..')
const prefix = 'whale-nav-switch-'
const output = path.join(root, 'tools/_ui-artifacts/nav-switch')

async function parent() {
  require('tsx/cjs')
  const { blackMarketTestSave } = require('./black-market-test-fixture.ts')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let child, timer, hosted, socket
  try {
    const save=blackMarketTestSave()
    hosted=await staticServer(path.join(root,'apps/desktop/out/renderer'))
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--no-first-run','--disable-background-timer-throttling','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    console.log('owned Chrome PID', child.pid)
    timer = setTimeout(() => child.kill(), 120000)
    let debug
    for(let i=0;i<100;i++){try{debug=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8');break}catch{await sleep(100)}}
    assert(debug)
    const target=await(await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`,{method:'PUT'})).json()
    socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
    const connection=new CdpConnection(socket), page=new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable');await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false})
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('whale:idle:save'))localStorage.setItem('whale:idle:save',${JSON.stringify(save)})`})
    await page.send('Page.navigate',{url:hosted.url})
    await measure(page)
  } finally {
    clearTimeout(timer)
    socket?.close()
    if (child && child.exitCode === null && child.signalCode === null) { const exit=once(child,'exit');child.kill();await exit }
    if(hosted)await new Promise(resolve=>hosted.server.close(resolve))
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith(prefix))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

async function measure(page) {
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
    const js = expression => page.js(expression)
    const wait = async expression => { for(let i=0;i<150;i++){if(await js(expression))return;await sleep(100)}throw Error(expression) }
    await wait('!!document.querySelector(".app-root")')
    fs.mkdirSync(output, {recursive:true})
    const results = []
    for (const layout of ['classic','modern']) {
      await js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { layout, debug:false, test:false }))
      await page.send('Page.reload');await sleep(600)
      await wait('!!document.querySelector(".app-root")')
      await dismissOverlays(page)
      for(const noFade of [false,true]) {
        await js(`document.getElementById('nav-no-fade')?.remove();${noFade ? "const s=document.createElement('style');s.id='nav-no-fade';s.textContent='.app-page-content{animation:none!important}';document.head.append(s);" : ''}`)
        for(const target of ['skills','market','task','industry','ship','skills','market','task','industry','ship']) {
          const label={skills:'技能',market:'市场',task:'任务中心',industry:'工业',ship:'舰船'}[target]
          const result = await js(`new Promise(resolve=>{
            const button=document.querySelector('[data-nav-page="${target}"]')??[...document.querySelectorAll('.app-nav-item')].find(b=>b.textContent.trim()===${JSON.stringify(label)});
            if(!button){resolve({target:'${target}',missing:true});return}
            const start=performance.now();let commit=null,firstOpacity=null;
            const observer=new MutationObserver(()=>{const el=document.querySelector('.app-page-content');if(el?.dataset.page==='${target}'&&commit===null)commit=performance.now()-start});
            observer.observe(document.querySelector('.app-root'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-page']});
            button.click();
            const frame=()=>{const el=document.querySelector('.app-page-content');if(el?.dataset.page==='${target}'){
              const opacity=Number(getComputedStyle(el).opacity);if(firstOpacity===null)firstOpacity=opacity;
              if(opacity>=0.99){observer.disconnect();resolve({target:'${target}',commitMs:commit,visibleMs:performance.now()-start,firstOpacity,animation:getComputedStyle(el).animationName});return}
            }if(performance.now()-start>3000){observer.disconnect();resolve({target:'${target}',timeout:true,page:el?.dataset.page});return}requestAnimationFrame(frame)};requestAnimationFrame(frame)
          })`)
          results.push({layout,noFade,...result})
          console.log(JSON.stringify(results.at(-1)))
          assert(!result.missing && !result.timeout, `navigation did not complete: ${layout}/${target}`)
          if(process.argv.includes('--assert') && !noFade) {
            assert.equal(result.firstOpacity, 1, 'navigation starts transparent')
            assert.equal(result.animation, 'none', 'navigation waits for entry animation')
          }
          await sleep(100)
        }
      }
    }
    fs.writeFileSync(path.join(output,'readings.json'),JSON.stringify(results,null,2))
}
parent().catch(error=>{console.error(error);process.exitCode=1})
