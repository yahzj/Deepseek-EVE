import { createHmac } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from './auth.js';
import type { Catalog } from './catalog.js';
import type { ServerConfig } from './config.js';
import { validateInstanceProps } from './instance-props.js';
import { appendEntry, stackOf, tx } from './ledger.js';

export interface ProductionEntry {
  itemDefId: string;
  qty: number;
  instanceId?: string;
  props?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MS = 60_000;

/** 服务器签发物品实例签名：id + 定义 + 归属 三者绑定，客户端改任何一项都对不上。 */
export function signInstance(seed: string, instanceId: string, itemDefId: string, ownerId: number): string {
  return createHmac('sha256', seed)
    .update(`${instanceId}|${itemDefId}|${ownerId}`)
    .digest('hex')
    .slice(0, 32);
}

/** 近 60 秒该账号已入账数量（按物品）。 */
function recentQuantities(db: DatabaseSync, accountId: number): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT item_def_id, COALESCE(SUM(qty), 0) AS total FROM production_events
       WHERE account_id = ? AND accepted = 1 AND server_ts > ?
       GROUP BY item_def_id`,
    )
    .all(accountId, Date.now() - RATE_WINDOW_MS) as Array<{ item_def_id: string; total: number }>;
  return new Map(rows.map((row) => [row.item_def_id, row.total]));
}

/**
 * 产出上报（半权威）：客户端按结算批次上报，服务器逐物品校验「每分钟入账数量」。
 * - 上限 = min(kind 硬顶, 价值配额 ÷ 该物基准价)，即**逐物品**而非按类别一刀切；
 * - 再叠加一道跨物品的「每分钟总产值」闸门，防止多物品叠加刷量；
 * - batchId 幂等：重复上报直接返回上次结果；
 * - 任何一条超限 → 整批拒绝，落审计（accepted=0 + reason），不部分入账。
 */
export function reportProduction(
  db: DatabaseSync,
  catalog: Catalog,
  config: ServerConfig,
  accountId: number,
  body: Record<string, unknown>,
): { accepted: boolean; batchId: string; credited: Array<{ itemDefId: string; qty: number; instanceId?: string }> } {
  const batchId = body['batchId'];
  if (typeof batchId !== 'string' || batchId.length < 8 || batchId.length > 64) {
    throw new ApiError(400, 'bad_batch_id', 'batchId 必须是 8~64 字符的唯一串');
  }
  const items = body['items'];
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'bad_production', 'items 必须是非空数组');
  }
  if (items.length > config.productionMaxEntries) {
    throw new ApiError(400, 'bad_production', `一次最多上报 ${config.productionMaxEntries} 种物品`);
  }
  const clientTs = Number(body['clientTs'] ?? Date.now());
  if (!Number.isFinite(clientTs)) {
    throw new ApiError(400, 'bad_client_ts', 'clientTs 必须是毫秒时间戳');
  }

  const duplicate = db
    .prepare('SELECT batch_id, accepted FROM production_events WHERE batch_id = ? LIMIT 1')
    .get(batchId) as { batch_id: string; accepted: number } | undefined;
  if (duplicate) {
    return { accepted: duplicate.accepted === 1, batchId, credited: [] };
  }

  const normalized: ProductionEntry[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) {
      throw new ApiError(400, 'bad_production', '每条产出必须是对象');
    }
    const entry = raw as Record<string, unknown>;
    const itemDefId = entry['itemDefId'];
    const qty = Number(entry['qty']);
    if (typeof itemDefId !== 'string' || !catalog.get(itemDefId)) {
      throw new ApiError(400, 'unknown_item', `未知物品：${String(itemDefId)}`);
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ApiError(400, 'bad_production', 'qty 必须是正整数');
    }
    const item = catalog.get(itemDefId)!;
    if (item.instanceBased) {
      const instanceId = entry['instanceId'];
      if (typeof instanceId !== 'string' || !UUID_RE.test(instanceId)) {
        throw new ApiError(400, 'bad_instance_id', `实例物品 ${itemDefId} 必须携带 UUID 实例编号`);
      }
      if (qty !== 1) {
        throw new ApiError(400, 'bad_production', '实例物品一次只能上报 1 件');
      }
      const props = validateInstanceProps(catalog, item, entry['props']);
      normalized.push({ itemDefId, qty: 1, instanceId, props });
      continue;
    }
    normalized.push({ itemDefId, qty });
  }

  // 限速：逐物品，每个物品有自己的上限（不是按类别一刀切）
  const perItem = new Map<string, number>();
  for (const entry of normalized) {
    perItem.set(entry.itemDefId, (perItem.get(entry.itemDefId) ?? 0) + entry.qty);
  }
  const capOf = (itemDefId: string): number => {
    const item = catalog.get(itemDefId)!;
    const runtimeCap = config.productionLimits[item.marketKind];
    return runtimeCap === undefined
      ? item.productionCapPerMin
      : Math.min(item.productionCapPerMin, runtimeCap);
  };
  const rejected = (reason: string, message: string, itemDefId: string): never => {
    const now = Date.now();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO production_events
         (account_id, batch_id, item_def_id, qty, client_ts, server_ts, accepted, reason)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    for (const entry of normalized) {
      insert.run(accountId, batchId, entry.itemDefId, entry.qty, clientTs, now, `${reason}:${itemDefId}`);
    }
    throw new ApiError(422, reason, message);
  };

  const recent = recentQuantities(db, accountId);
  for (const [itemDefId, qty] of perItem) {
    const cap = capOf(itemDefId);
    if ((recent.get(itemDefId) ?? 0) + qty > cap) {
      const item = catalog.get(itemDefId)!;
      rejected(
        'production_rate_exceeded',
        `物品 ${itemDefId}（${item.name}）超过每分钟 ${cap} 的产出上限，本批拒绝入账`,
        itemDefId,
      );
    }
  }

  // 限速二：叠加闸门——各物品「占自己上限的比例」加总不得超过限额。
  // 用比例而不是绝对价值，是因为绝对价值闸门会误杀单件高价物（一艘 6750 万的战列舰
  // 本身就超过任何合理的「每分钟产值」阈值）。
  let ratio = 0;
  const ratioBase = new Map<string, number>(recent);
  for (const [itemDefId, qty] of perItem) {
    const cap = capOf(itemDefId);
    ratio += ((ratioBase.get(itemDefId) ?? 0) + qty) / Math.max(1, cap);
  }
  if (ratio > config.productionBatchRatio) {
    const worst = [...perItem.entries()].sort((a, b) => b[1] / capOf(b[0]) - a[1] / capOf(a[0]))[0]!;
    rejected(
      'production_batch_exceeded',
      `本批合计达到各自上限的 ${ratio.toFixed(2)} 倍，超过同时入账限额 ${config.productionBatchRatio} 倍，本批拒绝入账`,
      worst[0],
    );
  }

  return tx(db, () => {
    const now = Date.now();
    for (const entry of normalized) {
      const item = catalog.get(entry.itemDefId)!;
      if (item.instanceBased && entry.instanceId) {
        db.prepare(
          `INSERT INTO items (instance_id, account_id, item_def_id, props_json, status, created_at)
           VALUES (?, ?, ?, ?, 'owned', ?)`,
        ).run(entry.instanceId, accountId, entry.itemDefId, JSON.stringify(entry.props ?? {}), now);
        appendEntry(db, {
          accountId,
          entryType: 'production',
          refType: 'batch',
          refId: batchId,
          instanceId: entry.instanceId,
          itemDefId: entry.itemDefId,
          qtyDelta: 1,
        });
      } else {
        appendEntry(db, {
          accountId,
          entryType: 'production',
          refType: 'batch',
          refId: batchId,
          itemDefId: entry.itemDefId,
          qtyDelta: entry.qty,
        });
      }
      db.prepare(
        `INSERT OR IGNORE INTO production_events
           (account_id, batch_id, item_def_id, qty, client_ts, server_ts, accepted, reason)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL)`,
      ).run(accountId, batchId, entry.itemDefId, entry.qty, clientTs, now);
    }
    return {
      accepted: true,
      batchId,
      credited: normalized.map((entry) => ({
        itemDefId: entry.itemDefId,
        qty: entry.qty,
        ...(entry.instanceId ? { instanceId: entry.instanceId } : {}),
      })),
    };
  });
}

export function inventoryOf(
  db: DatabaseSync,
  accountId: number,
): { stacks: Array<{ itemDefId: string; qty: number; locked: number }>; items: Array<{ instanceId: string; itemDefId: string; props: unknown; status: string }> } {
  const stacks = db
    .prepare('SELECT item_def_id, qty, locked FROM item_stacks WHERE account_id = ? AND qty != 0')
    .all(accountId) as Array<{ item_def_id: string; qty: number; locked: number }>;
  const items = db
    .prepare('SELECT instance_id, item_def_id, props_json, status FROM items WHERE account_id = ?')
    .all(accountId) as Array<{ instance_id: string; item_def_id: string; props_json: string; status: string }>;
  return {
    stacks: stacks.map((row) => ({ itemDefId: row.item_def_id, qty: row.qty, locked: row.locked })),
    items: items.map((row) => ({
      instanceId: row.instance_id,
      itemDefId: row.item_def_id,
      props: safeParse(row.props_json),
      status: row.status,
    })),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** 供市场模块使用：校验并读取某账号某物品的可用（未冻结）数量。 */
export function availableStack(db: DatabaseSync, accountId: number, itemDefId: string): number {
  const stack = stackOf(db, accountId, itemDefId);
  return stack.qty - stack.locked;
}
