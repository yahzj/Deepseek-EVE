/**
 * 大鲸鱼 · 云端客户端。
 *
 * 这是「服务器地址 + 端口」参数化的独立页面：不依赖游戏工程，也不改游戏内代码，
 * 桌面版玩家可以拿它同步存档、聊天、挂市场；游戏接入时复用同一套接口契约。
 */
import { ApiError, chatWsUrl, createApi, normalizeServer } from './api-client.js';
import { createBatchQueue } from './chat-queue.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'whale.cloud.v1';
const CHAT_BATCH_MS = 3000;

const state = {
  api: createApi(),
  deviceCode: '',
  profile: null,
  save: { serverVersion: 0, serverData: null, localText: null, localName: '' },
  market: { selected: null, item: null, catalog: [] },
  chat: {
    ws: null,
    channel: 'zh',
    online: [],
    logs: { zh: [], en: [] },
    unread: { zh: 0, en: 0 },
    loaded: { zh: false, en: false },
    queues: new Map(),
    manualClose: false,
    retries: 0,
    reconnectTimer: null,
  },
  ledger: [],
};

/* ------------------------------ 小工具 ------------------------------ */

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function fmtNumber(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '-';
}

function fmtSize(bytes) {
  const num = Number(bytes ?? 0);
  if (!num) return '-';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(ts, withDate = false) {
  if (!ts) return '-';
  const date = new Date(Number(ts));
  const time = date.toLocaleTimeString('zh-CN', { hour12: false });
  return withDate ? `${date.toLocaleDateString('zh-CN')} ${time}` : time;
}

function setMsg(node, text, kind = '') {
  if (!node) return;
  node.textContent = text;
  node.className = `msg ${kind}`.trim();
  node.hidden = !text;
}

function clearMsg(node) {
  if (node) node.hidden = true;
}

function renderTable(container, headers, rows, emptyText = '暂无数据') {
  container.replaceChildren();
  if (rows.length === 0) {
    container.append(h('p', { class: 'empty', text: emptyText }));
    return;
  }
  const thead = h(
    'thead',
    {},
    h(
      'tr',
      {},
      ...headers.map(([label, cls]) => h('th', cls ? { class: cls } : {}, label)),
    ),
  );
  const tbody = h('tbody', {});
  for (const row of rows) {
    tbody.append(
      h(
        'tr',
        row.onClick ? { class: 'clickable', onclick: row.onClick } : {},
        ...row.cells.map(([value, cls]) =>
          h('td', cls ? { class: cls } : {}, value instanceof Node ? value : String(value)),
        ),
      ),
    );
  }
  container.append(h('table', {}, thead, tbody));
}

/* ------------------------------ 本地配置 ------------------------------ */

function randomDeviceCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `dev-${hex}`;
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      server: state.api.server,
      deviceCode: state.deviceCode,
      token: state.api.token,
      nickname: state.profile?.nickname ?? $('nickname').value ?? '',
    }),
  );
}

function restoreConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    saved = {};
  }
  const fromUrl = new URLSearchParams(location.search).get('server');
  const server = normalizeServer(fromUrl || saved.server || location.origin);
  state.deviceCode = saved.deviceCode || randomDeviceCode();
  state.api.setServer(server);
  state.api.setToken(saved.token || '');
  $('server').value = server;
  $('deviceCode').value = state.deviceCode;
  $('nickname').value = saved.nickname ?? '';
}

/* ------------------------------ 连接与账号 ------------------------------ */

function setConn(kind, text) {
  const dot = $('connDot');
  dot.className = `dot${kind ? ` ${kind}` : ''}`;
  $('connText').textContent = text;
}

function renderAuth() {
  const logged = Boolean(state.profile);
  $('authGuest').hidden = logged;
  $('authUser').hidden = !logged;
  $('logoutBtn').hidden = !logged;
  $('whoName').textContent = logged ? state.profile.nickname : '未登录';
  if (logged) {
    $('userName').textContent = state.profile.nickname;
    $('userId').textContent = String(state.profile.playerId ?? '-');
    $('renameInput').value = state.profile.nickname;
  }
  $('chatInput').disabled = !logged;
  $('chatSend').disabled = !logged;
}

