/**
 * **材料行尾的「这一味料从哪来」跳转链接**（**2026-10-01 船长令**：「实验室的卡片还是使用自己的富文本规则，
 * 和组装机不一样（比如卡片标题有个'去弄料'，下方的原材料没有'去精炼''去组装机'然后字体样式也不一致）」）。
 *
 * 这段判定**原先只写在组装机卡的材料行里**（`panels/Industry.tsx` 的行内 IIFE）。实验室卡要与它对齐，
 * 若照抄一份就是两处各判一次、迟早漂（§十五之二 取数与派生纪律：单一来源）⇒ 整段搬到本件，
 * **组装机卡与实验室卡共用同一份**，两边的材料行从此逐字同款。
 *
 * 四支（优先级从上到下，与 §6「同级相似项」同一份口径）：
 * ① **声望商店**：该味料是通用黑匣（市场只收不卖、只有章鱼人声望商店一条来路）⇒「🛒 去声望商店」；
 * ② **有精炼源矿石**（`refineSourcesOf`）⇒「⚒ 去精炼」；
 * ③ **能在本机器上造出来**（零件等，`blueprintProducingItem`）⇒「🏭 去组装机」；
 * ④ 其余 ⇒「🛒 去市场」。
 * 点击一律交给调用方的 `onNeedMineral`（页内 `handleNeedMineral` 那条链：精炼 ⇒ 组装机 ⇒ 市场 ⇒ toast），
 * 唯一例外是第①支走 `onGotoPlugExchange`。
 *
 * ⚠ **等价组**：第①支按调用方传进来的 `groupIds`（`materialGroupIdsOf` 的产物）判，不按 `itemId` 直比 ——
 * 配方里写的是 `blackbox-h`，直接比 id 永远不成立（2026-09-29 实测踩到，读数照旧"去市场"）。
 * 组装机那条链的完整缘由（含各支文案的由来）留在 `panels/Industry.tsx` 材料行的注释里，本件只承载代码。
 */
import type { ReactNode } from 'react'
import { blueprintProducingItem, UNIVERSAL_BLACKBOX_ITEM_ID, visibleItemDefs } from '@whale/core'
import { tr } from '../i18n/locale'
import type { GameEngine } from '../game/engine'

/** 精炼源矿石：精炼配方（`def.refine`）产出该矿物的矿石 id 列表；空 = 无精炼产出，只能市场购买。
 *  ⚠ 只列**玩家可见**的矿（`visibleItemDefs`）：未上线矿石不能作为"由精炼炉炼出"的提示来源
 *  （否则"虚空晶由虚空母矿炼出"会把未上线矿名念给玩家听）。 */
export function refineSourcesOf(engine: GameEngine, mineralId: string): string[] {
  const out: string[] = []
  for (const def of visibleItemDefs(engine.ctx)) {
    if (def.kind === 'wreck') continue
    if ((def.refine ?? []).some((r) => r.mineralId === mineralId)) out.push(def.id)
  }
  return out
}

export function MatSourceLink({
  engine,
  itemId,
  matName,
  groupIds,
  onNeedMineral,
  onGotoPlugExchange,
}: {
  engine: GameEngine
  /** 配方里写的那个材料 id（点击与三支判定都用它） */
  itemId: string
  /** 该行**显示用**的名字（等价组口径：有哪种报哪种，见 `materialDisplayIdOf`）——只进悬停说明 */
  matName: string
  /** `materialGroupIdsOf(itemId)`（调用方多半已经算过，直接传进来，别在这里重算一遍） */
  groupIds: readonly string[]
  /** 「去弄料」那条链（页内 `handleNeedMineral`）；不给 ⇒ 整枚链接不渲染（与组装机卡原行为一致） */
  onNeedMineral?: (itemId: string) => void
  /** 第①支的落点：声望商店（章鱼人插件兑换） */
  onGotoPlugExchange?: () => void
}): ReactNode {
  if (onNeedMineral === undefined) return null
  const fromShop = groupIds.includes(UNIVERSAL_BLACKBOX_ITEM_ID)
  const srcs = refineSourcesOf(engine, itemId)
  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
  const madeBy = fromShop ? undefined : blueprintProducingItem(engine.ctx, itemId)
  const title = fromShop
    ? tr('ui.Industry.158', { matName })
    : srcs.length > 0
      ? tr('ui.Industry.109', { matName, p2: srcs.map(srcName).join(tr('ui.MatterTechTab.017')) })
      : madeBy
        ? tr('ui.Industry.155', { matName, p2: madeBy.name })
        : tr('ui.Industry.110', { matName })
  return (
    <span
      className="app-bp-mat-act"
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => (fromShop ? onGotoPlugExchange?.() : onNeedMineral(itemId))}
    >
      {fromShop
        ? tr('ui.Industry.159')
        : srcs.length > 0
          ? tr('ui.Industry.047')
          : madeBy
            ? tr('ui.Industry.154')
            : tr('ui.Industry.048')}
    </span>
  )
}
