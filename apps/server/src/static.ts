/**
 * 静态资源服务：把 public/ 下的客户端页面与脚本发给浏览器。
 *
 * 这些文件随服务端一起部署，不参与游戏构建；改动后重启服务即可生效。
 * 安全口径：只允许 public/ 目录内的普通文件，拒绝路径穿越与二进制大文件。
 */
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 单个静态文件上限：客户端页面都很小，超过说明配置错了 */
const MAX_FILE_BYTES = 1024 * 1024;

/** 地址重写：`/` 与 `/debug` 直接映射到具体文件 */
const REWRITE: Record<string, string> = {
  '/': '/index.html',
  '/debug': '/debug.html',
};

const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;

export type StaticHandler = (pathname: string, res: ServerResponse) => boolean;

export function createStaticHandler(publicDir: string): StaticHandler {
  const root = resolve(publicDir);
  const cache = new Map<string, Buffer>();

  return (pathname, res) => {
    const mapped = REWRITE[pathname] ?? pathname;
    let decoded: string;
    try {
      decoded = decodeURIComponent(mapped);
    } catch {
      return false;
    }
    // 只接受简单相对路径：拒绝 `..`、空段、编码绕过与绝对路径
    if (!SAFE_PATH.test(decoded) || decoded.includes('..') || decoded.includes('//')) {
      return false;
    }

    const filePath = resolve(root, `.${decoded}`);
    if (!filePath.startsWith(root + sep)) {
      return false;
    }
    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext];
    if (!type) {
      return false;
    }

    let body = cache.get(filePath);
    if (!body) {
      try {
        body = readFileSync(filePath);
      } catch {
        return false;
      }
      if (body.byteLength > MAX_FILE_BYTES) {
        return false;
      }
      cache.set(filePath, body);
    }

    res.writeHead(200, {
      'content-type': type,
      'content-length': body.byteLength,
      // 页面与脚本都随部署更新，交给浏览器每次校验，避免玩家卡在旧版本
      'cache-control': 'no-cache',
    });
    res.end(body);
    return true;
  };
}
