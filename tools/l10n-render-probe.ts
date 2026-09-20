/**
 * **渲染层文案核对 · 无头直调**（正式入库；原临时探针 `tools/_l10n-render-probe.ts`，一次性用完转正）。
 *
 * 背景（船长 2026-09-20 报障）：「随机事件的事件日志出现了重复文本，且数值显示为 `+{p1}`」。
 * 病根在渲染层 `composeParts`：`p{n}Id` 在 core 侧有两种含义——**槽译文**（首段 `{pN}` 那一槽
 * 那句话的 id）与**链段**（第 n+1 段的 id）——而实现只认了后者，于是槽译文被顶进 `{p1}` 当正文
 * （正文被吞）、又当第 2 段渲一遍（重复），第 n 段的段内命名空间是 `p{n}*` 导致它自己的 `{p1}`
 * 无人供给、原样漏出。本轮同时抓出市场侧一处**槽号写错**（`market.ts` 把 `{p5}` 的税注挂成了 `p1Id`）。
 *
 * 为什么需要它：`composeParts` 是纯函数，但 `apps/desktop` / `web` **都没有测试框架**，
 * core 侧的结构体检用例只能"照口径复刻"（两份实现靠人工保持一致）。本工具把
 * **渲染层真身源码**打包后直接调它的 `logText()` ⇒ 验的是同一份代码，且能报出**逐字差异**。
 *
 * 用法：`npx tsx tools/l10n-render-probe.ts`（等价 `npm run l10n:render`）——无需浏览器、无需起服务。
 *
 * 输入 / 输出：
 *   - 输入：本文件内的夹具表（`FIXTURES`）——每条给出 core 侧真实的 `text` / `textId` / `textParams`
 *     与两种语言下的期望整句；新增毛病时**先加一条夹具**再改实现。
 *   - 输出：stdout 逐条列出"实得 / 期望"，末尾 ✅/❌；不进产物目录、不写文件。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v30**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-20**（当日核对：事件日志三形态 + 市场成交税注，中英各一遍）
 *   - 本工具最后跑过：**2026-09-20**
 *   - 判据：`CURRENT_STATE_VERSION − v30 ≥ 2` ⇒ **必须重跑核对**；此外 `locale.tsx` 的
 *     `composeParts` / `paramsFor` 一旦改动 ⇒ **必须重跑**（本工具就是它的验收口）。
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 浏览器全局的替身（Node 里没有；`locale.tsx` 在模块加载期就会读 localStorage） */
const SHIM = `
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
// Node 26 自带只读的 navigator ⇒ 必须 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', {
  value: { languages: ['zh-CN'], language: 'zh-CN' },
  configurable: true,
  writable: true,
})
// locale.tsx 在 L10nProvider 里挂了开发钩子 window.__setLocale（切语言的正规入口）
globalThis.window = globalThis
globalThis.document = { documentElement: { dataset: {}, lang: '' } }
`

/**
 * 把渲染层真身打包成可 import 的模块：只替身 `react` / `react/jsx-runtime`（组件部分用不到），
 * 文案表直接引仓库里的唯一表 ⇒ 验的是线上同一份数据。
 */
async function loadRenderer(): Promise<Record<string, unknown>> {
  const result = await build({
    entryPoints: ['apps/desktop/src/renderer/src/i18n/locale.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'stub' }))
          b.onResolve({ filter: /^@whale\/data$/ }, () => ({ path: 'data', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
            if (args.path === 'data') {
              // `resolveDir` 指到仓库根，相对路径才解析得到
              return { contents: `export { L10N } from './packages/data/src/l10n/table.ts'`, loader: 'js', resolveDir: process.cwd() }
            }
            if (args.path === 'jsx') {
              // JSX 只为 Provider 组件服务（本工具只用纯函数）⇒ 返回 dummy 元素即可
              return { contents: 'export const jsx = (t, p) => ({ t, p })\nexport const jsxs = jsx\nexport const Fragment = Symbol("F")', loader: 'js' }
            }
            return {
              contents: [
                // 要调 Provider 里的切语言入口 ⇒ 替身必须"真的执行 effect"、并保留一个可用的 setState
                'const S = (globalThis.__probeState = globalThis.__probeState || {})',
                'export const createContext = () => ({ Provider: null, Consumer: null })',
                'export const useCallback = (f) => f',
                'export const useContext = () => undefined',
                'export const useEffect = (f) => { f() }',
                'export const useMemo = (f) => f()',
                'export const useState = (init) => [S.v === undefined ? init() : S.v, (n) => { S.v = n }]',
              ].join('\n'),
              loader: 'js',
            }
          })
        },
      },
    ],
  })
  const dir = mkdtempSync(join(tmpdir(), 'l10n-probe-'))
  const file = join(dir, 'renderer.mjs')
  writeFileSync(file, SHIM + result.outputFiles[0]!.text)
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>
}

