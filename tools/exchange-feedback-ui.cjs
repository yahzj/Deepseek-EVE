/** 证券组件回归：node tools/exchange-feedback-ui.cjs。隐藏 Electron、合成账户、临时目录自动清理。 */
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const {execFile} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const fixtures = path.join(__dirname, 'exchange-feedback-fixtures')
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-exchange-ui-'))
  try {
    for (const name of ['layout', 'progress', 'trading']) {
      const built = await require('esbuild').build({
        entryPoints: [path.join(fixtures, name + '.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic',
        alias: {'@whale/core': path.join(root,'packages/core/src/index.ts'), '@whale/data': path.join(root,'packages/data/src/index.ts'), '@whale/ui': path.join(root,'packages/ui/src/index.tsx')},
        logLevel: 'silent',
      })
      const css = await fs.readFile(path.join(root,'apps/desktop/src/renderer/src/features/exchange/exchange.css'), 'utf8')
      const bundle = 'var style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.appendChild(style);' + built.outputFiles[0].text
      await fs.writeFile(path.join(dir, 'fixture.js'), bundle)
      await fs.copyFile(path.join(fixtures, name + '.cjs'), path.join(dir,'main.cjs'))
      const result = await new Promise((resolve,reject) => execFile(require('electron'), [path.join(dir,'main.cjs'),path.join(dir,'fixture.js')], {windowsHide:true,timeout:30000}, (error,stdout,stderr) => error ? reject(Object.assign(error,{stdout,stderr})) : resolve({stdout,stderr})))
      console.log(name + ': ' + result.stdout.trim())
      if (result.stderr) process.stderr.write(result.stderr)
    }
  } finally { await fs.rm(dir, {recursive:true,force:true}) }
}
main().catch(error => { console.error(error.stdout || '', error.stderr || '', error); process.exitCode = 1 })