async function connect() {
  const server = state.api.setServer($('server').value || location.origin);
  if (!server) {
    setConn('bad', '未填地址');
    return;
  }
  persist();
  setConn('', '连接中…');
  try {
    const health = await state.api.health();
    setConn('on', `在线 · ${fmtTime(health.time)}`);
  } catch (error) {
    setConn('bad', error.message);
    return;
  }

  if (state.api.token) {
    try {
      state.profile = await state.api.profile();
    } catch (error) {
      if (error.status === 401) {
        state.api.setToken('');
        persist();
      }
    }
  }

  if (!state.profile) {
    try {
      const result = await state.api.login(state.deviceCode);
      state.api.setToken(result.token);
      state.profile = { playerId: result.playerId, nickname: result.nickname };
      persist();
      setMsg($('authMsg'), `已用本机设备码自动登录：${result.nickname}`, 'ok');
    } catch (error) {
      if (error.status !== 404) setMsg($('authMsg'), `自动登录失败：${error.message}`, 'warn');
    }
  }

  renderAuth();
  if (state.profile) await afterLogin();
}

async function afterLogin() {
  clearMsg($('authMsg'));
  await Promise.allSettled([refreshSave(), refreshWallet(), refreshOrders(), refreshInventory()]);
  connectChat();
}

function handleUnauthorized() {
  state.api.setToken('');
  state.profile = null;
  persist();
  renderAuth();
  closeChat(true);
  setMsg($('authMsg'), '登录已失效（可能在其他设备登录过），请重新登录。', 'warn');
}

function onError(error, target) {
  if (error instanceof ApiError && error.status === 401) {
    handleUnauthorized();
    return;
  }
  const message = error?.message ?? String(error);
  if (target) setMsg(target, message, 'bad');
  else console.error(error);
}

async function registerAccount() {
  const nickname = $('nickname').value.trim();
  if (!nickname) {
    setMsg($('authMsg'), '先填一个昵称', 'bad');
    return;
  }
  const result = await state.api.register(state.deviceCode, nickname);
  state.api.setToken(result.token);
  state.profile = { playerId: result.playerId, nickname: result.nickname };
  persist();
  renderAuth();
  await afterLogin();
  if (result.recoveryCode) {
    $('recoveryShow').value = result.recoveryCode;
    setMsg($('authMsg'), '注册成功。恢复码只显示这一次，请立刻抄下来。', 'ok');
  } else {
    setMsg($('authMsg'), `注册成功：${result.nickname}`, 'ok');
  }
}

async function redeemRecovery() {
  const code = $('recoveryInput').value.trim();
  if (!code) {
    setMsg($('authMsg'), '先填恢复码', 'bad');
    return;
  }
  const result = await state.api.redeemRecovery(code, state.deviceCode);
  state.api.setToken(result.token);
  state.profile = { playerId: result.playerId, nickname: result.nickname };
  persist();
  renderAuth();
  await afterLogin();
  setMsg($('authMsg'), `已迁移到本设备：${result.nickname}（旧设备码已失效）`, 'ok');
}

async function rotateRecovery() {
  const result = await state.api.rotateRecovery();
  $('recoveryShow').value = result.recoveryCode;
  setMsg($('authMsg'), '新恢复码已签发，旧码作废，请立刻抄下来。', 'warn');
}

async function renameAccount() {
  const nickname = $('renameInput').value.trim();
  if (!nickname) return;
  const result = await state.api.rename(nickname);
  state.profile = { playerId: result.playerId, nickname: result.nickname };
  persist();
  renderAuth();
  // 昵称在连接时确定，改名后重连才能让聊天显示新名字
  closeChat(true);
  connectChat();
  setMsg($('authMsg'), `昵称已改为 ${result.nickname}`, 'ok');
}

function logout() {
  state.api.setToken('');
  state.profile = null;
  persist();
  renderAuth();
  closeChat(true);
  $('saveVersion').textContent = '-';
  $('saveSize').textContent = '-';
  setMsg($('authMsg'), '已退出本机登录（设备码仍保留，可再登录）。', 'warn');
}

/* ------------------------------ 云存档 ------------------------------ */

async function refreshSave() {
  if (!state.profile) return;
  const latest = await state.api.saveLatest();
  state.save.serverVersion = latest.version ?? 0;
  state.save.serverData = latest.data ?? null;
  $('saveVersion').textContent = latest.version ? `v${latest.version}` : '空（还没上传过）';
  $('saveSize').textContent = fmtSize(latest.size);
  $('downloadBtn').disabled = !latest.data;
  $('saveFileOut').disabled = !latest.data;
  if (latest.data) {
    $('savePreviewFold').hidden = false;
    $('savePreview').value = latest.data;
  }
  await refreshVersions();
}

