import { Catalog, productionCapOf, type CatalogItem, type ShipSpec } from './catalog.js';
import { appendEntry, tx } from './ledger.js';
import type { App } from './app.js';

/** 与生产默认值同口径的类别硬顶，测试目录自行算逐物品上限用。 */
const KIND_CAPS = { item: 8000, module: 40, ship: 6, blueprint: 10, aicore: 6 };
const VALUE_QUOTA = 500_000;

/** 测试船规格：2 高 / 2 中 / 2 低，白板结构 500。 */
const TEST_SHIP_SPEC: ShipSpec = {
  cpuTotal: 100,
  slots: { high: 2, mid: 2, low: 2 },
  droneBayM3: 50,
  hp: { shield: 300, armor: 400, structure: 500 },
  unreleased: false,
};

const item = (overrides: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name'>): CatalogItem => {
  const merged = {
    marketKind: 'item',
    rarity: 'common',
    basePrice: 100,
    npcBuyPrice: null,
    playerSellable: true,
    playerBuyable: true,
    floorPrice: 60,
    instanceBased: false,
    ...overrides,
  };
  return {
    ...merged,
    productionCapPerMin: productionCapOf(
      merged.basePrice,
      merged.marketKind,
      VALUE_QUOTA,
      KIND_CAPS,
    ),
    ship: overrides.ship ?? null,
  };
};

/** 测试用固定目录：不依赖真实内容表，价格已知便于断言。 */
export const TEST_CATALOG = new Catalog([
  item({ id: 'ore-test', name: '测试矿', basePrice: 100, floorPrice: 60 }),
  item({ id: 'part-test', name: '测试零件', basePrice: 250, floorPrice: 150 }),
  item({
    id: 'ship-test',
    name: '测试船',
    marketKind: 'ship',
    basePrice: 1000,
    floorPrice: 600,
    instanceBased: true,
    ship: TEST_SHIP_SPEC,
  }),
  item({
    id: 'ship-capital',
    name: '测试战列舰',
    marketKind: 'ship',
    basePrice: 50_000_000,
    floorPrice: 30_000_000,
    instanceBased: true,
    ship: TEST_SHIP_SPEC,
  }),
  item({
    id: 'mod-test',
    name: '测试装备',
    marketKind: 'module',
    basePrice: 400,
    floorPrice: 240,
    instanceBased: true,
  }),
  item({
    id: 'no-sell',
    name: '不可卖品',
    basePrice: 100,
    floorPrice: 60,
    playerSellable: false,
  }),
]);

/** 测试专用：直接写账本给账号发信用点（正式环境没有这个入口）。 */
export function seedCredits(app: App, accountId: number, amount: number, ref = 'test-seed'): void {
  if (amount === 0) {
    return;
  }
  tx(app.db, () => {
    appendEntry(app.db, {
      accountId,
      entryType: 'test_seed',
      refType: 'test',
      refId: ref,
      creditsDelta: amount,
    });
  });
}

/** 测试专用：直接写账本发可堆叠物品。 */
export function seedStack(app: App, accountId: number, itemDefId: string, qty: number): void {
  if (qty === 0) {
    return;
  }
  tx(app.db, () => {
    appendEntry(app.db, {
      accountId,
      entryType: 'test_seed',
      refType: 'test',
      refId: `seed-${itemDefId}`,
      itemDefId,
      qtyDelta: qty,
    });
  });
}
