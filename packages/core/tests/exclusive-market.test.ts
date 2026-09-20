/**
 * **专属内容上市场（只收不卖）+ 无人机一次性图纸**（2026-09-14 船长 · 三号 · verify）
 *
 * 船长原话（照抄，本批全部裁定的来源）：
 * - 「**允许玩家挂卖，顺便检查下其他物品，维持所有物品允许玩家挂卖**」；
 * - 「**所有专属的东西，价格翻4倍**」（范围选定：凡专属，含洞内 88 条）；
 * - 「**无人机也出蓝图，专属无人机出一次性蓝图（专属无人机的一次性蓝图，每次制造50架）**」；
 * - 渠道选定「各自走原渠道」；沙猫级（保底艇）与邓氏鱼级（无渠道壳体）**决定不补**。
 *
 * 本件钉六件事：
 * ① 补行的专属内容**全部 `playerBuyable: false`（只收不卖）**：市场不出售现货、玩家可挂卖；
 * ② 价 = **基准 × 4**（有料单的 = 材料÷0.45×4；窝点专属件 = 同槽位最高档×4；无人机 = 自带货值×4；
 *    舰船图纸 = 舰价 ×0.5，守 2026-09-14「一次性舰船蓝图」规则）；
 * ③ **能挂卖**：挂单进 escrow、`from` 语义正确、撤单退回原库存（装备/蓝图各自回位）；
 * ④ **NPC 不出售现货**：跑若干窗口，`npcSell` 永不含这些 key（稀缺性不变）；
 * ⑤ **3 张无人机一次性图纸**：`singleUse` + `outputUnits: 50` + 真造一次得 **50 架**入物品仓库；
 * ⑥ **渠道各走原渠道**：C/E 族池自动收进无人机图纸（前缀派生）、G 族窝点池含 `bp-lair-g-drone`，
 *    且高级箱掷中图纸时进的是**蓝图书架**（不是被当成无人机物品）。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, ITEMS, MARKET_GOODS, MODULES, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { advanceGame } from '../src/engine'
import { addWare, countWare, itemReleased } from '../src/inventory'
import { addModule, countModule } from '../src/equipment'
import { startManufacturing } from '../src/manufacturing'
import { cancelOrder, listSellHolding } from '../src/market'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { rollRareBoxExtra } from '../src/salvage'
import { wormholeFamilyPoolOf } from '../src/wormholeSalvage'
import { makeTestCtx } from './helpers'

const ctx = buildSimContext() as SimContext
/** 本次补行的专属内容（id 判据：洞内 `-wh-` + 窝点专属池成员 + 专属无人机与其图纸） */
const exclusiveIds = (): string[] => {
  const out = new Set<string>([
    ...Object.values(FOE_LAIR_GEAR).flat(),
    ...[...ctx.modules.keys()].filter((id) => id.includes('-wh-')),
    ...[...ctx.items.keys()].filter((id) => id.includes('-wh-')),
    ...[...ctx.blueprints.keys()].filter((id) => id.includes('-wh-')),
    ...[...ctx.shipBlueprints.keys()].filter((id) => id.includes('-wh-')),
    ...[...ctx.ships.keys()].filter((id) => id.includes('-wh-')),
  ])
  return [...out]
}
const rowOf = (refId: string) => MARKET_GOODS.find((g) => g.refId === refId)
const priceOf = (refId: string): number => rowOf(refId)?.basePrice ?? 0
const round500 = (v: number): number => Math.max(500, Math.round(v / 500) * 500)
const matValue = (bpId: string): number => {
  const bp = BLUEPRINTS.find((b) => b.id === bpId) ?? SHIP_BLUEPRINTS.find((b) => b.id === bpId)
  return (bp?.materials ?? []).reduce((a, m) => {
    const g = MARKET_GOODS.find((x) => x.kind === 'item' && x.refId === m.itemId)
    return a + (g?.basePrice ?? 0) * m.count
  }, 0)
}

