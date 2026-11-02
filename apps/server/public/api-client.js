/**
 * 服务端 HTTP / WebSocket 客户端。
 *
 * 设计口径：调用方只需要「服务器地址 + 端口」一个配置项，WebSocket 地址由它推导
 * （http → ws、https → wss），所以桌面版与网页版共用同一套逻辑。
 * 这里不引用任何 DOM，Node 里可以直接用 globalThis.fetch 跑确定性用例。
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码（网络层失败用 0）
   * @param {string} code 服务端错误码
   * @param {string} message 面向玩家的说明
   * @param {Record<string, unknown>} [extra] 服务端附带的额外字段（如 latestVersion）
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  /** 429 时服务端建议的重试等待（毫秒） */
  get retryAfterMs() {
    const value = this.extra?.['retryAfterMs'];
    return typeof value === 'number' && Number.isFinite(value) ? value : 1000;
  }
}

/**
 * 规范化服务器地址：补协议、去尾部斜杠、去空白。
 * 玩家可能只输入 `1.2.3.4:8787`，也允许 `https://example.com`。
 */
export function normalizeServer(input, fallback = '') {
  const raw = String(input ?? '').trim() || String(fallback ?? '').trim();
  if (!raw) {
    return '';
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

/** 由服务器地址推导聊天 WebSocket 地址。 */
export function chatWsUrl(server, token) {
  const base = normalizeServer(server);
  if (!base) {
    throw new ApiError(0, 'bad_server', '还没填服务器地址');
  }
  const wsBase = base.replace(/^http/i, 'ws');
  return `${wsBase}/api/chat/ws?token=${encodeURIComponent(token ?? '')}`;
}

/**
 * @param {object} [options]
 * @param {string} [options.server]
 * @param {string} [options.token]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createApi(options = {}) {
  let server = normalizeServer(options.server ?? '');
  let token = options.token ?? '';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    if (!server) {
      throw new ApiError(0, 'bad_server', '还没填服务器地址');
    }
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    if (auth && token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetchImpl(server + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ApiError(0, 'network_error', `连不上服务器：${(error && error.message) || error}`);
    }
    const text = await response.text();
    let parsed = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const payload = parsed && typeof parsed === 'object' ? parsed : {};
      throw new ApiError(
        response.status,
        typeof payload.code === 'string' ? payload.code : `http_${response.status}`,
        typeof payload.message === 'string' ? payload.message : `请求失败（HTTP ${response.status}）`,
        payload,
      );
    }
    return parsed;
  }

  return {
    get server() {
      return server;
    },
    setServer(next) {
      server = normalizeServer(next);
      return server;
    },
    get token() {
      return token;
    },
    setToken(next) {
      token = next ?? '';
    },
    request,

    health: () => request('/health', { auth: false }),

    register: (deviceCode, nickname) =>
      request('/api/auth/register', { method: 'POST', body: { deviceCode, nickname }, auth: false }),
    login: (deviceCode) =>
      request('/api/auth/login', { method: 'POST', body: { deviceCode }, auth: false }),
    redeemRecovery: (recoveryCode, deviceCode) =>
      request('/api/auth/recovery/redeem', {
        method: 'POST',
        body: { recoveryCode, deviceCode },
        auth: false,
      }),
    rotateRecovery: () => request('/api/auth/recovery/rotate', { method: 'POST', body: {} }),
    profile: () => request('/api/profile'),
    rename: (nickname) => request('/api/profile', { method: 'PUT', body: { nickname } }),

    saveLatest: () => request('/api/saves/latest'),
    /** @param {string} data @param {number} [baseVersion] */
    uploadSave: (data, baseVersion) =>
      request('/api/saves', {
        method: 'PUT',
        body: baseVersion === undefined ? { data } : { data, baseVersion },
      }),
    saveVersions: () => request('/api/saves/versions'),
    saveVersion: (version) => request(`/api/saves/versions/${version}`),

    chatHistory: (channel, limit = 100) =>
      request(`/api/chat/history?channel=${encodeURIComponent(channel)}&limit=${limit}`),

    wallet: () => request('/api/wallet'),
    inventory: () => request('/api/inventory'),
    reportProduction: (batch) => request('/api/production/report', { method: 'POST', body: batch }),
    verifyItem: (instanceId) =>
      request(`/api/items/verify?instanceId=${encodeURIComponent(instanceId)}`),

    catalog: (keyword = '') => request(`/api/market/catalog?q=${encodeURIComponent(keyword)}`),
    orderBook: (itemDefId) => request(`/api/market/book/${encodeURIComponent(itemDefId)}`),
    placeOrder: (order) => request('/api/market/orders', { method: 'POST', body: order }),
    cancelOrder: (orderId) => request(`/api/market/orders/${orderId}`, { method: 'DELETE' }),
    myOrders: () => request('/api/market/orders/mine'),
    trades: (itemDefId) =>
      request(`/api/market/trades?itemDefId=${encodeURIComponent(itemDefId)}`),

    ledgerEntries: (since = 0, limit = 200) =>
      request(`/api/ledger/entries?since=${since}&limit=${limit}`),
    verifyLedger: () => request('/api/ledger/verify'),
  };
}
