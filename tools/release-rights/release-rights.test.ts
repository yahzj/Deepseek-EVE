import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditReleaseRights } from './check'
import { releaseRightsAssets, releaseRightsBannerPlugin, releaseRightsPlugin, RIGHTS_BANNER } from './index'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WEB = join(ROOT, 'web')

test('两端取同一授权正文，保留第三方许可和既有授权例外', () => {
  const web = releaseRightsAssets(WEB)
  const desktop = releaseRightsAssets(join(ROOT, 'apps/desktop'))
  assert.equal(web['LICENSE.txt'], readFileSync(join(ROOT, 'LICENSE.txt'), 'utf8'))
  assert.equal(web['LICENSE.txt'], desktop['LICENSE.txt'])
  assert.match(web['LICENSE.txt']!, /不撤销既有许可证已经授予的权利/)
  for (const pkg of ['react', 'react-dom', 'scheduler', 'lucide-react', 'PixelPlanets']) {
    assert.ok(web['THIRD-PARTY-NOTICES.txt']!.includes(`===== ${pkg}`))
  }
  assert.match(web['THIRD-PARTY-NOTICES.txt']!, /Copyright \(c\) 2020 Deep-Fold/)
  assert.match(web['copyright.html']!, /<pre>/)
  assert.doesNotMatch(web['copyright.html']!, /<script\b/)
})

test('构建插件关闭源码映射，给 JS 及 HTML 注入声明并输出完整文件', () => {
  const plugin = releaseRightsPlugin(WEB)
  assert.equal(plugin.apply, 'build')
  assert.equal(plugin.config().build.sourcemap, false)
  assert.equal(plugin.renderChunk('const n=1;').code, `${RIGHTS_BANNER}\nconst n=1;`)
  assert.equal(plugin.transformIndexHtml()[1]!.attrs.href, './copyright.html')
  const assets: Record<string, string> = {}
  plugin.generateBundle.call({ emitFile: (asset) => { assets[asset.fileName] = asset.source } })
  assert.deepEqual(assets, releaseRightsAssets(WEB))
  const worker = releaseRightsBannerPlugin()
  assert.equal(worker.renderChunk('self.onmessage=()=>{};').code, `${RIGHTS_BANNER}\nself.onmessage=()=>{};`)
  assert.equal('generateBundle' in worker, false)
})

test('产物核查识别缺声明、篡改、空产物、漏版权头及残留源码映射', () => {
  const temp = mkdtempSync(join(tmpdir(), 'whale-release-rights-'))
  try {
    const output = join(temp, 'renderer')
    mkdirSync(output)
    assert.ok(auditReleaseRights(output, WEB).length > 0)
    for (const [file, source] of Object.entries(releaseRightsAssets(WEB))) writeFileSync(join(output, file), source, 'utf8')
    writeFileSync(join(output, 'index.html'), '<link rel="license" href="./copyright.html">', 'utf8')
    assert.ok(auditReleaseRights(output, WEB).some((error) => error.includes('没有渲染包')))
    writeFileSync(join(output, 'app.js'), `${RIGHTS_BANNER}\nconst n=1;`, 'utf8')
    assert.deepEqual(auditReleaseRights(output, WEB, temp), [])
    writeFileSync(join(output, 'LICENSE.txt'), 'changed', 'utf8')
    writeFileSync(join(output, 'app.js'), 'const n=1;\n//# sourceMappingURL=app.js.map', 'utf8')
    writeFileSync(join(temp, 'main.js.map'), '{}', 'utf8')
    const errors = auditReleaseRights(output, WEB, temp)
    assert.ok(errors.some((error) => error.includes('LICENSE.txt')))
    assert.ok(errors.some((error) => error.includes('缺少版权头')))
    assert.ok(errors.some((error) => error.includes('包含源码映射链接')))
    assert.ok(errors.some((error) => error.includes('main.js.map')))
  } finally {
    // 只删除本测试用 mkdtempSync 创建的目录，不接触任何构建或用户文件。
    rmSync(temp, { recursive: true, force: true })
  }
})
