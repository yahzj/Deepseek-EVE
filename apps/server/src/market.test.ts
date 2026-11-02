import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestAccount, type TestApp } from './test-helpers.js';
import { seedCredits, seedStack } from './test-fixtures.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

const place = async (
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> => {
  const res = await fetch(`${current.baseUrl}/api/market/orders`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
};

const wallet = async (token: string): Promise<{ credits: number; escrow: number }> => {
  const res = await fetch(`${current.baseUrl}/api/wallet`, { headers: authHeaders(token) });
  return (await res.json()) as { credits: number; escrow: number };
};

const inventoryOf = async (
  token: string,
): Promise<{ stacks: Array<{ itemDefId: string; qty: number; locked: number }> }> => {
  const res = await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(token) });
  return (await res.json()) as { stacks: Array<{ itemDefId: string; qty: number; locked: number }> };
};

const prepare = (name: string, credits: number, stackQty = 0): Promise<TestAccount> =>
  registerAccount(current.baseUrl, name).then((account) => {
    seedCredits(current.app, account.playerId, credits, `seed-${name}`);
    if (stackQty > 0) {
      seedStack(current.app, account.playerId, 'ore-test', stackQty);
    }
    return account;
  });

describe('市场：挂单、撮合、税与冻结', () => {
  it('卖单低于最低价被拒绝', async () => {
    current = await startTestApp();
    const seller = await prepare('低价挂单者', 0, 100);

    const res = await place(seller.token, { side: 'sell', itemDefId: 'ore-test', qty: 10, price: 50 });
    assert.equal(res.status, 422);
    assert.equal(res.payload['code'], 'below_floor_price');
  });

  it('挂卖单冻结物品，可用数量减少', async () => {
    current = await startTestApp();
    const seller = await prepare('冻结测试', 0, 100);

    const res = await place(seller.token, { side: 'sell', itemDefId: 'ore-test', qty: 30, price: 80 });
    assert.equal(res.status, 200);
    assert.equal(res.payload['status'], 'open');

    const inv = await inventoryOf(seller.token);
    const stack = inv.stacks.find((s) => s.itemDefId === 'ore-test');
    assert.equal(stack?.qty, 100);
    assert.equal(stack?.locked, 30);

    const book = await fetch(`${current.baseUrl}/api/market/book/ore-test`);
    const bookPayload = (await book.json()) as { floorPrice: number; asks: Array<{ price: number; qty: number }> };
    assert.equal(bookPayload.floorPrice, 60);
    assert.deepEqual(bookPayload.asks, [{ price: 80, qty: 30, orders: 1 }]);
  });

  it('跨价成交按挂单方报价，买方多冻结的钱退回，卖方扣 5% 税', async () => {
    current = await startTestApp();
    const seller = await prepare('卖方', 0, 100);
    const buyer = await prepare('买方', 10_000);

    await place(seller.token, { side: 'sell', itemDefId: 'ore-test', qty: 10, price: 80 });
    const buy = await place(buyer.token, { side: 'buy', itemDefId: 'ore-test', qty: 10, price: 100 });
    assert.equal(buy.status, 200);
    const trades = buy.payload['trades'] as Array<{ price: number; qty: number; tax: number }>;
    assert.equal(trades.length, 1);
    assert.equal(trades[0].price, 80, '成交价取先挂单的 80');
    assert.equal(trades[0].qty, 10);
    assert.equal(trades[0].tax, 40); // 800 × 5%

    const sellerWallet = await wallet(seller.token);
    assert.equal(sellerWallet.credits, 760);
    assert.equal(sellerWallet.escrow, 0);

    const buyerWallet = await wallet(buyer.token);
    assert.equal(buyerWallet.credits, 9_200); // 10000 - 1000 冻结 + 200 差价退回
    assert.equal(buyerWallet.escrow, 0);

    const buyerInv = await inventoryOf(buyer.token);
    assert.equal(buyerInv.stacks.find((s) => s.itemDefId === 'ore-test')?.qty, 10);
    const sellerInv = await inventoryOf(seller.token);
    assert.equal(sellerInv.stacks.find((s) => s.itemDefId === 'ore-test')?.qty, 90);

    // 信用点守恒：买方支付 = 卖方收入 + 税（税沉淀在系统账户），总量等于初始注入
    const sum = current.app.db
      .prepare('SELECT COALESCE(SUM(credits_delta), 0) AS total FROM ledger_entries')
      .get() as { total: number };
    assert.equal(sum.total, 10_000, '交易后总信用点应等于初始注入量');
  });

  it('撤单退回冻结的信用点与物品', async () => {
    current = await startTestApp();
    const buyer = await prepare('撤单买方', 5_000);
    const seller = await prepare('撤单卖方', 0, 40);

    const buy = await place(buyer.token, { side: 'buy', itemDefId: 'ore-test', qty: 5, price: 100 });
    const buyWallet = await wallet(buyer.token);
    assert.equal(buyWallet.escrow, 500);
    assert.equal(buyWallet.credits, 4_500);

    const cancelled = await fetch(`${current.baseUrl}/api/market/orders/${buy.payload['orderId']}`, {
      method: 'DELETE',
      headers: authHeaders(buyer.token),
    });
    assert.equal(cancelled.status, 200);
    const afterWallet = await wallet(buyer.token);
    assert.equal(afterWallet.escrow, 0);
    assert.equal(afterWallet.credits, 5_000);

    const sell = await place(seller.token, { side: 'sell', itemDefId: 'ore-test', qty: 20, price: 80 });
    await fetch(`${current.baseUrl}/api/market/orders/${sell.payload['orderId']}`, {
      method: 'DELETE',
      headers: authHeaders(seller.token),
    });
    const inv = await inventoryOf(seller.token);
    assert.equal(inv.stacks.find((s) => s.itemDefId === 'ore-test')?.locked, 0);
  });

  it('实例物品按唯一编号成交，归属转移给买家', async () => {
    current = await startTestApp();
    const seller = await prepare('船商', 0);
    const buyer = await prepare('买家', 5_000);
    const instanceId = '0193f2c1-7a4b-7c3d-9e2f-1111222233aa';

    await fetch(`${current.baseUrl}/api/production/report`, {
      method: 'POST',
      headers: authHeaders(seller.token),
      body: JSON.stringify({
        batchId: 'ship-batch-0001',
        items: [{ itemDefId: 'ship-test', qty: 1, instanceId, props: { hullId: 'ship-test' } }],
      }),
    });

    const list = await place(seller.token, {
      side: 'sell',
      itemDefId: 'ship-test',
      qty: 1,
      price: 800,
      instanceId,
    });
    assert.equal(list.status, 200);

    const buy = await place(buyer.token, { side: 'buy', itemDefId: 'ship-test', qty: 1, price: 900 });
    assert.equal(buy.status, 200);

    const buyerInv = (await (
      await fetch(`${current.baseUrl}/api/inventory`, { headers: authHeaders(buyer.token) })
    ).json()) as { items: Array<{ instanceId: string; status: string }> };
    assert.equal(buyerInv.items[0]?.instanceId, instanceId);
    assert.equal(buyerInv.items[0]?.status, 'owned');

    const verify = (await (
      await fetch(`${current.baseUrl}/api/items/verify?instanceId=${instanceId}`, {
        headers: authHeaders(buyer.token),
      })
    ).json()) as { ownerId: number };
    assert.equal(verify.ownerId, buyer.playerId);

    // 卖方的 800 成交价扣 5% 税
    const sellerWallet = await wallet(seller.token);
    assert.equal(sellerWallet.credits, 760);
  });

  it('自己不能吃自己的挂单', async () => {
    current = await startTestApp();
    const trader = await prepare('自买自卖', 5_000, 50);

    await place(trader.token, { side: 'sell', itemDefId: 'ore-test', qty: 10, price: 80 });
    const buy = await place(trader.token, { side: 'buy', itemDefId: 'ore-test', qty: 10, price: 80 });
    assert.equal((buy.payload['trades'] as unknown[]).length, 0);
    assert.equal(buy.payload['status'], 'open');
  });

  it('信用点不足与物品不足都被拒绝', async () => {
    current = await startTestApp();
    const poor = await prepare('穷人', 100);
    const noItems = await prepare('无货者', 0);

    const noMoney = await place(poor.token, { side: 'buy', itemDefId: 'ore-test', qty: 10, price: 80 });
    assert.equal(noMoney.status, 409);
    assert.equal(noMoney.payload['code'], 'insufficient_credits');

    const noGoods = await place(noItems.token, { side: 'sell', itemDefId: 'ore-test', qty: 1, price: 80 });
    assert.equal(noGoods.status, 409);
    assert.equal(noGoods.payload['code'], 'insufficient_items');
  });

  it('不可卖出的物品不能挂卖单，目录接口带最低价', async () => {
    current = await startTestApp();
    const seller = await prepare('守规者', 0, 10);

    const blocked = await place(seller.token, { side: 'sell', itemDefId: 'no-sell', qty: 1, price: 100 });
    assert.equal(blocked.status, 403);

    const catalog = (await (await fetch(`${current.baseUrl}/api/market/catalog?q=ore`)).json()) as {
      items: Array<{ itemDefId: string; floorPrice: number; instanceBased: boolean }>;
    };
    assert.equal(catalog.items[0].itemDefId, 'ore-test');
    assert.equal(catalog.items[0].floorPrice, 60);
    assert.equal(catalog.items[0].instanceBased, false);
  });
});
