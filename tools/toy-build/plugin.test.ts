import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inlineToyWorkers, localToyHtml } from './plugin'

test('本地入口移除模块与跨域属性，保留外部普通脚本和安全策略', () => {
  const html = '<meta content="default-src old"><script type="module" crossorigin src="./assets/game.js"></script><link rel="stylesheet" crossorigin href="./assets/game.css">'
  const output = localToyHtml(html)
  assert.match(output, /worker-src blob: data:/)
  assert.match(output, /font-src 'self' data:/)
  assert.match(output, /<script src="\.\/assets\/game\.js" defer><\/script>/)
  assert(!/crossorigin|type="module"/.test(output))
})

test('两个现有 Worker 内嵌，接线漂移时构建失败', () => {
  const code = ['signalAuto', 'bountyWin'].map(name => `const ${name} = new Worker(new URL('./${name}.worker.ts', import.meta.url), { type: 'module' })`).join('\n')
  const output = inlineToyWorkers(code)
  assert.match(output, /signalAuto\.worker\.ts\?worker&inline/)
  assert.match(output, /bountyWin\.worker\.ts\?worker&inline/)
  assert(!output.includes('import.meta.url'))
  assert.throws(() => inlineToyWorkers(''), /接线发生变化/)
  assert.throws(() => localToyHtml('<script type="module" src="./changed.js"></script>'), /入口脚本路径不符/)
})