describe('专属内容上市场（2026-09-14 船长「允许玩家挂卖」批）', () => {
  it('① 专属内容补行后**全部只收不卖**（playerBuyable: false）· 奇货档 · 价 > 0', () => {
    const ids = exclusiveIds()
    expect(ids.length).toBeGreaterThan(100) // 106 条量级
    const bad: string[] = []
    let rows = 0
    for (const id of ids) {
      const g = rowOf(id)
      if (!g) continue
      rows += 1
      if (g.playerBuyable !== false || g.rarity !== 'exotic' || (g.basePrice ?? 0) <= 0) bad.push(g.key)
    }
    expect(rows).toBeGreaterThanOrEqual(100) // 本批补行的专属内容量级（106 条）
    expect(bad).toEqual([])
  })

  it('② 价 = 基准 ×4：料÷0.45×4（装备/图纸）· 同槽位最高档×4（窝点件）· 货值×4（无人机）· 舰价×0.5（舰船图纸）', () => {
    // 装备与图纸同料单 ⇒ 同价（书价 = 市场行值这条硬契约照旧）
    expect(priceOf('mod-wh-a-frag')).toBe(priceOf('bp-wh-a-frag'))
    // ⚠ 2026-09-20 零件体系：配方追加零件使材料总价 +50%（按基础收价口径），但成品/书价**不涨**
    //   （船长「可以根据零件涨价约50%」指配方成本）——料÷0.45×4 的旧等式随零件 +50% 作废。
    expect(priceOf('bp-wh-a-frag')).toBe(5_244_500) // 原书价不变
    const fragMat = BLUEPRINTS.find((b) => b.id === 'bp-wh-a-frag')!.materials
    expect(fragMat.some((m) => m.itemId === 'part-qchip')).toBe(true)
    expect(fragMat.some((m) => m.itemId === 'part-circuit')).toBe(true)
    expect(priceOf('mod-wh-g-prop')).toBeGreaterThan(0)
    // 窝点专属件（无料单）：同槽位最高档**常规件** ×4
    // ⚠ 基准只取常规件（排除专属自身：新加的专属行价本身就是 ×4 的，拿它当基准会自我放大）
    const normalTop = (slot: string): number =>
      Math.max(
        ...MARKET_GOODS.filter(
          (g) =>
            g.kind === 'module' &&
            ctx.modules.get(g.refId)?.slot === slot &&
            !g.refId.includes('-wh-') &&
            !g.refId.startsWith('mod-lair-'),
        ).map((g) => g.basePrice ?? 0),
      )
    expect(priceOf('mod-lair-turret-a')).toBe(round500(normalTop('turret') * 4))
    // 专属无人机：自带货值 ×4
    expect(priceOf('drone-exile-bee')).toBe(24_000)
    expect(priceOf('drone-wh-e-sentry')).toBe(88_000)
    // 舰船图纸：舰价 ×0.5（09-14 一次性舰船蓝图规则）
    expect(priceOf('sbp-wh-a-frigate')).toBe(round500(priceOf('sh-wh-a-frigate') * 0.5))
    // 两处同值（blueprints.ts priceIsk = 市场行）——硬契约在 content:check 里也有一条
    expect(BLUEPRINTS.find((b) => b.id === 'bp-wh-a-frag')?.priceIsk).toBe(priceOf('bp-wh-a-frag'))
    expect(SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-wh-a-frigate')?.priceIsk).toBe(priceOf('sbp-wh-a-frigate'))
  })

  it('③ 能挂卖：装备挂单进 escrow、撤单退回装备库；图纸挂单撤单退回蓝图书架', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addModule(state, 'mod-wh-a-frag')
    const r = listSellHolding(state, ctx, 'mod-wh-a-frag', 9_000_000, 1)
    expect(r.ok).toBe(true)
    expect(state.orders.some((o) => o.side === 'sell' && o.good === 'mod-wh-a-frag')).toBe(true)
    expect(state.escrowItems['mod-wh-a-frag']).toBe(1)
    const order = state.orders.find((o) => o.good === 'mod-wh-a-frag')!
    expect(cancelOrder(state, ctx, order.id)).toBe(true)
    expect(countModule(state, 'mod-wh-a-frag')).toBe(1) // 退回装备库
    // 图纸：书架 → 挂单 → 撤单回书架
    state.blueprintStock['bp-wh-a-frag'] = 1
    const r2 = listSellHolding(state, ctx, 'bp-wh-a-frag', 9_000_000, 1)
    expect(r2.ok).toBe(true)
    expect(state.blueprintStock['bp-wh-a-frag'] ?? 0).toBe(0)
    expect(cancelOrder(state, ctx, state.orders.find((o) => o.good === 'bp-wh-a-frag')!.id)).toBe(true)
    expect(state.blueprintStock['bp-wh-a-frag']).toBe(1)
  })

  it('④ NPC **不出售现货**（只收不卖）：跑 30 分钟窗口，专属 key 永不进 npcSell；收购单可出现', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const keys = exclusiveIds().filter((id) => rowOf(id))
    advanceGame(state, 30 * 60_000, ctx)
    const leaked = keys.filter((k) => (state.market.npcSell[k] ?? []).length > 0)
    expect(leaked).toEqual([])
  })

  it('⑤ 3 张无人机一次性图纸：singleUse + **每次 50 架** + 真造一次得 50 架', () => {
    const ids = ['bp-lair-g-drone', 'bp-wh-c-drone', 'bp-wh-e-drone']
    for (const id of ids) {
      const bp = BLUEPRINTS.find((b) => b.id === id)!
      expect(bp.singleUse).toBe(true)
      expect(bp.outputUnits).toBe(50)
      expect(bp.itemId).toBeTruthy()
      expect(bp.priceIsk).toBe(priceOf(id)) // = 产物价（无人机货值 ×50）
      expect(priceOf(id)).toBe((ITEMS.find((i) => i.id === bp.itemId)?.baseSellPriceIsk ?? 0) * 50)
    }
    // 真造一次：开线 → 推进到完工 → 仓库 +50
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const bp = BLUEPRINTS.find((b) => b.id === 'bp-lair-g-drone')!
    state.blueprintStock['bp-lair-g-drone'] = 1
    for (const m of bp.materials) addWare(state, m.itemId, m.count)
    const before = countWare(state, 'drone-exile-bee')
    expect(startManufacturing(state, 'bp-lair-g-drone', 'pilot', ctx).ok).toBe(true)
    advanceGame(state, (bp.buildSeconds + 1) * 1000, ctx)
    expect(countWare(state, 'drone-exile-bee') - before).toBe(50)
    expect(state.blueprintStock['bp-lair-g-drone'] ?? 0).toBe(0) // 一次性书已吃掉
  })

  it('⑥ 渠道各走原渠道：C/E 族池自动收进无人机图纸；G 窝点池含图纸，且高级箱掷中图纸时进书架', () => {
    expect(wormholeFamilyPoolOf(ctx, 'C').moduleBlueprints).toContain('bp-wh-c-drone')
    expect(wormholeFamilyPoolOf(ctx, 'E').moduleBlueprints).toContain('bp-wh-e-drone')
    expect(FOE_LAIR_GEAR.G).toContain('bp-lair-g-drone')
    // 高级箱：把池收成只有那张图纸 ⇒ 必须走"图纸"分支（进 blueprintStock 语义的返回字段，不是无人机物品）
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    let sawBlueprint = false
    let sawBogusDrone = false
    for (let i = 0; i < 400; i += 1) {
      const extra = rollRareBoxExtra(state, ctx, {
        anomalyId: 'ano-x',
        galaxyId: 'galaxy-hub',
        threat: 90,
        baseDensity: 10,
        tier: 'dire',
        lairGear: ['bp-lair-g-drone'],
      } as never)
      if (!extra) continue
      if (extra.blueprints.includes('bp-lair-g-drone')) sawBlueprint = true
      if (extra.drones.some((d) => d.id === 'bp-lair-g-drone')) sawBogusDrone = true
    }
    expect(sawBlueprint).toBe(true)
    expect(sawBogusDrone).toBe(false)
  })

  it('⑦ 例外表（有意不补市场行）：沙猫级 / 邓氏鱼级 / 沙猫级舰船蓝图 / 基础零件隐式蓝图；其余可获得内容全部有市场行', () => {
    const rowKeys = new Set(MARKET_GOODS.map((g) => g.refId))
    expect(rowKeys.has('sandcat')).toBe(false)
    expect(rowKeys.has('sh-dunkleosteus')).toBe(false)
    // 2026-09-18 船长裁定新建的沙猫级舰船蓝图只作「第一次生产」的任务奖励发放，不进市场
    expect(rowKeys.has('sbp-sandcat')).toBe(false)
    const noRowOk = [
      'sandcat',
      'sh-dunkleosteus',
      'sbp-sandcat',
      // 2026-09-20 零件体系：基础零件隐式蓝图（无需学习、无书、不上市场）
      'bp-part-circuit',
      'bp-part-armor-plate',
      'bp-part-frame',
      'bp-part-cable',
      'bp-part-coolant',
      'bp-part-gyro',
      'bp-part-lens',
    ]
    const gaps: string[] = []
    for (const it of ITEMS) if (itemReleased(it) && !rowKeys.has(it.id) && !noRowOk.includes(it.id)) gaps.push(it.id)
    for (const m of MODULES) if (itemReleased(m) && !rowKeys.has(m.id)) gaps.push(m.id)
    for (const b of BLUEPRINTS) if (itemReleased(b) && !rowKeys.has(b.id) && !noRowOk.includes(b.id)) gaps.push(b.id)
    for (const b of SHIP_BLUEPRINTS) if (itemReleased(b) && !rowKeys.has(b.id) && !noRowOk.includes(b.id)) gaps.push(b.id)
    expect(gaps).toEqual([])
  })
})
