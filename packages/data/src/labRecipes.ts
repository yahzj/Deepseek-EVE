/**
 * **实验室配方表**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料。
 * 实验室的生产卡片和其他工业卡片类似」）。
 *
 * 口径：
 * - **一批 = 一份 BOM ⇒ 一批产物**（可连续跑到料尽，见 `core/lab.ts`）；
 * - **虚空晶用量**（船长原话：「同时超空间折跃燃料还需要少量的虚空晶」；**2026-09-30 船长令**：
 *   「**将燃料消耗的虚空晶\*10**」⇒ 6 → **60 枚/批**）：每批（600 单位燃料）吃 **60 枚虚空晶**
 *   ⇒ 每单位燃料 **0.1 枚**；一批料价随之 46,540 → **240,940 ISK**（站内收价口径，虚空晶 3,600/枚），
 *   自产单价 **77.57 → 401.57 ISK/单位**（市场行价同日抬到 420，见 `marketCatalog.ts`）；
 * - **主料 = 新精炼三件套**（折跃等离子/低温跃迁浆/曲率凝析物，见 `items.ts` 的气/冰重配比）；
 * - **工期 5 分钟/批**（基准值；起线时按「产线节拍学」等既有工业技能缩短，与精炼炉同一成法）；
 * - **解锁门槛 = 已建成空间站 ≥ 1 座**（船长令：「基础燃料合成不需要蓝图，但是需要玩家建设第一个
 *   空间站后才解锁相关内容」）⇒ 配方本身**不需要蓝图**，门槛由 `core/lab.ts` 的门判。
 *
 * ⚠ **2026-09-30 修（P0）**：主料 id 原先写成 `min-jumpplasma`（**双 p**，表里没有这个物品），
 * 真的矿物是 `min-jumplasma`（`items.ts` 的气/冰精炼产物）⇒ `labAffordableBatches` 永远算 0 批、
 * **实验室在真游戏里根本起不了线**（"材料不足一批"），燃料链等于死的。
 * 为什么一直没被抓住：`content:check` 当时**没有"实验室配方 BOM 可解析"这条契约**，而用例是照配方
 * 自己的 id 灌料的 ⇒ 幽灵 id 在测试里也能"备齐"。现在契约与用例都补上了（见该批工作文档）。
 */
import type { LabRecipeDef } from '@whale/core'

export const LAB_RECIPES: readonly LabRecipeDef[] = [
  {
    id: 'jump-fuel',
    name: '超空间折跃燃料',
    outputItemId: 'jump-fuel',
    outputUnits: 600,
    cycleMs: 5 * 60 * 1000,
    materials: [
      { itemId: 'min-jumplasma', units: 60 },
      { itemId: 'min-cryoslurry', units: 60 },
      { itemId: 'min-curvature', units: 12 },
      // 2026-09-30 船长令「将燃料消耗的虚空晶*10」：6 → 60 枚/批（每单位燃料 0.1 枚）
      { itemId: 'min-voidcrystal', units: 60 },
      { itemId: 'min-isotope', units: 100 },
    ],
  },
  /* ═══ 实验室后续内容（**2026-09-30 船长令**「你先继续制作后续实验室内容」＋「信号发射器和技能加速剂」）═══
   * 口径（见工作文档 `docs/design/lab-consumables-20260930.md` 与 `docs/design/beacon-parts-20260930.md`）：
   * - **造价**（船长 2026-09-29 定）：突触加速剂 **2,000 虚空晶** · 信号发射器 **10,000 虚空晶**；
   * - **信号发射器的其余材料**（船长 2026-09-30 令「**将一部分非虚空晶材料换成量子协处理器芯和电路基板**」，
   *   同日「按你推荐来」定**甲案**）：非虚空晶那三条矿物**整条换成两种零件** —— 量子协处理器芯 **2,000**
   *   ＋ 电路基板 **18,000**（两件都是常驻市场件、可买可造）⇒ 一批料价 39,140,000 → **39,110,000**，
   *   与行价 96,000,000 的料/价 40.8% → **40.7%**（等值替换、锚不动）；
   * - **突触加速剂的其余材料**＝我按"料价 ×2.4 ⇒ 奇货行价"的口径提的（待船长核，见文档"待确认"节）；
   * - 两张都已在 **2026-09-30 上线**（施工期 `unreleased` 已摘，见 `items.ts` 的同批标记）。 */
  {
    id: 'synaptic-accelerant',
    name: '突触加速剂',
    outputItemId: 'synaptic-accelerant',
    outputUnits: 1,
    cycleMs: 30 * 60 * 1000,
    materials: [
      { itemId: 'min-voidcrystal', units: 2_000 },
      { itemId: 'min-curvature', units: 400 },
      { itemId: 'min-isotope', units: 4_000 },
    ],
  },
  {
    id: 'invasion-beacon',
    name: '信号发射器',
    outputItemId: 'invasion-beacon',
    outputUnits: 1,
    cycleMs: 2 * 60 * 60 * 1000,
    materials: [
      // 2026-09-30 船长令（非虚空晶材料换成零件 · 甲案）：料价 39,110,000（料/价 40.8%，等值替换）
      { itemId: 'min-voidcrystal', units: 10_000 },
      { itemId: 'part-qchip', units: 2_000 },
      { itemId: 'part-circuit', units: 18_000 },
    ],
  },
]

/** 玩家可见的配方（施工期 `unreleased` 的不列；界面与开工校验都读它） */
export function buildLabRecipeCatalog(): ReadonlyMap<string, LabRecipeDef> {
  return new Map(LAB_RECIPES.filter((r) => r.unreleased !== true).map((r) => [r.id, r]))
}
