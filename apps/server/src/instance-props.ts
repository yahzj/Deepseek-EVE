import { ApiError } from './auth.js';
import type { Catalog, CatalogItem } from './catalog.js';

/** 舰船快照允许出现的字段（白名单：其余字段一律拒绝，防止往实例里塞任意垃圾）。 */
const SHIP_PROP_KEYS = new Set(['hullId', 'name', 'fit', 'plugs', 'hp']);

/** 一艘船最多能插的插件数（high/mid/low 三类 rack 合计的经验上限）。 */
const MAX_PLUGS = 8;

/** 实例属性快照的通用体积上限（字节）。 */
const MAX_PROPS_BYTES = 2048;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 校验并归一化「实例物品」的属性快照。
 *
 * 为什么舰船要严格校验：舰船按实例流转，快照就是市场里的「货况」——改档者若能随手写出
 * 「护卫舰装了 8 个重型炮台、护盾 1 亿」，市场就变成了凭空造价值的地方。所以这里做四件事：
 * 1. 白名单字段，未知字段直接拒绝；
 * 2. `hullId` 必须等于商品定义（防止拿便宜船的名字套贵船的壳）；
 * 3. 装配件数与插件数不得超过该船槽位（ships.csv 的高/中/低槽数）；
 * 4. 耐久不得超过白板值的安全倍数（装配与插件会加成，所以给 2 倍 + 1000 的宽容度）。
 *
 * 装备/蓝图/核心这类实例不参与价值判定（它们的价值由 basePrice 决定），只做体积与对象校验。
 */
export function validateInstanceProps(
  catalog: Catalog,
  item: CatalogItem,
  rawProps: unknown,
): Record<string, unknown> {
  if (rawProps === undefined || rawProps === null) {
    if (item.marketKind === 'ship') {
      throw new ApiError(400, 'missing_ship_props', `舰船 ${item.id} 必须携带船体快照（hullId）`);
    }
    return {};
  }
  if (!isPlainObject(rawProps)) {
    throw new ApiError(400, 'bad_props', '实例属性快照必须是对象');
  }
  if (JSON.stringify(rawProps).length > MAX_PROPS_BYTES) {
    throw new ApiError(400, 'props_too_large', `实例属性快照不能超过 ${MAX_PROPS_BYTES} 字节`);
  }
  if (item.marketKind !== 'ship') {
    return rawProps;
  }

  for (const key of Object.keys(rawProps)) {
    if (!SHIP_PROP_KEYS.has(key)) {
      throw new ApiError(400, 'unknown_ship_prop', `舰船快照不允许字段「${key}」`);
    }
  }

  const hullId = rawProps['hullId'];
  if (typeof hullId !== 'string' || hullId !== item.id) {
    throw new ApiError(400, 'ship_hull_mismatch', `舰船快照的 hullId 必须等于 ${item.id}`);
  }

  const spec = item.ship;
  if (!spec) {
    throw new ApiError(400, 'unknown_ship_spec', `内容表缺少舰船 ${item.id} 的规格`);
  }

  const name = rawProps['name'];
  if (name !== undefined && (typeof name !== 'string' || [...name].length > 32)) {
    throw new ApiError(400, 'bad_ship_name', '船名必须是不超过 32 字的字符串');
  }

  const slotTotal = spec.slots.high + spec.slots.mid + spec.slots.low;
  const fit = rawProps['fit'];
  if (fit !== undefined) {
    if (!Array.isArray(fit)) {
      throw new ApiError(400, 'bad_ship_fit', 'fit 必须是装备 id 数组');
    }
    if (fit.length > slotTotal) {
      throw new ApiError(400, 'ship_fit_overflow', `${item.id} 只有 ${slotTotal} 个槽位，装不下 ${fit.length} 件`);
    }
    for (const moduleId of fit) {
      const module = typeof moduleId === 'string' ? catalog.get(moduleId) : undefined;
      if (!module || module.marketKind !== 'module') {
        throw new ApiError(400, 'unknown_module', `装配里出现未知装备：${String(moduleId)}`);
      }
    }
  }

  const plugs = rawProps['plugs'];
  if (plugs !== undefined) {
    if (!Array.isArray(plugs) || plugs.length > MAX_PLUGS) {
      throw new ApiError(400, 'bad_ship_plugs', `plugs 必须是数组且不超过 ${MAX_PLUGS} 条`);
    }
    for (const plugId of plugs) {
      if (typeof plugId !== 'string' || !catalog.get(plugId)) {
        throw new ApiError(400, 'unknown_plug', `插件里出现未知物品：${String(plugId)}`);
      }
    }
  }

  const hp = rawProps['hp'];
  if (hp !== undefined) {
    if (!isPlainObject(hp)) {
      throw new ApiError(400, 'bad_ship_hp', 'hp 必须是 { shield, armor, structure } 对象');
    }
    const ceilings: Array<[string, number]> = [
      ['shield', spec.hp.shield],
      ['armor', spec.hp.armor],
      ['structure', spec.hp.structure],
    ];
    for (const [key, base] of ceilings) {
      const value = hp[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ApiError(400, 'bad_ship_hp', `hp.${key} 必须是非负数字`);
      }
      // 装配与插件会加耐久，给 2 倍白板值 + 1000 的宽容度，超出即视为改档
      if (base > 0 && value > base * 2 + 1000) {
        throw new ApiError(
          400,
          'ship_hp_overflow',
          `hp.${key}=${value} 超过 ${item.id} 的合理上限（白板 ${base}）`,
        );
      }
    }
  }

  return rawProps;
}
