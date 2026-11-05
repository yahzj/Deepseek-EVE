const {app,BrowserWindow}=require('electron'); const fs=require('fs'); const path=require('path'); const assert=require('assert/strict');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1600,height:900,webPreferences:{offscreen:true,nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});try{
await win.loadURL('data:text/html,<html><body style="margin:0"><div id="root"></div></body></html>');
await win.webContents.executeJavaScript(fs.readFileSync(process.argv[2],'utf8'));
await new Promise(r=>setTimeout(r,100));
const js=s=>win.webContents.executeJavaScript(s); const wait=ms=>new Promise(r=>setTimeout(r,ms));
assert.equal(await js('document.querySelectorAll(".ex-simple-side-tab").length'),2);
assert.equal(await js('document.querySelector(".ex-simple-side-tab[aria-selected=true]").textContent'),'理财与基金');
const before=await js('document.querySelector(".ex-simple-chart-section").getBoundingClientRect().height');win.setSize(1600,1200);await wait(100);assert.equal(await js('document.querySelector(".ex-simple-chart-section").getBoundingClientRect().height'),before);
await js('fixture.setMode("pro")');await wait(100);win.setSize(1600,900);await wait(100);
const geometry='({chart:document.querySelector(".ex-pro-chart-wrap").getBoundingClientRect().height,list:document.querySelector(".ex-pro-mid-bottom").getBoundingClientRect().height})';const pro=await js(geometry);win.setSize(1600,1200);await wait(100);const expanded=await js(geometry);assert.equal(pro.chart,expanded.chart);assert.ok(expanded.list>pro.list);
console.log(JSON.stringify({result:'PASS',simpleHeight:before,pro,expanded}));}catch(e){console.error(e);process.exitCode=1}finally{win.destroy();app.exit(process.exitCode||0)}});