async function refreshVersions() {
  if (!state.profile) return;
  const { versions } = await state.api.saveVersions();
  const rows = versions.map((item) => ({
    cells: [
      [`v${item.version}`],
      [fmtSize(item.size), 'num'],
      [fmtTime(item.createdAt, true)],
      [
        h(
          'span',
          {},
          h('button', { class: 'btn ghost small', onclick: () => downloadVersion(item.version) }, '下载'),
          ' ',
          h('button', { class: 'btn ghost small', onclick: () => rollbackTo(item.version) }, '回滚'),
        ),
      ],
    ],
  }));
  renderTable($('versionList'), [['版本'], ['大小', 'num'], ['时间'], ['操作']], rows, '还没有历史版本');
}

async function pickSaveFile(file) {
  if (!file) return;
  const text = await file.text();
  try {
    JSON.parse(text);
  } catch {
    setMsg($('saveMsg'), '这个文件不是合法 JSON，先确认选的是游戏存档。', 'bad');
    return;
  }
  state.save.localText = text;
  state.save.localName = file.name;
  $('saveLocal').textContent = `${file.name} · ${fmtSize(text.length)}`;
  $('uploadBtn').disabled = false;
  clearMsg($('saveMsg'));
}

async function uploadSave(force = false) {
  if (!state.save.localText) return;
  const baseVersion = force ? undefined : state.save.serverVersion;
  const result = await state.api.uploadSave(state.save.localText, baseVersion);
  $('saveConflict').hidden = true;
  setMsg($('saveMsg'), `已上传为 v${result.version}（${fmtSize(result.size)}）`, 'ok');
  await refreshSave();
}

async function downloadLatestSave() {
  const latest = await state.api.saveLatest();
  if (!latest.data) {
    setMsg($('saveMsg'), '云端还没有存档。', 'warn');
    return;
  }
  state.save.serverData = latest.data;
  state.save.serverVersion = latest.version;
  $('savePreviewFold').hidden = false;
  $('savePreview').value = latest.data;
  $('saveFileOut').disabled = false;
  setMsg($('saveMsg'), `已拉取 v${latest.version}（${fmtSize(latest.size)}），可另存为文件。`, 'ok');
}

async function downloadVersion(version) {
  const row = await state.api.saveVersion(version);
  saveTextAsFile(row.data, `whale-save-v${version}.json`);
  setMsg($('saveMsg'), `已下载历史版本 v${version}。`, 'ok');
}

async function rollbackTo(version) {
  const row = await state.api.saveVersion(version);
  if (!confirm(`把 v${version} 的内容上传为新版本（当前 v${state.save.serverVersion}）？历史不会被删除。`)) {
    return;
  }
  const result = await state.api.uploadSave(row.data, state.save.serverVersion);
  setMsg($('saveMsg'), `已回滚，v${version} 的内容现在是 v${result.version}。`, 'ok');
  await refreshSave();
}

function saveTextAsFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showConflict(latestVersion) {
  const box = $('saveConflict');
  box.replaceChildren(
    h('strong', { text: `服务器上已有 v${latestVersion}，你这次上传基于 v${state.save.serverVersion}。` }),
    h('p', { text: '先拉云端版本比对，还是确认用本地覆盖？覆盖不会删除历史版本，可以回滚。' }),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'btn ghost small',
          onclick: async () => {
            try {
              await downloadLatestSave();
            } catch (error) {
              onError(error, $('saveMsg'));
            }
          },
        },
        '先拉云端版本',
      ),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            try {
              await uploadSave(true);
            } catch (error) {
              onError(error, $('saveMsg'));
            }
          },
        },
        '确认覆盖',
      ),
    ),
  );
  box.hidden = false;
}

/* ------------------------------ 钱包 / 库存 ------------------------------ */

async function refreshWallet() {
  if (!state.profile) return;
  const wallet = await state.api.wallet();
  $('walletAvailable').textContent = fmtNumber(wallet.available);
  $('walletEscrow').textContent = fmtNumber(wallet.escrow);
  $('walletCredits').textContent = fmtNumber(wallet.credits);
}

