import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadCatalog, productionCapOf } from './catalog.js';
import { catalogOptions, CONTENT_DIR } from './test-content.js';

const opts = catalogOptions;

describe('内容表目录与最低价', () => {
  it('从真实内容表加载出可交易物品，最低价 = 基准价 × 系数', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    assert.ok(catalog.all().length > 400, `应加载 400+ 物品，实际 ${catalog.all().length}`);

    const ore = catalog.get('ore-veldspar');
    assert.ok(ore, '应能查到橄榄岩');
    assert.equal(ore.basePrice, 12);
    assert.equal(ore.floorPrice, 7); // floor(12 × 0.6) = 7
    assert.equal(ore.instanceBased, false);
    assert.equal(ore.playerSellable, true);
  });

  it('舰船/装备/蓝图按唯一实例交易，矿石按堆叠交易', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const ships = catalog.all().filter((item) => item.marketKind === 'ship');
    const modules = catalog.all().filter((item) => item.marketKind === 'module');
    const items = catalog.all().filter((item) => item.marketKind === 'item');

    assert.ok(ships.length > 0, '内容表里应有舰船');
    assert.ok(modules.length > 0, '内容表里应有装备');
    assert.ok(ships.every((item) => item.instanceBased));
    assert.ok(modules.every((item) => item.instanceBased));
    assert.ok(items.every((item) => !item.instanceBased));
    assert.ok(ships.every((item) => item.floorPrice >= 1));
  });

  it('最低价系数可调，系数变化直接反映到挂单下限', () => {
    const looser = loadCatalog(CONTENT_DIR, opts(0.3));
    const ore = looser.get('ore-veldspar');
    assert.equal(ore?.floorPrice, 3); // floor(12 × 0.3)
  });

  it('不允许玩家卖出的物品不能挂卖单', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const blocked = catalog.all().filter((item) => !item.playerSellable);
    for (const item of blocked) {
      assert.equal(catalog.tradeable(item.id), undefined);
    }
  });
});

