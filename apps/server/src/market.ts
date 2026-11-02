import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from './auth.js';
import type { Catalog } from './catalog.js';
import type { ServerConfig } from './config.js';
import type { ItemRow, OrderRow } from './db.js';
import { appendEntry, stackOf, tx, walletOf } from './ledger.js';
import { availableStack } from './production.js';

export interface PlaceOrderInput {
  side: 'buy' | 'sell';
  itemDefId: string;
  qty: number;
  price: number;
  instanceId?: string;
}

export interface TradeResult {
  tradeId: number;
  qty: number;
  price: number;
  tax: number;
  buyerId: number;
  sellerId: number;
}

const MAX_PRICE = 1_000_000_000;

function orderEscrowHeld(db: DatabaseSync, order: OrderRow): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(gross), 0) AS spent FROM trades WHERE buy_order_id = ?')
    .get(order.id) as { spent: number };
  return order.qty * order.price - row.spent;
}

function releaseBuyEscrow(db: DatabaseSync, order: OrderRow, amount: number, refId: string): void {
  if (amount <= 0) {
    return;
  }
  appendEntry(db, {
    accountId: order.account_id,
    entryType: 'escrow_refund',
    refType: 'order',
    refId,
    creditsDelta: amount,
    escrowDelta: -amount,
  });
}

function settleOrderClose(db: DatabaseSync, order: OrderRow, reason: 'filled' | 'cancelled'): void {
  db.prepare('UPDATE orders SET status = ?, qty_remaining = ?, updated_at = ? WHERE id = ?').run(
    reason === 'cancelled' ? 'cancelled' : 'filled',
    reason === 'cancelled' ? order.qty_remaining : 0,
    Date.now(),
    order.id,
  );
  if (order.side === 'buy') {
    releaseBuyEscrow(db, order, orderEscrowHeld(db, order), `order-${order.id}`);
    return;
  }
  // 卖单剩余量解锁
  const remaining = db.prepare('SELECT qty_remaining FROM orders WHERE id = ?').get(order.id) as {
    qty_remaining: number;
  };
  if (remaining.qty_remaining > 0) {
    if (order.instance_id) {
      db.prepare("UPDATE items SET status = 'owned', order_id = NULL WHERE instance_id = ?").run(
        order.instance_id,
      );
    } else {
      db.prepare(
        'UPDATE item_stacks SET locked = MAX(0, locked - ?) WHERE account_id = ? AND item_def_id = ?',
      ).run(remaining.qty_remaining, order.account_id, order.item_def_id);
    }
  }
}

function transferItems(
  db: DatabaseSync,
  order: OrderRow,
  buyerId: number,
  qty: number,
  tradeId: string,
): void {
  if (order.instance_id) {
    db.prepare("UPDATE items SET account_id = ?, status = 'owned', order_id = NULL WHERE instance_id = ?").run(
      buyerId,
      order.instance_id,
    );
    appendEntry(db, {
      accountId: order.account_id,
      entryType: 'trade_out',
      refType: 'trade',
      refId: tradeId,
      instanceId: order.instance_id,
      itemDefId: order.item_def_id,
      qtyDelta: -1,
    });
    appendEntry(db, {
      accountId: buyerId,
      entryType: 'trade_in',
      refType: 'trade',
      refId: tradeId,
      instanceId: order.instance_id,
      itemDefId: order.item_def_id,
      qtyDelta: 1,
    });
    return;
  }
  // 数量与冻结由账本统一处理，这里只负责解锁（qty 由 appendEntry 变更，避免重复扣减）
  db.prepare(
    'UPDATE item_stacks SET locked = MAX(0, locked - ?) WHERE account_id = ? AND item_def_id = ?',
  ).run(qty, order.account_id, order.item_def_id);
  appendEntry(db, {
    accountId: order.account_id,
    entryType: 'trade_out',
    refType: 'trade',
    refId: tradeId,
    itemDefId: order.item_def_id,
    qtyDelta: -qty,
  });
  appendEntry(db, {
    accountId: buyerId,
    entryType: 'trade_in',
    refType: 'trade',
    refId: tradeId,
    itemDefId: order.item_def_id,
    qtyDelta: qty,
  });
}

