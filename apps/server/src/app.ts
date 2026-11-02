import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadConfig } from './config.js';
import type { ServerConfig } from './config.js';
import { emptyCatalog, loadCatalog, type Catalog } from './catalog.js';
import { handleApi } from './http-api.js';
import { attachChat } from './chat.js';
import { RateLimiter } from './rate-limit.js';
import { createStaticHandler } from './static.js';

export interface AppOptions {
  dbPath?: string;
  config?: Partial<ServerConfig>;
  /** 测试可直接注入目录；生产从内容表加载 */
  catalog?: Catalog;
  /** 客户端静态资源目录，默认 apps/server/public */
  publicDir?: string;
}

export interface App {
  listen: (port?: number) => Promise<number>;
  close: () => Promise<void>;
  db: ReturnType<typeof openDb>;
  catalog: Catalog;
}

function loadCatalogSafely(config: ServerConfig): Catalog {
  try {
    const catalog = loadCatalog(config.contentDir, {
      floorRatio: config.floorRatio,
      productionValueQuota: config.productionValueQuota,
      productionKindCaps: config.productionLimits,
    });
    if (catalog.all().length === 0) {
      console.warn(`[whale-server] 内容表为空：${config.contentDir}`);
    }
    return catalog;
  } catch (error) {
    console.warn(
      `[whale-server] 内容表加载失败（${config.contentDir}）：${(error as Error).message}；市场接口将返回空目录`,
    );
    return emptyCatalog();
  }
}

export function createApp(options: AppOptions = {}): App {
  const dbPath = options.dbPath ?? process.env.WHALE_SERVER_DB ?? 'data/whale-server.db';
  const db = openDb(dbPath);
  const config = loadConfig(options.config);
  const catalog = options.catalog ?? loadCatalogSafely(config);
  const limiter = new RateLimiter();
  const publicDir = options.publicDir ?? fileURLToPath(new URL('../public/', import.meta.url));
  const serveStatic = createStaticHandler(publicDir);
  const server = createServer((req, res) => {
    void handleApi(req, res, db, config, catalog, limiter, serveStatic).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ code: 'internal_error', message: '服务器内部错误' }));
    });
  });
  server.keepAliveTimeout = 65_000;
  const chat = attachChat(server, db, config);

  return {
    db,
    catalog,
    listen: (port?: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port ?? config.port, () => {
          const address = server.address();
          resolve(typeof address === 'object' && address !== null ? address.port : config.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        chat.close();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
