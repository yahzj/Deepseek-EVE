import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 舰船规格（ships.csv 摘取的、服务端需要校验与展示的那部分） */
export interface ShipSpec {
  cpuTotal: number;
  slots: { high: number; mid: number; low: number };
  droneBayM3: number;
  /** 白板耐久上限（不含装配/插件加成） */
  hp: { shield: number; armor: number; structure: number };
  /** ships.csv 的「未上线闸门」：施工期对玩家不可见的船 */
  unreleased: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  /** market.csv 的 kind：item/module/ship/blueprint/aicore */
  marketKind: string;
  rarity: string;
  basePrice: number;
  /** 空间站收购价（items.csv 有则带上，没有为 null） */
  npcBuyPrice: number | null;
  playerSellable: boolean;
  playerBuyable: boolean;
  /** 公共市场挂单最低价 = floor(basePrice × 系数)，至少 1 */
  floorPrice: number;
  /** 是否按唯一实例交易（舰船/装备/蓝图/核心），否则按可堆叠数量交易 */
  instanceBased: boolean;
  /**
   * 逐物品的「每分钟最多入账数量」：按 basePrice 折算的价值配额与类别硬顶取小。
   * 低价原料得到大配额、高价成品得到小配额，无需为每种物品手配数字。
   */
  productionCapPerMin: number;
  /** 舰船才有：槽位与耐久，用于校验客户端上报的实例快照 */
  ship: ShipSpec | null;
}

/** 需要唯一实例编号的类别：属性不可堆叠、逐个流转的东西。 */
const INSTANCE_MARKET_KINDS = new Set(['module', 'ship', 'blueprint', 'aicore']);

/** 极简 CSV 解析：支持双引号包裹、逗号转义、BOM 头，够读内容表用。 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }
  return rows;
}

export function toRows(text: string): Array<Record<string, string>> {
  const table = parseCsv(text);
  if (table.length === 0) {
    return [];
  }
  const header = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      row[key] = (cells[index] ?? '').trim();
    });
    return row;
  });
}

const pick = (row: Record<string, string>, ...keys: string[]): string => {
  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key];
    }
  }
  return '';
};

/** 内容表列名带长篇注释（如「高槽数」），按前缀取第一个命中的列。 */
const pickPrefix = (row: Record<string, string>, prefix: string): string => {
  for (const key of Object.keys(row)) {
    if (key.startsWith(prefix)) {
      return row[key];
    }
  }
  return '';
};

const numOrNull = (raw: string): number | null => {
  const value = Number(raw);
  return raw === '' || !Number.isFinite(value) ? null : value;
};

const numOr = (raw: string, fallback: number): number => {
  const value = Number(raw);
  return raw === '' || !Number.isFinite(value) ? fallback : value;
};

/**
 * 原料类判定的价格上限（信用点）：单价低于它的可堆叠物按「原料」看待。
 * 依据：矿石/冰/气体最贵的一档约 1300 cr（ore-voidmother），掉落箱与黑匣从 350 万起，中间有巨大断层。
 */
const RAW_MATERIAL_PRICE_CEILING = 2000;
/**
 * 原料的每分钟数量保底：一趟满载约 15.7 万单位、约 50 分钟，即 3000 单位/分钟量级。
 * 光按价值折算会把高价矿（如 1300 cr 的虚空母矿）压到 384/分钟，正常玩家会被误拒，
 * 所以原料给 2000 的保底，再由「跨物品价值闸门」防止用高价矿刷价值。
 */
const RAW_MATERIAL_FLOOR = 2000;

/**
 * 逐物品产出上限：
 * - **原料/材料**（可堆叠、单价 ≤ 2000）：min(类别硬顶, max(价值折算, 2000))；
 * - **成品与珍稀掉落**（装备/舰船/蓝图/核心、以及高价箱与黑匣）：min(类别硬顶, 价值折算)，最低 1。
 * 例：12 cr 橄榄岩 8000/分钟；1300 cr 虚空母矿 2000/分钟；6750 万战列舰 1 艘/分钟；8000 万黑匣 1 个/分钟。
 */
export function productionCapOf(
  basePrice: number,
  marketKind: string,
  valueQuota: number,
  kindCaps: Record<string, number>,
): number {
  const kindCap = kindCaps[marketKind] ?? 8000;
  const byValue = Math.floor(valueQuota / Math.max(1, basePrice));
  const isRawMaterial = marketKind === 'item' && basePrice <= RAW_MATERIAL_PRICE_CEILING;
  const effective = isRawMaterial ? Math.max(byValue, RAW_MATERIAL_FLOOR) : byValue;
  return Math.max(1, Math.min(kindCap, effective));
}

export class Catalog {
  private readonly items = new Map<string, CatalogItem>();

  constructor(entries: CatalogItem[]) {
    for (const entry of entries) {
      this.items.set(entry.id, entry);
    }
  }

  get(id: string): CatalogItem | undefined {
    return this.items.get(id);
  }

  all(): CatalogItem[] {
    return [...this.items.values()];
  }

  /** 能挂卖单的物品：market.csv 有基准价且允许玩家卖出。 */
  tradeable(id: string): CatalogItem | undefined {
    const item = this.items.get(id);
    return item && item.playerSellable ? item : undefined;
  }
}