async function refreshInventory() {
  if (!state.profile) return;
  const inventory = await state.api.inventory();
  const stackRows = inventory.stacks.map((stack) => ({
    cells: [
      [stack.itemDefId],
      [fmtNumber(stack.qty), 'num'],
      [fmtNumber(stack.locked), 'num'],
      [fmtNumber(stack.qty - stack.locked), 'num'],
      [
        h(
          'button',
          {
            class: 'btn ghost small',
            onclick: () => openSell(stack.itemDefId),
          },
          '挂卖',
        ),
      ],
    ],
  }));
  renderTable(
    $('stackList'),
    [['物品'], ['数量', 'num'], ['冻结', 'num'], ['可用', 'num'], ['操作']],
    stackRows,
    '没有可堆叠物品',
  );

  const itemRows = inventory.items.map((item) => ({
    cells: [
      [item.instanceId.slice(0, 13) + '…'],
      [item.itemDefId],
      [item.status === 'listed' ? '挂单中' : '在手'],
      [
        h(
          'details',
          {},
          h('summary', { class: 'muted', text: '属性' }),
          h('pre', { class: 'muted', text: JSON.stringify(item.props ?? {}, null, 1) }),
        ),
      ],
      [
        h(
          'span',
          {},
          h('button', { class: 'btn ghost small', onclick: () => openSell(item.itemDefId, item.instanceId) }, '挂卖'),
          ' ',
          h('button', { class: 'btn ghost small', onclick: () => verifyInstance(item.instanceId) }, '核验'),
        ),
      ],
    ],
  }));
  renderTable(
    $('itemList'),
    [['实例'], ['定义'], ['状态'], ['属性'], ['操作']],
    itemRows,
    '没有实例物品（舰船/装备/蓝图）',
  );
}

async function verifyInstance(instanceId) {
  const result = await state.api.verifyItem(instanceId);
  setMsg($('prodMsg'), `实例签名：${result.signature}（归属 ${result.ownerId}）`, 'ok');
}

async function reportProduction(items) {
  const batchId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await state.api.reportProduction({ batchId, items, clientTs: Date.now() });
  const credited = result.credited
    .map((entry) => `${entry.itemDefId} × ${entry.qty}${entry.instanceId ? '（实例）' : ''}`)
    .join('、');
  setMsg(
    $('prodMsg'),
    result.accepted ? `已入账：${credited || '（重复批次，未重复入账）'}` : '批次被拒绝',
    result.accepted ? 'ok' : 'bad',
  );
  await Promise.allSettled([refreshInventory(), refreshWallet()]);
}

async function submitProductionSingle() {
  const itemDefId = $('prodItem').value.trim();
  const qty = Number($('prodQty').value);
  if (!itemDefId || !Number.isFinite(qty) || qty <= 0) {
    setMsg($('prodMsg'), '填物品 id 与正整数数量', 'bad');
    return;
  }
  await reportProduction([{ itemDefId, qty: Math.trunc(qty) }]);
}

async function submitProductionBatch() {
  let parsed;
  try {
    parsed = JSON.parse($('prodJson').value);
  } catch {
    setMsg($('prodMsg'), '批量内容不是合法 JSON 数组', 'bad');
    return;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    setMsg($('prodMsg'), '批量内容必须是非空数组', 'bad');
    return;
  }
  await reportProduction(parsed);
}

/* ------------------------------ 市场 ------------------------------ */

async function searchCatalog() {
  const keyword = $('marketQuery').value.trim();
  const result = await state.api.catalog(keyword);
  state.market.catalog = result.items;
  const rows = result.items.slice(0, 50).map((item) => ({
    cells: [
      [item.name],
      [item.itemDefId],
      [fmtNumber(item.basePrice), 'num'],
      [fmtNumber(item.floorPrice), 'num'],
      [item.instanceBased ? '实例' : '堆叠'],
    ],
    onClick: () => selectItem(item.itemDefId),
  }));
  renderTable(
    $('catalogList'),
    [['名称'], ['id'], ['基准价', 'num'], ['最低价', 'num'], ['类型']],
    rows,
    '没有匹配的物品',
  );
  if (result.items.length > 50) {
    $('catalogList').append(h('p', { class: 'hint', text: `共 ${result.total} 条，显示前 50，继续输入缩小范围` }));
  }
}

async function selectItem(itemDefId) {
  const item = state.market.catalog.find((row) => row.itemDefId === itemDefId) ?? null;
  state.market.selected = itemDefId;
  state.market.item = item;
  $('tradeCard').hidden = false;
  $('tradeTitle').textContent = item ? `${item.name} · ${item.itemDefId}` : itemDefId;
  $('tradeBase').textContent = item ? fmtNumber(item.basePrice) : '-';
  $('tradeFloor').textContent = item ? fmtNumber(item.floorPrice) : '-';
  $('orderPrice').value = item ? String(item.basePrice) : '';

  await refreshBook(itemDefId);
  await refreshTrades(itemDefId);
  if (item?.instanceBased) {
    await fillInstanceOptions(itemDefId);
  } else {
    $('orderInstance').hidden = true;
  }
  clearMsg($('tradeMsg'));
}

