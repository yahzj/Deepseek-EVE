import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog, type Catalog, type CatalogOptions } from './catalog.js';

/**
 * 内容表位置随部署形态不同：
 * - 仓库内：apps/server/src → ../../../content-csv
 * - 服务器独立部署：~/whale-server/src → ../content-csv
 * 取第一个存在的目录，两种形态都能跑这套测试。
 */
export const CONTENT_DIR =
  [
    process.env['WHALE_CONTENT_TEST_DIR'],
    fileURLToPath(new URL('../../../content-csv/', import.meta.url)),
    fileURLToPath(new URL('../content-csv/', import.meta.url)),
  ].find((dir): dir is string => typeof dir === 'string' && existsSync(dir)) ?? '';

/** 与生产默认值同口径的目录参数（配额 50 万 cr/分钟 + 各类别硬顶）。 */
export const catalogOptions = (floorRatio = 0.6): CatalogOptions => ({
  floorRatio,
  productionValueQuota: 500_000,
  productionKindCaps: { item: 8000, module: 40, ship: 6, blueprint: 10, aicore: 6 },
});

/** 加载真实内容表，供需要「真实规格」的用例使用。 */
export const loadRealCatalog = (floorRatio = 0.6): Catalog =>
  loadCatalog(CONTENT_DIR, catalogOptions(floorRatio));