describe('逐物品产出上限', () => {
  it('低价原料受类别硬顶约束，高价成品受价值配额约束', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));

    const ore = catalog.get('ore-veldspar');
    assert.ok(ore);
    // 12 cr 的矿石：配额折算 41666，仍被 item 类硬顶 8000 卡住
    assert.equal(ore.productionCapPerMin, 8000);

    const battleship = catalog.get('ship-bowhead');
    assert.ok(battleship, '应能查到战列舰');
    assert.equal(battleship.productionCapPerMin, 1, '6750 万的船每分钟只能入账 1 艘');
  });

  it('同一类别里不同物品的上限不同（不是按类别一刀切）', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const items = catalog.all().filter((item) => item.marketKind === 'item');
    const distinct = new Set(items.map((item) => item.productionCapPerMin));
    assert.ok(distinct.size > 3, `矿石类上限应有多个档位，实际 ${distinct.size} 种`);

    const cheapest = items.reduce((a, b) => (a.basePrice <= b.basePrice ? a : b));
    const priciest = items.reduce((a, b) => (a.basePrice >= b.basePrice ? a : b));
    assert.ok(
      priciest.productionCapPerMin < cheapest.productionCapPerMin,
      `贵物品上限应低于便宜物品：${priciest.id}=${priciest.productionCapPerMin} vs ${cheapest.id}=${cheapest.productionCapPerMin}`,
    );
  });

  it('配额调小只影响成品；原料吃保底，价格再高也不会归 0', () => {
    const tight = loadCatalog(CONTENT_DIR, {
      floorRatio: 0.6,
      productionValueQuota: 600,
      productionKindCaps: { item: 8000, module: 40, ship: 6, blueprint: 10, aicore: 6 },
    });
    // 原料走保底 2000（600/12 = 50 太小，会把正常采矿全卡死）
    const ore = tight.get('ore-veldspar');
    assert.equal(ore?.productionCapPerMin, 2000);

    // 成品按配额折算，最低 1
    const battleship = tight.get('ship-bowhead');
    assert.equal(battleship?.productionCapPerMin, 1, '上限最低为 1，不会是 0');
  });

  it('productionCapOf 取「价值折算」与「类别硬顶」的较小值', () => {
    const caps = { item: 100, ship: 6 };
    // 10 cr 属原料：保底 2000，最终被硬顶 100 卡住
    assert.equal(productionCapOf(10, 'item', 1000, caps), 100);
    // 3000 cr 非原料：折算 900000/3000 = 300，被硬顶 100 卡住
    assert.equal(productionCapOf(3000, 'item', 900_000, caps), 100);
    // 硬顶放宽后按价值折算
    assert.equal(productionCapOf(3000, 'item', 900_000, { item: 5000 }), 300);
    // 天价物品折算为 0 时兜底 1
    assert.equal(productionCapOf(1_000_000, 'ship', 1000, caps), 1);
  });

  it('原料有数量保底，不会被价值折算压死（否则正常采矿被误拒）', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    // 1300 cr 的虚空母矿：纯价值折算只有 384/分钟，保底到 2000
    const voidmother = catalog.get('ore-voidmother');
    assert.ok(voidmother, '应能查到虚空母矿');
    assert.equal(Math.floor(500_000 / voidmother.basePrice), 384);
    assert.equal(voidmother.productionCapPerMin, 2000);
  });

  it('高价掉落物（黑匣/开箱）按价值折算，每分钟最多 1 个', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const blackbox = catalog.get('blackbox-h') ?? catalog.get('blackbox-universal');
    assert.ok(blackbox, '应能查到黑匣');
    assert.ok(blackbox.basePrice > 1_000_000, `黑匣应是高价物，实际 ${blackbox.basePrice}`);
    assert.equal(blackbox.productionCapPerMin, 1);
  });
});

describe('舰船规格（供实例快照校验用）', () => {
  it('舰船带上槽位与耐久白板值，非舰船没有规格', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const ship = catalog.get('ship-whale');
    assert.ok(ship?.ship, '鲸鱼级应有规格');
    assert.ok(ship.ship.slots.high + ship.ship.slots.mid + ship.ship.slots.low > 0, '应有槽位');
    assert.ok(ship.ship.hp.structure > 0, '应有结构值');
    assert.ok(ship.ship.cpuTotal > 0, '应有 CPU 总量');

    const ore = catalog.get('ore-veldspar');
    assert.equal(ore?.ship, null, '矿石没有舰船规格');
  });

  it('每一艘可交易的船都能查到规格（防两套命名漂移）', () => {
    const catalog = loadCatalog(CONTENT_DIR, opts(0.6));
    const ships = catalog.all().filter((item) => item.marketKind === 'ship');
    assert.ok(ships.length > 40, `应有 40+ 艘船，实际 ${ships.length}`);

    const missing = ships.filter((item) => !item.ship).map((item) => item.id);
    assert.deepEqual(missing, [], `这些船在 ships.csv 里找不到规格：${missing.join(', ')}`);

    // 裸名与 sh- 前缀两套写法都要能命中（ship-humpback ← sh-humpback）
    assert.ok(catalog.get('ship-humpback')?.ship, 'ship-humpback 应能对上 sh-humpback');
    assert.ok(catalog.get('ship-bowhead')?.ship, 'ship-bowhead 应能对上 sh-bowhead');
    assert.ok(catalog.get('sh-wh-a-frigate')?.ship, '直接用 sh- id 的 key 也要能命中');
    // 别名不能退化成 id，否则市场里显示成 ship-bowhead
    const bowhead = catalog.get('ship-bowhead');
    assert.ok(bowhead && bowhead.name !== 'ship-bowhead', `别名应带上中文名，实际 ${bowhead?.name}`);
  });
});
