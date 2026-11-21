/** 用法见同目录 README；只生成参赛产物，不触碰桌面包与个人存档。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const JSZip = require('jszip')

const ROOT = path.resolve(__dirname, '../..')
const OUTPUT = path.join(ROOT, 'dist/toy')
const LIMIT = 50_000_000

async function checkOutputPath() {
  const root = await fs.realpath(ROOT)
  for (const name of ['dist', 'dist/toy']) {
    const target = path.join(ROOT, name)
    const actual = await fs.realpath(target).catch(error => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    assert(actual === null || path.relative(path.join(root, name), actual) === '', `产物目录越界：${target}`)
  }
}

async function filesIn(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return filesIn(fullPath)
    assert(entry.isFile(), `产物不允许链接：${fullPath}`)
    return [fullPath]
  }))
  return nested.flat().sort()
}

async function main() {
  await checkOutputPath()
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')
  const result = spawnSync(process.execPath, [vite, 'build', '--config', 'web/vite.toy.config.ts', '--mode', 'toy'], {
    cwd: ROOT, stdio: 'inherit', windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, '参赛构建失败')
  // 图表库附带作者、上游项目声明与单独的许可证，随参赛包一起发出。
  const chartRoot = path.dirname(require.resolve('klinecharts/package.json', { paths: [path.join(ROOT, 'web')] }))
  for (const [source, name] of [
    ['LICENSE', 'LICENSE-KLineChart.txt'], ['NOTICE', 'NOTICE-KLineChart.txt'],
    ['licenses/LICENSE-lightweight-charts', 'LICENSE-Lightweight-Charts.txt'],
  ]) {
    await fs.copyFile(path.join(chartRoot, source), path.join(OUTPUT, name))
  }
  const zip = new JSZip()
  const files = []
  for (const fullPath of await filesIn(OUTPUT)) {
    const name = path.relative(OUTPUT, fullPath).replace(/\\/g, '/')
    assert(!/\.map$/i.test(name), '参赛包不得含源码映射')
    const bytes = await fs.readFile(fullPath)
    files.push({ name, bytes: bytes.length })
    zip.file(name, bytes)
  }
  const html = await fs.readFile(path.join(OUTPUT, 'index.html'), 'utf8')
  assert(!/type="module"|\bcrossorigin\b|modulepreload|\/Deepseek-EVE\//.test(html), '入口仍依赖网页服务器')
  assert.match(html, /<script[^>]+src="\.\/assets\/game\.js"[^>]+defer>/)
  for (const name of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'copyright.html']) {
    assert(files.some(file => file.name === name), `缺少许可文件：${name}`)
  }
  const expandedBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  assert(expandedBytes < LIMIT, `解压包 ${expandedBytes} 字节，超出 50 MB`)
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  assert(archive.length < LIMIT, `ZIP ${archive.length} 字节，超出 50 MB`)
  await fs.writeFile(path.join(ROOT, 'dist/whale-toy.zip'), archive)
  const report = {
    limitBytes: LIMIT, expandedBytes, zipBytes: archive.length,
    files: files.sort((a, b) => b.bytes - a.bytes),
  }
  await fs.writeFile(path.join(ROOT, 'dist/toy-size.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`参赛包：${files.length} 文件；解压 ${expandedBytes} 字节；ZIP ${archive.length} 字节；均小于 ${LIMIT} 字节。`)
  console.log(path.join(OUTPUT, 'index.html'))
  console.log(path.join(ROOT, 'dist/whale-toy.zip'))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
