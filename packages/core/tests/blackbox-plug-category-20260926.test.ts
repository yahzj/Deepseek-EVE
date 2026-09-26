/**
 * **黑匣独立成类 ＋ 装备归属档新增「舰船插件」档**（**船长 2026-09-26 两条令**）。
 *
 * 船长原话（照抄）：
 * 1.「**入侵获得的黑匣在仓库内查看不到，需要新增分类。并且在装备图鉴中，和高中低槽同级的位置，
 *    新增一个舰船插件的分类。修改的过程中要记住筛选统一化的规则**」
 * 2.「**按你推荐来，不过建议市场内黑匣单独一个分类，不要挪到「货物」。**」
 *
 * 两处根因（读数）：
 * - 黑匣 09-25「先做壳」那批**借了 `kit` 档** ⇒ 仓库/货仓/手册/市场全按 kind 分类，
 *   它被塞进「**修理组件**」里（真档里确有 3 件，玩家按「黑匣」找永远找不到）；
 * - 舰船插件是 `slot: 'plug'` 的装备，但数据为满足体检契约写了 `rack: 'low'` ⇒ `rackOf()` 把它算成低槽，
 *   装备图鉴的归属档行（`RACK_SUBS`）里没有它自己的档，分组还会掉进「其它」。
 *
 * 本文件钉的是**模型层 + 单点存在性**；筛选判定本身由 `content:check` 的两条新契约跑真函数守
 * （「黑匣契约」「归属档契约」），UI 侧的接线用源码静态断言（与舰船美术契约同款做法）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ITEMS, L10N, MODULES, buildSimContext } from '@whale/data'
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, isBlackboxItem, marketGoodOf } from '../src/index'

/** 仓根（与 `new-battleships-20260926.test.ts` 同一套取法：`__dirname` 往上三层） */
const ROOT = join(__dirname, '..', '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const ctx = buildSimContext()

describe('黑匣独立成类（船长报障：入侵获得的黑匣在仓库内查看不到）', () => {
  it('`blackbox-h` 是 `blackbox` 档（不再是借来的 `kit`）', () => {
    const b = ITEMS.find((i) => i.id === 'blackbox-h')!
    expect(b.kind).toBe('blackbox')
    expect(ITEMS.filter((i) => i.kind === 'blackbox').map((i) => i.id)).toEqual(['blackbox-h'])
    expect(isBlackboxItem('blackbox-h'), 'core 单点认它').toBe(true)
    expect(isBlackboxItem('repairkit-civ'), '修理组件不是黑匣').toBe(false)
  })

  it('`ITEM_KIND_ORDER` / `ITEM_KIND_LABELS` 两处登记齐（漏一处 typecheck 就红）', () => {
    expect(ITEM_KIND_ORDER).toContain('blackbox')
    expect(ITEM_KIND_LABELS.blackbox).toBe('黑匣')
    // 位置：紧挨「蓝图碎片」之后、「修理组件」之前（战利品一族连在一起）
    const at = ITEM_KIND_ORDER.indexOf('blackbox')
    expect(ITEM_KIND_ORDER[at - 1]).toBe('fragment')
    expect(ITEM_KIND_ORDER[at + 1]).toBe('kit')
  })

  it('修理组件仍是 `kit`（放宽档从 kit 换成 blackbox，三件修理组件一件不少）', () => {
    const kits = ITEMS.filter((i) => i.kind === 'kit').map((i) => i.id)
    expect(kits).toEqual(['repairkit-civ', 'repairkit-mil', 'repairkit-dc'])
  })

  it('市场行照旧（可回收/可卖，只收不卖 · 奇货档）；价格 = 2026-09-26 船长令的 8,000 万', () => {
    const good = marketGoodOf(ctx, 'item', 'blackbox-h')!
    expect(good).toBeTruthy()
    expect(good.rarity).toBe('exotic')
    expect(good.playerBuyable).toBe(false)
    // 船长原话：「黑匣的价格需要提高到8000万」（原 80 万 · 与物品 baseSellPriceIsk 同值）
    expect(good.basePrice).toBe(80_000_000)
    expect(ctx.items.get('blackbox-h')!.baseSellPriceIsk).toBe(80_000_000)
  })

  it('文案：中英双语同一条 id（仓库/货仓/图鉴/市场四处共用）', () => {
    expect(L10N['ui.labelsText.069']!.zh).toBe('黑匣')
    expect(L10N['ui.labelsText.069']!.en).toBe('Black boxes')
  })

  it('接线静态断言：仓库分类自动多一档；市场类型下拉新登记一档；图标/色调齐备', () => {
    // 仓库页 / 货仓页 / 手册物品图鉴都按 `ITEM_KIND_ORDER` 渲染 ⇒ 上面那条断言即覆盖它们的分类行
    const market = read('apps/desktop/src/renderer/src/pages/MarketPage.tsx')
    expect(market, '市场一级类型里有 blackbox 档').toContain("'blackbox'")
    const subs = read('apps/desktop/src/renderer/src/ui/itemSubs.ts')
    expect(subs, '黑匣键集合单点').toContain('BLACKBOX_KIND_KEYS')
    const glyphs = read('apps/desktop/src/renderer/src/ui/Glyphs.tsx')
    expect(glyphs, 'Glyphs 有黑匣形').toContain('blackbox: (')
    const tones = read('apps/desktop/src/renderer/src/ui/tones.ts')
    expect(tones, 'tones 有黑匣色调').toContain("blackbox: toneVar('blackbox')")
    const css = read('packages/ui/src/index.css')
    expect(css.match(/--wui-tone-blackbox:/g)?.length, '每个主题块都要有该色调').toBe(7)
  })
})

describe('装备归属档新增「舰船插件」（船长令：和高中低槽同级）', () => {
  it('插件是独立槽位的装备，数据里声明的 `rack` 仍是 low（故必须走归属档单点）', () => {
    const plugs = MODULES.filter((m) => m.slot === 'plug')
    expect(plugs.length).toBe(12)
    for (const p of plugs) expect(p.rack, `${p.id} 的 raw rack（历史声明，勿直接拿来筛选）`).toBe('low')
  })

  it('单点 `rackDimKeyOf` 把插件判成 `plug`；高低中低三档的键顺序含 plug', () => {
    const subs = read('apps/desktop/src/renderer/src/ui/itemSubs.ts')
    expect(subs, '归属档单点存在').toContain('export function rackDimKeyOf')
    expect(subs, '四档键序').toContain("(['high', 'mid', 'low', 'plug'] as const)")
    expect(subs, '分组族').toContain("plug: ['plug']")
    expect(subs, '市场桶登记（黑匣同样只装物品）').toContain("'blackbox', 'module'")
  })

  it('手册两处分组改读单点（不再直接读 `rackOf`——那会把插件蓝图归进低槽）', () => {
    const hb = read('apps/desktop/src/renderer/src/panels/Handbook.tsx')
    expect(hb).toContain('rackDimKeyOf')
    expect(hb.includes('mod ? rackOf(mod) :'), '旧写法已清').toBe(false)
    expect(hb.includes('rackOf(mod) === sub'), '旧写法已清').toBe(false)
  })
})
