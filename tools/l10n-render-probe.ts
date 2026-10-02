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
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-10-02**（当日新增：**列表槽**两夹具——「自动探索队出发（名单）」
 *     与「自动探索队返航（战利品＋核心＋损伤＋谜质科技全槽齐）」，中英各一遍 ⇒
 *     这是船长「按你建议来修」那批机制的验收口）
 *   - 本工具最后跑过：**2026-10-02**
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
  textParams: Record<string, unknown>
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
    textParams: { p1: '协会发布收购周通告：「爆破弹药」热度上升，行情看涨。', p2: '', p1p1: '爆破弹药', p1Id: 'core.events.084' },
    expectZh: '✦ 协会发布收购周通告：「爆破弹药」热度上升，行情看涨。',
    expectEn: '✦ The Association announced a buy week: demand for “爆破弹药” is up and the market looks bullish.',
  },
  {
    /**
     * **神秘买家回归**（船长 2026-10 报障：「神秘买家 … 求购「{p2}」×1… 损伤管制装置 MK1」）。
     * 病根：市场事件调用点把槽值喂成**顶层** `p1/p2/p3`，而渲染层的槽译文 `p1Id` 按
     * **槽内参数** `p1p1/p1p2/p1p3` 取 —— 于是 `{p2}`（商品名）无人供给、原样漏出，
     * 且顶层 `p2` 被外壳当"金额附注槽"顶到句尾（商品名跑到了句末）。
     * 修复后：槽值一律 `p1p{k}`，外壳 `{p2}` 恒空串，正文槽由 `p1Id` 译文代回。
     */
    name: '事件·神秘买家（{p1} 价格 / {p2} 商品名 —— 泄漏回归钉）',
    text: '✦ 神秘买家以 856,159 信用点的天价求购「损伤管制装置 MK1」×1——远高于常态收购价，约 9 分钟内有效。',
    textId: 'core.events.001',
    textParams: {
      p1: '神秘买家以 856,159 信用点的天价求购「损伤管制装置 MK1」×1——远高于常态收购价，约 9 分钟内有效。',
      p2: '',
      p1p1: '856,159',
      p1p2: '损伤管制装置 MK1',
      p1p3: 9,
      p1Id: 'core.events.090',
    },
    expectZh: '✦ 神秘买家以 856,159 信用点的天价求购「损伤管制装置 MK1」×1——远高于常态收购价，约 9 分钟内有效。',
    expectEn:
      '✦ A mysterious buyer is paying a sky-high 856,159 credits for one “损伤管制装置 MK1” — far above the usual buy price, valid for about 9 minutes.',
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
  {
    /**
     * **进洞自动停机 · 读数段**（2026-09-27 三号核验批）：读数原先是一整段裸中文塞进 `{p3}`，
     * 现在挂在**第 4 槽**（`p4Id` + `p4p1…`），且**段内自己还有参数位要取词**——
     * 这是全仓最深的一层（`p4p3Id`：段 → 参数 → 内容表 id），本夹具就是钉它。
     *
     * core 侧真实取值（`wormhole.ts` 的 `haltEntryActivityOf`，开采档）：
     * 矿带「曦晶带」/ 12 单位 / 曦棱晶，中英对照见 `packages/data/src/l10n.ts`。
     */
    name: '进洞停机·开采读数（p4Id 槽译文）',
    text: '已自动停止「开采」：本趟原矿留在船上，舰船返港。（「曦晶带」 · 本趟 12 单位曦棱晶，货物留在船上）',
    textId: 'core.activityGate.007',
    textParams: {
      p1: '开采',
      p1Id: 'ui.Expedition.144',
      p2: '本趟原矿留在船上，舰船返港',
      p2Id: 'core.activity.007',
      p4: '「曦晶带」 · 本趟 12 单位曦棱晶，货物留在船上',
      p4Id: 'core.wormhole.039',
      p4p1: '曦晶带',
      p4p2: 12,
      p4p3: '曦棱晶',
    },
    expectZh: '已自动停止「开采」：本趟原矿留在船上，舰船返港。（「曦晶带」 · 本趟 12 单位曦棱晶，货物留在船上）',
    // ⚠ 矿带名与矿石名是**内容专名**（走 `EN_BELTS` / `EN_ITEMS_ALL`，不在 `L10N` 里）⇒
    //    本批只翻句子、专名照旧中文（边界见 `wormhole.ts` 的 `haltEntryActivityOf` 注释）。
    expectEn:
      'Stopped “Mine” automatically: ore from this run stays aboard and the ship returns to port. (“曦晶带” · 12 units of 曦棱晶 this run; the cargo stays aboard)',
  },
  {
    /** 同一句读数段的**两态**：出发站名（内容专名 ⇒ 照旧中文）与**"母港"这个通用词**（有词条 ⇒ 翻） */
    name: '进洞停机·长途运输读数（出发站名 / 母港 两态）',
    text: '已自动停止「长途运输」：本段报酬拿不到（报酬到站才结）。（已即时返港停靠「红环前哨站」）',
    textId: 'core.activityGate.007',
    textParams: {
      p1: '长途运输',
      p1Id: 'ui.MapPage.006',
      p2: '本段报酬拿不到（报酬到站才结）',
      p2Id: 'core.activity.009',
      p4: '已即时返港停靠「红环前哨站」',
      p4Id: 'core.wormhole.041',
      p4p1: '红环前哨站',
    },
    expectZh: '已自动停止「长途运输」：本段报酬拿不到（报酬到站才结）。（已即时返港停靠「红环前哨站」）',
    expectEn:
      'Stopped “Long-haul transport” automatically: this leg pays nothing (payment settles on arrival). (it docked back at “红环前哨站” at once)',
  },
  {
    /** 同一条读数段的**母港态**：`p4p1Id` 指向的是"母港"这个**通用词**的词条（不是内容专名）⇒ 能翻 */
    name: '进洞停机·长途运输读数（无出发站 ⇒ 母港）',
    text: '已自动停止「长途运输」：本段报酬拿不到（报酬到站才结）。（已即时返港停靠「母港」）',
    textId: 'core.activityGate.007',
    textParams: {
      p1: '长途运输',
      p1Id: 'ui.MapPage.006',
      p2: '本段报酬拿不到（报酬到站才结）',
      p2Id: 'core.activity.009',
      p4: '已即时返港停靠「母港」',
      p4Id: 'core.wormhole.041',
      p4p1: '母港',
      p4p1Id: 'core.wormhole.042',
    },
    expectZh: '已自动停止「长途运输」：本段报酬拿不到（报酬到站才结）。（已即时返港停靠「母港」）',
    expectEn:
      'Stopped “Long-haul transport” automatically: this leg pays nothing (payment settles on arrival). (it docked back at “Home port” at once)',
  },
  {
    /**
     * **长途运输 · 开跑那条日志的槽位映射**（**2026-09-27 船长报障**：「长途运输的文本也有错误
     * （数值不对，还有额外显示了个 `{p8}`）」）。
     *
     * 钉两件事：① `{p8}` 槽（卸货备注）必须渲出来、**不许再漏出 `{p8}`**；
     * ② `p5` 是**分钟**、`p6`/`p7` 才是**报酬区间**（此前三者喂错位 ⇒ 分钟显示成报酬）。
     *
     * ⚠ 这一段英文里**仍夹着中文标点**（`core.state.039` 的英文值以 `;` 开头、段尾把外壳的 `。`
     * 也带进去）——那是既有边界（多段拼接的段自带标点），已单列进 backlog，本夹具先把**实得**钉住。
     */
    name: '长途运输·开跑日志（`{p8}` 尾槽 ＋ 槽位映射）',
    text: '长途运输开始：磷虾 承运「母港 ⇄ 新港」（货仓 320 m³ 满载虚拟货物）——单段航程约 45 分钟，单段报酬随行情浮动在 12,000 ~ 20,000 信用点（每趟一价，到站结算）；船上原有货物已卸入仓库（50 单位）。',
    textId: 'core.hauling.024',
    textParams: {
      p1: '磷虾',
      p2: '母港',
      p3: '新港',
      p4: '320',
      p5: 45,
      p6: '12,000',
      p7: '20,000',
      p8: '50',
      p8Id: 'core.state.039',
      p8p1: 50,
    },
    expectZh:
      '长途运输开始：磷虾 承运「母港 ⇄ 新港」（货仓 320 m³ 满载虚拟货物）——单段航程约 45 分钟，单段报酬随行情浮动在 12,000 ~ 20,000 信用点（每趟一价，到站结算）；船上原有货物已卸入仓库（50 单位）。',
    expectEn:
      'Long-haul transport started: 磷虾 runs “母港 ⇄ 新港” (a hold of 320 m³ filled with virtual freight) — a single leg takes about 45 minutes; single-leg pay drifts with the market between 12,000 and 20,000 credits (one price per trip, settled on arrival); the cargo already aboard was unloaded into the warehouse (50 units).',
  },
  /**
   * **精炼停炉·段链三层**（**2026-09-29 加** · 船长报障「各种事件里的参数都有问题」的验收夹具）。
   *
   * 一条把三层走全：① 基础模板 `.077`（自己占 `p1` 船名 / `p2` 批数）
   * ② 段 `.067`「；精炼所得：{p1}」（**专属键空间** `seg2…`）
   * ③ 清单那层模板 `.044`「{p1}{p2}」（值在 `seg2p1p1`）
   * 三种错都会现形：**抢槽**（段内容顶替基础槽）、**段丢失**（`parts` 缺席时英文只剩基础句）、
   * **漏槽**（内层取不到值 ⇒ `{p1}` 原样漏出）。
   */
  {
    name: '精炼停炉·段链三层（抢槽 / 段丢失 / 漏槽 三条一起守）',
    text: '精炼炉停：矿甲 原料耗尽（共 1 批）；精炼所得：矿粉min-a×24、矿粉min-b×6。',
    textId: 'core.industry.077',
    textParams: {
      p1: '矿甲',
      p2: 1,
      // 段链专属键空间 `seg{n}…`（n 从 2 起；第 1 段 = 基础模板本身）
      seg2Id: 'core.industry.067',
      seg2p1: '矿粉min-a×24、矿粉min-b×6',
      seg2p1p1: '矿粉min-a×24、矿粉min-b×6', // 清单那层模板 `.044` 的 {p1}
      seg2p1p2: '', // `.044` 的 {p2}（「等 N 种」尾巴；没截断 ⇒ 空串）
      seg2p1Id: 'core.industry.044', // 清单那层模板是谁
      seg3Id: 'core.state.042',
      parts: ['core.industry.067', 'core.state.042'],
    } as unknown as Record<string, string | number>,
    expectZh: '精炼炉停：矿甲 原料耗尽（共 1 批）；精炼所得：矿粉min-a×24、矿粉min-b×6。',
    expectEn: 'Refinery stopped: 矿甲 ran out of feedstock (1 batches); refined: 矿粉min-a×24、矿粉min-b×6.',
  },
  /**
   * **列表槽 · 出发名单**（**2026-10-02 加** · 船长「按你建议来修」那批机制的验收口）。
   *
   * 病根：core 原先写 `${names.join('、')}` —— 中文顿号**焊进参数值**，而参数值不会再被翻译
   * ⇒ 英文界面里名单是「A、B」。现在 core 只给 `p3List`（逐项值），分隔符由渲染层按
   * `core.state.043`（zh `、` / en `, `）取。
   * ⚠ 名字是**内容专名**（走 `EN_SHIPS` 等 ctx 覆盖，不在 `L10N` 里）⇒ 中英两列都照旧中文（既有边界）。
   */
  {
    name: '列表槽·自动探索队出发（原型名走 p1Id · 名单走 p3List）',
    text: '🛰 自动探索队出发：均衡深区 · 2 条舰（磷虾、长尾鲨）——约 5 分钟后返航（每次自动探索占 1 枚 AI 核心）。',
    textId: 'core.wormholeAuto.020',
    textParams: {
      p1: '均衡深区',
      p1Id: 'core.wormholeArch.001',
      p2: 2,
      p3: '磷虾、长尾鲨',
      p3List: ['磷虾', '长尾鲨'],
      p4: 5,
    },
    expectZh: '🛰 自动探索队出发：均衡深区 · 2 条舰（磷虾、长尾鲨）——约 5 分钟后返航（每次自动探索占 1 枚 AI 核心）。',
    expectEn:
      '🛰 Exploration team away: Balanced deep zone · 2 ships (磷虾, 长尾鲨) — it returns in about 5 minutes (each automated run takes 1 AI core).',
  },
  /**
   * **列表槽 · 返航全槽齐**（战利品列表＋逐项模板 / 核心附注槽（内层再取词）/ 损伤列表 / 谜质科技段）。
   * 一条夹具把四类槽全走一遍：`p1List`＋`p1ItemId`＋`p1ItemParams` · `p2Id`＋`p2p1`＋`p2p1Id` ·
   * `p3List`＋`p3ItemId` · `p4Id`＋`p4p1..3`。
   */
  {
    name: '列表槽·自动探索队返航（战利品/核心/损伤/谜质科技 四类槽齐）',
    text: '🛰 自动探索队返航：带回 曦棱晶 ×24、虫洞谜质 ×2（已入仓库），并带回 基础 AI 核心 ×1（已直接接入核心库）；损伤：磷虾（结构 −35% / 装甲 −12%）。谜质科技：残骸线 ×1.20 · 母矿线 ×1.10 · 损伤 ×0.80。2 条舰全部安全返航，1 枚 AI 核心已释放（每次自动探索占 1 枚）——报告在「扫描虫洞」页等你确认。',
    textId: 'core.wormholeAuto.021',
    textParams: {
      p1: '曦棱晶 ×24、虫洞谜质 ×2',
      p1List: ['曦棱晶', '虫洞谜质'],
      p1ItemId: 'core.wormholeAuto.022',
      p1ItemParams: [{ p2: 24 }, { p2: 2 }],
      p2: '，并带回 基础 AI 核心 ×1（已直接接入核心库）',
      p2Id: 'core.wormholeAuto.024',
      p2p1: '基础 AI 核心',
      p2p1Id: 'ui.labelsText.009',
      p2p2: 1,
      p3: '磷虾（结构 −35% / 装甲 −12%）',
      p3List: ['磷虾'],
      p3ItemId: 'core.wormholeAuto.025',
      p3ItemParams: [{ p2: 35, p3: 12 }],
      p4: '谜质科技：残骸线 ×1.20 · 母矿线 ×1.10 · 损伤 ×0.80。',
      p4Id: 'core.wormholeAuto.026',
      p4p1: '1.20',
      p4p2: '1.10',
      p4p3: '0.80',
      p5: 2,
    },
    expectZh:
      '🛰 自动探索队返航：带回 曦棱晶 ×24、虫洞谜质 ×2（已入仓库），并带回 基础 AI 核心 ×1（已直接接入核心库）；损伤：磷虾（结构 −35% / 装甲 −12%）。谜质科技：残骸线 ×1.20 · 母矿线 ×1.10 · 损伤 ×0.80。2 条舰全部安全返航，1 枚 AI 核心已释放（每次自动探索占 1 枚）——报告在「扫描虫洞」页等你确认。',
    expectEn:
      '🛰 Exploration team back: brought 曦棱晶 ×24, 虫洞谜质 ×2 (now in the warehouse), plus Basic AI core ×1 (routed straight to the core vault); damage: 磷虾 (hull −35% / armour −12%). Enigma tech: wreck line ×1.20 · mother-lode line ×1.10 · damage ×0.80. All 2 ships made it home safely and 1 AI core was released (each automated run takes 1) — the report is waiting for you on the Scan Wormholes page.',
  },
  /**
   * **列表槽 · 空态**（战利品为空 ⇒ core **不传 `List`**、改挂槽译文 `p1Id`「空手而归」）：
   * 传空数组会把该槽渲成空串 ⇒ 这条夹具钉住"空态走 `p1Id`"这个写法。
   */
  {
    name: '列表槽·自动探索队返航（空手而归 · 无损伤 · 无核心 · 未点谜质科技）',
    text: '🛰 自动探索队返航：带回 空手而归（已入仓库）；损伤：。2 条舰全部安全返航，1 枚 AI 核心已释放（每次自动探索占 1 枚）——报告在「扫描虫洞」页等你确认。',
    textId: 'core.wormholeAuto.021',
    /** ⚠ `p2`/`p3`/`p4` 三个"可选槽"core 侧**恒传空串**（硬槽缺键会原样漏 `{pN}`）——夹具照真实落码写 */
    textParams: { p1: '空手而归', p1Id: 'core.wormholeAuto.023', p2: '', p3: '', p4: '', p5: 2 },
    expectZh:
      '🛰 自动探索队返航：带回 空手而归（已入仓库）；损伤：。2 条舰全部安全返航，1 枚 AI 核心已释放（每次自动探索占 1 枚）——报告在「扫描虫洞」页等你确认。',
    expectEn:
      '🛰 Exploration team back: brought nothing but empty hands (now in the warehouse); damage: . All 2 ships made it home safely and 1 AI core was released (each automated run takes 1) — the report is waiting for you on the Scan Wormholes page.',
  },
]

