/**
 * **图鉴条目 → 市场商品键**（2026-09-14 船长：「玩家查看图鉴内的道具时，添加一个跳转市场的按钮」）。
 *
 * 为什么单独一个小模块（而不是写在 `panels/Handbook.tsx` 里）：
 * - **体检要跨层调它**（`tools/content-check.ts` 的「图鉴市场跳转契约」逐个走一遍四类图鉴目录）；
 * - 而 `panels/Handbook.tsx` 会 import `@whale/ui` → `packages/ui/src/index.css`
 *   ⇒ node 侧 `tsx` 直接加载会 `SyntaxError: Unexpected token ':'`（实测）。本模块**只依赖 `@whale/core`**
 *   （与 `ui/shipInfo.tsx` 那条既有跨层契约同款），任何一侧都能安全 import。
 *
 * 映射口径：图鉴四类的主键就是各自目录的 id（物品 / 装备 / 舰船 / 蓝图）⇒ 直接问 core 的
 * `marketGoodOf(ctx, kind, refId)`（与物品页 / 货舱页 / 组装机**同一个查询口**）。
 * 其余页签（玩法速览 / 航行须知 / 技能速查）不涉市场 ⇒ 返回 `null`。
 * **没有市场行的条目也返回 `null`**（照物品页口径：那枚按钮**不渲染**，而不是置灰）。
 */
import { marketGoodOf } from '@whale/core'
import type { MarketGoodKind, SimContext } from '@whale/core'

export function handMarketKeyOf(ctx: SimContext, tab: string, key: string): string | null {
  const kind: MarketGoodKind | null =
    tab === 'items'
      ? 'item'
      : tab === 'modules'
        ? 'module'
        : tab === 'ships'
          ? 'ship'
          : tab === 'blueprints'
            ? 'blueprint'
            : null
  if (kind === null) return null
  return marketGoodOf(ctx, kind, key)?.key ?? null
}
