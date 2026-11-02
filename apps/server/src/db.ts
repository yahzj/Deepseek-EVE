import { DatabaseSync } from 'node:sqlite';

export interface AccountRow {
  id: number;
  device_code: string;
  token_hash: string;
  recovery_hash: string | null;
  nickname: string;
  created_at: number;
  last_seen_at: number;
}

export interface SaveRow {
  id: number;
  account_id: number;
  version: number;
  data: string;
  size: number;
  created_at: number;
}

export interface MessageRow {
  id: number;
  channel: string;
  account_id: number | null;
  nickname: string;
  text: string;
  created_at: number;
}

export interface WalletRow {
  account_id: number;
  credits: number;
  escrow: number;
}

export interface StackRow {
  account_id: number;
  item_def_id: string;
  qty: number;
  locked: number;
}

export interface ItemRow {
  instance_id: string;
  account_id: number;
  item_def_id: string;
  props_json: string;
  status: 'owned' | 'listed' | 'traded';
  order_id: number | null;
  created_at: number;
}

export interface OrderRow {
  id: number;
  side: 'buy' | 'sell';
  account_id: number;
  item_def_id: string;
  instance_id: string | null;
  qty: number;
  qty_remaining: number;
  price: number;
  status: 'open' | 'filled' | 'cancelled';
  created_at: number;
  updated_at: number;
}

export interface LedgerRow {
  seq: number;
  account_id: number | null;
  entry_type: string;
  ref_type: string;
  ref_id: string;
  credits_delta: number;
  item_def_id: string | null;
  qty_delta: number;
  instance_id: string | null;
  prev_hash: string;
  hash: string;
  created_at: number;
}

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      recovery_hash TEXT,
      nickname TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(account_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_saves_account ON saves(account_id, version DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      account_id INTEGER,
      nickname TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id DESC);

    CREATE TABLE IF NOT EXISTS wallets (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
      credits INTEGER NOT NULL DEFAULT 0,
      escrow INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS item_stacks (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      item_def_id TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, item_def_id)
    );

    CREATE TABLE IF NOT EXISTS items (
      instance_id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      item_def_id TEXT NOT NULL,
      props_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'owned',
      order_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_owner ON items(account_id, item_def_id);

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      side TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      item_def_id TEXT NOT NULL,
      instance_id TEXT,
      qty INTEGER NOT NULL,
      qty_remaining INTEGER NOT NULL,
      price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_book ON orders(item_def_id, side, status, price);

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buy_order_id INTEGER NOT NULL,
      sell_order_id INTEGER NOT NULL,
      item_def_id TEXT NOT NULL,
      instance_id TEXT,
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,
      gross INTEGER NOT NULL,
      tax INTEGER NOT NULL,
      buyer_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      batch_id TEXT NOT NULL UNIQUE,
      item_def_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      client_ts INTEGER NOT NULL,
      server_ts INTEGER NOT NULL,
      accepted INTEGER NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_production_account ON production_events(account_id, item_def_id, server_ts);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      entry_type TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      credits_delta INTEGER NOT NULL DEFAULT 0,
      escrow_delta INTEGER NOT NULL DEFAULT 0,
      item_def_id TEXT,
      qty_delta INTEGER NOT NULL DEFAULT 0,
      instance_id TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id, seq);
  `);

  // 老库补列（恢复码与冻结额是 P1 新增字段），已有库升级时不会丢数据
  const accountColumns = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>;
  if (!accountColumns.some((column) => column.name === 'recovery_hash')) {
    db.exec('ALTER TABLE accounts ADD COLUMN recovery_hash TEXT');
  }
  const ledgerColumns = db.prepare('PRAGMA table_info(ledger_entries)').all() as Array<{ name: string }>;
  if (!ledgerColumns.some((column) => column.name === 'escrow_delta')) {
    db.exec('ALTER TABLE ledger_entries ADD COLUMN escrow_delta INTEGER NOT NULL DEFAULT 0');
  }
  return db;
}
