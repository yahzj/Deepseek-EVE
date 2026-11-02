import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface LedgerEntryInput {
  accountId: number | null;
  entryType: string;
  refType: string;
  refId: string;
  /** 可用信用点变动（钱包 credits） */
  creditsDelta?: number;
  /** 冻结信用点变动（钱包 escrow），挂单冻结/解冻/支付用 */
  escrowDelta?: number;
  itemDefId?: string | null;
  qtyDelta?: number;
  instanceId?: string | null;
}

const GENESIS_HASH = '0'.repeat(64);

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** 事务包装：SQLite 单写者，BEGIN IMMEDIATE 可避免写冲突时读到中间态。 */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function walletOf(db: DatabaseSync, accountId: number): { credits: number; escrow: number } {
  const row = db.prepare('SELECT credits, escrow FROM wallets WHERE account_id = ?').get(accountId) as
    | { credits: number; escrow: number }
    | undefined;
  return row ?? { credits: 0, escrow: 0 };
}

function ensureWallet(db: DatabaseSync, accountId: number): void {
  db.prepare('INSERT OR IGNORE INTO wallets (account_id, credits, escrow) VALUES (?, 0, 0)').run(accountId);
}

export function stackOf(db: DatabaseSync, accountId: number, itemDefId: string): { qty: number; locked: number } {
  const row = db
    .prepare('SELECT qty, locked FROM item_stacks WHERE account_id = ? AND item_def_id = ?')
    .get(accountId, itemDefId) as { qty: number; locked: number } | undefined;
  return row ?? { qty: 0, locked: 0 };
}

/**
 * 写入一条账本记录并同步物化状态：
 * - 物品/信用点变动先落账本（只追加 + 哈希链），再改钱包/堆叠/实例；
 * - 所有调用方必须自己包在 tx() 里，保证「流水 + 状态」原子。
 */
export function appendEntry(db: DatabaseSync, input: LedgerEntryInput): { seq: number; hash: string } {
  const head = db.prepare('SELECT hash FROM ledger_entries ORDER BY seq DESC LIMIT 1').get() as
    | { hash: string }
    | undefined;
  const prevHash = head?.hash ?? GENESIS_HASH;
  const creditsDelta = Math.trunc(input.creditsDelta ?? 0);
  const escrowDelta = Math.trunc(input.escrowDelta ?? 0);
  const qtyDelta = Math.trunc(input.qtyDelta ?? 0);
  if (creditsDelta === 0 && escrowDelta === 0 && qtyDelta === 0) {
    throw new Error('账本记录必须至少有一个变动');
  }

  const payload = [
    prevHash,
    input.accountId ?? 'system',
    input.entryType,
    input.refType,
    input.refId,
    creditsDelta,
    escrowDelta,
    input.itemDefId ?? '',
    qtyDelta,
    input.instanceId ?? '',
  ].join('|');
  const hash = sha256(payload);
  const now = Date.now();

  const result = db
    .prepare(
      `INSERT INTO ledger_entries
        (account_id, entry_type, ref_type, ref_id, credits_delta, escrow_delta, item_def_id, qty_delta, instance_id, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.entryType,
      input.refType,
      input.refId,
      creditsDelta,
      escrowDelta,
      input.itemDefId ?? null,
      qtyDelta,
      input.instanceId ?? null,
      prevHash,
      hash,
      now,
    );

  if (input.accountId !== null) {
    if (creditsDelta !== 0 || escrowDelta !== 0) {
      ensureWallet(db, input.accountId);
      const wallet = walletOf(db, input.accountId);
      const nextCredits = wallet.credits + creditsDelta;
      const nextEscrow = wallet.escrow + escrowDelta;
      if (nextCredits < 0) {
        throw new Error('信用点余额不足');
      }
      if (nextEscrow < 0) {
        throw new Error('冻结额度不足');
      }
      db.prepare('UPDATE wallets SET credits = ?, escrow = ? WHERE account_id = ?').run(
        nextCredits,
        nextEscrow,
        input.accountId,
      );
    }
    // 实例物品的增减记在 items 表（唯一实例台账），不进可堆叠库存
    if (input.itemDefId && qtyDelta !== 0 && !input.instanceId) {
      db.prepare(
        `INSERT INTO item_stacks (account_id, item_def_id, qty, locked) VALUES (?, ?, ?, 0)
         ON CONFLICT(account_id, item_def_id) DO UPDATE SET qty = qty + excluded.qty`,
      ).run(input.accountId, input.itemDefId, qtyDelta);
      const stack = stackOf(db, input.accountId, input.itemDefId);
      if (stack.qty < 0) {
        throw new Error('物品数量不足');
      }
    }
  }

  return { seq: Number(result.lastInsertRowid), hash };
}

/** 校验哈希链完整性，返回第一个断点（无断点则 chainOk=true）。 */
export function verifyChain(db: DatabaseSync): { chainOk: boolean; checked: number; brokenAt: number | null } {
  const rows = db
    .prepare('SELECT * FROM ledger_entries ORDER BY seq ASC')
    .all() as unknown as Array<{
    seq: number;
    account_id: number | null;
    entry_type: string;
    ref_type: string;
    ref_id: string;
    credits_delta: number;
    escrow_delta: number;
    item_def_id: string | null;
    qty_delta: number;
    instance_id: string | null;
    prev_hash: string;
    hash: string;
  }>;
  let prev = GENESIS_HASH;
  for (const row of rows) {
    const payload = [
      prev,
      row.account_id ?? 'system',
      row.entry_type,
      row.ref_type,
      row.ref_id,
      row.credits_delta,
      row.escrow_delta,
      row.item_def_id ?? '',
      row.qty_delta,
      row.instance_id ?? '',
    ].join('|');
    if (row.prev_hash !== prev || row.hash !== sha256(payload)) {
      return { chainOk: false, checked: rows.length, brokenAt: row.seq };
    }
    prev = row.hash;
  }
  return { chainOk: true, checked: rows.length, brokenAt: null };
}
