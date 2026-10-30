import { bumpFirst } from '../firstTasks'
import type { GameState } from '../state'
import type { AiCoreType, SimContext } from '../types'
import { aiCoreName } from '../aiCores'

/**
 * **甲案·多段可空尾巴**（2026-09-20）：市场成交日志末尾会挂「（含协会声望加成）」「（贸易税 … 信用点）」两段，
 * 两段都可能为空——而多段链**不能有空段**（空 id 会把后面的段整段丢掉），
 * 故按"实际有哪几段"选模板：`p1` 传商品串，尾巴段做进模板正文 ⇒ **译文顺序由英文侧自己定**。
 * 中文串按原样拼（与改造前逐字一致）。
 */
export type TradeNote = '' | 'bonus' | 'tax' | 'bonusTax'

export function tradeNoteText(note: TradeNote, tax: number): string {
  const taxTxt = `（贸易税 ${tax.toLocaleString('zh-CN')} 信用点）`
  if (note === 'bonus') return '（含协会声望加成）'
  if (note === 'tax') return taxTxt
  if (note === 'bonusTax') return `（含协会声望加成）${taxTxt}`
  return ''
}

/**
 * 槽译文的 id（`p4Id`）。
 *
 * ⚠ **调用点必须连"槽内参数" `p4p1` 一起喂**（**2026-09-29 实障修正**）：
 * `core.market.034/035` 自己带 `{p1}`（税额），渲染层按 `p4p1` 取它 ——
 * 只给 `p4Id` 的话那一槽的 `{p1}` **无人供给、原样漏出**（实测日志里出现
 * 「（贸易税 {p1} 信用点）」）。同款范式见 `events.ts` 的 `p2p1`、`hauling.ts` 的 `p8p1`；
 * 漏喂由 `npm run l10n:params` 的"槽内参数"检查兜住。
 */
export function tradeNoteId(note: TradeNote): string | undefined {
  switch (note) {
    case 'bonus':
      return 'core.market.033'
    case 'tax':
      return 'core.market.034'
    case 'bonusTax':
      return 'core.market.035'
    default:
      return undefined
  }
}

/** 商品显示名 */
export function goodName(ctx: SimContext, goodKey: string): string {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return goodKey
  switch (def.kind) {
    case 'item':
      return ctx.items.get(def.refId)?.name ?? goodKey
    case 'module':
      return ctx.modules.get(def.refId)?.name ?? goodKey
    case 'ship':
      return ctx.ships.get(def.refId)?.name ?? goodKey
    case 'blueprint':
      return ctx.blueprints.get(def.refId)?.name ?? ctx.shipBlueprints.get(def.refId)?.name ?? goodKey
    case 'aicore':
      /**
       * ⚠ **AI 核心四档没有"物品行"可查**（它们走 `state.aiCores` 账本，不在物品表里）
       * ⇒ 名字原先**写死中文**，英文界面下市场/工业那几行一直是中文（**2026-09-30 批 5**）。
       * 现在改走**数据层的 id 侧面通道** `nameId`（口径同 `marketLockNote` 一族），
       * 渲染层写 `tr(def.nameId)`；没配 `nameId` 的（老档/夹具的临时货）仍回落中文原串。
       */
      return aiCoreName(def.refId as AiCoreType)
  }
}

/**
 * **AI 核心那四档的市场行该用哪个 id**（渲染层用；与上面 `goodName` 的回落同源）。
 * 抽出来是为了**不让渲染层自己拼 id 字符串**（拼错了静默出中文，体检也看不出来）。
 */
export function aiCoreGoodNameId(refId: string): string | undefined {
  switch (refId) {
    case 'basic':
      return 'ui.labelsText.009'
    case 'gamma':
      return 'ui.labelsText.010'
    case 'beta':
      return 'ui.labelsText.011'
    case 'alpha':
      return 'ui.labelsText.012'
    default:
      return undefined
  }
}

/* ═══════════ 玩家操作：挂单 / 撤单 / 市价单 / 卖船 ═══════════ */

/**
 * 挂限价卖单：货先入 escrow（**调用方应先从库存扣货入 escrowItems**；舰船走 placeShipSellOrder）。
 *
 * ⚠ **主键校验（2026-09-20 外部审计报告后补）**：本函数是"底层记账"，**不替调用方锁库存**
 * （锁货在 `listSellHolding` / `sellAtMarket` 那几条玩家入口里，走 `lockNaturalStock`）——
 * 这个契约写在函数注里已有一段时间，但**没有任何一道运行期校验**：传进来的 `goodKey` 哪怕是
 * `undefined` 或某个不存在的字符串，也照样会挂出一张单、并把 `escrowItems[goodKey]` 加一笔
 * （`tools/flow-newgame.ts` 把 `good.id`（不存在，应为 `good.key`）传进来时正是这个下场：
 * 出现 goodKey = `"undefined"` 的幽灵单与幽灵 escrow）。
 * ⇒ 现在**先查目录**：`ctx.marketGoods` 里没有这个 key 就不挂单（返回 null，与其它入参非法同款）。
 * 这条只挡"不存在的商品"，不影响既有调用方（它们传的都是目录里真实存在的 key）。
 */
/**
 * **「第一次挂单销售」的判据落点**（**2026-09-22 船长令**：「**第一次挂单允许玩家挂买单或者直接市价购买
 * 卖出都算完成**」）。
 *
 * 四种"真做成了一笔交易"的路各记一笔（**互不嵌套 ⇒ 不会重复计数**，调用点见下面每处的注释）：
 * ① **挂卖单**：`placeSellOrder`（core API）· 界面 `listSellHolding`（物品 / 整船两条分支）·
 *    `placeShipSellOrder`（整船挂单；`sellShipAtMarket` 也走它）· `placeStoredShipSellOrder`（舰船仓库挂单）
 * ② **挂买单**：`placeBuyOrder`
 * ③ **市价卖出**：`sellAtMarket`（物品页「市价卖出」也走它）· `sellStoredShipAtMarket`（整船市价卖出）
 * ④ **市价买入**：`buyAtMarket`
 *
 * ⚠ 计数键仍是 `firstStats.orders`（**存档兼容**：老档已有的数字照旧算数，键名与存档形状都不动——
 * 它现在的语义是"做过几笔市场交易"，不只"挂过几张单"）。
 */
export function bumpFirstMarketTrade(state: GameState): void {
  bumpFirst(state, 'orders')
}

/** 挂单回执文案（含即时成交结果；数量单位为件/单位，与既有日志口径一致） */
export function placeOrderLogText(
  ctx: SimContext,
  side: 'buy' | 'sell',
  goodKey: string,
  price: number,
  want: number,
  r: { filled: number; resting: number },
): string {
  const name = goodName(ctx, goodKey)
  const p = price.toLocaleString('zh-CN')
  if (r.filled <= 0) return `已挂${side === 'buy' ? '买' : '卖'}单：${name}×${want.toLocaleString('zh-CN')} @ ${p} 信用点。`
  if (r.resting <= 0) return `${side === 'buy' ? '买' : '卖'}单已即时成交：${name}×${r.filled.toLocaleString('zh-CN')} @ ${p} 信用点（无需再等撮合）。`
  return `${side === 'buy' ? '买' : '卖'}单已即时成交 ${r.filled.toLocaleString('zh-CN')} 件，余 ${r.resting.toLocaleString('zh-CN')} 件挂单 @ ${p} 信用点。`
}