async function main(): Promise<void> {
  const mod = await loadRenderer()
  const logText = mod.logText as (e: {
    text: string
    textId?: string
    textParams?: Record<string, unknown>
  }) => string
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
  /**
   * **入侵通讯专项**（**2026-10-01 船长报障**：「**入侵的通讯应该采取更正式的名称，不应该直接用X族**」）。
   *
   * 为什么要单独一段：通讯的标题/正文走的是 `commsText.ts` 的 `commsEntrySubjectText` /
   * `commsEntryBodyText` —— 它们的取参口径是 `pNId ⇒ paramText()`（与日志的 `composeParts`
   * **同源但不是同一个函数**，`composeParts` 认得段链与槽内参数，通讯这两个只认槽译文）。
   * 所以这里用真身的 `paramText` ＋ `tr` 把两族（H 墨潮帮 / R 光环）的标题与正文各复算一遍。
   */
  const tr = mod.tr as (id: string, p?: Record<string, string | number>) => string
  const paramText = mod.paramText as (s: string) => string
  const COMMS_FAMILIES = [
    { fam: 'H', id: 'core.weekend.023', zh: '墨潮帮', en: 'Ink Tide' },
    { fam: 'R', id: 'core.weekend.024', zh: '光环', en: 'Corona Systems' },
  ] as const
  const famCode = /[A-Z]\d?\s*族|family\s+[A-Z]/
  console.log('\n===== 入侵通讯 · 族名（`p1Id` ⇒ `paramText`）=====')
  for (const loc of ['zh', 'en'] as const) {
    setLocale(loc)
    for (const c of COMMS_FAMILIES) {
      const fam = paramText(c.id)
      const subject = tr('core.weekend.010', { p1: fam })
      const body = tr('core.weekend.011', { p1: fam, p2: 3, p3: '示例星系' })
      const want = loc === 'zh' ? c.zh : c.en
      const ok = fam === want && !famCode.test(subject) && !famCode.test(body)
      if (!ok) bad += 1
      console.log(`${ok ? '✓' : '✗'} [${c.fam} 族] ${loc} · 族名「${fam}」`)
      console.log(`    标题：${subject}`)
      console.log(`    正文：${body}`)
      if (!ok) console.log(`    期望族名：${want}（且标题/正文不许出现族代号）`)
    }
  }
  console.log(bad === 0 ? '\n✅ 渲染层真身核对通过：各形态 × 两种语言，逐字相符且无残留占位符。' : `\n❌ 有 ${bad} 处不符。`)
  process.exitCode = bad === 0 ? 0 : 1
}

void main()
