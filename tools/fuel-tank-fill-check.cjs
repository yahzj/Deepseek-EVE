/** 燃料罐真组件像素读数，不加载个人档。
 * 用法：node tools/fuel-tank-fill-check.cjs。
 * 自建隐藏Electron，宽/窄视口、不同罐高与库存比例；PNG和JSON输出到tools/_ui-artifacts/fuel-tank-fill-20261017。
 * 本工具验证填充比例与非空像素，不代替观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { build } = require('esbuild')
const { stopOwned, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/fuel-tank-fill-20261017')

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{FuelTank}from'../apps/desktop/src/renderer/src/ui/FuelTank';
    const values=[0,.25,.5,.75,1,1.2];
    const cap=Number(new URLSearchParams(location.search).get('cap'))||60000;
    const height=Number(new URLSearchParams(location.search).get('height'))||320;
    createRoot(document.getElementById('root')).render(<>{values.map(r=><section data-ratio={r}><FuelTank units={cap*r} capacity={cap} height={height} width={48} label={String(r)}/></section>)}</>);`,
    loader: 'tsx', resolveDir: path.join(ROOT, 'tools') }, bundle: true, write: true,
    outfile: path.join(OUT, 'probe.js'), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await fs.copyFile(path.join(ROOT, 'packages/ui/src/index.css'), path.join(OUT, 'ui.css'))
  await fs.writeFile(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"><style>body{margin:0;background:#080d13}#root{display:flex;gap:8px;padding:8px}.wave-a,.wave-b{animation:none}</style><div id="root"></div><script src="./probe.js"></script>')
  let child, timer
  try {
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true,
      stdio: 'inherit', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) })
    console.log(`燃料罐自建隐藏Electron PID=${child.pid}`)
    timer = setTimeout(() => child.kill(), 60000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
  } finally { clearTimeout(timer); await stopOwned(child) }
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(OUT, 'isolated-profile'))
  await app.whenReady()
  const win = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { backgroundThrottling: false } })
  win.setMinimumSize(200, 200)
  const reports = [], errors = []
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
  for (const width of [800, 390]) for (const height of [140, 320, 600]) for (const cap of [60000, 135000]) {
    win.setContentSize(width, 700)
    await win.loadFile(path.join(OUT, 'index.html'), { query: { height: String(height), cap: String(cap) } })
    await sleep(150)
    const boxes = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('section'),el=>({ratio:Number(el.dataset.ratio),box:el.querySelector('svg').getBoundingClientRect().toJSON()}))`)
    assert.equal(boxes.length, 6)
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty())
    const { width: iw, height: ih } = image.getSize()
    const bytes = image.toBitmap()
    const pixel = (x, y) => { const i = (Math.round(y) * iw + Math.round(x)) * 4; return [...bytes.subarray(i, i + 3)] }
    const base = boxes[0].box
    for (const item of boxes) {
      const b = item.box
      assert(b.right <= iw && b.bottom <= ih, '罐体超出视口')
      let filled = 0, count = 0
      for (let localY = 18; localY < height - 12; localY++) {
        const p = pixel(b.x + 26, b.y + localY), empty = pixel(base.x + 26, base.y + localY)
        const diff = p.reduce((n, value, i) => n + Math.abs(value - empty[i]), 0)
        if (diff > 45) filled++
        count++
      }
      const actual = filled / count, target = Math.min(1, item.ratio)
      assert(Math.abs(actual - target) < .045, `填充比例错误:${width}/${height}/${cap}/${target}:${actual}`)
      reports.push({ width, height, cap, target, pixelFill: actual })
    }
    await fs.writeFile(path.join(OUT, `${width}-${height}-${cap}.png`), image.toPNG())
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ pid: process.pid, reports, errors }, null, 2))
  console.log(`燃料罐像素检查通过：${reports.length}组，运行异常0`)
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(e => { console.error(e); require('electron').app.exit(1) })
else parent().catch(e => { console.error(e); process.exitCode = 1 })