export interface CatalogOptions {
  /** 最低价系数：floor = basePrice × 该系数 */
  floorRatio: number;
  /** 每分钟允许入账的物品价值（信用点，按 basePrice 折算） */
  productionValueQuota: number;
  /** 按 kind 的每分钟数量硬顶 */
  productionKindCaps: Record<string, number>;
}

/**
 * 从内容表构建物品目录：
 * - market.csv 决定「有哪些物品、基准价、稀有度、能否买卖」（权威来源）；
 * - items.csv / ships.csv / modules.csv / plugs.csv / plugBlueprints.csv 只用来补名称、收购价与舰船规格。
 */
export function loadCatalog(contentDir: string, options: CatalogOptions): Catalog {
  const read = (file: string): Array<Record<string, string>> => {
    const full = join(contentDir, file);
    return existsSync(full) ? toRows(readFileSync(full, 'utf8')) : [];
  };

  const names = new Map<string, string>();
  const npcPrices = new Map<string, number>();
  for (const file of ['items.csv', 'ships.csv', 'modules.csv', 'plugs.csv', 'plugBlueprints.csv']) {
    for (const row of read(file)) {
      const id = pick(row, 'id');
      if (!id) {
        continue;
      }
      const name = pick(row, '名称');
      if (name) {
        names.set(id, name);
      }
      // 只有 items.csv 有「空间站收购价」；ships.csv 的售价是卖给玩家的价，不能当收购价用
      if (file === 'items.csv') {
        const npc = numOrNull(pick(row, '空间站收购价信用点'));
        if (npc !== null && npc > 0) {
          npcPrices.set(id, npc);
        }
      }
    }
  }

  const ships = new Map<string, ShipSpec>();
  for (const row of read('ships.csv')) {
    const id = pick(row, 'id');
    if (!id) {
      continue;
    }
    const spec: ShipSpec = {
      cpuTotal: numOr(pick(row, 'CPU总量'), 0),
      slots: {
        high: numOr(pickPrefix(row, '高槽数'), 0),
        mid: numOr(pickPrefix(row, '中槽数'), 0),
        low: numOr(pickPrefix(row, '低槽数'), 0),
      },
      droneBayM3: numOr(pickPrefix(row, '无人机舱'), 0),
      hp: {
        shield: numOr(pick(row, '护盾量'), 0),
        armor: numOr(pick(row, '装甲量'), 0),
        structure: numOr(pick(row, '结构量'), 0),
      },
      unreleased: pickPrefix(row, '未上线闸门') === '是',
    };
    ships.set(id, spec);
    /**
     * market.csv 的舰船 key 与 ships.csv 的 id 两套命名混用：
     * - ships.csv 既有裸名（whale、whale-king），也有 sh- 前缀（sh-humpback、sh-wh-a-frigate）；
     * - market.csv 多数写作 ship-<裸名>（ship-whale、ship-humpback），少数直接用 sh- id。
     * 所以同时登记「原 id」与「ship-<去掉 sh- 的裸名>」两种写法，两边都能命中。
     */
    const bareId = id.startsWith('sh-') ? id.slice(3) : id;
    const alias = `ship-${bareId}`;
    if (!ships.has(alias)) {
      ships.set(alias, spec);
    }
    // 别名也要带上中文名，否则市场里会显示成 ship-bowhead 这种 id
    const shipName = pick(row, '名称');
    if (shipName) {
      names.set(id, names.get(id) ?? shipName);
      names.set(alias, names.get(alias) ?? shipName);
    }
  }

  const entries: CatalogItem[] = [];
  for (const row of read('market.csv')) {
    const id = pick(row, 'key(=refId；与其它表id对应)', 'key');
    const basePrice = numOrNull(pick(row, '基准价basePrice(池商品=均衡价；单件=供应价)', 'basePrice'));
    if (!id || basePrice === null || basePrice <= 0) {
      continue;
    }
    const marketKind = pick(row, 'kind(item物品/module装备/ship舰船/blueprint蓝图/aicore核心)', 'kind') || 'item';
    const sellableRaw = pick(row, '可否卖出playerSellable(空=默认可)');
    const buyableRaw = pick(row, '可否买入playerBuyable(空=默认可)');
    entries.push({
      id,
      name: names.get(id) ?? id,
      marketKind,
      rarity: pick(row, 'rarity(common常驻/rare稀有/exotic限定)') || 'common',
      basePrice,
      npcBuyPrice: npcPrices.get(id) ?? null,
      playerSellable: sellableRaw === '' ? true : sellableRaw !== '0' && sellableRaw !== 'false',
      playerBuyable: buyableRaw === '' ? true : buyableRaw !== '0' && buyableRaw !== 'false',
      floorPrice: Math.max(1, Math.floor(basePrice * options.floorRatio)),
      instanceBased: INSTANCE_MARKET_KINDS.has(marketKind),
      productionCapPerMin: productionCapOf(
        basePrice,
        marketKind,
        options.productionValueQuota,
        options.productionKindCaps,
      ),
      ship: marketKind === 'ship' ? ships.get(id) ?? null : null,
    });
  }
  return new Catalog(entries);
}

/** 测试或无内容表场景用的空目录。 */
export function emptyCatalog(): Catalog {
  return new Catalog([]);
}