/** 撮合：价格优先、时间优先；成交价取先挂单（resting / maker）的报价。 */
function matchOrder(
  db: DatabaseSync,
  aggressor: OrderRow,
  config: ServerConfig,
): TradeResult[] {
  const trades: TradeResult[] = [];
  const opposite = aggressor.side === 'buy' ? 'sell' : 'buy';

  for (;;) {
    const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(aggressor.id) as unknown as OrderRow;
    if (current.status !== 'open' || current.qty_remaining <= 0) {
      break;
    }
    const priceFilter = current.side === 'buy' ? 'price <= ?' : 'price >= ?';
    const orderBy = current.side === 'buy' ? 'price ASC, created_at ASC' : 'price DESC, created_at ASC';
    const resting = db
      .prepare(
        `SELECT * FROM orders
         WHERE item_def_id = ? AND side = ? AND status = 'open' AND account_id != ? AND ${priceFilter}
         ORDER BY ${orderBy} LIMIT 1`,
      )
      .get(current.item_def_id, opposite, current.account_id, current.price) as unknown as OrderRow | undefined;
    if (!resting) {
      break;
    }
    if (resting.instance_id && resting.qty_remaining !== 1) {
      settleOrderClose(db, resting, 'filled');
      continue;
    }

    const qty = Math.min(current.qty_remaining, resting.qty_remaining);
    const price = resting.price;
    const gross = price * qty;
    const tax = Math.floor(gross * config.tradeTaxRate);
    const net = gross - tax;
    const now = Date.now();
    const buyOrder = current.side === 'buy' ? current : resting;
    const sellOrder = current.side === 'buy' ? resting : current;
    const buyerId = buyOrder.account_id;
    const sellerId = sellOrder.account_id;

    const inserted = db
      .prepare(
        `INSERT INTO trades
          (buy_order_id, sell_order_id, item_def_id, instance_id, qty, price, gross, tax, buyer_id, seller_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        buyOrder.id,
        sellOrder.id,
        current.item_def_id,
        sellOrder.instance_id,
        qty,
        price,
        gross,
        tax,
        buyerId,
        sellerId,
        now,
      );
    const tradeId = String(inserted.lastInsertRowid);

    // 买方：从冻结额度里扣掉成交额（差价留到订单结束时统一退回）
    appendEntry(db, {
      accountId: buyerId,
      entryType: 'trade_pay',
      refType: 'trade',
      refId: tradeId,
      escrowDelta: -gross,
    });

    // 卖方：收入扣税后入账；税进系统（account_id 为空，不进任何玩家钱包）
    appendEntry(db, {
      accountId: sellerId,
      entryType: 'trade_income',
      refType: 'trade',
      refId: tradeId,
      creditsDelta: net,
    });
    appendEntry(db, {
      accountId: null,
      entryType: 'trade_tax',
      refType: 'trade',
      refId: tradeId,
      creditsDelta: tax,
    });

    transferItems(db, sellOrder, buyerId, qty, tradeId);

    db.prepare('UPDATE orders SET qty_remaining = qty_remaining - ?, updated_at = ? WHERE id = ?').run(
      qty,
      now,
      current.id,
    );
    db.prepare('UPDATE orders SET qty_remaining = qty_remaining - ?, updated_at = ? WHERE id = ?').run(
      qty,
      now,
      resting.id,
    );
    db.prepare("UPDATE orders SET status = 'filled' WHERE id = ? AND qty_remaining <= 0").run(current.id);
    db.prepare("UPDATE orders SET status = 'filled' WHERE id = ? AND qty_remaining <= 0").run(resting.id);

    trades.push({ tradeId: Number(tradeId), qty, price, tax, buyerId, sellerId });

    const refreshedResting = db.prepare('SELECT * FROM orders WHERE id = ?').get(resting.id) as unknown as OrderRow;
    if (refreshedResting.status !== 'open') {
      settleOrderClose(db, refreshedResting, 'filled');
    }
  }

  const final = db.prepare('SELECT * FROM orders WHERE id = ?').get(aggressor.id) as unknown as OrderRow;
  if (final.qty_remaining <= 0) {
    settleOrderClose(db, final, 'filled');
  }
  return trades;
}

export function placeOrder(
  db: DatabaseSync,
  catalog: Catalog,
  config: ServerConfig,
  accountId: number,
  input: PlaceOrderInput,
): { orderId: number; trades: TradeResult[]; status: string } {
  const item = catalog.get(input.itemDefId);
  if (!item) {
    throw new ApiError(400, 'unknown_item', `未知物品：${input.itemDefId}`);
  }
  if (input.side === 'sell' && !item.playerSellable) {
    throw new ApiError(403, 'item_not_sellable', `${item.name} 不允许玩家卖出`);
  }
  if (input.side === 'buy' && !item.playerBuyable) {
    throw new ApiError(403, 'item_not_buyable', `${item.name} 不允许玩家买入`);
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new ApiError(400, 'bad_qty', '数量必须是正整数');
  }
  if (!Number.isInteger(input.price) || input.price <= 0 || input.price > MAX_PRICE) {
    throw new ApiError(400, 'bad_price', `价格必须是 1~${MAX_PRICE} 的整数信用点`);
  }
  if (input.side === 'sell' && input.price < item.floorPrice) {
    throw new ApiError(
      422,
      'below_floor_price',
      `${item.name} 的公共市场最低价为 ${item.floorPrice}，挂单价不得低于该值`,
    );
  }
  if (item.instanceBased) {
    if (input.side === 'sell') {
      if (!input.instanceId) {
        throw new ApiError(400, 'missing_instance_id', `${item.name} 必须按唯一实例挂单`);
      }
      if (input.qty !== 1) {
        throw new ApiError(400, 'bad_qty', '实例物品一次只能挂 1 件');
      }
    } else {
      // 买单不指定具体实例：成交时由服务器从卖单里挑一件给你
      if (input.instanceId) {
        throw new ApiError(400, 'unexpected_instance_id', '实例物品的买单不指定实例编号');
      }
      if (input.qty !== 1) {
        throw new ApiError(400, 'bad_qty', '实例物品一次只能买 1 件');
      }
    }
  } else if (input.instanceId) {
    throw new ApiError(400, 'unexpected_instance_id', `${item.name} 是按数量堆叠的物品，不带实例编号`);
  }

  return tx(db, () => {
    const now = Date.now();
    if (input.side === 'sell') {
      if (item.instanceBased) {
        const row = db.prepare('SELECT * FROM items WHERE instance_id = ?').get(input.instanceId!) as
          | ItemRow
          | undefined;
        if (!row || row.account_id !== accountId || row.status !== 'owned') {
          throw new ApiError(409, 'item_not_owned', '该实例不在你名下或已上架');
        }
      } else if (availableStack(db, accountId, input.itemDefId) < input.qty) {
        throw new ApiError(409, 'insufficient_items', '可用数量不足（挂单中的物品会被冻结）');
      }
    } else {
      const wallet = walletOf(db, accountId);
      const need = input.price * input.qty;
      if (wallet.credits < need) {
        throw new ApiError(409, 'insufficient_credits', `信用点不足，需要 ${need}`);
      }
      appendEntry(db, {
        accountId,
        entryType: 'escrow_lock',
        refType: 'order',
        refId: `new-${now}`,
        creditsDelta: -need,
        escrowDelta: need,
      });
    }

    const result = db
      .prepare(
        `INSERT INTO orders (side, account_id, item_def_id, instance_id, qty, qty_remaining, price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        input.side,
        accountId,
        input.itemDefId,
        input.instanceId ?? null,
        input.qty,
        input.qty,
        input.price,
        now,
        now,
      );
    const orderId = Number(result.lastInsertRowid);

    if (input.side === 'sell') {
      if (item.instanceBased) {
        db.prepare("UPDATE items SET status = 'listed', order_id = ? WHERE instance_id = ?").run(
          orderId,
          input.instanceId!,
        );
      } else {
        db.prepare(
          `INSERT INTO item_stacks (account_id, item_def_id, qty, locked) VALUES (?, ?, 0, ?)
           ON CONFLICT(account_id, item_def_id) DO UPDATE SET locked = locked + excluded.locked`,
        ).run(accountId, input.itemDefId, input.qty);
        const stack = stackOf(db, accountId, input.itemDefId);
        if (stack.locked > stack.qty) {
          throw new ApiError(409, 'insufficient_items', '可用数量不足');
        }
      }
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow;
    const trades = matchOrder(db, order, config);
    const final = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string };
    return { orderId, trades, status: final.status };
  });
}

