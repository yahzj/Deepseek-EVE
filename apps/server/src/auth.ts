import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountRow } from './db.js';

/** 带 HTTP 状态码的业务错误，路由层统一转响应。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export function validateNickname(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'bad_nickname', '昵称必须是字符串');
  }
  const nickname = raw.trim();
  if (nickname.length < 1 || nickname.length > maxChars) {
    throw new ApiError(400, 'bad_nickname', `昵称长度需在 1~${maxChars} 字符之间`);
  }
  return nickname;
}

export function validateDeviceCode(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
    throw new ApiError(400, 'bad_device_code', '设备码格式非法（8~64 位字母数字）');
  }
  return raw;
}

/** 恢复码字符集：去掉容易看错的 0/O/1/I，16 位分 4 组展示（80 bit 熵）。 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  let raw = '';
  for (const byte of bytes) {
    raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
  return raw.match(/.{4}/g)!.join('-');
}

export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** 恢复码只存哈希，服务器自己也无法反查明文。 */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex');

/**
 * 设备码注册即登录：
 * - register 模式：已有该设备码则直接登录（昵称沿用旧值，改名走 profile 接口），否则建号；
 * - login 模式：设备码不存在直接报错，不允许借登录端点创建账号。
 * 同名昵称拒绝，保证聊天显示名可辨认。
 */
export function registerOrLogin(
  db: DatabaseSync,
  deviceCode: string,
  nickname: string,
  mode: 'register' | 'login',
): { account: AccountRow; token: string; recoveryCode?: string } {
  const now = Date.now();
  const existing = db
    .prepare('SELECT * FROM accounts WHERE device_code = ?')
    .get(deviceCode) as AccountRow | undefined;
  if (existing) {
    const token = randomBytes(24).toString('hex');
    db.prepare('UPDATE accounts SET token_hash = ?, last_seen_at = ? WHERE id = ?').run(
      hashToken(token),
      now,
      existing.id,
    );
    return { account: { ...existing, token_hash: hashToken(token), last_seen_at: now }, token };
  }
  if (mode === 'login') {
    throw new ApiError(404, 'account_not_found', '该设备尚未注册，请走注册流程');
  }

  const nicknameTaken = db.prepare('SELECT id FROM accounts WHERE nickname = ?').get(nickname);
  if (nicknameTaken) {
    throw new ApiError(409, 'nickname_taken', '该昵称已被占用，请换一个');
  }
  const token = randomBytes(24).toString('hex');
  const recoveryCode = generateRecoveryCode();
  const result = db
    .prepare(
      `INSERT INTO accounts (device_code, token_hash, recovery_hash, nickname, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(deviceCode, hashToken(token), hashRecoveryCode(recoveryCode), nickname, now, now);
  const account: AccountRow = {
    id: Number(result.lastInsertRowid),
    device_code: deviceCode,
    token_hash: hashToken(token),
    recovery_hash: hashRecoveryCode(recoveryCode),
    nickname,
    created_at: now,
    last_seen_at: now,
  };
  return { account, token, recoveryCode };
}

/** 重新签发恢复码（旧码立即失效），返回明文仅此一次。 */
export function rotateRecoveryCode(db: DatabaseSync, accountId: number): string {
  const code = generateRecoveryCode();
  db.prepare('UPDATE accounts SET recovery_hash = ? WHERE id = ?').run(hashRecoveryCode(code), accountId);
  return code;
}

/**
 * 用恢复码把账号迁移到新设备码：换机/清档后的找回通道。
 * 成功后旧设备码立即失效，返回新 token。
 */
export function redeemRecoveryCode(
  db: DatabaseSync,
  code: string,
  newDeviceCode: string,
): { account: AccountRow; token: string; nickname: string } {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 16) {
    throw new ApiError(400, 'bad_recovery_code', '恢复码应为 16 位');
  }
  const account = db
    .prepare('SELECT * FROM accounts WHERE recovery_hash = ?')
    .get(hashRecoveryCode(code)) as AccountRow | undefined;
  if (!account) {
    throw new ApiError(404, 'recovery_not_found', '恢复码无效');
  }
  const conflict = db
    .prepare('SELECT id FROM accounts WHERE device_code = ? AND id != ?')
    .get(newDeviceCode, account.id);
  if (conflict) {
    throw new ApiError(409, 'device_in_use', '该设备码已被其他账号占用');
  }
  const token = randomBytes(24).toString('hex');
  db.prepare('UPDATE accounts SET device_code = ?, token_hash = ?, last_seen_at = ? WHERE id = ?').run(
    newDeviceCode,
    hashToken(token),
    Date.now(),
    account.id,
  );
  return {
    account: { ...account, device_code: newDeviceCode, token_hash: hashToken(token) },
    token,
    nickname: account.nickname,
  };
}

export function authenticate(db: DatabaseSync, token: string | null): AccountRow {
  if (typeof token !== 'string' || token.length === 0) {
    throw new ApiError(401, 'missing_token', '缺少访问令牌');
  }
  const account = db
    .prepare('SELECT * FROM accounts WHERE token_hash = ?')
    .get(hashToken(token)) as AccountRow | undefined;
  if (!account) {
    throw new ApiError(401, 'invalid_token', '访问令牌无效');
  }
  db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(Date.now(), account.id);
  return account;
}
