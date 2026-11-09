/** 网页版更新提示的新鲜度判定；node --import tsx --test tools/web-update-prompt.test.ts */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entryScriptOf, isNewerBuild, scriptKey } from '../web/src/buildFreshness'

const page = (src: string): string =>
  `<!doctype html><html><head><meta charset="UTF-8" /></head><body><div id="root"></div><script type="module" crossorigin src="${src}"></script></body></html>`

test('从 index.html 取出带哈希的入口脚本', () => {
  assert.equal(entryScriptOf(page('/Deepseek-EVE/assets/index-AAAA1111.js')), '/Deepseek-EVE/assets/index-AAAA1111.js')
  // 没有 /assets/ 入口的是开发服务器或旧产物，不能据此判定版本。
  assert.equal(entryScriptOf('<script type="module" src="/src/main.tsx"></script>'), null)
  assert.equal(entryScriptOf('<html></html>'), null)
})

test('脚本比较只看路径，域名与查询串不参与', () => {
  const base = 'https://example.github.io/Deepseek-EVE/index.html'
  assert.equal(scriptKey('/Deepseek-EVE/assets/a.js', base), '/Deepseek-EVE/assets/a.js')
  assert.equal(scriptKey('https://cdn.example/assets/a.js?v=2', base), '/assets/a.js')
})

test('入口脚本没变 = 不是新版本；变了 = 有新版本', () => {
  const base = 'https://example.github.io/Deepseek-EVE/'
  const running = 'https://example.github.io/Deepseek-EVE/assets/index-AAAA1111.js'
  assert.equal(isNewerBuild(running, page('/Deepseek-EVE/assets/index-AAAA1111.js'), base), false)
  assert.equal(isNewerBuild(running, page('/Deepseek-EVE/assets/index-BBBB2222.js'), base), true)
  // 解析不到入口脚本时不误报（离线或异常页面）。
  assert.equal(isNewerBuild(running, '<html><body>404</body></html>', base), false)
})
