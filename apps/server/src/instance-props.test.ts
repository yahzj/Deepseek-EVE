import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './auth.js';
import { validateInstanceProps } from './instance-props.js';
import { loadRealCatalog } from './test-content.js';

const catalog = loadRealCatalog();

/** 断言校验抛出的错误码，避免只断言「报错了」而掩盖错误原因。 */
const assertCode = (fn: () => unknown, code: string): void => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `应抛 ApiError，实际 ${String(error)}`);
    assert.equal((error as ApiError).code, code);
    return;
  }
  assert.fail(`应抛出 ${code}，但没有报错`);
};

describe('舰船实例快照校验（真实内容表）', () => {
  it('合法快照通过：船体一致、装配在槽位内、耐久不超上限', () => {
    const ship = catalog.get('ship-whale');
    assert.ok(ship?.ship, '鲸鱼级应有规格');
    const slots = ship.ship.slots.high + ship.ship.slots.mid + ship.ship.slots.low;

    const props = {
      hullId: 'ship-whale',
      name: '抹香鲸号',
      fit: ['mod-miner-1'],
      hp: { shield: Math.floor(ship.ship.hp.shield * 1.5), armor: ship.ship.hp.armor, structure: 1 },
    };
    assert.equal(validateInstanceProps(catalog, ship, props), props);

    // 空装配也要能通过（新船刚出厂）
    assert.deepEqual(validateInstanceProps(catalog, ship, { hullId: 'ship-whale', fit: [] }), {
      hullId: 'ship-whale',
      fit: [],
    });
    assert.ok(slots > 0);
  });

  it('船体 id 必须与商品定义一致（防拿便宜船套贵船壳）', () => {
    const ship = catalog.get('ship-whale')!;
    assertCode(() => validateInstanceProps(catalog, ship, { hullId: 'ship-pioneer' }), 'ship_hull_mismatch');
    assertCode(() => validateInstanceProps(catalog, ship, { fit: [] }), 'ship_hull_mismatch');
    assertCode(() => validateInstanceProps(catalog, ship, undefined), 'missing_ship_props');
  });

  it('装配件数不能超过该船槽位，且必须是已知装备', () => {
    const ship = catalog.get('ship-whale')!;
    const total = ship.ship!.slots.high + ship.ship!.slots.mid + ship.ship!.slots.low;
    const tooMany = Array.from({ length: total + 1 }, () => 'mod-miner-1');
    assertCode(
      () => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', fit: tooMany }),
      'ship_fit_overflow',
    );
    // 矿石不是装备，塞进装配里应被拒
    assertCode(
      () => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', fit: ['ore-veldspar'] }),
      'unknown_module',
    );
    assertCode(
      () => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', fit: ['mod-does-not-exist'] }),
      'unknown_module',
    );
  });

  it('耐久超白板安全倍数视为改档，未知字段直接拒绝', () => {
    const ship = catalog.get('ship-whale')!;
    const ceiling = ship.ship!.hp.structure * 2 + 1000;
    assertCode(
      () =>
        validateInstanceProps(catalog, ship, {
          hullId: 'ship-whale',
          hp: { structure: ceiling + 1 },
        }),
      'ship_hp_overflow',
    );
    // 恰好等于上限允许（边界）
    assert.ok(
      validateInstanceProps(catalog, ship, { hullId: 'ship-whale', hp: { structure: ceiling } }),
    );
    assertCode(() => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', hp: -1 }), 'bad_ship_hp');
    assertCode(
      () => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', cheat: true }),
      'unknown_ship_prop',
    );
    assertCode(
      () => validateInstanceProps(catalog, ship, { hullId: 'ship-whale', name: 'x'.repeat(33) }),
      'bad_ship_name',
    );
  });

  it('非舰船实例保持宽松：蓝图/装备只做对象与体积校验', () => {
    const blueprint = catalog.get('bp-miner-1');
    assert.ok(blueprint, '应能查到蓝图');
    assert.equal(blueprint.instanceBased, true);
    assert.equal(blueprint.marketKind, 'blueprint');

    assert.deepEqual(validateInstanceProps(catalog, blueprint, undefined), {});
    assert.deepEqual(validateInstanceProps(catalog, blueprint, { singleUse: false }), { singleUse: false });
    assertCode(() => validateInstanceProps(catalog, blueprint, ['not', 'object']), 'bad_props');
    assertCode(
      () => validateInstanceProps(catalog, blueprint, { blob: 'x'.repeat(4000) }),
      'props_too_large',
    );
  });
});
