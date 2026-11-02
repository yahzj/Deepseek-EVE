import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

interface ReportBody {
  batchId: string;
  clientTs?: number;
  items: Array<{ itemDefId: string; qty: number; instanceId?: string; props?: unknown }>;
}

const report = (token: string, body: ReportBody): Promise<Response> =>
  fetch(`${current.baseUrl}/api/production/report`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });

describe('产出上报与速率校验', () => {
  it('正常上报入账并记入账本，库存与钱包可查', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '矿工甲');

    const res = await report(account.token, {
      batchId: 'batch-mining-0001',
      items: [{ itemDefId: 'ore-test', qty: 120 }],
    });
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { accepted: boolean };
    assert.equal(payload.accepted, true);

    const inv = await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(account.token) });
    const inventory = (await inv.json()) as { stacks: Array<{ itemDefId: string; qty: number }> };
    assert.equal(inventory.stacks.find((s) => s.itemDefId === 'ore-test')?.qty, 120);

    const ledger = await fetch(`${current.baseUrl}/api/ledger/entries`, {
      headers: authHeaders(account.token),
    });
    const entries = (await ledger.json()) as { entries: Array<{ entryType: string; qtyDelta: number }> };
    const production = entries.entries.filter((e) => e.entryType === 'production');
    assert.equal(production.length, 1);
    assert.equal(production[0].qtyDelta, 120);

    const verify = await fetch(`${current.baseUrl}/api/ledger/verify`, {
      headers: authHeaders(account.token),
    });
    const chain = (await verify.json()) as { chainOk: boolean; checked: number };
    assert.equal(chain.chainOk, true);
    assert.equal(chain.checked, 1);
  });

  it('重复 batchId 幂等：不重复入账', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '重放者');
    const body: ReportBody = { batchId: 'batch-dup-0001', items: [{ itemDefId: 'ore-test', qty: 50 }] };

    const first = await report(account.token, body);
    assert.equal(first.status, 200);
    const second = await report(account.token, body);
    assert.equal(second.status, 200);

    const inv = await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(account.token) });
    const inventory = (await inv.json()) as { stacks: Array<{ itemDefId: string; qty: number }> };
    assert.equal(inventory.stacks.find((s) => s.itemDefId === 'ore-test')?.qty, 50);
  });

  it('超过每分钟产出上限整批拒绝并留审计记录', async () => {
    current = await startTestApp({ productionLimits: { item: 100 } });
    const account = await registerAccount(current.baseUrl, '超速者');

    const ok = await report(account.token, {
      batchId: 'batch-cap-0001',
      items: [{ itemDefId: 'ore-test', qty: 80 }],
    });
    assert.equal(ok.status, 200);

    const over = await report(account.token, {
      batchId: 'batch-cap-0002',
      items: [{ itemDefId: 'ore-test', qty: 60 }],
    });
    assert.equal(over.status, 422);
    const payload = (await over.json()) as { code: string };
    assert.equal(payload.code, 'production_rate_exceeded');

    const inv = await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(account.token) });
    const inventory = (await inv.json()) as { stacks: Array<{ itemDefId: string; qty: number }> };
    assert.equal(inventory.stacks.find((s) => s.itemDefId === 'ore-test')?.qty, 80);

    const audit = current.app.db
      .prepare('SELECT COUNT(*) AS n FROM production_events WHERE accepted = 0')
      .get() as { n: number };
    assert.equal(audit.n, 1);
  });

  it('实例物品必须带 UUID 实例编号，且服务器签发签名', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '船东');
    const instanceId = '0193f2c1-7a4b-7c3d-9e2f-1a2b3c4d5e6f';

    const missing = await report(account.token, {
      batchId: 'batch-ship-bad',
      items: [{ itemDefId: 'ship-test', qty: 1 }],
    });
    assert.equal(missing.status, 400);

    const ok = await report(account.token, {
      batchId: 'batch-ship-0001',
      items: [
        {
          itemDefId: 'ship-test',
          qty: 1,
          instanceId,
          props: { hullId: 'ship-test', name: '测试号', fit: ['mod-test'], hp: { shield: 300, structure: 500 } },
        },
      ],
    });
    assert.equal(ok.status, 200);

    const inv = await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(account.token) });
    const inventory = (await inv.json()) as {
      items: Array<{ instanceId: string; itemDefId: string; props: { hullId?: string } }>;
    };
    assert.equal(inventory.items.length, 1);
    assert.equal(inventory.items[0].instanceId, instanceId);
    assert.equal(inventory.items[0].props.hullId, 'ship-test');

    const verify = await fetch(`${current.baseUrl}/api/items/verify?instanceId=${instanceId}`, {
      headers: authHeaders(account.token),
    });
    const verified = (await verify.json()) as { signature: string; ownerId: number };
    assert.match(verified.signature, /^[0-9a-f]{32}$/);
    assert.equal(verified.ownerId, account.playerId);
  });

  it('未知物品与超量条目数被拒绝', async () => {
    current = await startTestApp({ productionMaxEntries: 2 });
    const account = await registerAccount(current.baseUrl, '乱报者');

    const unknown = await report(account.token, {
      batchId: 'batch-unknown-1',
      items: [{ itemDefId: 'ghost-item', qty: 1 }],
    });
    assert.equal(unknown.status, 400);

    const tooMany = await report(account.token, {
      batchId: 'batch-many-0001',
      items: [
        { itemDefId: 'ore-test', qty: 1 },
        { itemDefId: 'part-test', qty: 1 },
        { itemDefId: 'mod-test', qty: 1 },
      ],
    });
    assert.equal(tooMany.status, 400);
  });

  it('同类别里单价越高的物品，每分钟上限越低（逐物品而非按类别）', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '比价者');

    // 测试目录：ore-test 100 cr → 5000/分钟；part-test 250 cr → 2000/分钟
    const over = await report(account.token, {
      batchId: 'batch-value-cap-1',
      items: [{ itemDefId: 'part-test', qty: 2100 }],
    });
    assert.equal(over.status, 422);
    const payload = (await over.json()) as { code: string; message: string };
    assert.equal(payload.code, 'production_rate_exceeded');
    assert.match(payload.message, /每分钟 2000/);
  });

  it('叠加闸门：各物品占各自上限的比例之和超限则整批拒绝', async () => {
    current = await startTestApp({ productionBatchRatio: 0.5 });
    const account = await registerAccount(current.baseUrl, '叠量者');
    // ore-test 上限 5000，报 3000 → 占 0.6 > 0.5；单物品本身没超（不算 rate_exceeded）
    const res = await report(account.token, {
      batchId: 'batch-total-ratio-1',
      items: [{ itemDefId: 'ore-test', qty: 3000 }],
    });
    assert.equal(res.status, 422);
    assert.equal(((await res.json()) as { code: string }).code, 'production_batch_exceeded');
  });

  it('单件高价物不受绝对价值影响（5000 万的船按 1 艘/分钟放行）', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '战列舰船东');
    const res = await report(account.token, {
      batchId: 'batch-highvalue-1',
      items: [
        {
          itemDefId: 'ship-capital',
          qty: 1,
          instanceId: '0193f2c1-7a4b-7c3d-9e2f-bbbbbbbbbbbb',
          props: { hullId: 'ship-capital' },
        },
      ],
    });
    assert.equal(res.status, 200, '单件高价物不应被叠加闸门误杀');

    // 同分钟内再来一艘就超上限（5000 万 → 1 艘/分钟）
    const second = await report(account.token, {
      batchId: 'batch-highvalue-2',
      items: [
        {
          itemDefId: 'ship-capital',
          qty: 1,
          instanceId: '0193f2c1-7a4b-7c3d-9e2f-bbbbbbbbbbbc',
          props: { hullId: 'ship-capital' },
        },
      ],
    });
    assert.equal(second.status, 422);
    assert.equal(
      ((await second.json()) as { code: string }).code,
      'production_rate_exceeded',
    );
  });

  it('舰船快照改档被拒：船体不符、槽位溢出、耐久超标、未知字段', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '改档者');
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['wrong-hull', { hullId: 'ship-other' }, 'ship_hull_mismatch'],
      [
        'fit-overflow',
        { hullId: 'ship-test', fit: Array.from({ length: 7 }, () => 'mod-test') },
        'ship_fit_overflow',
      ],
      ['hp-overflow', { hullId: 'ship-test', hp: { shield: 999_999 } }, 'ship_hp_overflow'],
      ['unknown-key', { hullId: 'ship-test', cheat: 1 }, 'unknown_ship_prop'],
    ];
    let seq = 0;
    for (const [tag, props, code] of cases) {
      seq += 1;
      const res = await report(account.token, {
        batchId: `batch-ship-bad-${tag}`,
        items: [
          {
            itemDefId: 'ship-test',
            qty: 1,
            instanceId: `0193f2c1-7a4b-7c3d-9e2f-1a2b3c4d5${String(seq).padStart(3, '0')}`,
            props,
          },
        ],
      });
      assert.equal(res.status, 400, `${tag} 应被拒`);
      assert.equal(((await res.json()) as { code: string }).code, code, `${tag} 错误码`);
    }
  });
});