interface Fixture {
  name: string
  text: string
  textId: string
  textParams: Record<string, string | number>
  expectZh: string
  expectEn: string
}

const FIXTURES: Fixture[] = [
  {
    name: '事件·纯正文（无金额）',
    text: '✦ 深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。',
    textId: 'core.events.001',
    textParams: { p1: '深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。', p2: '', p1Id: 'core.events.003' },
    expectZh: '✦ 深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。',
    expectEn: '✦ A drifting deep-space container caught in your tractor beam: one crate of intact circuit boards inside.',
  },
  {
    name: '事件·带金额附注（船长报障原形）',
    text: '✦ 深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。（+2,133 信用点）',
    textId: 'core.events.001',
    textParams: {
      p1: '深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。',
      p2: '（+2,133 信用点）',
      p2Id: 'core.events.002',
      p2p1: '2,133',
      p1Id: 'core.events.003',
    },
    expectZh: '✦ 深空漂流货柜被你的牵引光捕获，里面有一箱完好的电路板。（+2,133 信用点）',
    expectEn:
      '✦ A drifting deep-space container caught in your tractor beam: one crate of intact circuit boards inside. (+2,133 credits)',
  },
  {
    name: '事件·带槽模板（协会收购周：正文 id 自己就带 {p1}）',
    text: '✦ 协会发布收购周通告：「爆破弹药」热度上升，行情看涨。',
    textId: 'core.events.001',
    textParams: { p1: '爆破弹药', p2: '', p1Id: 'core.events.084' },
    expectZh: '✦ 协会发布收购周通告：「爆破弹药」热度上升，行情看涨。',
    expectEn: '✦ The Association announced a buy week: demand for “爆破弹药” is up and the market looks bullish.',
  },
  {
    name: '市场·成交 + 贸易税尾槽（p5Id + p5p1）',
    // core 侧：p1=商品 p2=数量 p3=税后 p4=笔数，贸易税挂在 `{p5}` 槽上
    text: '市价售出 长尾鲨级导弹巡洋舰×3（税后入账 1,000 信用点，2 笔），贸易税 88 信用点。',
    textId: 'core.market.040',
    textParams: { p1: '长尾鲨级导弹巡洋舰', p2: '3', p3: '1,000', p4: '2', p5Id: 'core.market.037', p5p1: '88' },
    expectZh: '市价售出 长尾鲨级导弹巡洋舰×3（税后入账 1,000 信用点，2 笔），贸易税 88 信用点。',
    expectEn: 'Sold 长尾鲨级导弹巡洋舰×3 at market (1,000 credits after tax, 2 fills), trading tax 88 credits.',
  },
]

async function main(): Promise<void> {
  const mod = await loadRenderer()
  const logText = mod.logText as (e: { text: string; textId?: string; textParams?: Record<string, string | number> }) => string
  // 调一次真 Provider（替身会真的执行它的 useEffect）⇒ 挂上 window.__setLocale
  ;(mod.L10nProvider as (p: { children: unknown }) => unknown)({ children: null })
  const setLocale = (globalThis as unknown as { __setLocale?: (l: 'zh' | 'en') => void }).__setLocale
  if (setLocale === undefined) throw new Error('渲染层没挂 window.__setLocale（开发钩子被删了？）')

  let bad = 0
  for (const loc of ['zh', 'en'] as const) {
    setLocale(loc)
    console.log(`\n===== locale = ${loc}（模块内 currentLocale() = ${(mod.currentLocale as () => string)()}）=====`)
    for (const f of FIXTURES) {
      const got = logText({ text: f.text, textId: f.textId, textParams: f.textParams })
      const want = loc === 'zh' ? f.expectZh : f.expectEn
      const ok = got === want
      if (!ok) bad += 1
      console.log(`${ok ? '✓' : '✗'} ${f.name}`)
      console.log(`    实得：${got}`)
      if (!ok) console.log(`    期望：${want}`)
      if (/[{}]/.test(got)) {
        bad += 1
        console.log('    ✗ 残留占位符！')
      }
    }
  }
  console.log(bad === 0 ? '\n✅ 渲染层真身核对通过：各形态 × 两种语言，逐字相符且无残留占位符。' : `\n❌ 有 ${bad} 处不符。`)
  process.exitCode = bad === 0 ? 0 : 1
}

void main()
