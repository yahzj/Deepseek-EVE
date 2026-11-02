import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticate } from './auth.js';
import type { ServerConfig } from './config.js';

export type ChatClientFrame =
  | { type: 'batch'; channel: string; messages: unknown }
  | { type: 'ping' };

export type ChatServerFrame =
  | { type: 'hello'; nickname: string; online: string[]; channels: readonly string[] }
  | { type: 'batch'; channel: string; nickname: string; messages: string[]; ts: number }
  | { type: 'presence'; event: 'join' | 'leave'; nickname: string; onlineCount: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

interface ClientState {
  ws: WebSocket;
  playerId: number;
  nickname: string;
  lastBatchAt: number;
  alive: boolean;
}

/**
 * WebSocket 聊天：
 * - 客户端把多条消息打成一个 batch 帧发送（打包节奏由客户端控制，建议 3 秒）；
 * - 服务器逐条校验后落库并原样广播该帧，避免高人数时逐条广播放大流量；
 * - 限频：相邻 batch 帧间隔不得小于 chatBatchIntervalMs。
 */
export function attachChat(server: Server, db: DatabaseSync, config: ServerConfig): { close: () => void } {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientState>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/chat/ws') {
      socket.destroy();
      return;
    }
    try {
      const account = authenticate(db, url.searchParams.get('token'));
      wss.handleUpgrade(req, socket, head, (ws) => {
        const state: ClientState = {
          ws,
          playerId: account.id,
          nickname: account.nickname,
          lastBatchAt: 0,
          alive: true,
        };
        clients.add(state);
        setupClient(state, db, config, clients);
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        clients.delete(client);
        client.ws.terminate();
        broadcastPresence(clients, 'leave', client.nickname);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, 30_000);

  return {
    close: () => {
      clearInterval(heartbeat);
      for (const client of clients) {
        client.ws.close();
      }
      wss.close();
    },
  };
}

function setupClient(
  state: ClientState,
  db: DatabaseSync,
  config: ServerConfig,
  clients: Set<ClientState>,
): void {
  const hello: ChatServerFrame = {
    type: 'hello',
    nickname: state.nickname,
    online: [...clients].map((c) => c.nickname),
    channels: config.chatChannels,
  };
  state.ws.send(JSON.stringify(hello));
  broadcastPresence(clients, 'join', state.nickname);

  state.ws.on('pong', () => {
    state.alive = true;
  });

  state.ws.on('message', (raw) => {
    let frame: ChatClientFrame;
    try {
      frame = JSON.parse(String(raw)) as ChatClientFrame;
    } catch {
      sendError(state, 'bad_json', '消息不是合法 JSON');
      return;
    }

    if (frame.type === 'ping') {
      const pong: ChatServerFrame = { type: 'pong' };
      state.ws.send(JSON.stringify(pong));
      return;
    }

    if (frame.type !== 'batch') {
      sendError(state, 'bad_frame', '只接受 batch 与 ping 帧');
      return;
    }
    handleBatch(state, frame, db, config, clients);
  });

  state.ws.on('close', () => {
    clients.delete(state);
    broadcastPresence(clients, 'leave', state.nickname);
  });

  state.ws.on('error', () => {
    clients.delete(state);
  });
}

function handleBatch(
  state: ClientState,
  frame: Extract<ChatClientFrame, { type: 'batch' }>,
  db: DatabaseSync,
  config: ServerConfig,
  clients: Set<ClientState>,
): void {
  if (!config.chatChannels.includes(frame.channel)) {
    sendError(state, 'bad_channel', `channel 必须是 ${config.chatChannels.join(' 或 ')}`);
    return;
  }
  const now = Date.now();
  if (now - state.lastBatchAt < config.chatBatchIntervalMs) {
    sendError(state, 'rate_limited', `发送间隔不得小于 ${config.chatBatchIntervalMs} 毫秒`);
    return;
  }
  if (!Array.isArray(frame.messages) || frame.messages.length === 0) {
    sendError(state, 'bad_batch', 'messages 必须是非空数组');
    return;
  }
  if (frame.messages.length > config.chatBatchMaxMessages) {
    sendError(state, 'bad_batch', `一个打包帧最多 ${config.chatBatchMaxMessages} 条消息`);
    return;
  }

  const cleaned: string[] = [];
  for (const item of frame.messages) {
    if (typeof item !== 'string') {
      sendError(state, 'bad_batch', '每条消息必须是字符串');
      return;
    }
    const text = item.trim();
    if (text.length === 0) {
      continue;
    }
    if (text.length > config.chatMessageMaxChars) {
      sendError(state, 'bad_batch', `单条消息不超过 ${config.chatMessageMaxChars} 字符`);
      return;
    }
    cleaned.push(text);
  }
  if (cleaned.length === 0) {
    sendError(state, 'bad_batch', '打包帧里没有有效消息');
    return;
  }

  state.lastBatchAt = now;
  const insert = db.prepare(
    'INSERT INTO messages (channel, account_id, nickname, text, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const text of cleaned) {
    insert.run(frame.channel, state.playerId, state.nickname, text, now);
  }
  // 每频道只留最近 N 条，超出的从最旧删起（控制 SQLite 体积）
  db.prepare(
    `DELETE FROM messages WHERE channel = ? AND id NOT IN (
       SELECT id FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(frame.channel, frame.channel, config.chatRetentionPerChannel);

  const broadcast: ChatServerFrame = {
    type: 'batch',
    channel: frame.channel,
    nickname: state.nickname,
    messages: cleaned,
    ts: now,
  };
  const payload = JSON.stringify(broadcast);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function broadcastPresence(
  clients: Set<ClientState>,
  event: 'join' | 'leave',
  nickname: string,
): void {
  const frame: ChatServerFrame = { type: 'presence', event, nickname, onlineCount: clients.size };
  const payload = JSON.stringify(frame);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function sendError(state: ClientState, code: string, message: string): void {
  const frame: ChatServerFrame = { type: 'error', code, message };
  state.ws.send(JSON.stringify(frame));
}