async function refreshBook(itemDefId) {
  const book = await state.api.orderBook(itemDefId);
  $('tradeFloor').textContent = fmtNumber(book.floorPrice);
  const toRows = (levels, empty) =>
    levels.length === 0
      ? [{ cells: [[empty]] }]
      : levels.map((level) => ({
          cells: [
            [fmtNumber(level.price), 'num'],
            [fmtNumber(level.qty), 'num'],
            [fmtNumber(level.orders), 'num'],
          ],
        }));
  renderTable($('bookBids'), [['价', 'num'], ['量', 'num'], ['笔', 'num']], toRows(book.bids, '无买盘'), '无买盘');
  renderTable($('bookAsks'), [['价', 'num'], ['量', 'num'], ['笔', 'num']], toRows(book.asks, '无卖盘'), '无卖盘');
}

async function refreshTrades(itemDefId) {
  const { trades } = await state.api.trades(itemDefId);
  const rows = trades.map((trade) => ({
    cells: [
      [fmtTime(trade.createdAt, true)],
      [fmtNumber(trade.price), 'num'],
      [fmtNumber(trade.qty), 'num'],
      [fmtNumber(trade.tax), 'num'],
    ],
  }));
  renderTable($('tradeList'), [['时间'], ['成交价', 'num'], ['数量', 'num'], ['税', 'num']], rows, '还没有成交记录');
}

async function fillInstanceOptions(itemDefId) {
  const select = $('orderInstance');
  select.hidden = false;
  select.replaceChildren();
  const inventory = await state.api.inventory();
  const candidates = inventory.items.filter(
    (item) => item.itemDefId === itemDefId && item.status !== 'listed',
  );
  for (const item of candidates) {
    select.append(h('option', { value: item.instanceId, text: `${item.instanceId.slice(0, 13)}…` }));
  }
  if (candidates.length === 0) {
    select.append(h('option', { value: '', text: '（本机账号没有该实例）' }));
  }
}

async function submitOrder() {
  if (!state.market.selected) return;
  const item = state.market.item;
  const side = $('orderSide').value;
  const price = Number($('orderPrice').value);
  const instanceBased = Boolean(item?.instanceBased);
  const qty = instanceBased ? 1 : Number($('orderQty').value);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
    setMsg($('tradeMsg'), '价格与数量都要填正整数', 'bad');
    return;
  }
  const order = { side, itemDefId: state.market.selected, qty: Math.trunc(qty), price: Math.trunc(price) };
  if (instanceBased && side === 'sell') {
    const instanceId = $('orderInstance').value;
    if (!instanceId) {
      setMsg($('tradeMsg'), '这个物品要按实例挂单，但当前没有可卖的实例', 'bad');
      return;
    }
    order.instanceId = instanceId;
  }
  const result = await state.api.placeOrder(order);
  const filled = result.trades?.length ?? 0;
  setMsg(
    $('tradeMsg'),
    `下单成功（订单 ${result.orderId}，状态 ${result.status}${filled ? `，立即成交 ${filled} 笔` : ''}）`,
    'ok',
  );
  await Promise.allSettled([
    refreshBook(state.market.selected),
    refreshTrades(state.market.selected),
    refreshOrders(),
    refreshWallet(),
    refreshInventory(),
  ]);
}

async function refreshOrders() {
  if (!state.profile) return;
  const { orders } = await state.api.myOrders();
  const rows = orders.map((order) => ({
    cells: [
      [String(order.orderId)],
      [order.side === 'buy' ? '买' : '卖'],
      [order.itemDefId],
      [`${order.qtyRemaining}/${order.qty}`],
      [fmtNumber(order.price), 'num'],
      [order.status === 'open' ? '挂单中' : order.status],
      [
        order.status === 'open' && order.qtyRemaining > 0
          ? h('button', { class: 'btn ghost small', onclick: () => cancelOrderAt(order.orderId) }, '撤单')
          : '-',
      ],
    ],
  }));
  renderTable(
    $('ordersList'),
    [['单号'], ['方向'], ['物品'], ['剩余/总量'], ['单价', 'num'], ['状态'], ['操作']],
    rows,
    '还没有订单',
  );
}

