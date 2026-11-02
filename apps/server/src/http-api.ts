import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  ApiError,
  authenticate,
  redeemRecoveryCode,
  registerOrLogin,
  rotateRecoveryCode,
  validateDeviceCode,
  validateNickname,
} from './auth.js';
import type { Catalog } from './catalog.js';
import type { ServerConfig } from './config.js';
import type { AccountRow, SaveRow } from './db.js';
import { verifyChain, walletOf } from './ledger.js';
import { cancelOrder, myOrders, orderBook, placeOrder, recentTrades } from './market.js';
import { inventoryOf, reportProduction, signInstance } from './production.js';
import { clientIp, type RateLimiter } from './rate-limit.js';
import type { StaticHandler } from './static.js';

interface JsonBody {
  [key: string]: unknown;
}

/** 读取 JSON 请求体，带体积上限保护。 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      throw new ApiError(413, 'payload_too_large', `请求体超过 ${maxBytes} 字节上限`);
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(400, 'bad_json', '请求体必须是 JSON 对象');
    }
    return parsed as JsonBody;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(400, 'bad_json', '请求体不是合法 JSON');
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
}

function latestSave(db: DatabaseSync, accountId: number): SaveRow | undefined {
  return db
    .prepare('SELECT * FROM saves WHERE account_id = ? ORDER BY version DESC LIMIT 1')
    .get(accountId) as SaveRow | undefined;
}

function saveSummary(row: SaveRow): { version: number; size: number; createdAt: number } {
  return { version: row.version, size: row.size, createdAt: row.created_at };
}

function renameAccount(
  db: DatabaseSync,
  account: AccountRow,
  nickname: string,
): AccountRow {
  const taken = db
    .prepare('SELECT id FROM accounts WHERE nickname = ? AND id != ?')
    .get(nickname, account.id);
  if (taken) {
    throw new ApiError(409, 'nickname_taken', '该昵称已被占用，请换一个');
  }
  db.prepare('UPDATE accounts SET nickname = ? WHERE id = ?').run(nickname, account.id);
  return { ...account, nickname };
}

function uploadSave(
  db: DatabaseSync,
  config: ServerConfig,
  accountId: number,
  body: JsonBody,
): { status: number; payload: unknown } {
  const data = body['data'];
  if (typeof data !== 'string' || data.length === 0) {
    throw new ApiError(400, 'bad_save_data', '存档内容必须是非空字符串');
  }
  const size = Buffer.byteLength(data, 'utf8');
  if (size > config.saveMaxBytes) {
    throw new ApiError(413, 'save_too_large', `存档超过 ${config.saveMaxBytes} 字节上限`);
  }
  const baseVersion = body['baseVersion'];
  if (baseVersion !== undefined && typeof baseVersion !== 'number') {
    throw new ApiError(400, 'bad_base_version', 'baseVersion 必须是数字');
  }

  const current = latestSave(db, accountId);
  // 客户端声明基于旧版本上传时做冲突检测，保护新进度不被旧档覆盖
  if (
    current &&
    typeof baseVersion === 'number' &&
    baseVersion < current.version
  ) {
    return {
      status: 409,
      payload: {
        code: 'save_conflict',
        message: `服务器已有更高版本 v${current.version}，而上传基于 v${baseVersion}`,
        latestVersion: current.version,
      },
    };
  }

  const nextVersion = (current?.version ?? 0) + 1;
  db.prepare(
    'INSERT INTO saves (account_id, version, data, size, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(accountId, nextVersion, data, size, Date.now());
  // 超出保留数的历史版本从最旧开始清理
  db.prepare(
    `DELETE FROM saves WHERE account_id = ? AND id NOT IN (
       SELECT id FROM saves WHERE account_id = ? ORDER BY version DESC LIMIT ?
     )`,
  ).run(accountId, accountId, config.saveHistoryVersions);
  return { status: 200, payload: { version: nextVersion, size } };
}

function chatHistory(
  db: DatabaseSync,
  config: ServerConfig,
  url: URL,
): unknown {
  const channel = url.searchParams.get('channel') ?? '';
  if (!config.chatChannels.includes(channel)) {
    throw new ApiError(400, 'bad_channel', `channel 必须是 ${config.chatChannels.join(' 或 ')}`);
  }
  const requested = Number(url.searchParams.get('limit') ?? config.chatHistoryLimit);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), config.chatHistoryLimit)
    : config.chatHistoryLimit;
  const rows = db
    .prepare('SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?')
    .all(channel, limit) as Array<Record<string, unknown>>;
  rows.reverse();
  return { channel, messages: rows };
}

/** 路由主体：所有 REST 接口集中在这一个函数里，便于阅读与测试。 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  config: ServerConfig,
  catalog: Catalog,
  limiter: RateLimiter,
  serveStatic: StaticHandler,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const route = `${method} ${url.pathname}`;

  // 网页版部署在 GitHub Pages，与 API 不同源，必须允许跨域
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 客户端页面与脚本：不计数限流（一个页面要拉几个静态文件，算进去会误伤正常访问）
  if (method === 'GET' && serveStatic(url.pathname, res)) {
    return;
  }

  const ip = clientIp(req, config.trustProxy);
  const tooMany = (retryAfterMs: number, message: string): void => {
    res.setHeader('retry-after', String(Math.ceil(retryAfterMs / 1000)));
    sendJson(res, 429, { code: 'rate_limited', message, retryAfterMs });
  };

  // 第一道：每个 IP 的总请求量（挡脚本无脑扫接口）
  const globalCheck = limiter.hit(`ip:${ip}`, 60_000, config.rateLimitGlobalPerMin);
  if (!globalCheck.ok) {
    tooMany(globalCheck.retryAfterMs, `请求过于频繁，请 ${Math.ceil(globalCheck.retryAfterMs / 1000)} 秒后重试`);
    return;
  }

  // 第二道：注册/登录更严（这是最容易被刷爆表的入口）
  if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') {
    const authCheck = limiter.hit(`auth:${ip}`, 60_000, config.rateLimitAuthPerMin);
    if (!authCheck.ok) {
      tooMany(authCheck.retryAfterMs, '注册/登录尝试过于频繁，请稍后再试');
      return;
    }
  }

  try {
    if (route === 'GET /health') {
      sendJson(res, 200, { ok: true, time: Date.now() });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/debug') {
      // 静态文件处理器理论上已接管这两个路径；走到这里说明 public/ 缺文件
      throw new ApiError(500, 'client_missing', '客户端页面缺失（public/index.html）');
    }

    if (route === 'POST /api/auth/register' || route === 'POST /api/auth/login') {
      const body = await readJsonBody(req, 64 * 1024);
      const deviceCode = validateDeviceCode(body['deviceCode']);
      const isRegister = route.endsWith('/register');
      const nickname = isRegister
        ? validateNickname(body['nickname'], config.nicknameMaxChars)
        : '';
      const { account, token, recoveryCode } = registerOrLogin(
        db,
        deviceCode,
        nickname,
        isRegister ? 'register' : 'login',
      );
      sendJson(res, 200, {
        token,
        playerId: account.id,
        nickname: account.nickname,
        createdAt: account.created_at,
        ...(recoveryCode ? { recoveryCode } : {}),
      });
      return;
    }

    if (route === 'POST /api/auth/recovery/redeem') {
      const body = await readJsonBody(req, 64 * 1024);
      const code = body['recoveryCode'];
      if (typeof code !== 'string') {
        throw new ApiError(400, 'bad_recovery_code', 'recoveryCode 必须是字符串');
      }
      const deviceCode = validateDeviceCode(body['deviceCode']);
      const { account, token } = redeemRecoveryCode(db, code, deviceCode);
      sendJson(res, 200, {
        token,
        playerId: account.id,
        nickname: account.nickname,
        recovered: true,
      });
      return;
    }

    if (route === 'POST /api/auth/recovery/rotate') {
      const account = authenticate(db, bearerToken(req));
      const recoveryCode = rotateRecoveryCode(db, account.id);
      sendJson(res, 200, { recoveryCode, message: '旧恢复码已失效，请立刻保存新码' });
      return;
    }

    if (route === 'GET /api/profile') {
      const account = authenticate(db, bearerToken(req));
      sendJson(res, 200, { playerId: account.id, nickname: account.nickname });
      return;
    }

    if (route === 'PUT /api/profile') {
      const account = authenticate(db, bearerToken(req));
      const body = await readJsonBody(req, 64 * 1024);
      const nickname = validateNickname(body['nickname'], config.nicknameMaxChars);
      const updated = renameAccount(db, account, nickname);
      sendJson(res, 200, { playerId: updated.id, nickname: updated.nickname });
      return;
    }

    if (route === 'GET /api/saves/latest') {
      const account = authenticate(db, bearerToken(req));
      const row = latestSave(db, account.id);
      if (!row) {
        sendJson(res, 200, { version: 0, data: null });
        return;
      }
      sendJson(res, 200, { version: row.version, data: row.data, size: row.size, createdAt: row.created_at });
      return;
    }

    if (route === 'PUT /api/saves') {
      const account = authenticate(db, bearerToken(req));
      const body = await readJsonBody(req, config.saveMaxBytes * 2);
      const { status, payload } = uploadSave(db, config, account.id, body);
      sendJson(res, status, payload);
      return;
    }

    if (route === 'GET /api/saves/versions') {
      const account = authenticate(db, bearerToken(req));
      const rows = db
        .prepare('SELECT version, size, created_at FROM saves WHERE account_id = ? ORDER BY version DESC')
        .all(account.id) as Array<{ version: number; size: number; created_at: number }>;
      sendJson(res, 200, {
        versions: rows.map((r) => ({ version: r.version, size: r.size, createdAt: r.created_at })),
      });
      return;
    }

    {
      const versionMatch = url.pathname.match(/^\/api\/saves\/versions\/(\d+)$/);
      if (method === 'GET' && versionMatch) {
        const account = authenticate(db, bearerToken(req));
        const row = db
          .prepare('SELECT * FROM saves WHERE account_id = ? AND version = ?')
          .get(account.id, Number(versionMatch[1])) as SaveRow | undefined;
        if (!row) {
          throw new ApiError(404, 'version_not_found', '该历史版本不存在（可能已被清理）');
        }
        sendJson(res, 200, { ...saveSummary(row), data: row.data });
        return;
      }
    }

    if (route === 'GET /api/chat/history') {
      authenticate(db, bearerToken(req));
      sendJson(res, 200, chatHistory(db, config, url));
      return;
    }

    // ---- 钱包 / 库存 / 产出 ----
    if (route === 'GET /api/wallet') {
      const account = authenticate(db, bearerToken(req));
      const wallet = walletOf(db, account.id);
      sendJson(res, 200, {
        credits: wallet.credits,
        escrow: wallet.escrow,
        available: wallet.credits - wallet.escrow,
      });
      return;
    }

    if (route === 'GET /api/inventory') {
      const account = authenticate(db, bearerToken(req));
      sendJson(res, 200, inventoryOf(db, account.id));
      return;
    }

    if (route === 'POST /api/production/report') {
      const account = authenticate(db, bearerToken(req));
      const body = await readJsonBody(req, 256 * 1024);
      const result = reportProduction(db, catalog, config, account.id, body);
      sendJson(res, 200, result);
      return;
    }

    // ---- 市场 ----
    if (route === 'GET /api/market/catalog') {
      const keyword = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const items = catalog
        .all()
        .filter((item) => item.playerSellable || item.playerBuyable)
        .filter((item) =>
          keyword === ''
            ? true
            : item.id.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword),
        )
        .slice(0, 1000)
        .map((item) => ({
          itemDefId: item.id,
          name: item.name,
          marketKind: item.marketKind,
          rarity: item.rarity,
          basePrice: item.basePrice,
          floorPrice: item.floorPrice,
          instanceBased: item.instanceBased,
          playerSellable: item.playerSellable,
          playerBuyable: item.playerBuyable,
          npcBuyPrice: item.npcBuyPrice,
        }));
      sendJson(res, 200, { total: items.length, items });
      return;
    }

    {
      const bookMatch = url.pathname.match(/^\/api\/market\/book\/([A-Za-z0-9_-]+)$/);
      if (method === 'GET' && bookMatch) {
        sendJson(res, 200, orderBook(db, catalog, bookMatch[1]));
        return;
      }
    }

    if (route === 'GET /api/market/orders/mine') {
      const account = authenticate(db, bearerToken(req));
      sendJson(res, 200, { orders: myOrders(db, account.id) });
      return;
    }

    if (route === 'POST /api/market/orders') {
      const account = authenticate(db, bearerToken(req));
      const body = await readJsonBody(req, 64 * 1024);
      const side = body['side'];
      if (side !== 'buy' && side !== 'sell') {
        throw new ApiError(400, 'bad_side', 'side 必须是 buy 或 sell');
      }
      const itemDefId = body['itemDefId'];
      if (typeof itemDefId !== 'string') {
        throw new ApiError(400, 'bad_item', 'itemDefId 必须是字符串');
      }
      const result = placeOrder(db, catalog, config, account.id, {
        side,
        itemDefId,
        qty: Number(body['qty']),
        price: Number(body['price']),
        ...(typeof body['instanceId'] === 'string' ? { instanceId: body['instanceId'] } : {}),
      });
      sendJson(res, 200, result);
      return;
    }

    {
      const cancelMatch = url.pathname.match(/^\/api\/market\/orders\/(\d+)$/);
      if (method === 'DELETE' && cancelMatch) {
        const account = authenticate(db, bearerToken(req));
        sendJson(res, 200, cancelOrder(db, account.id, Number(cancelMatch[1])));
        return;
      }
    }

    if (route === 'GET /api/market/trades') {
      const itemDefId = url.searchParams.get('itemDefId') ?? '';
      if (!itemDefId) {
        throw new ApiError(400, 'bad_item', '缺少 itemDefId');
      }
      sendJson(res, 200, { trades: recentTrades(db, itemDefId) });
      return;
    }

    // ---- 账本 ----
    if (route === 'GET /api/ledger/entries') {
      const account = authenticate(db, bearerToken(req));
      const since = Number(url.searchParams.get('since') ?? 0);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200), 1), 500);
      const rows = db
        .prepare(
          `SELECT seq, entry_type, ref_type, ref_id, credits_delta, escrow_delta, item_def_id, qty_delta, instance_id, hash, created_at
           FROM ledger_entries WHERE account_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
        )
        .all(account.id, Number.isFinite(since) ? since : 0, limit) as Array<Record<string, unknown>>;
      sendJson(res, 200, {
        entries: rows.map((row) => ({
          seq: row['seq'],
          entryType: row['entry_type'],
          refType: row['ref_type'],
          refId: row['ref_id'],
          creditsDelta: row['credits_delta'],
          escrowDelta: row['escrow_delta'],
          itemDefId: row['item_def_id'],
          qtyDelta: row['qty_delta'],
          instanceId: row['instance_id'],
          hash: row['hash'],
          createdAt: row['created_at'],
        })),
      });
      return;
    }

    if (route === 'GET /api/ledger/verify') {
      authenticate(db, bearerToken(req));
      sendJson(res, 200, verifyChain(db));
      return;
    }

    if (route === 'GET /api/items/verify') {
      const account = authenticate(db, bearerToken(req));
      const instanceId = url.searchParams.get('instanceId') ?? '';
      const row = db.prepare('SELECT * FROM items WHERE instance_id = ?').get(instanceId) as
        | { instance_id: string; item_def_id: string; account_id: number }
        | undefined;
      if (!row) {
        throw new ApiError(404, 'instance_not_found', '物品实例不存在');
      }
      sendJson(res, 200, {
        instanceId: row.instance_id,
        itemDefId: row.item_def_id,
        ownerId: row.account_id,
        signature: signInstance(config.itemSignSeed, row.instance_id, row.item_def_id, row.account_id),
        viewer: account.id,
      });
      return;
    }

    sendJson(res, 404, { code: 'not_found', message: `未知接口：${route}` });
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { code: error.code, message: error.message });
      return;
    }
    sendJson(res, 500, { code: 'internal_error', message: '服务器内部错误' });
  }
}
