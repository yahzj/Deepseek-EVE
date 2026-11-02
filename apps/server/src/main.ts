import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const dbPath = process.env.WHALE_SERVER_DB ?? 'data/whale-server.db';
mkdirSync(dirname(dbPath), { recursive: true });

const app = createApp({ dbPath });
await app.listen();

const stop = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

console.log(`[whale-server] 已启动：http://0.0.0.0:${config.port}（存档库：${dbPath}）`);