async function cancelOrderAt(orderId) {
  await state.api.cancelOrder(orderId);
  setMsg($('tradeMsg'), `订单 ${orderId} 已撤，冻结资产已退回。`, 'ok');
  await Promise.allSettled([refreshOrders(), refreshWallet(), refreshInventory()]);
  if (state.market.selected) await refreshBook(state.market.selected);
}

async function openSell(itemDefId, instanceId) {
  switchTab('market');
  await selectItem(itemDefId);
  $('orderSide').value = 'sell';
  if (instanceId) {
    $('orderInstance').value = instanceId;
    $('orderQty').value = '1';
  }
}

/* ------------------------------ 账本 ------------------------------ */

async function refreshLedger() {
  if (!state.profile) return;
  const { entries } = await state.api.ledgerEntries(0, 200);
  state.ledger = entries;
  const rows = entries
    .slice()
    .reverse()
    .map((entry) => ({
      cells: [
        [String(entry.seq), 'num'],
        [entry.entryType],
        [entry.creditsDelta ? fmtNumber(entry.creditsDelta) : '-', 'num'],
        [entry.escrowDelta ? fmtNumber(entry.escrowDelta) : '-', 'num'],
        [entry.itemDefId ?? '-'],
        [entry.qtyDelta ? fmtNumber(entry.qtyDelta) : '-', 'num'],
        [String(entry.hash ?? '').slice(0, 10)],
        [fmtTime(entry.createdAt, true)],
      ],
    }));
  renderTable(
    $('ledgerList'),
    [['序', 'num'], ['类型'], ['信用点', 'num'], ['冻结变动', 'num'], ['物品'], ['数量', 'num'], ['哈希'], ['时间']],
    rows,
    '还没有流水（物品/信用点变动才会记账）',
  );
}

async function verifyLedger() {
  const result = await state.api.verifyLedger();
  setMsg(
    $('ledgerMsg'),
    result.chainOk
      ? `全链校验通过：${result.checked} 条记录连续无断点。`
      : `发现篡改：第 ${result.brokenAt} 条起哈希对不上。`,
    result.chainOk ? 'ok' : 'bad',
  );
}

/* ------------------------------ 聊天 ------------------------------ */

function chatQueue(channel) {
  let queue = state.chat.queues.get(channel);
  if (!queue) {
    queue = createBatchQueue({
      intervalMs: CHAT_BATCH_MS,
      maxPerFrame: 5,
      send: (messages) => sendBatch(channel, messages),
    });
    state.chat.queues.set(channel, queue);
  }
  return queue;
}

function sendBatch(channel, messages) {
  const ws = state.chat.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    appendChat(channel, { kind: 'system', text: '未连接，消息没有发出（重连后可再发）' });
    return;
  }
  ws.send(JSON.stringify({ type: 'batch', channel, messages }));
}

function appendChat(channel, entry) {
  const logs = state.chat.logs[channel];
  logs.push(entry);
  if (logs.length > 300) logs.splice(0, logs.length - 300);
  if (channel === state.chat.channel) {
    renderChat();
    return;
  }
  state.chat.unread[channel] += 1;
  renderChannelTabs();
}

function renderChannelTabs() {
  for (const button of document.querySelectorAll('.chan')) {
    const channel = button.dataset.channel;
    const unread = state.chat.unread[channel];
    button.classList.toggle('active', channel === state.chat.channel);
    button.replaceChildren(
      channel === 'zh' ? '中文' : 'English',
      ...(unread > 0 ? [h('span', { class: 'badge', text: String(unread) })] : []),
    );
  }
}