export function cancelOrder(
  db: DatabaseSync,
  accountId: number,
  orderId: number,
): { orderId: number; status: string } {
  return tx(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow | undefined;
    if (!order) {
      throw new ApiError(404, 'order_not_found', '订单不存在');
    }
    if (order.account_id !== accountId) {
      throw new ApiError(403, 'not_order_owner', '只能撤销自己的订单');
    }
    if (order.status !== 'open') {
      throw new ApiError(409, 'order_closed', `订单已是 ${order.status} 状态`);
    }
    settleOrderClose(db, order, 'cancelled');
    return { orderId, status: 'cancelled' };
  });
}

export interface BookLevel {
  price: number;
  qty: number;
  orders: number;
}

export function orderBook(
  db: DatabaseSync,
  catalog: Catalog,
  itemDefId: string,
): { itemDefId: string; floorPrice: number; bids: BookLevel[]; asks: BookLevel[] } {
  const item = catalog.get(itemDefId);
  if (!item) {
    throw new ApiError(404, 'unknown_item', `未知物品：${itemDefId}`);
  }
  const rows = db
    .prepare(
      `SELECT side, price, SUM(qty_remaining) AS qty, COUNT(*) AS orders
       FROM orders WHERE item_def_id = ? AND status = 'open'
       GROUP BY side, price`,
    )
    .all(itemDefId) as Array<{ side: string; price: number; qty: number; orders: number }>;
  const bids = rows
    .filter((row) => row.side === 'buy')
    .map((row) => ({ price: row.price, qty: row.qty, orders: row.orders }))
    .sort((a, b) => b.price - a.price);
  const asks = rows
    .filter((row) => row.side === 'sell')
    .map((row) => ({ price: row.price, qty: row.qty, orders: row.orders }))
    .sort((a, b) => a.price - b.price);
  return { itemDefId, floorPrice: item.floorPrice, bids, asks };
}

export function myOrders(db: DatabaseSync, accountId: number): Array<Record<string, unknown>> {
  const rows = db
    .prepare('SELECT * FROM orders WHERE account_id = ? ORDER BY id DESC LIMIT 100')
    .all(accountId) as unknown as OrderRow[];
  return rows.map((row) => ({
    orderId: row.id,
    side: row.side,
    itemDefId: row.item_def_id,
    instanceId: row.instance_id,
    qty: row.qty,
    qtyRemaining: row.qty_remaining,
    price: row.price,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function recentTrades(db: DatabaseSync, itemDefId: string, limit = 50): Array<Record<string, unknown>> {
  const rows = db
    .prepare('SELECT * FROM trades WHERE item_def_id = ? ORDER BY id DESC LIMIT ?')
    .all(itemDefId, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    tradeId: row['id'],
    itemDefId: row['item_def_id'],
    qty: row['qty'],
    price: row['price'],
    tax: row['tax'],
    createdAt: row['created_at'],
  }));
}