function renderChat() {
  const log = $('chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.replaceChildren();
  for (const entry of state.chat.logs[state.chat.channel]) {
    if (entry.kind === 'system') {
      log.append(h('div', { class: 'chat-line sys', text: entry.text }));
      continue;
    }
    log.append(
      h(
        'div',
        { class: 'chat-line' },
        h('span', { class: 'time', text: fmtTime(entry.ts) }),
        h('span', { class: 'nick', style: `color:${nicknameColor(entry.nickname)}`, text: entry.nickname }),
        h('span', { text: entry.text }),
      ),
    );
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function nicknameColor(nickname) {
  let hash = 0;
  for (const char of String(nickname)) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return `hsl(${hash}, 70%, 68%)`;
}

async function loadHistory(channel) {
  if (state.chat.loaded[channel] || !state.profile) return;
  state.chat.loaded[channel] = true;
  try {
    const { messages } = await state.api.chatHistory(channel, 100);
    const history = messages.map((row) => ({
      kind: 'msg',
      nickname: row.nickname,
      text: row.text,
      ts: row.created_at,
    }));
    state.chat.logs[channel] = [...history, ...state.chat.logs[channel]];
    if (channel === state.chat.channel) renderChat();
  } catch (error) {
    state.chat.loaded[channel] = false;
    appendChat(channel, { kind: 'system', text: `历史消息加载失败：${error.message}` });
  }
}

function connectChat() {
  if (!state.profile) return;
  closeChat(true);
  state.chat.manualClose = false;
  let ws;
  try {
    ws = new WebSocket(chatWsUrl(state.api.server, state.api.token));
  } catch (error) {
    appendChat(state.chat.channel, { kind: 'system', text: `无法连接聊天：${error.message}` });
    return;
  }
  state.chat.ws = ws;

  ws.onopen = () => {
    state.chat.retries = 0;
    appendChat(state.chat.channel, { kind: 'system', text: '已连接聊天' });
    void loadHistory(state.chat.channel);
  };

  ws.onmessage = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    if (frame.type === 'hello') {
      state.chat.online = frame.online ?? [];
      updateOnline();
      appendChat(state.chat.channel, {
        kind: 'system',
        text: `欢迎 ${frame.nickname}，当前在线 ${state.chat.online.length} 人`,
      });
      return;
    }
    if (frame.type === 'presence') {
      if (frame.event === 'join') {
        if (!state.chat.online.includes(frame.nickname)) state.chat.online.push(frame.nickname);
      } else {
        state.chat.online = state.chat.online.filter((name) => name !== frame.nickname);
      }
      updateOnline();
      appendChat(state.chat.channel, {
        kind: 'system',
        text: `${frame.nickname} ${frame.event === 'join' ? '上线' : '下线'}（在线 ${frame.onlineCount}）`,
      });
      return;
    }
    if (frame.type === 'batch') {
      for (const text of frame.messages ?? []) {
        appendChat(frame.channel, { kind: 'msg', nickname: frame.nickname, text, ts: frame.ts });
      }
      return;
    }
    if (frame.type === 'error') {
      appendChat(state.chat.channel, { kind: 'system', text: `提示（${frame.code}）：${frame.message}` });
    }
  };

  ws.onclose = () => {
    state.chat.ws = null;
    if (state.chat.manualClose) return;
    appendChat(state.chat.channel, { kind: 'system', text: '聊天连接断开，正在重连…' });
    const delay = Math.min(30_000, 1000 * 2 ** state.chat.retries);
    state.chat.retries += 1;
    state.chat.reconnectTimer = setTimeout(() => connectChat(), delay);
  };

  ws.onerror = () => {
    appendChat(state.chat.channel, { kind: 'system', text: '聊天连接异常' });
  };
}

function closeChat(manual = false) {
  state.chat.manualClose = manual;
  if (state.chat.reconnectTimer) {
    clearTimeout(state.chat.reconnectTimer);
    state.chat.reconnectTimer = null;
  }
  if (state.chat.ws) {
    const ws = state.chat.ws;
    state.chat.ws = null;
    ws.onclose = null;
    ws.close();
  }
}

function updateOnline() {
  $('onlineCount').textContent = String(state.chat.online.length);
}

function queueChatMessage() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!state.chat.ws || state.chat.ws.readyState !== WebSocket.OPEN) {
    appendChat(state.chat.channel, { kind: 'system', text: '聊天未连接，先等重连或点「连接」' });
    return;
  }
  const queue = chatQueue(state.chat.channel);
  if (queue.push(text)) input.value = '';
  updatePending();
}

function updatePending() {
  const queue = chatQueue(state.chat.channel);
  const pending = queue.pending();
  const node = $('chatPending');
  if (pending === 0) {
    node.hidden = true;
    return;
  }
  const delay = queue.nextDelay();
  node.hidden = false;
  node.textContent = `${pending} 条待发送${delay !== null ? ` · 约 ${Math.ceil(delay / 100) / 10} 秒后打包发出` : ''}`;
}

function switchChannel(channel) {
  state.chat.channel = channel;
  state.chat.unread[channel] = 0;
  renderChannelTabs();
  renderChat();
  updatePending();
  void loadHistory(channel);
}

/* ------------------------------ 页签 ------------------------------ */

function switchTab(tab) {
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.id !== `panel-${tab}`;
  }
}

/* ------------------------------ 事件绑定 ------------------------------ */

function bindEvents() {
  $('connectBtn').addEventListener('click', () => void connect().catch((error) => onError(error, $('authMsg'))));
  $('server').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void connect().catch((error) => onError(error, $('authMsg')));
  });

  $('copyDevice').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.deviceCode);
      setMsg($('authMsg'), '设备码已复制', 'ok');
    } catch {
      setMsg($('authMsg'), `设备码：${state.deviceCode}`, 'warn');
    }
  });

  $('registerBtn').addEventListener('click', () => void registerAccount().catch((error) => onError(error, $('authMsg'))));
  $('redeemBtn').addEventListener('click', () => void redeemRecovery().catch((error) => onError(error, $('authMsg'))));
  $('rotateBtn').addEventListener('click', () => void rotateRecovery().catch((error) => onError(error, $('authMsg'))));
  $('renameBtn').addEventListener('click', () => void renameAccount().catch((error) => onError(error, $('authMsg'))));
  $('logoutBtn').addEventListener('click', logout);

  $('pickFile').addEventListener('click', () => $('saveFile').click());
  $('saveFile').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    void pickSaveFile(file).catch((error) => onError(error, $('saveMsg')));
  });

  const drop = $('dropZone');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove('over');
    });
  }
  drop.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    void pickSaveFile(file).catch((error) => onError(error, $('saveMsg')));
  });

  $('uploadBtn').addEventListener('click', () =>
    void uploadSave().catch((error) => {
      if (error.code === 'save_conflict') showConflict(error.extra?.latestVersion ?? '更高版本');
      else onError(error, $('saveMsg'));
    }),
  );
  $('downloadBtn').addEventListener('click', () => void downloadLatestSave().catch((error) => onError(error, $('saveMsg'))));
  $('refreshSave').addEventListener('click', () => void refreshSave().catch((error) => onError(error, $('saveMsg'))));
  $('saveFileOut').addEventListener('click', () => {
    if (!state.save.serverData) return;
    saveTextAsFile(state.save.serverData, `whale-save-v${state.save.serverVersion}.json`);
  });

  $('walletRefresh').addEventListener('click', () => void refreshWallet().catch((error) => onError(error)));
  $('invRefresh').addEventListener('click', () => void refreshInventory().catch((error) => onError(error)));
  $('prodSubmit').addEventListener('click', () => void submitProductionSingle().catch((error) => onError(error, $('prodMsg'))));
  $('prodJsonBtn').addEventListener('click', () => void submitProductionBatch().catch((error) => onError(error, $('prodMsg'))));

  $('marketSearch').addEventListener('click', () => void searchCatalog().catch((error) => onError(error, $('tradeMsg'))));
  $('marketQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void searchCatalog().catch((error) => onError(error, $('tradeMsg')));
  });
  $('orderSubmit').addEventListener('click', () => void submitOrder().catch((error) => onError(error, $('tradeMsg'))));
  $('ordersRefresh').addEventListener('click', () => void refreshOrders().catch((error) => onError(error)));

  $('ledgerRefresh').addEventListener('click', () => void refreshLedger().catch((error) => onError(error, $('ledgerMsg'))));
  $('ledgerVerify').addEventListener('click', () => void verifyLedger().catch((error) => onError(error, $('ledgerMsg'))));

  for (const button of document.querySelectorAll('.tab')) {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
      if (button.dataset.tab === 'ledger') void refreshLedger().catch((error) => onError(error, $('ledgerMsg')));
      if (button.dataset.tab === 'inventory') void refreshInventory().catch((error) => onError(error));
      if (button.dataset.tab === 'market') void refreshOrders().catch((error) => onError(error));
    });
  }

  for (const button of document.querySelectorAll('.chan')) {
    button.addEventListener('click', () => switchChannel(button.dataset.channel));
  }

  $('chatSend').addEventListener('click', queueChatMessage);
  $('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      queueChatMessage();
    }
  });
  $('onlineList').addEventListener('click', () => {
    const names = state.chat.online.length ? state.chat.online.join('、') : '（暂无）';
    appendChat(state.chat.channel, { kind: 'system', text: `在线名单：${names}` });
  });

  setInterval(updatePending, 500);
}

/* ------------------------------ 启动 ------------------------------ */

restoreConfig();
renderAuth();
renderChannelTabs();
bindEvents();
void connect().catch((error) => setMsg($('authMsg'), error.message, 'bad'));
